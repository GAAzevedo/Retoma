// Teste da sincronização: vários "aparelhos" no mesmo banco (PGlite com as regras reais)
const { create, openDb } = require('./fake-supabase.js')
const { Sync, tombstone } = require('../src/sync.js')
const Core = require('../src/core.js')
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tick = () => sleep(5)   // garante updatedAt diferente
function device(db, data = {}) {
  const store = { data, save() {}, backups: [], backup(n) { this.backups.push(n) } }
  Core.normalize(store.data)
  const client = create({ db })
  const sync = new Sync({ store, getClient: () => client, log: (...a) => console.log('   [log]', ...a) })
  return { store, client, sync, d: store.data }
}
const today = '2026-11-05'
const edit = (f, patch) => { Object.assign(f, patch, { updatedAt: new Date().toISOString() }) }
;(async () => {
  const db = await openDb()
  // ── Aparelho A do dono, com dados antigos (formato 0.6.1)
  const A = device(db, { followups: [
    { id: '1759000000001', name: 'Bruno', phone: '11999990001', note: '7,1 K', date: today, time: '09:00', prio: 'alta' },
    { id: '1759000000002', name: 'Carla', phone: '11999990002', note: 'R$ 2.500', date: today, time: '10:00', prio: 'media' },
    { id: '1759000000003', name: 'Joana', phone: '11988887777', note: '', date: '2026-11-01', time: '10:00', prio: 'baixa' }],
    done: [{ id: '1759000000009', name: 'Adriano', phone: '1199', note: '6 mil', date: '2026-10-30', doneAt: '2026-11-01T10:00:00.000Z', outcome: 'won' }] })
  A.d.businesses[0].kind = 'store'
  const r1 = await A.client.auth.signUp({ email: 'gui@t.com', password: 'senha123', options: { data: { name: 'Guilherme' } } })
  ok(!r1.error, 'cadastro do dono')
  await A.sync.start({ id: r1.data.user.id })
  ok(A.sync.state === 'idle', 'A sincronizou: ' + A.sync.state + (A.sync.error ? ' ' + A.sync.error : ''))
  ok(A.d.followups.every(f => f._s === f.updatedAt && f._remote), 'tudo marcado como enviado')
  ok(A.d.roles[A.d.businesses[0].id] === 'owner', 'dono da Construpac na nuvem')

  // ── Aparelho B do mesmo dono (vazio)
  const B = device(db, {})
  await B.client.auth.signInWithPassword({ email: 'gui@t.com', password: 'senha123' })
  await B.sync.start({ id: r1.data.user.id })
  ok(B.d.followups.length === 3 && B.d.done.length === 1, `B recebeu tudo: ${B.d.followups.length} ativos, ${B.d.done.length} concluído`)
  ok(B.d.businesses.some(b => b.name === 'Construpac' && b.kind === 'store'), 'B recebeu o negócio Construpac')
  ok(B.d.businesses.length === 1, 'B não criou negócio sobrando (provisório descartado): ' + B.d.businesses.map(b => b.name))
  await A.sync.syncNow()
  ok(A.d.businesses.length === 1, 'A continua com 1 negócio')
  // reabrir o app (normalize) não perde as marcas de sincronização
  Core.normalize(A.d); ok(A.d.businesses[0]._remote && A.d.businesses[0]._s === A.d.businesses[0].updatedAt, 'reabrir o app mantém as marcas de sincronização')
  const bz = A.d.businesses[0].id
  ok(B.d.followups.find(f => f.id === '1759000000001').note === '7,1 K', 'conteúdo igual')

  // ── Edições nos dois e conflito
  await tick(); edit(A.d.followups.find(f => f.id === '1759000000001'), { note: 'A editou' })
  await tick(); edit(B.d.followups.find(f => f.id === '1759000000001'), { note: 'B editou depois' })
  await tick(); edit(B.d.followups.find(f => f.id === '1759000000002'), { date: '2026-11-06' })
  await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow()
  ok(A.d.followups.find(f => f.id === '1759000000001').note === 'B editou depois', 'conflito: vale a edição mais recente (B)')
  ok(A.d.followups.find(f => f.id === '1759000000002').date === '2026-11-06', 'edição de B chegou em A')

  // ── Concluir em A, excluir em B
  const j = A.d.followups.find(f => f.id === '1759000000003')
  A.d.followups = A.d.followups.filter(f => f !== j); await tick()
  A.d.done.unshift({ ...j, doneAt: new Date().toISOString(), outcome: 'lost', updatedAt: new Date().toISOString() })
  const adr = B.d.done.find(f => f.id === '1759000000009'); B.d.done = B.d.done.filter(f => f !== adr); tombstone(B.d, adr)
  await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow()
  ok(B.d.done.some(f => f.id === '1759000000003' && f.outcome === 'lost') && !B.d.followups.some(f => f.id === '1759000000003'), 'concluído em A aparece concluído em B')
  ok(!A.d.done.some(f => f.id === '1759000000009'), 'excluído em B some de A (lápide)')
  ok(!(B.d.tombstones || []).length, 'lápide enviada e limpa')

  // ── Preferências
  await tick(); Core.patchSettings(A.d, { features: { money: false } }); A.d.prefsUpdatedAt = new Date().toISOString()
  A.d.templates = [{ title: 'Oi', text: 'Oi {nome}' }]
  await A.sync.syncNow(); await B.sync.syncNow()
  ok(Core.getSettings(B.d).features.money === false && B.d.templates[0].title === 'Oi', 'configurações e mensagens chegaram em B')

  // ── Vendedor entra com convite
  const { data: code } = await A.client.rpc('create_invite', { ws: bz, invite_role: 'seller' })
  ok(/^[A-Z2-9]{6}$/.test(code), 'convite gerado: ' + code)
  const V = device(db, {})
  const rv = await V.client.auth.signUp({ email: 'vend@t.com', password: 'senha123', options: { data: { name: 'Vitor' } } })
  const { error: ae } = await V.client.rpc('accept_invite', { invite_code: code })
  ok(!ae, 'vendedor aceitou o convite')
  await V.sync.start({ id: rv.data.user.id })
  ok(V.d.businesses.some(b => b.id === bz), 'vendedor recebeu a loja')
  ok(V.d.followups.filter(f => f.biz === bz).length === 0, 'vendedor não vê os clientes do dono')
  ok(V.d.roles[bz] === 'seller' && (V.d.people[bz] || []).length === 2, 'papel e equipe conhecidos')
  // vendedor cria cliente na loja
  const t0 = new Date().toISOString()
  V.d.followups.push({ id: Core.uid(), biz: bz, name: 'Cliente do Vitor', phone: '11977776666', note: '', date: today, time: '11:00', prio: 'media', createdAt: t0, updatedAt: t0 })
  await V.sync.syncNow(); await A.sync.syncNow()
  const vc = A.d.followups.find(f => f.name === 'Cliente do Vitor')
  ok(vc && vc.owner === rv.data.user.id, 'dono (gerente) vê o cliente do vendedor, com o responsável')
  // aviso de duplicado
  const { data: who } = await A.client.rpc('phone_owner', { ws: bz, phone8: '77776666' })
  ok(who === 'Vitor', 'aviso de cliente duplicado: já está com ' + who)
  // dono atribui um cliente ao vendedor
  await tick(); edit(A.d.followups.find(f => f.id === '1759000000002'), { owner: rv.data.user.id })
  await A.sync.syncNow(); await V.sync.syncNow()
  ok(V.d.followups.some(f => f.id === '1759000000002'), 'cliente atribuído chegou no vendedor')
  // dono tira de volta → some do vendedor na conferência completa
  await tick(); edit(A.d.followups.find(f => f.id === '1759000000002'), { owner: r1.data.user.id })
  await A.sync.syncNow(); await V.sync.syncNow({ full: true })
  ok(!V.d.followups.some(f => f.id === '1759000000002'), 'cliente passado pra outro some do vendedor')
  // vendedor sai da loja (dono remove)
  await A.client.rpc('remove_member', { ws: bz, member: rv.data.user.id })
  await V.sync.syncNow({ full: true }); await A.sync.syncNow()
  ok(!V.d.businesses.some(b => b.id === bz) && !V.d.followups.some(f => f.biz === bz), 'vendedor removido: loja e clientes somem do aparelho dele')
  ok(V.d.businesses.filter(b => !b.archived).length >= 1, 'vendedor continua com um negócio próprio pra usar')
  ok(A.d.followups.find(f => f.name === 'Cliente do Vitor').owner === null, 'cliente dele foi pra carteira sem dono')

  // ── Outra conta no mesmo aparelho não mistura dados
  const before = A.d.followups.length
  const rx = await A.client.auth.signUp({ email: 'outra@t.com', password: 'senha123', options: { data: { name: 'Outra' } } })
  A.sync.stop(); await A.sync.start({ id: rx.data.user.id })
  ok(A.store.backups.includes('antes-de-trocar-de-conta') && A.d.followups.length === 0 && before > 0, 'troca de conta: backup + aparelho limpo pra nova conta')
  // ── Offline
  const off = device(db, {}); off.client.from = () => { throw new Error('fetch failed') }
  off.sync.user = { id: r1.data.user.id }; await off.sync.syncNow()
  ok(off.sync.state === 'offline', 'sem internet: estado offline, nada se perde')
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.log('ERRO', e.stack); process.exit(1) })
