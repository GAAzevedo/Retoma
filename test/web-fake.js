// Supabase simulado no navegador (só pra testar a versão celular). Sem RLS: as regras
// de verdade já são testadas no rls.test.js.
(function () {
  const d = new Date(), pad = n => String(n).padStart(2, '0'), ymd = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
  const today = ymd(d), y = new Date(d); y.setDate(d.getDate() - 1); const yest = ymd(y), t2 = new Date(d); t2.setDate(d.getDate() + 2); const plus2 = ymd(t2)
  const ME = 'u-gui', VIT = 'u-vit', LOJA = 'w-loja', ALVA = 'w-alva'
  const db = {
    workspaces: [{ id: LOJA, name: 'Construpac', color: '#1db954', kind: 'store', fields: [{ id: 'f1', label: 'm³', type: 'number', options: [], onCard: true }, { id: 'f2', label: 'Tipo de peça', type: 'choice', options: ['Deck', 'Pergolado', 'Viga'], onCard: true }, { id: 'f3', label: 'Valor', type: 'money', options: [], onCard: false }] },
      { id: ALVA, name: 'Alvamind', color: '#a855f7', kind: 'personal', fields: [] }],
    workspace_members: [{ workspace_id: LOJA, user_id: ME, role: 'owner', wa_phone: '11955554444', archived: false }, { workspace_id: ALVA, user_id: ME, role: 'owner', wa_phone: '11977776666', archived: false }],
    retomas: [
      { id: 'r1', workspace_id: LOJA, owner_id: ME, name: 'Bruno Madeiras', phone: '11999990001', note: 'Deck da varanda', date: today, time: '09:00', prio: 'alta', fields: { f1: 7.5, f2: 'Deck' }, value: 12000, status: 'active', snoozes: 0 },
      { id: 'r2', workspace_id: LOJA, owner_id: VIT, name: 'Pergolado Marcos', phone: '11955554444', note: '9k', date: today, time: '14:00', prio: 'media', status: 'active', snoozes: 0 },
      { id: 'r3', workspace_id: LOJA, owner_id: null, name: 'Obra Rita', phone: '11944443333', note: '3,5k', date: yest, time: '10:00', prio: 'alta', status: 'active', snoozes: 3 },
      { id: 'r4', workspace_id: ALVA, owner_id: ME, name: 'Clínica Sorriso', phone: '11933332222', note: 'R$ 1.800 mensal', date: plus2, time: '11:00', prio: 'media', status: 'active', snoozes: 0 }],
  }
  const people = [{ workspace_id: LOJA, user_id: ME, role: 'owner', display_name: 'Guilherme', email: 'gui@t.com' }, { workspace_id: LOJA, user_id: VIT, role: 'seller', display_name: 'Vitor Souza', email: 'v@t.com' }, { workspace_id: ALVA, user_id: ME, role: 'owner', display_name: 'Guilherme', email: 'gui@t.com' }]
  window.__fakeDb = db
  let session = JSON.parse(localStorage.getItem('fake-sess') || 'null')
  const user = { id: ME, email: 'gui@t.com', user_metadata: { name: 'Guilherme' } }
  class Q {
    constructor(t) { this.t = t; this.f = [] }
    select() { return this } eq(c, v) { this.f.push([c, v]); return this }
    insert(rows) { this.ins = [].concat(rows); return this } update(p) { this.upd = p; return this }
    then(res) {
      const tbl = db[this.t]
      if (this.ins) { tbl.push(...this.ins.map(r => ({ ...r }))); return Promise.resolve({ data: null, error: null }).then(res) }
      const rows = tbl.filter(r => this.f.every(([c, v]) => r[c] === v))
      if (this.upd) { rows.forEach(r => Object.assign(r, this.upd)); return Promise.resolve({ data: null, error: null }).then(res) }
      return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(res)
    }
  }
  const ok = data => Promise.resolve({ data, error: null })
  window.supabase = { createClient: () => ({
    from: t => new Q(t),
    rpc: n => ok(n === 'ws_people' ? people : null),
    auth: {
      getSession: () => ok({ session: session ? { user } : null }),
      signInWithPassword: ({ email, password }) => password === 'senha123' ? (session = 1, localStorage.setItem('fake-sess', '1'), ok({ user, session: {} })) : Promise.resolve({ data: {}, error: { message: 'Invalid login credentials', code: 'invalid_credentials' } }),
      signOut: () => { session = null; localStorage.removeItem('fake-sess'); return ok({}) },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signUp: () => ok({ user, session: null }), resetPasswordForEmail: () => ok({}), verifyOtp: () => ok({}), updateUser: () => ok({}), signInWithOAuth: () => ok({}),
      mfa: { getAuthenticatorAssuranceLevel: () => ok({ currentLevel: 'aal1', nextLevel: 'aal1' }), listFactors: () => ok({ totp: [] }), challengeAndVerify: () => ok({}) },
    },
  }) }
})()
