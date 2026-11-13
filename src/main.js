const {
  app, BrowserWindow, Tray, Menu,
  nativeImage, ipcMain, Notification, shell, screen,
  globalShortcut, clipboard, dialog, powerMonitor
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const Store = require('./store.js')
const Core = require('./core.js')
const Config = require('./config.js')
const cloud = require('./cloud.js')
const Auth = require('./auth.js')
const { Sync, tombstone } = require('./sync.js')
const Updater = require('./updater.js')
require('./money.js')
const Money = globalThis.Money

let mainWin, compactWin, pillWin, tray
const store = new Store()

// ─── TRAY ───────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'))   // logo claro (+ @2x)
  tray = new Tray(icon)
  tray.setToolTip('Retoma')
  rebuildTrayMenu()
  tray.on('click', () => {
    if (mainWin && mainWin.isVisible()) mainWin.focus()
    else if (floatingVisible()) hideFloating()
    else showFloating()
  })
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir app',          click: () => showMain() },
    { label: 'Mostrar flutuante',  click: () => showFloating() },
    { label: 'Esconder flutuante', click: () => hideFloating() },
    { label: Core.getSettings(store.data).system.shortcut ? 'Novo retoma (Ctrl+Alt+R)' : 'Novo retoma', click: () => quickAdd() },
    { label: 'Configurações', click: () => openSettings() },
    { label: 'Recolocar flutuante no canto', click: () => { resetFloatingPositions(); showFloating() } },
    { type: 'separator' },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: getUi().autoStart !== false,
      click: item => { setUi({ autoStart: item.checked }); applyAutoStart() } },
    { label: 'Abrir pasta de backups', click: () => shell.openPath(cloudBackupDir() || path.join(app.getPath('userData'), 'backups')) },
    { type: 'separator' },
    ...(Updater.state().ready ? [{ label: `Reiniciar e atualizar (${Updater.state().version})`, click: () => Updater.install() }] : []),
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit() } }
  ]))
}

// ─── INICIAR COM O WINDOWS ──────────────────────────────────────────────
// Registra sempre a versão que está rodando agora (cada versão nova numa
// pasta nova assume o lugar da anterior ao ser aberta).
function applyAutoStart() {
  try {
    const on = getUi().autoStart !== false
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, args: ['--autostart'] })
    else app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [path.resolve(app.getAppPath()), '--autostart'] })
  } catch (e) {}
}

// ─── BACKUP NO ONEDRIVE ─────────────────────────────────────────────────
function cloudBackupDir() {
  const base = process.env.OneDrive || process.env.OneDriveConsumer || path.join(os.homedir(), 'OneDrive')
  try { if (base && fs.existsSync(base)) return path.join(base, 'Retoma', 'backups') } catch (e) {}
  return null
}
function cloudBackup() {
  try {
    const dir = cloudBackupDir(); if (!dir) return
    fs.mkdirSync(dir, { recursive: true })
    const stamp = Money.ymd(new Date())
    fs.writeFileSync(path.join(dir, `retoma-${stamp}.json`), JSON.stringify(store.data, null, 2), 'utf8')
    const files = fs.readdirSync(dir).filter(f => /^retoma-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    files.slice(0, Math.max(0, files.length - 30)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)) } catch (e) {} })
  } catch (e) {}
}

// ─── RESUMO DA MANHÃ ────────────────────────────────────────────────────
function monthScore(done = getDone(), biz = null) {
  const ym = Money.ymd(new Date()).slice(0, 7)
  const month = done.filter(f => (f.doneAt ? Money.ymd(new Date(f.doneAt)) : '').startsWith(ym) && f.outcome && (!biz || f.biz === biz))
  const won = month.filter(f => f.outcome === 'won')
  const res = { won: won.length, decided: month.length, wonValue: Money.sumValues(won) }
  if (!biz) {
    // placar separado por negócio (somar madeira com marketing não diz nada)
    res.byBiz = activeBusinesses().map(b => {
      const m = month.filter(f => f.biz === b.id), w = m.filter(f => f.outcome === 'won')
      return { id: b.id, name: b.name, color: b.color, won: w.length, decided: m.length, wonValue: Money.sumValues(w) }
    }).filter(x => x.decided)
  }
  return res
}
function activeBusinesses() { return (store.get('businesses', []) || []).filter(b => !b.archived) }
function morningBrief(force = false) {
  const today = Money.ymd(new Date())
  const cfg = Core.getSettings(store.data)
  if (!force && (getUi().lastBrief === today || new Date().getHours() < cfg.routine.briefHour)) return
  setUi({ lastBrief: today })
  cloudBackup()
  if (!force && !Core.featureOn(store.data, 'brief')) return
  const all = store.get('followups', [])
  const items = all.filter(f => f.date === today)
  const late = all.filter(f => f.date < today)
  const top = [...items, ...late].sort((a, b) => (Money.valueOf(b) || 0) - (Money.valueOf(a) || 0))[0]
  const money = Core.featureOn(store.data, 'money')
  const lines = []
  const bizs = activeBusinesses()
  if (bizs.length > 1) {
    // uma linha por negócio
    for (const b of bizs) {
      const it = items.filter(f => f.biz === b.id), lt = late.filter(f => f.biz === b.id)
      if (!it.length && !lt.length) continue
      const v = Money.sumValues([...it, ...lt])
      lines.push(`${b.name}: ${it.length} hoje${lt.length ? ' · ' + lt.length + ' atrasado' + (lt.length > 1 ? 's' : '') : ''}${money && v ? ' · ' + Money.fmtMoney(v) : ''}`)
    }
    if (!lines.length) lines.push('Nada marcado pra hoje')
  } else lines.push(items.length ? `Hoje: ${items.length} retoma${items.length > 1 ? 's' : ''}${money && Money.sumValues(items) ? ' (' + Money.fmtMoney(Money.sumValues(items)) + ')' : ''}` : 'Nada marcado pra hoje')
  if (bizs.length <= 1 && late.length) lines.push(`${late.length} atrasado${late.length > 1 ? 's' : ''}${money && Money.sumValues(late) ? ' · ' + Money.fmtMoney(Money.sumValues(late)) + ' parados' : ''}`)
  if (money && top && Money.valueOf(top)) lines.push(`Maior: ${top.name} · ${Money.fmtMoney(Money.valueOf(top))}`)
  const sc = monthScore()
  if (Core.featureOn(store.data, 'score') && sc.won) lines.push(`Mês: ${Money.fmtMoney(sc.wonValue)} fechados`)
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Bom dia! ☀️ Retoma', body: lines.join('\n'), icon: path.join(__dirname, 'icon.png') })
  n.on('click', () => showMain())
  n.show()
}

