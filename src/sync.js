// ═══════════════════════════════════════════════════════════════════════
//  RETOMA — Sincronização (offline primeiro)
//
//  O app sempre lê e grava no arquivo local. Quando há login, este módulo:
//   1. ENVIA o que mudou (registro "sujo" = updatedAt diferente de _s, a última versão sincronizada)
//   2. RECEBE o que mudou na nuvem desde o último cursor (server_updated_at)
//   3. Em conflito vale a alteração mais recente (updatedAt / client_updated_at) — o banco
//      também garante isso (gatilho sync_stamp)
//   4. Exclusão = marca deleted_at (lápide), pra outros aparelhos também apagarem
//   5. De tempos em tempos confere quais retomas ainda são visíveis (ex.: o gerente passou
//      um cliente pra outro vendedor → some deste aparelho)
//
//  Campos só locais (não vão pra nuvem): _s (versão sincronizada), _remote (já existe na nuvem)
//  Não depende do Electron: recebe { store, getClient } — dá pra testar em Node puro.
// ═══════════════════════════════════════════════════════════════════════
const Core = require('./core.js')

const BATCH = 200
const PULL_PAGE = 1000
const iso = t => { const d = new Date(t); return isNaN(d) ? new Date().toISOString() : d.toISOString() }
const newer = (a, b) => Date.parse(a || 0) > Date.parse(b || 0)
const dirty = r => r && r._s !== r.updatedAt

function toRow(f, status, me) {
  return {
    id: String(f.id), workspace_id: f.biz,
    owner_id: f.owner === undefined ? me : f.owner,          // null = carteira sem dono
    created_by: f.createdBy || me,
    name: f.name || '', phone: f.phone || '', note: f.note || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : null,
    time: f.time || '', prio: ['alta', 'media', 'baixa'].includes(f.prio) ? f.prio : 'media',
    fields: f.fields || null, value: typeof f.value === 'number' ? f.value : null,
    snoozes: f.snoozes || 0, status,
    done_at: status === 'done' ? (f.doneAt || f.updatedAt) : null,
    outcome: status === 'done' && ['won', 'lost'].includes(f.outcome) ? f.outcome : null,
    recovered: !!f.recovered,
    client_created_at: iso(f.createdAt || f.updatedAt), client_updated_at: iso(f.updatedAt),
    deleted_at: null,
  }
}
function fromRow(r) {
  const f = {
    id: r.id, biz: r.workspace_id, owner: r.owner_id || null, createdBy: r.created_by || null,
    name: r.name, phone: r.phone, note: r.note, date: r.date ? String(r.date).slice(0, 10) : '',
    time: r.time || '', prio: r.prio || 'media', snoozes: r.snoozes || 0,
    createdAt: iso(r.client_created_at), updatedAt: iso(r.client_updated_at),
  }
  if (r.fields && Object.keys(r.fields).length) f.fields = r.fields
  if (r.value !== null && r.value !== undefined) f.value = Number(r.value)
  if (r.status === 'done') { f.doneAt = iso(r.done_at || r.client_updated_at); if (r.outcome) f.outcome = r.outcome; if (r.recovered) f.recovered = true }
  if (!f.snoozes) delete f.snoozes
  f._s = f.updatedAt; f._remote = true
  return f
}

class Sync {
  constructor({ store, getClient, onApplied = () => {}, onStatus = () => {}, log = () => {} }) {
    this.store = store; this.getClient = getClient
    this.onApplied = onApplied; this.onStatus = onStatus; this.log = log
    this.user = null; this.running = false; this.again = false
    this.timer = null; this.tick = null; this.lastFull = 0
    this.state = 'off'; this.error = null
  }
  get data() { return this.store.data }
  meta() { return this.data.sync || (this.data.sync = {}) }
  status() {
    const m = this.data.sync || {}
    return { state: this.state, error: this.error, lastSync: m.lastSync || null, user: this.user }
  }
  setState(s, err = null) { this.state = s; this.error = err; this.onStatus(this.status()) }

  // Entrou: prepara os dados locais e começa a sincronizar
  start(user) {
    this.user = user
    const m = this.meta()
    if (m.userId && m.userId !== user.id) this.resetForNewUser()
    m.userId = user.id
    this.store.save()
    this.setState('idle')
    clearInterval(this.tick)
    this.tick = setInterval(() => this.syncNow(), 60 * 1000)
    return this.syncNow({ full: true })
  }
  stop({ wipe = false } = {}) {
    clearInterval(this.tick); clearTimeout(this.timer)
    this.user = null
    const d = this.data
    if (wipe) {
      // "Sair e apagar deste computador": fica só o básico pra recomeçar
      for (const k of ['followups', 'done', 'businesses', 'tombstones', 'people', 'roles', 'templates', 'settings']) delete d[k]
      delete d.sync
      Core.normalize(d)
    } else if (d.sync) { d.sync = { userId: d.sync.userId, lastSync: d.sync.lastSync } }
    this.store.save()
    this.setState('off')
  }
  // Outra conta entrou neste PC: não mistura dados de pessoas diferentes
  resetForNewUser() {
    const d = this.data
    this.store.backup && this.store.backup('antes-de-trocar-de-conta')
    for (const k of ['followups', 'done', 'businesses', 'tombstones', 'people', 'roles']) delete d[k]
    d.sync = {}
    Core.normalize(d)
  }

