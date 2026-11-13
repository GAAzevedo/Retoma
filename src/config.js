// ─── Configuração da nuvem (nunca fica no código) ──────────────────────
// Ordem de busca:
//   1) Variáveis de ambiente: RETOMA_SUPABASE_URL, RETOMA_SUPABASE_ANON_KEY, RETOMA_UPDATE_URL
//   2) retoma.config.json na pasta de dados   (%APPDATA%\retoma\retoma.config.json)
//   3) retoma.config.json ao lado do app      (pasta da versão no npm start / resources no .exe)
// A "anon key" do Supabase é pública por natureza (quem protege os dados são as regras
// RLS do banco), mas mesmo assim fica fora do código pra cada instalação poder apontar
// pro seu próprio projeto.
const fs = require('fs')
const path = require('path')

let cached = null

function readJson(p) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) {}
  return null
}

function load(app) {
  if (cached) return cached
  const candidates = []
  try { candidates.push(path.join(app.getPath('userData'), 'retoma.config.json')) } catch (e) {}
  candidates.push(path.join(__dirname, '..', 'retoma.config.json'))
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'retoma.config.json'))
  let file = {}
  for (const c of candidates) { const j = readJson(c); if (j) { file = j; break } }
  const env = process.env
  const url = (env.RETOMA_SUPABASE_URL || file.supabaseUrl || '').trim().replace(/\/+$/, '')
  const key = (env.RETOMA_SUPABASE_ANON_KEY || file.supabaseAnonKey || '').trim()
  cached = {
    supabaseUrl: /^https?:\/\//.test(url) ? url : '',
    supabaseAnonKey: key,
    updateUrl: (env.RETOMA_UPDATE_URL || file.updateUrl || '').trim(),
    webAppUrl: (file.webAppUrl || '').trim(),          // versão celular (opcional)
    siteUrl: (file.siteUrl || '').trim(),              // página com política de privacidade
    google: file.google === true,                      // botão do Google só depois de configurar no Supabase
    fake: !!env.RETOMA_FAKE_CLOUD,                     // só nos testes
  }
  cached.cloud = cached.fake || !!(cached.supabaseUrl && cached.supabaseAnonKey)
  cached.missingKey = !cached.cloud && !!cached.supabaseUrl && !cached.supabaseAnonKey
  return cached
}

module.exports = { load }