// ─── NOVO RETOMA RÁPIDO (Ctrl+Alt+R) ────────────────────────────────────
function phoneFromClipboard() {
  try {
    const t = (clipboard.readText() || '').trim()
    if (t.length > 40) return ''
    const d = t.replace(/\D/g, '')
    return d.length >= 8 && d.length <= 13 ? t : ''
  } catch (e) { return '' }
}
function quickAdd() {
  if (gated()) { showMain(); return }
  const phone = phoneFromClipboard()
  if (mainWin) mainWin.hide()
  if (pillWin) pillWin.hide()
  if (!compactWin) return
  pushCompactData()
  compactWin.show()
  compactWin.focus()
  compactWin.setIgnoreMouseEvents(false)
  compactWin.webContents.send('quick-add', { phone })
}

function applyShortcut() {
  try {
    const on = Core.getSettings(store.data).system.shortcut
    const has = globalShortcut.isRegistered('Control+Alt+R')
    if (on && !has) globalShortcut.register('Control+Alt+R', quickAdd)
    if (!on && has) globalShortcut.unregister('Control+Alt+R')
  } catch (e) {}
}

// ─── JANELA PRINCIPAL ────────────────────────────────────────────────────
function createMain() {
  // 1.2: janela de PC (redimensiona, maximiza). O sempre-por-cima fica só com o flutuante.
  const a = screen.getPrimaryDisplay().workArea
  const mb = getUi().mainBounds
  const W = Math.min(1180, a.width - 40), H = Math.min(780, a.height - 40)
  let bounds = { width: W, height: H, x: Math.round(a.x + (a.width - W) / 2), y: Math.round(a.y + (a.height - H) / 2) }
  if (mb && mb.width >= 380 && mb.height >= 520 && centerInsideSomeScreen(mb.x, mb.y, mb.width, mb.height)) bounds = { x: mb.x, y: mb.y, width: mb.width, height: mb.height }
  mainWin = new BrowserWindow({
    ...bounds,
    minWidth: 380, minHeight: 520,
    frame: false,
    alwaysOnTop: false,
    resizable: true,
    maximizable: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#0b0c0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png'),
  })
  if (mb && mb.max) mainWin.maximize()
  mainWin.loadFile(path.join(__dirname, 'index.html'))
  let saveT = null
  const saveBounds = () => {
    clearTimeout(saveT)
    saveT = setTimeout(() => {
      if (!mainWin || mainWin.isDestroyed()) return
      if (mainWin.isMaximized() || mainWin.isMinimized()) { setUi({ mainBounds: { ...(getUi().mainBounds || bounds), max: mainWin.isMaximized() } }); return }
      const b = mainWin.getBounds(); setUi({ mainBounds: { ...b, max: false } })
    }, 400)
  }
  mainWin.on('resize', saveBounds)
  mainWin.on('move', saveBounds)
  const sendMax = () => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('win-max', mainWin.isMaximized()) }
  mainWin.on('maximize', () => { sendMax(); saveBounds() })
  mainWin.on('unmaximize', () => { sendMax(); saveBounds() })
  mainWin.on('close', e => {
    if (!app.isQuitting) { e.preventDefault(); mainWin.hide(); if (!gated()) showFloating() }
  })
}

// ─── JANELA COMPACTA ─────────────────────────────────────────────────────
function createCompact() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  compactWin = new BrowserWindow({
    width: 360,
    height: 560,
    x: width - 380,
    y: height - 576,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-compact.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  lockSize(compactWin, 360, 560)
  const cp = getUi().compactPos
  if (cp && centerInsideSomeScreen(cp.x, cp.y, 360, 560)) placeWin(compactWin, cp.x, cp.y, 360, 560)
  compactWin.loadFile(path.join(__dirname, 'compact.html'))
  compactWin.webContents.on('did-finish-load', () => pushCompactData())   // dados assim que a tela carrega
  compactWin.on('close', e => {
    if (!app.isQuitting) { e.preventDefault(); compactWin.hide() }
  })
  // FIX BUG 1: área transparente não bloqueia o mouse
  compactWin.on('show', () => {
    compactWin.setIgnoreMouseEvents(true, { forward: true })
  })
}

function showMain() {
  if (compactWin) compactWin.hide()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    // FIX BUG 2: recarregar dados ao abrir
    mainWin.webContents.send('reload-data')
  }
}

// ─── MODO DO FLUTUANTE: 'compact' (card) ou 'pill' (mini) ───────────────
function getUi() { return store.get('ui', { mode: 'compact', pillPos: null }) }
function setUi(patch) { store.set('ui', { ...getUi(), ...patch }) }

function floatingVisible() {
  return (compactWin && compactWin.isVisible()) || (pillWin && pillWin.isVisible())
}

// Login obrigatório (1.1): com a nuvem configurada e sem conta, nada de flutuante
function gated() { return cloud.configured() && !sync.user }
function showFloating() {
  if (gated()) { showMain(); return }
  if (mainWin) mainWin.hide()
  if (getUi().mode === 'pill') showPill(); else showCompact()
}

function hideFloating() {
  if (compactWin) compactWin.hide()
  if (pillWin) pillWin.hide()
}

function showCompact() {
  if (mainWin) mainWin.hide()
  if (pillWin) pillWin.hide()
  if (compactWin) { pushCompactData(); compactWin.show() }
}

// ─── PÍLULA (modo mini) ─────────────────────────────────────────────────
// A pílula cresce pra caber até 3 negócios (cada um com sua bolinha)
const PILL_H = 44
let PILL_W = 132
const pillWidthFor = segs => 132 + Math.max(0, segs - 1) * 40
function setPillWidth(w) {
  if (!pillWin || pillWin.isDestroyed() || w === PILL_W) return
  const b = pillWin.getBounds()
  const right = b.x + b.width          // mantém a borda direita no lugar
  PILL_W = w
  try { pillWin.setMinimumSize(1, 1); pillWin.setMaximumSize(10000, 10000) } catch (e) {}
  placeWin(pillWin, right - w, b.y, w, PILL_H)
  try { pillWin.setMinimumSize(w, PILL_H); pillWin.setMaximumSize(w, PILL_H) } catch (e) {}
  keepOnScreen()
}

