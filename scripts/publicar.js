// ─── Publicar uma versão nova (atualização automática) ─────────────────
// Depois do "npm run build", sobe pro bucket "releases" do Supabase:
//   dist/latest.yml, dist/Retoma-Setup-x.y.z.exe e o .blockmap
// Quem tem o Retoma instalado recebe a atualização sozinho (em até 6 horas, ou ao abrir).
//
// Uso (PowerShell, na pasta da versão):
//   $env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"
//   $env:SUPABASE_SERVICE_KEY="chave service_role (NUNCA coloque no app nem no Git)"
//   npm run publicar
const fs = require('fs')
const path = require('path')

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_KEY || ''
const bucket = process.env.RETOMA_BUCKET || 'releases'
if (!url || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY (veja supabase/LEIA-ME.md, passo 7).')
  process.exit(1)
}
const version = require('../package.json').version
const dist = path.join(__dirname, '..', 'dist')
const files = [`Retoma-Setup-${version}.exe`, `Retoma-Setup-${version}.exe.blockmap`, 'latest.yml']
const types = { '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream', '.yml': 'text/yaml' }

;(async () => {
  for (const f of files) {
    const p = path.join(dist, f)
    if (!fs.existsSync(p)) { console.error('Não achei ' + p + '. Rode "npm run build" antes.'); process.exit(1) }
  }
  // o latest.yml vai por último: só aponta pra versão nova quando o instalador já está lá
  for (const f of files) {
    const body = fs.readFileSync(path.join(dist, f))
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURIComponent(f)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': f.endsWith('.yml') ? 'no-cache' : 'max-age=31536000' },
      body,
    })
    if (!res.ok) { console.error(`Falhou ${f}: ${res.status} ${await res.text()}`); process.exit(1) }
    console.log(`✓ ${f} (${(body.length / 1048576).toFixed(1)} MB)`)
  }
  console.log(`\nRetoma ${version} publicado. Link de download:\n${url}/storage/v1/object/public/${bucket}/Retoma-Setup-${version}.exe`)
})()