  schedule(ms = 2500) {
    if (!this.user) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.syncNow(), ms)
  }

  async syncNow({ full = false } = {}) {
    if (!this.user) return this.status()
    if (this.running) { this.again = true; return this.status() }
    this.running = true
    const sb = this.getClient()
    this.setState('syncing')
    try {
      if (full || Date.now() - this.lastFull > 10 * 60 * 1000) { full = true; this.lastFull = Date.now() }
      // 1ª vez neste aparelho: recebe antes, pra não subir o negócio provisório à toa
      if (!this.meta().cursorW) { await this.pull(sb, { full: false }); this.dropPlaceholder() }
      this.claimLocal()
      await this.pushWorkspaces(sb)
      await this.pushRetomas(sb)
      await this.pushPrefs(sb)
      const changed = await this.pull(sb, { full })
      this.meta().lastSync = new Date().toISOString()
      this.store.save()
      if (changed) this.onApplied()
      this.setState('idle')
    } catch (e) {
      const msg = String((e && e.message) || e)
      const offline = /fetch failed|network|enotfound|econnrefused|timeout|socket/i.test(msg)
      this.log('sync error', msg)
      this.setState(offline ? 'offline' : 'error', offline ? 'Sem internet: as mudanças ficam guardadas e sobem quando voltar.' : msg)
    } finally {
      this.running = false
      if (this.again) { this.again = false; this.schedule(500) }
    }
    return this.status()
  }

  // "Meu negócio" provisório, vazio e nunca enviado: some se a conta já tem negócios
  dropPlaceholder() {
    const d = this.data, list = d.businesses || []
    const ph = list.filter(b => b._auto && !b._remote && !(d.followups || []).some(f => f.biz === b.id) && !(d.done || []).some(f => f.biz === b.id))
    if (ph.length && list.some(b => b._remote && !b.archived)) d.businesses = list.filter(b => !ph.includes(b))
  }

  // Registros sem dono (feitos antes do login) passam a ser meus
  claimLocal() {
    const me = this.user.id
    for (const key of ['followups', 'done']) for (const f of (this.data[key] || [])) {
      if (f.owner === undefined) f.owner = me
      if (!f.createdBy) f.createdBy = me
    }
  }
  role(bizId) { return (this.data.roles || {})[bizId] || null }

  // ─── ENVIAR ───────────────────────────────────────────────────────────
  async pushWorkspaces(sb) {
    const me = this.user.id
    for (const b of (this.data.businesses || []).filter(dirty)) {
      const sent = b.updatedAt
      const role = this.role(b.id)
      const shared = { name: b.name, color: b.color, kind: b.kind, fields: b.fields || [], client_updated_at: iso(b.updatedAt) }
      if (!b._remote) {
        const { error } = await sb.from('workspaces').insert({ id: b.id, owner_id: me, ...shared })
        if (error && !/duplicate|unique|23505/i.test(error.message + (error.code || ''))) throw error
        if (!error) { (this.data.roles || (this.data.roles = {}))[b.id] = 'owner' }
      } else if (role === 'owner' || role === 'manager') {
        const { error } = await sb.from('workspaces').update(shared).eq('id', b.id)
        if (error) throw error
      }
      // preferências pessoais (meu WhatsApp, pílula, arquivado)
      const { error: e2 } = await sb.from('workspace_members')
        .update({ wa_phone: b.phone || '', show_in_pill: !!b.showInPill, archived: !!b.archived, client_updated_at: iso(b.updatedAt) })
        .eq('workspace_id', b.id).eq('user_id', me)
      if (e2) throw e2
      const cur = (this.data.businesses || []).find(x => x.id === b.id)
      if (cur && cur.updatedAt === sent) { cur._s = sent; cur._remote = true }
    }
  }

  async pushRetomas(sb) {
    const me = this.user.id
    const rows = []
    for (const f of (this.data.followups || [])) if (dirty(f)) rows.push([f, toRow(f, 'active', me)])
    for (const f of (this.data.done || [])) if (dirty(f)) rows.push([f, toRow(f, 'done', me)])
    for (const t of (this.data.tombstones || [])) {
      // lápide: só os campos que o banco exige + deleted_at
      rows.push([t, { ...toRow(t.row || { id: t.id, biz: t.biz, updatedAt: t.deletedAt }, 'active', me), id: String(t.id), workspace_id: t.biz, deleted_at: iso(t.deletedAt), client_updated_at: iso(t.deletedAt) }])
    }
    const known = new Set((this.data.businesses || []).filter(b => b._remote).map(b => b.id))
    const ready = rows.filter(([, r]) => known.has(r.workspace_id))
    for (let i = 0; i < ready.length; i += BATCH) {
      const chunk = ready.slice(i, i + BATCH)
      const { error } = await sb.from('retomas').upsert(chunk.map(c => c[1]), { onConflict: 'id' })
      if (error) {
        if (/fetch failed|network|timeout/i.test(error.message)) throw error
        // um registro sem permissão não pode travar os outros: tenta um por um
        for (const c of chunk) {
          const { error: e1 } = await sb.from('retomas').upsert([c[1]], { onConflict: 'id' })
          if (e1) { this.log('recusado', c[1].id, e1.message); this.markSent(c, true) } else this.markSent(c)
        }
      } else chunk.forEach(c => this.markSent(c))
    }
  }
  markSent([local, row], rejected = false) {
    if (row.deleted_at) { this.data.tombstones = (this.data.tombstones || []).filter(t => t.id !== local.id); return }
    for (const key of ['followups', 'done']) {
      const cur = (this.data[key] || []).find(x => x.id === local.id)
      if (cur && iso(cur.updatedAt) === row.client_updated_at) { cur._s = cur.updatedAt; cur._remote = !rejected }
    }
  }

  async pushPrefs(sb) {
    const d = this.data
    if (!d.prefsUpdatedAt || d.prefsUpdatedAt === this.meta().prefsSent) return
    const st = Core.getSettings(d)
    const prefs = { settings: { features: st.features, routine: st.routine, visual: st.visual }, templates: d.templates || null }
    const { error } = await sb.from('profiles').update({ prefs, prefs_updated_at: iso(d.prefsUpdatedAt) }).eq('id', this.user.id)
    if (error) throw error
    this.meta().prefsSent = d.prefsUpdatedAt
  }

  // ─── RECEBER ──────────────────────────────────────────────────────────
  async pull(sb, { full }) {
    const me = this.user.id, d = this.data, m = this.meta()
    let changed = false

    // Pessoas e papéis em cada negócio
    const { data: people, error: pe } = await sb.rpc('ws_people')
    if (pe) throw pe
    const roles = {}, byWs = {}
    for (const p of people || []) {
      if (p.user_id === me) roles[p.workspace_id] = p.role
      ;(byWs[p.workspace_id] || (byWs[p.workspace_id] = [])).push({ id: p.user_id, role: p.role, name: p.display_name || (p.email || '').split('@')[0], email: p.email })
    }
    if (JSON.stringify(d.roles || {}) !== JSON.stringify(roles) || JSON.stringify(d.people || {}) !== JSON.stringify(byWs)) changed = true
    d.roles = roles; d.people = byWs

    // Negócios
    const ws = await this.pullTable(sb, 'workspaces', m.cursorW)
    for (const w of ws.rows) {
      const list = d.businesses || (d.businesses = [])
      let b = list.find(x => x.id === w.id)
      if (w.deleted_at) { if (b) { d.businesses = list.filter(x => x.id !== w.id); changed = true } continue }
      const incoming = iso(w.client_updated_at)
      if (!b) {
        b = Core.makeBusiness({ id: w.id, name: w.name, color: w.color, kind: w.kind, fields: w.fields, createdAt: iso(w.created_at), updatedAt: incoming })
        b._s = b.updatedAt; b._remote = true; list.push(b); changed = true
      } else if (!dirty(b) || !newer(b.updatedAt, incoming)) {
        Object.assign(b, { name: w.name, color: w.color, kind: w.kind, fields: Core.cleanFields(w.fields) })
        if (newer(incoming, b.updatedAt)) b.updatedAt = incoming
        b._s = b.updatedAt; b._remote = true; changed = true
      }
    }
    if (ws.cursor) m.cursorW = ws.cursor

    // Minhas preferências em cada negócio
    const mem = await this.pullTable(sb, 'workspace_members', m.cursorM, q => q.eq('user_id', me))
    for (const r of mem.rows) {
      const b = (d.businesses || []).find(x => x.id === r.workspace_id); if (!b) continue
      const incoming = iso(r.client_updated_at)
      if (!dirty(b) || newer(incoming, b.updatedAt)) {
        b.phone = r.wa_phone || ''; b.showInPill = r.show_in_pill; b.archived = r.archived
        changed = true
      }
    }
    if (mem.cursor) m.cursorM = mem.cursor

    // Saí (ou fui tirado) de um negócio: some daqui
    const mine = new Set(Object.keys(roles))
    const gone = (d.businesses || []).filter(b => b._remote && !mine.has(b.id))
    if (gone.length) {
      const ids = new Set(gone.map(b => b.id))
      d.businesses = d.businesses.filter(b => !ids.has(b.id))
      d.followups = (d.followups || []).filter(f => !ids.has(f.biz))
      d.done = (d.done || []).filter(f => !ids.has(f.biz))
      if (!d.businesses.some(b => !b.archived)) Core.normalize(d)
      changed = true
    }

    // Retomas
    const rt = await this.pullTable(sb, 'retomas', m.cursorR)
    for (const r of rt.rows) changed = this.applyRetoma(r) || changed
    if (rt.cursor) m.cursorR = rt.cursor

    // Retomas que não enxergo mais (passados pra outro vendedor)
    if (full) {
      for (const bizId of mine) {
        const { data: vis, error } = await sb.rpc('visible_retoma_ids', { ws: bizId })
        if (error) throw error
        const set = new Set((vis || []).map(x => typeof x === 'string' ? x : x.visible_retoma_ids || x.id))
        for (const key of ['followups', 'done']) {
          const before = (d[key] || []).length
          d[key] = (d[key] || []).filter(f => f.biz !== bizId || !f._remote || dirty(f) || set.has(String(f.id)))
          if (d[key].length !== before) changed = true
        }
      }
    }

    // Perfil: plano + configurações + mensagens prontas
    const { data: prof, error: pfe } = await sb.from('profiles').select('display_name, plan, prefs, prefs_updated_at').eq('id', me).maybeSingle()
    if (pfe) throw pfe
    if (prof) {
      d.account = { ...(d.account || {}), plan: prof.plan || 'free', name: prof.display_name || '' }
      const pAt = iso(prof.prefs_updated_at)
      if (prof.prefs && Object.keys(prof.prefs).length && newer(pAt, d.prefsUpdatedAt)) {
        if (prof.prefs.settings) Core.patchSettings(d, prof.prefs.settings)
        if (Array.isArray(prof.prefs.templates)) d.templates = prof.prefs.templates
        d.prefsUpdatedAt = pAt; m.prefsSent = pAt
        changed = true
      }
    }
    return changed
  }

  async pullTable(sb, table, cursor, extra) {
    let rows = [], last = cursor || null
    for (let page = 0; page < 50; page++) {
      let q = sb.from(table).select('*')
      if (last) q = q.gte('server_updated_at', last)
      if (extra) q = extra(q)
      q = q.order('server_updated_at', { ascending: true }).limit(PULL_PAGE)
      const { data, error } = await q
      if (error) throw error
      const fresh = (data || []).filter(r => !rows.some(x => (x.id || x.workspace_id + x.user_id) === (r.id || r.workspace_id + r.user_id) && x.server_updated_at === r.server_updated_at))
      rows = rows.concat(fresh)
      if (!data || data.length < PULL_PAGE || !fresh.length) { if (data && data.length) last = data[data.length - 1].server_updated_at; break }
      last = data[data.length - 1].server_updated_at
    }
    return { rows, cursor: last }
  }

  applyRetoma(r) {
    const d = this.data
    const id = String(r.id)
    const act = d.followups || (d.followups = []), done = d.done || (d.done = [])
    const local = act.find(f => f.id === id) || done.find(f => f.id === id)
    const incoming = iso(r.client_updated_at)
    if (local && dirty(local) && newer(local.updatedAt, incoming)) return false   // o meu é mais novo: fica e sobe depois
    if (local && !dirty(local) && local._s === incoming && !r.deleted_at) return false  // já tenho
    d.followups = act.filter(f => f.id !== id)
    d.done = done.filter(f => f.id !== id)
    if (r.deleted_at) { d.tombstones = (d.tombstones || []).filter(t => t.id !== id); return !!local }
    const f = fromRow(r)
    if (r.status === 'done') d.done.unshift(f); else d.followups.push(f)
    return true
  }
}

// Exclusão definitiva vira lápide (pra apagar também nos outros aparelhos)
function tombstone(data, item) {
  if (!item || !item.id) return
  const t = new Date().toISOString()
  ;(data.tombstones || (data.tombstones = [])).push({ id: String(item.id), biz: item.biz, deletedAt: t, row: { ...item, updatedAt: t } })
}

module.exports = { Sync, toRow, fromRow, tombstone }