function pillDefaultPos() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - PILL_W - 20, y: a.y + a.height - PILL_H - 16 }
}

// ─── DUAS TELAS ─────────────────────────────────────────────────────────
// Com telas de escala diferente (ex.: notebook 125% + monitor 100%), mover a
// janela com setPosition fazia o Windows recalcular o tamanho a cada passo e
// a pílula crescia sem parar. Agora: tamanho travado + mover sempre com
// setBounds informando o tamanho certo.
function lockSize(win, gw, gh) {
  const W = typeof gw === 'function' ? gw : () => gw, H = typeof gh === 'function' ? gh : () => gh
  try { win.setMinimumSize(W(), H()); win.setMaximumSize(W(), H()) } catch (e) {}
  const fix = () => {
    if (win.isDestroyed()) return
    const w = W(), h = H()
    const b = win.getBounds()
    if (b.width !== w || b.height !== h) win.setBounds({ x: b.x, y: b.y, width: w, height: h })
  }
  win.on('resize', fix)
  win.on('moved', fix)
  win.on('show', fix)
}
function placeWin(win, x, y, w, h) {
  if (!win || win.isDestroyed()) return
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
}
function centerInsideSomeScreen(x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2
  return screen.getAllDisplays().some(d => {
    const a = d.workArea
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height
  })
}
function compactDefaultPos() {
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - 380, y: a.y + a.height - 576 }
}
function resetFloatingPositions() {
  const p = pillDefaultPos()
  placeWin(pillWin, p.x, p.y, PILL_W, PILL_H)
  setUi({ pillPos: p })
  const c = compactDefaultPos()
  placeWin(compactWin, c.x, c.y, 360, 560)
}
function keepOnScreen() {
  if (pillWin && !pillWin.isDestroyed()) {
    const b = pillWin.getBounds()
    if (!centerInsideSomeScreen(b.x, b.y, PILL_W, PILL_H)) { const p = pillDefaultPos(); placeWin(pillWin, p.x, p.y, PILL_W, PILL_H); setUi({ pillPos: p }) }
    else placeWin(pillWin, b.x, b.y, PILL_W, PILL_H)
  }
  if (compactWin && !compactWin.isDestroyed()) {
    const b = compactWin.getBounds()
    if (!centerInsideSomeScreen(b.x, b.y, 360, 560)) { const c = compactDefaultPos(); placeWin(compactWin, c.x, c.y, 360, 560) }
    else placeWin(compactWin, b.x, b.y, 360, 560)
  }
}

function pillPosIsVisible(pos) {
  if (!pos) return false
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return false
  if (centerInsideSomeScreen(pos.x, pos.y, PILL_W, PILL_H)) return true
  return screen.getAllDisplays().some(d => {
    const a = d.workArea
    return pos.x >= a.x - 20 && pos.y >= a.y - 10 &&
           pos.x + PILL_W <= a.x + a.width + 20 && pos.y + PILL_H <= a.y + a.height + 10
  })
}

function createPill() {
  const saved = getUi().pillPos
  const pos = pillPosIsVisible(saved) ? saved : pillDefaultPos()
  pillWin = new BrowserWindow({
    width: PILL_W, height: PILL_H, x: pos.x, y: pos.y,
    frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true,
    show: false, transparent: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pill.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  })
  lockSize(pillWin, () => PILL_W, PILL_H)
  pillWin.loadFile(path.join(__dirname, 'pill.html'))
  pillWin.webContents.on('did-finish-load', () => pushCompactData())
  pillWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); pillWin.hide() } })
}

function showPill() {
  if (mainWin) mainWin.hide()
  if (compactWin) compactWin.hide()
  if (pillWin) { pushCompactData(); pillWin.showInactive() }
}

function getMeta() {
  return {
    businesses: store.get('businesses', []),
    settings: Core.getSettings(store.data),
    features: Core.effectiveFeatures(store.data),
    plan: (store.get('account', {}) || {}).plan || 'free',
    colors: Core.COLORS,
    maxInPill: Core.MAX_IN_PILL,
    ui: { lastBiz: getUi().lastBiz || null, bizFilter: getUi().bizFilter || 'all', mode: getUi().mode || 'compact', autoStart: getUi().autoStart !== false,
          onboarded: !!getUi().onboarded, tutorialDone: !!getUi().tutorialDone, ownerFilter: getUi().ownerFilter || 'all', whatsNew10: !!getUi().whatsNew10, seen12: !!getUi().seen12 },
    accents: Core.ACCENTS,
    version: app.getVersion(),
    account: {
      cloud: cloud.configured(),
      user: sync.user,
      sync: sync.status(),
      roles: store.get('roles', {}),
      people: store.get('people', {}),
      siteUrl: Config.load(app).siteUrl,
      webAppUrl: Config.load(app).webAppUrl,
      google: Config.load(app).google,
      missingKey: Config.load(app).missingKey,
      gated: gated(),
    },
    update: Updater.state(),
  }
}

function pushCompactData() {
  if (!compactWin) return
  const all    = store.get('followups', [])
  const today  = Money.ymd(new Date())
  const items  = all.filter(f => f.date === today)
  const late   = all.filter(f => f.date < today)
  const bizs   = activeBusinesses()
  const money  = Core.featureOn(store.data, 'money')
  // Pílula: até 3 negócios com bolinha própria; o resto entra em "outros"
  const shown  = bizs.length > 1 ? bizs.filter(b => b.showInPill).slice(0, Core.MAX_IN_PILL) : bizs.slice(0, 1)
  const segs   = shown.map(b => ({ name: b.name, color: b.color, count: items.filter(f => f.biz === b.id).length }))
  const shownIds = new Set(shown.map(b => b.id))
  const otherN = items.filter(f => !shownIds.has(f.biz)).length
  if (otherN || !segs.length) segs.push({ name: 'outros', color: null, count: otherN, other: true })
  const payload = {
    count:     items.length,
    items:     items.map(f => { const b = bizs.find(x => x.id === f.biz); return { name: f.name, prio: f.prio || 'media', color: b ? b.color : null, biz: b ? b.name : '' } }),
    lateCount: late.length,
    valueToday: money ? Money.sumValues(items) : 0,
    valueLate:  money ? Money.sumValues(late) : 0,
    multi:     bizs.length > 1,
    segs,
    byBiz:     bizs.map(b => ({ name: b.name, color: b.color, today: items.filter(f => f.biz === b.id).length, late: late.filter(f => f.biz === b.id).length })),
    meta:      getMeta(),
  }
  setPillWidth(pillWidthFor(segs.length))
  compactWin.webContents.send('compact-update', payload)
  if (pillWin) pillWin.webContents.send('compact-update', payload)
}

