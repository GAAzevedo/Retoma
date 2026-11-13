// ─── Cliente da nuvem (Supabase) ────────────────────────────────────────
// Roda só no processo principal: a tela nunca vê token nem chave.
// Sessão guardada criptografada com o cofre do Windows (safeStorage / DPAPI).
const fs = require('fs')
const path = require('path')
const { app, safeStorage } = require('electron')
const Config = require('./config.js')

// O Electron 31 roda Node 20, que não tem WebSocket nativo: o supabase-js 2.118 exige um
let WS = null
function wsTransport() {
  if (globalThis.WebSocket) return globalThis.WebSocket
  try { return WS || (WS = require('ws')) } catch (e) { return undefined }
}

let client = null

// Armazenamento seguro da sessão (o supabase-js usa como se fosse localStorage)
function secureStorage() {
  const file = path.join(app.getPath('userData'), 'session.bin')
  let mem = null
  const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable() } catch (e) { return false } }
  const read = () => {
    if (mem) return mem
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file)
        const txt = canEncrypt() ? safeStorage.decryptString(raw) : raw.toString('utf8')
        mem = JSON.parse(txt)
      }
    } catch (e) { mem = null }
    return mem || (mem = {})
  }
  const write = () => {
    try {
      const txt = JSON.stringify(mem || {})
      fs.writeFileSync(file, canEncrypt() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8'))
    } catch (e) {}
  }
  return {
    getItem: k => { const v = read()[k]; return v === undefined ? null : v },
    setItem: (k, v) => { read()[k] = v; write() },
    removeItem: k => { delete read()[k]; write() },
    clearAll: () => { mem = {}; try { fs.unlinkSync(file) } catch (e) {} },
  }
}

let storage = null
function getStorage() { return storage || (storage = secureStorage()) }

function getClient() {
  if (client) return client
  const cfg = Config.load(app)
  if (!cfg.cloud) return null
  if (cfg.fake) {
    // testes automáticos: Postgres local (PGlite) com as mesmas regras do Supabase
    client = require(process.env.RETOMA_FAKE_CLOUD).create({ dataDir: process.env.RETOMA_FAKE_DB, storage: getStorage() })
    return client
  }
  const { createClient } = require('@supabase/supabase-js')
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { transport: wsTransport() },
    auth: {
      storage: getStorage(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',          // login com Google pelo navegador, com verificador PKCE
    },
    global: { headers: { 'x-client-info': 'retoma-desktop/' + app.getVersion() } },
  })
  return client
}

// Cliente separado só pra disparar o e-mail de convite: não mexe na sessão de quem convida
let mailer = null
async function getMailer() {
  if (mailer) return mailer
  const cfg = Config.load(app)
  if (!cfg.cloud) return null
  if (cfg.fake) { mailer = await getClient().__newDevice(); return mailer }
  const { createClient } = require('@supabase/supabase-js')
  const mem = {}
  mailer = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { transport: wsTransport() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
            storage: { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, removeItem: k => { delete mem[k] } } },
  })
  return mailer
}

module.exports = { getMailer, getClient, getStorage, configured: () => Config.load(app).cloud }