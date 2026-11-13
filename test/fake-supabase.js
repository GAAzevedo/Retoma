// ─── Supabase "de teste" ────────────────────────────────────────────────
// Imita a parte do supabase-js que o Retoma usa, por cima de um Postgres real (PGlite)
// com o MESMO schema e as MESMAS regras RLS do Supabase. Só para testes automáticos.
//   create({ dataDir?, db?, storage? })  — db compartilhado = vários "aparelhos" no mesmo banco
// Senhas ficam em memória/arquivo de teste. Código de e-mail e de 2 etapas: sempre 123456.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const PGLITE = process.env.PGLITE || '@electric-sql/pglite'

const OID = { DATE: 1082, TSTZ: 1184, TS: 1114, NUMERIC: 1700 }
const SETOF = { ws_people: 'table', visible_retoma_ids: 'scalar', ws_invites: 'table', my_pending_invites: 'table', accept_my_invites: 'scalar' }

async function openDb(dataDir) {
  // caminho de pasta: usa a versão CommonJS (o Electron 31 não carrega o ESM com require)
  const mod = path.isAbsolute(PGLITE) && fs.existsSync(path.join(PGLITE, 'dist/index.cjs')) ? path.join(PGLITE, 'dist/index.cjs') : PGLITE
  const { PGlite } = require(mod)
  const db = new PGlite(dataDir || undefined)
  const has = await db.query(`select to_regclass('public.retomas') r`)
  if (!has.rows[0].r) {
    await db.exec(fs.readFileSync(path.join(__dirname, 'prelude.sql'), 'utf8'))
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8'))
    await db.exec(`create schema fakeauth; create table fakeauth.pw (email text primary key, id uuid, password text, confirmed boolean default true, factors jsonb default '[]'::jsonb)`)
  }
  db.__queue = Promise.resolve()
  return db
}

function conv(res) {
  const types = Object.fromEntries((res.fields || []).map(f => [f.name, f.dataTypeID]))
  return (res.rows || []).map(r => {
    const o = {}
    for (const [k, v] of Object.entries(r)) {
      const t = types[k]
      if (v instanceof Date) o[k] = t === OID.DATE ? v.toISOString().slice(0, 10) : v.toISOString()
      else if (t === OID.NUMERIC && v !== null) o[k] = Number(v)
      else o[k] = v
    }
    return o
  })
}

// Modo remoto: o banco roda num processo Node à parte (usado dentro do Electron)
let server = null, seq = 0
const waiting = new Map()
function remoteClient(device) {
  if (!server) {
    const { fork } = require('child_process')
    server = fork(path.join(__dirname, 'fake-server.js'), [], { execPath: process.env.FAKE_NODE || 'node', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    server.on('message', m => { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m.res) } })
  }
  const send = msg => new Promise(res => { const id = ++seq; waiting.set(id, res); server.send({ ...msg, id, device }) })
  class RQ {
    constructor(t) { this.t = t; this.ops = [] }
    then(res, rej) { return send({ type: 'query', table: this.t, ops: this.ops }).then(res, rej) }
  }
  for (const fn of ['select', 'insert', 'upsert', 'update', 'eq', 'gte', 'in', 'order', 'limit', 'maybeSingle'])
    RQ.prototype[fn] = function (...a) { this.ops.push([fn, a]); return this }
  const authProxy = (prefix = '') => new Proxy({}, { get: (_, k) => k === 'mfa' && !prefix ? authProxy('mfa.') : (...args) => send({ type: 'auth', path: prefix + String(k), args }) })
  return {
    from: t => new RQ(t),
    rpc: (name, args) => send({ type: 'rpc', name, args }),
    auth: authProxy(),
    __newDevice: () => remoteClient('dev-' + Math.random().toString(36).slice(2)),
    __mail: () => send({ type: 'mail' }),
  }
}