function updateBadge(count) {
  if (!tray) return
  tray.setToolTip(count > 0 ? `Retoma — ${count} hoje` : 'Retoma')
  if (mainWin && count > 0) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
      <circle cx="10" cy="10" r="10" fill="#e53935"/>
      <text x="10" y="14.5" text-anchor="middle" fill="white" font-size="11" font-family="Arial" font-weight="bold">${count > 9 ? '9+' : count}</text>
    </svg>`
    mainWin.setOverlayIcon(
      nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')),
      `${count} hoje`
    )
  } else if (mainWin) {
    mainWin.setOverlayIcon(null, '')
  }
}

const DEFAULT_TEMPLATES = [
  { title: 'Cobrar retorno',   text: 'Oi {nome}, tudo bem? Passando pra saber se conseguiu avaliar o orçamento. Qualquer dúvida estou à disposição!' },
  { title: 'Fechar pedido',    text: 'Oi {nome}! Conseguimos fechar o pedido? Se quiser, já deixo tudo separado pra você.' },
  { title: 'Cobrar pagamento', text: 'Oi {nome}, tudo certo? Passando pra lembrar do pagamento combinado. Qualquer coisa me avisa!' },
]

// ─── CONCLUÍDOS (✓ move pro histórico em vez de apagar) ─────────────────
const DONE_KEEP_DAYS = 730   // 1.3: 2 anos (pra ver meses anteriores e relatórios)

function getDone() {
  const cutoff = Date.now() - DONE_KEEP_DAYS * 864e5
  return store.get('done', []).filter(f => !f.doneAt || new Date(f.doneAt).getTime() >= cutoff)
}

function afterChange() {
  pushCompactData()
  if (mainWin) mainWin.webContents.send('reload-data')
}

function completeItem(id) {
  const all = store.get('followups', [])
  const item = all.find(f => f.id === id)
  if (!item) return false
  store.set('followups', all.filter(f => f.id !== id))
  const t = new Date().toISOString()
  store.set('done', [{ ...item, doneAt: t, updatedAt: t }, ...getDone().filter(f => f.id !== id)])
  afterChange()
  return true
}

function restoreItem(id) {
  const done = getDone()
  const item = done.find(f => f.id === id)
  if (!item) return false
  const { doneAt, recovered, outcome, ...clean } = item
  const all = store.get('followups', []).filter(f => f.id !== id)
  store.set('followups', [...all, { ...clean, updatedAt: new Date().toISOString() }])
  store.set('done', done.filter(f => f.id !== id))
  afterChange()
  return true
}

// Uma única vez: o que sumiu desde a cópia antiga entra nos Concluídos como "recuperado"
function seedDoneFromLegacy() {
  if (store.get('done') !== undefined) return
  const activeIds = store.get('followups', []).map(f => f.id)
  store.set('done', store.legacyMissing(activeIds))
}

ipcMain.handle('complete', (_, id) => completeItem(id))
ipcMain.handle('set-outcome', (_, { id, outcome }) => {
  if (![null, 'won', 'lost'].includes(outcome ?? null)) return false
  const done = getDone()
  const it = done.find(f => f.id === id); if (!it) return false
  if (outcome) it.outcome = outcome; else delete it.outcome
  it.updatedAt = new Date().toISOString()
  store.set('done', done)
  afterChange()
  return true
})
ipcMain.handle('get-score', (_, biz) => monthScore(getDone(), biz && biz !== 'all' ? biz : null))
// Mensagens prontas: cada modelo pode ser de um negócio (biz) ou de todos (sem biz)
ipcMain.handle('get-templates', () => store.get('templates', DEFAULT_TEMPLATES))
ipcMain.handle('set-templates', (_, list) => {
  if (!Array.isArray(list)) return false
  const ids = new Set(store.get('businesses', []).map(b => b.id))
  store.data.prefsUpdatedAt = new Date().toISOString()
  store.set('templates', list.filter(t => t && t.title && t.text).map(t => {
    const o = { title: String(t.title).slice(0, 40), text: String(t.text).slice(0, 1000) }
    if (t.biz && ids.has(t.biz)) o.biz = t.biz
    return o
  }))
  return true
})

// ─── NEGÓCIOS E CONFIGURAÇÕES (0.7) ─────────────────────────────────────
function broadcastMeta() {
  Money.configure({ workSat: Core.getSettings(store.data).routine.workSat })
  applyShortcut()
  rebuildTrayMenu()
  afterChange()
}
ipcMain.handle('get-meta', () => getMeta())
ipcMain.handle('set-businesses', (_, list) => {
  const r = Core.saveBusinesses(store.data, list)
  if (!r.ok) return r
  store.save()
  broadcastMeta()
  return { ok: true, meta: getMeta() }
})
ipcMain.handle('set-settings', (_, patch) => {
  if (patch && (patch.features || patch.routine || patch.visual)) store.data.prefsUpdatedAt = new Date().toISOString()
  Core.patchSettings(store.data, patch || {})
  if (patch && patch.ui) {
    const u = {}
    if ('autoStart' in patch.ui) u.autoStart = !!patch.ui.autoStart
    if (['compact', 'pill'].includes(patch.ui.mode)) u.mode = patch.ui.mode
    setUi(u)
    if ('autoStart' in u) applyAutoStart()
  } else store.save()
  broadcastMeta()
  return getMeta()
})
ipcMain.on('set-last-biz', (_, id) => { if (store.get('businesses', []).some(b => b.id === id)) setUi({ lastBiz: id }) })
ipcMain.on('set-biz-filter', (_, id) => setUi({ bizFilter: id === 'all' || store.get('businesses', []).some(b => b.id === id) ? id : 'all' }))
ipcMain.on('open-settings', () => openSettings())
function openSettings() { showMain(); if (mainWin) mainWin.webContents.send('show-settings') }
ipcMain.on('snooze', (_, { id, date, undo }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return
  const all = store.get('followups', [])
  const it = all.find(f => f.id === id); if (!it) return
  it.date = date
  it.snoozes = Math.max(0, (it.snoozes || 0) + (undo ? -1 : 1))
  it.updatedAt = new Date().toISOString()
  store.set('followups', all)
  afterChange()
})
ipcMain.handle('restore',  (_, id) => restoreItem(id))
ipcMain.handle('get-done', () => getDone())

// ─── IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-data', () => store.get('followups', []))

ipcMain.handle('set-data', (_, data) => {
  if (!Array.isArray(data)) return false
  store.set('followups', Core.stampChanges(store.get('followups', []), data, store.data))
  pushCompactData()
  return true
})

ipcMain.on('compact-save', (_, data) => {
  const all = store.get('followups', [])
  const t = new Date().toISOString()
  const ids = new Set(activeBusinesses().map(b => b.id))
  const biz = data && ids.has(data.biz) ? data.biz : (getUi().lastBiz && ids.has(getUi().lastBiz) ? getUi().lastBiz : [...ids][0])
  const bizObj = store.get('businesses', []).find(b => b.id === biz)
  all.push(Core.applyFieldValues({ ...data, id: Core.uid(), biz, createdAt: t, updatedAt: t }, bizObj))
  setUi({ lastBiz: biz })
  store.set('followups', all)
  pushCompactData()
  // FIX BUG 2: avisar app principal se estiver aberto
  if (mainWin && mainWin.isVisible()) mainWin.webContents.send('reload-data')
})

// FIX BUG 1: ativar mouse apenas sobre o card/form
ipcMain.on('mouse-enter', () => {
  if (compactWin) compactWin.setIgnoreMouseEvents(false)
})
ipcMain.on('mouse-leave', () => {
  if (compactWin) compactWin.setIgnoreMouseEvents(true, { forward: true })
})

ipcMain.on('update-badge', (_, n) => updateBadge(n))
ipcMain.on('minimize',     ()     => showFloating())

// Card ↔ pílula
ipcMain.on('to-pill', () => { setUi({ mode: 'pill' });    showPill() })
ipcMain.on('to-card', () => { setUi({ mode: 'compact' }); showCompact() })

// Arrastar (pílula, card e janela principal): a janela segue o cursor em
// coordenadas da tela. Funciona entre monitores com escalas diferentes e o
// tamanho vai sempre junto (a área de arraste nativa falhava em janela transparente).
let dragTimer = null, dragOff = null, dragStop = null, dragWin = null, dragSize = null
function stopDrag(save) {
  clearInterval(dragTimer); clearTimeout(dragStop); dragTimer = null
  const win = dragWin; dragWin = null
  if (!win || win.isDestroyed()) return
  keepOnScreen()
  if (!save) return
  const b = win.getBounds()
  if (win === pillWin) setUi({ pillPos: { x: b.x, y: b.y } })
  else if (win === compactWin) setUi({ compactPos: { x: b.x, y: b.y } })
  else if (win === mainWin) setUi({ mainBounds: { ...b, max: false } })
}
function startDrag(win) {
  if (!win || win.isDestroyed()) return
  stopDrag(false)
  let c = screen.getCursorScreenPoint(), b = win.getBounds()
  if (win === mainWin && win.isMaximized()) {
    const rx = (c.x - b.x) / b.width
    win.unmaximize()
    const r = win.getBounds()
    b = { x: Math.round(c.x - r.width * rx), y: c.y - 20, width: r.width, height: r.height }
    placeWin(win, b.x, b.y, b.width, b.height)
  }
  dragWin = win
  dragSize = win === pillWin ? null : { w: b.width, h: b.height }
  dragOff = { x: c.x - b.x, y: c.y - b.y }
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint()
    const w = dragSize ? dragSize.w : PILL_W, h = dragSize ? dragSize.h : PILL_H
    placeWin(win, p.x - dragOff.x, p.y - dragOff.y, w, h)
  }, 16)
  clearTimeout(dragStop)
  dragStop = setTimeout(() => stopDrag(true), 20000)   // segurança: nunca fica preso seguindo o mouse
}
ipcMain.on('pill-drag-start', () => startDrag(pillWin))
ipcMain.on('pill-drag-end', () => stopDrag(true))
ipcMain.on('win-drag-start', e => startDrag(BrowserWindow.fromWebContents(e.sender)))
ipcMain.on('win-drag-end', () => stopDrag(true))
// 1.2: botões da janela principal
ipcMain.on('win-min', () => { if (mainWin) mainWin.minimize() })
ipcMain.on('win-max', () => { if (!mainWin) return; if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize() })
ipcMain.on('win-close', () => { if (mainWin) mainWin.close() })
ipcMain.on('pill-menu', () => {
  Menu.buildFromTemplate([
    { label: 'Abrir card',       click: () => { setUi({ mode: 'compact' }); showCompact() } },
    { label: 'Abrir app',        click: () => showMain() },
    { label: 'Concluídos (restaurar)', click: () => { showMain(); if (mainWin) mainWin.webContents.send('show-done') } },
    { label: 'Configurações',    click: () => openSettings() },
    { label: 'Voltar pro canto', click: () => { const p = pillDefaultPos(); placeWin(pillWin, p.x, p.y, PILL_W, PILL_H); setUi({ pillPos: p }) } },
    { type: 'separator' },
    { label: 'Esconder (reabrir pelo ícone perto do relógio)', click: () => hideFloating() },
  ]).popup({ window: pillWin })
})

// Busca no flutuante
ipcMain.handle('compact-get-all', () => store.get('followups', []))
ipcMain.on('compact-done', (_, id) => completeItem(id))
ipcMain.on('expand-edit', (_, id) => {
  showMain()
  if (mainWin) mainWin.webContents.send('edit-item', id)
})
ipcMain.on('expand-main',  ()     => showMain())
ipcMain.on('expand-overdue', () => { showMain(); if (mainWin) mainWin.webContents.send('show-overdue') })

// Cada negócio pode ter o seu número. O Retoma NÃO troca a conta do WhatsApp
// (regra de ouro); só avisa por qual negócio está abrindo quando muda.
let lastWppBiz = null
ipcMain.on('open-whatsapp', (e, arg) => {
  const phone = typeof arg === 'string' ? arg : (arg && arg.phone) || ''
  const text  = typeof arg === 'object' && arg && arg.text ? String(arg.text) : ''
  const n = phone.replace(/\D/g, '')
  if (!n) return
  const bizId = typeof arg === 'object' && arg ? arg.biz : null
  const bizs = activeBusinesses()
  const b = bizs.find(x => x.id === bizId)
  if (b && bizs.length > 1 && b.phone && b.id !== lastWppBiz) {
    try { e.sender.send('wpp-hint', { name: b.name, color: b.color, phone: b.phone }) } catch (err) {}
  }
  if (b) lastWppBiz = b.id
  const num = n.startsWith('55') && n.length >= 12 ? n : '55' + n
  shell.openExternal(`whatsapp://send?phone=${num}${text ? '&text=' + encodeURIComponent(text) : ''}`)
})

