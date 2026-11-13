// ─── Atualização automática (1.0) ───────────────────────────────────────
// Só funciona no app instalado (.exe) e com "updateUrl" no retoma.config.json:
// uma pasta pública com latest.yml + Retoma-Setup-x.y.z.exe (ex.: bucket "releases" do Supabase).
// Baixa em segundo plano e avisa; instala ao reiniciar (ou ao sair do app).
let st = { enabled: false, checking: false, ready: false, version: null, error: null, progress: 0 }
let updater = null, notify = () => {}

function init({ app, config, notify: n }) {
  notify = n || notify
  if (!app.isPackaged || !config.updateUrl) return
  try { updater = require('electron-updater').autoUpdater } catch (e) { return }
  updater.setFeedURL({ provider: 'generic', url: config.updateUrl })
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => set({ checking: true, error: null }))
  updater.on('update-not-available', () => set({ checking: false }))
  updater.on('download-progress', p => set({ progress: Math.round(p.percent || 0) }))
  updater.on('update-downloaded', info => set({ checking: false, ready: true, version: info.version }))
  updater.on('error', e => set({ checking: false, error: String((e && e.message) || e).slice(0, 200) }))
  st.enabled = true
  setTimeout(check, 15 * 1000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
function set(p) { st = { ...st, ...p }; try { notify(st) } catch (e) {} }
async function check() { if (!updater) return st; try { await updater.checkForUpdates() } catch (e) { set({ error: String(e.message || e) }) } return st }
function install() { if (updater && st.ready) { require('electron').app.isQuitting = true; setImmediate(() => updater.quitAndInstall(false, true)) } return st }
module.exports = { init, check, install, state: () => st }
