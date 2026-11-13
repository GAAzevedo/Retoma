// Processo Node separado com o banco de teste (o Electron não roda o plpgsql do PGlite).
// Recebe pedidos por IPC e executa num cliente "local" do fake-supabase (um por aparelho).
const { create, openDb } = require('./fake-supabase.js')
let dbP = null
const devices = new Map()
async function dev(id) {
  if (!dbP) dbP = openDb(process.env.RETOMA_FAKE_DB || undefined)
  if (!devices.has(id)) devices.set(id, create({ db: await dbP }))
  return devices.get(id)
}
process.on('message', async m => {
  try {
    const c = await dev(m.device)
    let res
    if (m.type === 'query') {
      let q = c.from(m.table)
      for (const [fn, args] of m.ops) q = q[fn](...args)
      res = await q
    } else if (m.type === 'rpc') res = await c.rpc(m.name, m.args)
    else if (m.type === 'mail') res = globalThis.__fakeMail || []
    else if (m.type === 'auth') {
      const parts = m.path.split('.'); let obj = c.auth
      for (const p of parts.slice(0, -1)) obj = obj[p]
      res = await obj[parts[parts.length - 1]](...(m.args || []))
    }
    process.send({ id: m.id, res })
  } catch (e) { process.send({ id: m.id, res: { data: null, error: { message: e.message } } }) }
})