ipcMain.on('notify', (_, { title, body }) => {
  if (Notification.isSupported())
    new Notification({ title, body, icon: path.join(__dirname, 'icon.png') }).show()
})

// ─── BOOT ────────────────────────────────────────────────────────────────
// ─── UMA CÓPIA SÓ ───────────────────────────────────────────────────────
// Duas cópias abertas (ex.: "iniciar com o Windows" + npm start) gravavam o
// mesmo arquivo e uma apagava as mudanças da outra. Agora só fica uma:
// se a segunda for de uma versão mais nova, a antiga fecha e passa a vez;
// se não, a segunda só traz a janela da que já está aberta e fecha.
function newerThan(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) }
  return false
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function acquireLock() {
  const data = { version: app.getVersion() }
  for (let i = 0; i < 12; i++) {
    if (app.requestSingleInstanceLock(data)) return true
    await sleep(400)
  }
  return false
}

app.whenReady().then(async () => {
  if (!(await acquireLock())) { app.exit(0); return }
  store.reload()   // a cópia antiga pode ter gravado algo enquanto esta esperava
  store.migrate()  // 0.7: negócios + formato novo (com cópia de segurança antes)
  Money.configure({ workSat: Core.getSettings(store.data).routine.workSat })
  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data && newerThan(data.version, app.getVersion())) { app.isQuitting = true; app.quit() }
    else showMain()
  })
  boot()
})