function create({ dataDir, db: shared, storage, remote } = {}) {
  if (remote || process.versions.electron) return remoteClient('main')
  let dbP = shared ? Promise.resolve(shared) : openDb(dataDir)
  const mem = {}
  const st = storage || { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, removeItem: k => { delete mem[k] } }
  const sess = () => { try { return JSON.parse(st.getItem('fake-session') || 'null') } catch (e) { return null } }
  const setSess = s => s ? st.setItem('fake-session', JSON.stringify(s)) : st.removeItem('fake-session')

  // fila: "set role" + consulta nunca se misturam entre chamadas
  async function run(fn, { asUser = true } = {}) {
    const db = await dbP
    const job = db.__queue.then(async () => {
      const s = sess()
      const claims = JSON.stringify({ sub: s && s.uid ? s.uid : '', amr: [{ method: (s && s.amr) || 'password' }] })
      if (asUser) await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${s && s.uid ? s.uid : ''}', false); select set_config('request.jwt.claims', '${claims}', false); set role authenticated;`)
      try { return await fn(db) } finally { await db.exec('reset role') }
    })
    db.__queue = job.catch(() => {})
    return job
  }
  const wrap = p => p.then(data => ({ data, error: null }), e => ({ data: null, error: { message: e.message, code: e.code } }))
  const q = id => '"' + String(id).replace(/"/g, '""') + '"'
  const val = (v, params) => {
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) { params.push(JSON.stringify(v)); return `$${params.length}::jsonb` }
    params.push(v); return `$${params.length}`
  }

  class Query {
    constructor(table) { this.t = table; this.op = 'select'; this.cols = '*'; this.w = []; this.ord = null; this.lim = null; this.one = false }
    select(c = '*') { if (this.op === 'select') this.cols = c; else this.ret = true; return this }
    insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this }
    upsert(rows, o = {}) { this.op = 'upsert'; this.rows = [].concat(rows); this.conflict = o.onConflict || 'id'; return this }
    update(p) { this.op = 'update'; this.patch = p; return this }
    eq(c, v) { this.w.push(['=', c, v]); return this }
    gte(c, v) { this.w.push(['>=', c, v]); return this }
    in(c, v) { this.w.push(['in', c, v]); return this }
    order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this }
    limit(n) { this.lim = n; return this }
    maybeSingle() { this.one = true; return this }
    where(params) {
      if (!this.w.length) return ''
      return ' where ' + this.w.map(([op, c, v]) => {
        if (op === 'in') { const ph = v.map(x => { params.push(x); return '$' + params.length }); return `${q(c)} in (${ph.join(',') || 'null'})` }
        params.push(v); return `${q(c)} ${op} $${params.length}`
      }).join(' and ')
    }
    sql() {
      const p = [], T = 'public.' + q(this.t)
      if (this.op === 'select') {
        let s = `select ${this.cols === '*' ? '*' : this.cols.split(',').map(c => q(c.trim())).join(',')} from ${T}` + this.where(p)
        if (this.ord) s += ` order by ${q(this.ord[0])} ${this.ord[1] ? 'asc' : 'desc'}`
        if (this.lim) s += ` limit ${Number(this.lim)}`
        return [s, p]
      }
      if (this.op === 'update') {
        const sets = Object.entries(this.patch).map(([k, v]) => `${q(k)} = ${val(v, p)}`).join(', ')
        return [`update ${T} set ${sets}` + this.where(p) + (this.ret ? ' returning *' : ''), p]
      }
      const cols = [...new Set(this.rows.flatMap(r => Object.keys(r)))]
      const values = this.rows.map(r => '(' + cols.map(c => val(r[c] === undefined ? null : r[c], p)).join(',') + ')').join(',')
      let s = `insert into ${T} (${cols.map(q).join(',')}) values ${values}`
      if (this.op === 'upsert') s += ` on conflict (${this.conflict}) do update set ${cols.filter(c => c !== this.conflict).map(c => `${q(c)} = excluded.${q(c)}`).join(', ')}`
      return [s + (this.ret ? ' returning *' : ''), p]   // supabase-js só devolve a linha com .select()
    }
    then(res, rej) {
      return wrap(run(async db => {
        const [s, p] = this.sql()
        const rows = conv(await db.query(s, p))
        return this.one ? (rows[0] || null) : rows
      })).then(res, rej)
    }
  }

  async function rpc(name, args = {}) {
    return wrap(run(async db => {
      const p = [], named = Object.entries(args).map(([k, v]) => { p.push(v); return `${q(k)} := $${p.length}` }).join(', ')
      const kind = SETOF[name]
      if (kind === 'table') return conv(await db.query(`select * from public.${q(name)}(${named})`, p))
      if (kind === 'scalar') return conv(await db.query(`select * from public.${q(name)}(${named}) x`, p)).map(r => r.x)
      const r = conv(await db.query(`select public.${q(name)}(${named}) as r`, p))
      return r[0] ? r[0].r : null
    }))
  }

  // ─── auth ─────────────────────────────────────────────────────────────
  const err = (message, code, status = 400) => ({ data: { user: null, session: null }, error: { message, code, status } })
  const userObj = row => row && { id: row.id, email: row.email, user_metadata: row.raw_user_meta_data || {} }
  const admin = fn => run(fn, { asUser: false })
  async function findUser(email) {
    const r = await admin(db => db.query(`select p.*, u.raw_user_meta_data from fakeauth.pw p join auth.users u on u.id = p.id where p.email = $1`, [email]))
    return r.rows[0] || null
  }
  async function sessionFor(row, aal = 'aal1', amr = 'password') {
    const s = { uid: row.id, aal, amr, access_token: 'fake.' + row.id }
    setSess(s)
    return { access_token: s.access_token, user: userObj(row) }
  }
  const auth = {
    async signUp({ email, password, options = {} }) {
      if (await findUser(email)) return err('User already registered', 'user_already_exists', 422)
      if (String(password).length < 6) return err('Password should be at least 6 characters', 'weak_password', 422)
      const id = crypto.randomUUID()
      const confirm = !process.env.FAKE_REQUIRE_CONFIRM
      await admin(async db => {
        await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, JSON.stringify(options.data || {})])
        await db.query(`insert into fakeauth.pw (email, id, password, confirmed) values ($1, $2, $3, $4)`, [email, id, password, confirm])
      })
      const row = await findUser(email)
      return { data: { user: userObj(row), session: confirm ? await sessionFor(row) : null }, error: null }
    },
    async signInWithPassword({ email, password }) {
      const row = await findUser(email)
      if (!row || !row.password || row.password !== password) return err('Invalid login credentials', 'invalid_credentials')
      if (!row.confirmed) return err('Email not confirmed', 'email_not_confirmed')
      return { data: { user: userObj(row), session: await sessionFor(row) }, error: null }
    },
    async signOut() { setSess(null); return { error: null } },
    async getSession() {
      const s = sess(); if (!s) return { data: { session: null }, error: null }
      const r = await admin(db => db.query(`select id, email, raw_user_meta_data from auth.users where id = $1`, [s.uid]))
      return { data: { session: r.rows[0] ? { access_token: s.access_token, user: userObj(r.rows[0]) } : null }, error: null }
    },
    async getUser() { const { data } = await auth.getSession(); return { data: { user: data.session ? data.session.user : null }, error: null } },
    async resend() { return { data: {}, error: null } },
    async resetPasswordForEmail() { return { data: {}, error: null } },
    async verifyOtp({ email, token }) {
      const row = await findUser(email)
      if (!row || token !== '123456') return err('Token has expired or is invalid', 'otp_expired', 403)
      await admin(db => db.query(`update fakeauth.pw set confirmed = true where id = $1`, [row.id]))
      return { data: { user: userObj(row), session: await sessionFor(row, 'aal1', 'otp') }, error: null }
    },
    // código de acesso por e-mail (convite). shouldCreateUser cria a conta sem senha
    async signInWithOtp({ email, options = {} }) {
      let row = await findUser(email)
      if (!row) {
        if (options.shouldCreateUser === false) return err('Signups not allowed for otp', 'otp_disabled', 422)
        const id = crypto.randomUUID()
        await admin(async db => {
          await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, JSON.stringify(options.data || {})])
          await db.query(`insert into fakeauth.pw (email, id, password, confirmed) values ($1, $2, null, false)`, [email, id])
        })
      }
      ;(globalThis.__fakeMail || (globalThis.__fakeMail = [])).push({ email, code: '123456', at: Date.now() })
      return { data: { user: null, session: null }, error: null }
    },
    async updateUser({ password, data }) {
      const s = sess(); if (!s) return err('Auth session missing!', 'session_missing', 401)
      if (password) await admin(db => db.query(`update fakeauth.pw set password = $1 where id = $2`, [password, s.uid]))
      if (data) await admin(db => db.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $1::jsonb where id = $2`, [JSON.stringify(data), s.uid]))
      return { data: {}, error: null }
    },
    async signInWithOAuth() { return { data: { url: 'about:blank' }, error: null } },
    async exchangeCodeForSession() { return err('not supported in fake', 'unsupported') },
    mfa: {
      async factors() { const s = sess(); const r = await admin(db => db.query(`select factors from fakeauth.pw where id = $1`, [s && s.uid])); return (r.rows[0] && r.rows[0].factors) || [] },
      async save(f) { const s = sess(); await admin(db => db.query(`update fakeauth.pw set factors = $1::jsonb where id = $2`, [JSON.stringify(f), s.uid])) },
      async listFactors() { const all = await auth.mfa.factors(); return { data: { all, totp: all.filter(f => f.status === 'verified') }, error: null } },
      async enroll() { const all = await auth.mfa.factors(); const f = { id: crypto.randomUUID(), status: 'unverified', factor_type: 'totp' }; await auth.mfa.save([...all, f]); return { data: { id: f.id, totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'FAKESECRET' } }, error: null } },
      async challengeAndVerify({ factorId, code }) {
        if (code !== '123456') return { data: null, error: { message: 'Invalid TOTP code entered', code: 'mfa_verification_failed' } }
        const all = await auth.mfa.factors(); const f = all.find(x => x.id === factorId); if (f) f.status = 'verified'; await auth.mfa.save(all)
        const s = sess(); s.aal = 'aal2'; setSess(s); return { data: {}, error: null }
      },
      async unenroll({ factorId }) { await auth.mfa.save((await auth.mfa.factors()).filter(f => f.id !== factorId)); return { data: {}, error: null } },
      async getAuthenticatorAssuranceLevel() {
        const s = sess(); if (!s) return { data: { currentLevel: null, nextLevel: null }, error: null }
        const v = (await auth.mfa.factors()).some(f => f.status === 'verified')
        return { data: { currentLevel: s.aal, nextLevel: v ? 'aal2' : 'aal1' }, error: null }
      },
    },
  }
  return { from: t => new Query(t), rpc, auth, __db: () => dbP, __newDevice: async () => create({ db: await dbP }), __mail: async () => globalThis.__fakeMail || [] }
}

module.exports = { create, openDb }