function boot() {
  applyAutoStart()
  ;['display-added', 'display-removed', 'display-metrics-changed'].forEach(ev =>
    screen.on(ev, () => setTimeout(keepOnScreen, 300)))   // tirou/colocou monitor ou mudou escala
  applyShortcut()
  setTimeout(() => morningBrief(), 4000)
  setInterval(() => morningBrief(), 10 * 60 * 1000)   // pega a virada do dia com o app aberto
  setInterval(() => pushCompactData(), 60 * 1000)     // flutuante/pílula acompanham a virada do dia
  seedDoneFromLegacy()
  createMain()
  createCompact()
  createPill()
  createTray()
  // 1ª vez: quem já usava ganha o aviso de novidades; instalação nova abre o app com as boas-vindas
  const u = getUi()
  if (!u.onboarded && !u.whatsNewSeenSet) {
    const hasData = store.get('followups', []).length || store.get('done', []).length
    if (hasData) setUi({ onboarded: true, whatsNew10: true, whatsNewSeenSet: true })
  }
  // Com a nuvem ligada, o login é obrigatório: sem conta, só a janela de entrada aparece
  initCloud().then(() => {
    if (gated()) showMain()
    else { showFloating(); if (!getUi().onboarded) showMain() }
  })
  Updater.init({ app, config: Config.load(app), notify: (st) => { rebuildTrayMenu(); if (mainWin) mainWin.webContents.send('update-state', st) } })
}

app.on('window-all-closed', e => e.preventDefault())

app.on('will-quit', () => { try { globalShortcut.unregisterAll() } catch (e) {} })


// ═══ NUVEM: LOGIN, SINCRONIZAÇÃO, EQUIPES (1.0) ══════════════════════════
const sync = new Sync({
  store,
  getClient: () => cloud.getClient(),
  onApplied: () => { Money.configure({ workSat: Core.getSettings(store.data).routine.workSat }); afterChange() },
  onStatus: st => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('sync-status', st) },
  log: (...a) => console.log('[sync]', ...a),
})
store.onSave = () => { if (sync.user && !sync.running) sync.schedule() }

async function initCloud() {
  if (!cloud.configured()) return
  const u = await Auth.currentUser()
  if (u) sync.start(u)
  try { powerMonitor.on('resume', () => sync.syncNow()) } catch (e) {}
}
async function loggedIn(r) {
  if (r && r.ok && r.user) { await sync.start(r.user); afterChange() }
  return r
}
const authApi = {
  'auth:sign-up':        a => Auth.signUp(a).then(loggedIn),
  'auth:sign-in':        a => Auth.signIn(a).then(loggedIn),
  'auth:google':         () => Auth.signInWithGoogle().then(loggedIn),
  'auth:mfa-login':      a => Auth.mfaVerifyLogin(a).then(loggedIn),
  'auth:resend':         a => Auth.resendConfirmation(a && a.email),
  'auth:reset-request':  a => Auth.requestPasswordReset(a && a.email),
  'auth:reset-confirm':  a => Auth.confirmPasswordReset(a).then(loggedIn),
  'auth:change-password':a => Auth.changePassword(a),
  'auth:mfa-status':     () => Auth.mfaStatus(),
  'auth:mfa-enroll':     () => Auth.mfaEnroll(),
  'auth:mfa-activate':   a => Auth.mfaActivate(a),
  'auth:mfa-disable':    a => Auth.mfaDisable(a),
}
for (const [ch, fn] of Object.entries(authApi)) ipcMain.handle(ch, (_, a) => fn(a || {}))

ipcMain.handle('auth:sign-out', async (_, { wipe } = {}) => {
  await sync.syncNow().catch(() => {})     // sobe o que faltava antes de sair
  sync.stop({ wipe: !!wipe })
  await Auth.signOut()
  hideFloating(); showMain()                // volta pra tela de entrada
  afterChange()
  return { ok: true }
})
ipcMain.handle('auth:delete-account', async () => {
  const r = await Auth.deleteAccount()
  if (r.ok) { sync.stop({ wipe: false }); delete store.data.roles; delete store.data.people; store.save(); afterChange() }
  return r
})
ipcMain.handle('sync:now', () => sync.syncNow({ full: true }))

// ─── Equipes ────────────────────────────────────────────────────────────
function teamErr(e) {
  const m = String((e && e.message) || e || '')
  const map = { sem_permissao: 'Você não tem permissão pra isso.', so_loja: 'Convites só existem em negócios do tipo Loja.', convite_invalido: 'Código de convite inválido.',
    convite_expirado: 'Esse convite venceu ou já foi usado. Peça um novo.', ja_membro: 'Essa pessoa já está na equipe.', email_invalido: 'E-mail inválido.', prove_email: 'Confirme com o código enviado pro seu e-mail.', nao_remove_dono: 'O dono não pode ser removido.', papel_invalido: 'Papel inválido.', sem_login: 'Entre na sua conta primeiro.' }
  for (const k of Object.keys(map)) if (m.includes(k)) return { ok: false, error: map[k] }
  return { ok: false, error: /fetch|network/i.test(m) ? 'Sem conexão com a internet.' : (m || 'Algo deu errado.') }
}
async function rpc(name, args) {
  if (!sync.user) return { ok: false, error: 'Entre na sua conta primeiro.' }
  try {
    const { data, error } = await cloud.getClient().rpc(name, args)
    return error ? teamErr(error) : { ok: true, data }
  } catch (e) { return teamErr(e) }
}
ipcMain.handle('team:invite', async (_, { biz, role }) => {
  await sync.syncNow()                              // o negócio precisa existir na nuvem
  return rpc('create_invite', { ws: biz, invite_role: role === 'manager' ? 'manager' : 'seller' })
})
ipcMain.handle('team:accept', async (_, { code }) => {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z2-9]{6}$/.test(c)) return { ok: false, error: 'O código tem 6 letras/números.' }
  const r = await rpc('accept_invite', { invite_code: c })
  if (r.ok) { await sync.syncNow({ full: true }); afterChange() }
  return r
})
ipcMain.handle('team:set-role', async (_, { biz, user, role }) => { const r = await rpc('set_member_role', { ws: biz, member: user, new_role: role }); if (r.ok) await sync.syncNow(); return r })
ipcMain.handle('team:remove', async (_, { biz, user }) => { const r = await rpc('remove_member', { ws: biz, member: user }); if (r.ok) await sync.syncNow({ full: true }); return r })
ipcMain.handle('team:leave', async (_, { biz }) => { const r = await rpc('leave_workspace', { ws: biz }); if (r.ok) { await sync.syncNow({ full: true }); afterChange() } return r })
ipcMain.handle('team:phone-owner', async (_, { biz, phone }) => {
  const b = store.get('businesses', []).find(x => x.id === biz)
  const p8 = String(phone || '').replace(/\D/g, '').slice(-8)
  if (!sync.user || !b || b.kind !== 'store' || p8.length < 8) return null
  const r = await rpc('phone_owner', { ws: biz, phone8: p8 })
  return r.ok ? r.data : null
})

// ─── LGPD: exportar e apagar dados deste computador ────────────────────
// 1.3: relatório do período em PDF (janela escondida, sem scripts)
ipcMain.handle('report:pdf', async (_, { html, css, name }) => {
  const safe = String(name || 'Retoma - relatorio').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { title: 'Salvar relatório', defaultPath: path.join(app.getPath('documents'), safe + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (canceled || !filePath) return { ok: false, canceled: true }
  const fontDir = 'file:///' + path.join(__dirname, 'fonts').replace(/\\/g, '/')
  const doc = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${String(css || '').replace(/url\((['"]?)fonts\//g, 'url($1' + fontDir + '/')}
    html,body{background:#fff!important;color:#111!important;margin:0;height:auto!important;overflow:visible!important}body{padding:0}
    .rp{--rp-ink:#111;--rp-mut:#666;color:#111}</style></head><body class="print">${html}</body></html>`
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    const tmp = path.join(app.getPath('temp'), 'retoma-relatorio.html')
    fs.writeFileSync(tmp, doc, 'utf8')
    await w.loadFile(tmp)
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } })
    fs.writeFileSync(filePath, pdf)
    try { fs.unlinkSync(tmp) } catch (e) {}
    shell.openPath(filePath)
    return { ok: true, path: filePath }
  } catch (e) { return { ok: false, error: String(e.message || e) } } finally { w.destroy() }
})
ipcMain.handle('data:export', async () => {
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { title: 'Exportar meus dados', defaultPath: path.join(app.getPath('documents'), `retoma-meus-dados-${stamp}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (canceled || !filePath) return { ok: false, canceled: true }
  const clean = JSON.parse(JSON.stringify(store.data, (k, v) => (k === '_s' || k === '_remote' || k === 'sync') ? undefined : v))
  fs.writeFileSync(filePath, JSON.stringify({ exportadoEm: d.toISOString(), app: 'Retoma ' + app.getVersion(), ...clean }, null, 2), 'utf8')
  return { ok: true, path: filePath }
})
ipcMain.handle('data:wipe-local', async () => {
  store.backup('antes-de-apagar')
  sync.stop({ wipe: true })
  await Auth.signOut()
  setUi({ onboarded: false, tutorialDone: false })
  afterChange()
  return { ok: true }
})
// Excluir de vez (some também nos outros aparelhos)
ipcMain.handle('delete-forever', (_, id) => {
  const done = store.get('done', []), act = store.get('followups', [])
  const item = done.find(f => f.id === id) || act.find(f => f.id === id)
  if (!item) return false
  store.data.done = done.filter(f => f.id !== id)
  store.data.followups = act.filter(f => f.id !== id)
  tombstone(store.data, item)
  store.save()
  afterChange()
  return true
})
ipcMain.on('set-ui', (_, patch) => {
  const ok = {}
  for (const k of ['onboarded', 'tutorialDone', 'whatsNew10', 'seen12']) if (k in (patch || {})) ok[k] = !!patch[k]
  if (patch && typeof patch.ownerFilter === 'string') ok.ownerFilter = patch.ownerFilter.slice(0, 64)
  setUi(ok)
})
ipcMain.handle('update:install', () => Updater.install())
ipcMain.handle('update:check', () => Updater.check())
ipcMain.on('open-url', (_, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url) })

// Só nos testes automáticos (variável RETOMA_FAKE_CLOUD): acesso pra simular outra pessoa da equipe
if (process.env.RETOMA_FAKE_CLOUD) globalThis.__retomaTest = { cloud, sync, store, Auth, fake: require(process.env.RETOMA_FAKE_CLOUD) }


// ═══ 1.1: ENTRADA OBRIGATÓRIA — "Criar minha empresa" e "Fui convidado" ═══
let pendingCompany = null
// A empresa nova aproveita o negócio que já existe neste PC (com os retomas dele)
function prepareCompany(name) {
  const nm = String(name || '').trim().slice(0, 30) || 'Minha empresa'
  const list = store.get('businesses', [])
  const local = list.filter(b => !b._remote && !b.archived)
  const withData = local.find(b => store.get('followups', []).some(f => f.biz === b.id) || store.get('done', []).some(f => f.biz === b.id))
  const target = withData || local[0]
  const t = new Date().toISOString()
  if (target) { target.name = nm; target.kind = 'store'; delete target._auto; target.updatedAt = t }
  else list.push(Core.makeBusiness({ name: nm, kind: 'store', updatedAt: t }, list.length))
  store.data.businesses = list
  setUi({ onboarded: false, companyNew: true })     // o app mostra a escolha do modelo (Madeireira…)
  store.save()
}
// Vendedor: o que já existia neste PC vira negócio pessoal (não entra na loja sem querer)
function prepareSeller() {
  for (const b of store.get('businesses', [])) if (!b._remote && b.kind === 'store') { b.kind = 'personal'; b.updatedAt = new Date().toISOString() }
  setUi({ onboarded: true, sellerNew: true })
  store.save()
}
async function joinedNames(ids) {
  const set = new Set(ids || [])
  return store.get('businesses', []).filter(b => set.has(b.id)).map(b => b.name)
}
async function acceptMine() {
  try {
    const { data, error } = await cloud.getClient().rpc('accept_my_invites')
    return error ? [] : (data || []).map(x => typeof x === 'string' ? x : x.accept_my_invites)
  } catch (e) { return [] }
}
ipcMain.handle('auth:create-company', async (_, a = {}) => {
  if (!String(a.company || '').trim()) return { ok: false, error: 'Digite o nome da empresa.', code: 'validation' }
  const r = await Auth.signUp(a)
  if (r.ok && r.needsConfirmation) { pendingCompany = a.company; return r }
  if (r.ok && r.user) { prepareCompany(a.company); await loggedIn(r) }
  return r
})
ipcMain.handle('auth:confirm-signup', async (_, a = {}) => {
  const r = await Auth.confirmSignup(a)
  if (r.ok && r.user) { if (pendingCompany) { prepareCompany(pendingCompany); pendingCompany = null } await loggedIn(r) }
  return r
})
ipcMain.handle('auth:invite-request', (_, a = {}) => Auth.requestEmailCode(a.email))
ipcMain.handle('auth:invite-verify', async (_, a = {}) => {
  const r = await Auth.verifyEmailCode(a)
  if (!r.ok || r.mfaRequired) return r
  const ids = await acceptMine()
  prepareSeller()
  await loggedIn(r)
  return { ...r, joined: await joinedNames(ids) }
})
ipcMain.handle('auth:finish-profile', async (_, a = {}) => {
  const r = await Auth.finishProfile(a)
  if (r.ok && r.user && sync.user) { sync.user = { ...sync.user, name: r.user.name }; afterChange() }
  return r
})
ipcMain.handle('auth:join-with-code', async (_, a = {}) => {
  const code = String(a.code || '').trim().toUpperCase()
  if (!/^[A-Z2-9]{6}$/.test(code)) return { ok: false, error: 'O código da loja tem 6 letras/números.', code: 'validation' }
  const r = await Auth.signUp(a)
  if (!r.ok) return r
  if (r.needsConfirmation) return { ok: false, error: 'Confirme o e-mail e depois entre com "Já tenho conta".', code: 'needs_confirm' }
  const { data: ws, error } = await cloud.getClient().rpc('accept_invite', { invite_code: code })
  if (error) { await Auth.signOut(); return teamErr(error) }
  prepareSeller()
  await loggedIn(r)
  return { ...r, joined: await joinedNames([ws]) }
})
// Convites pendentes pro meu e-mail (conta já existente): confirma com código no e-mail
ipcMain.handle('auth:pending-invites', async () => { const r = await rpc('my_pending_invites'); return r.ok ? r.data || [] : [] })
ipcMain.handle('auth:accept-request', async () => sync.user ? Auth.requestEmailCode(sync.user.email) : { ok: false, error: 'Entre na sua conta primeiro.' })
ipcMain.handle('auth:accept-verify', async (_, { code } = {}) => {
  if (!sync.user) return { ok: false, error: 'Entre na sua conta primeiro.' }
  const r = await Auth.verifyEmailCode({ email: sync.user.email, code })
  if (!r.ok) return r
  const ids = await acceptMine()
  await sync.syncNow({ full: true }); afterChange()
  return { ok: true, joined: await joinedNames(ids) }
})
// Gerente: convidar por e-mail (manda o código de acesso) + código de reserva
ipcMain.handle('team:invite-email', async (_, { biz, email, role } = {}) => {
  await sync.syncNow()
  const r = await rpc('invite_by_email', { ws: biz, invite_email: email, invite_role: role === 'manager' ? 'manager' : 'seller' })
  if (!r.ok) return r
  const mail = await Auth.sendInviteEmail(email)
  return { ok: true, code: r.data, emailSent: mail.ok, emailError: mail.ok ? null : mail.error }
})
ipcMain.handle('team:invites', async (_, { biz } = {}) => { const r = await rpc('ws_invites', { ws: biz }); return r.ok ? r.data || [] : [] })
ipcMain.handle('team:cancel-invite', (_, { code } = {}) => rpc('cancel_invite', { invite_code: code }))
ipcMain.handle('ui:consume', (_, key) => { const v = !!getUi()[key]; if (['companyNew', 'sellerNew'].includes(key)) setUi({ [key]: false }); return v })
