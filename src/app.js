
// ─── Arrastar a janela (o main segue o cursor; ver main.js → startDrag) ───
function makeDraggable(handle, { onClickOnly } = {}) {
  let down = null, moved = false
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, .no-drag')) return
    down = { x: e.screenX, y: e.screenY }; moved = false
  })
  window.addEventListener('mousemove', e => {
    if (!down || moved) return
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) < 4) return
    moved = true; document.body.classList.add('dragging-win'); window.api.dragStart()
  })
  const end = () => { if (!down) return; const m = moved; down = null; moved = false; document.body.classList.remove('dragging-win'); if (m) window.api.dragEnd() }
  window.addEventListener('mouseup', end)
  window.addEventListener('blur', end)
}

window.addEventListener('DOMContentLoaded', () => {
  const tb = document.querySelector('.topbar')
  makeDraggable(tb)
  tb.addEventListener('dblclick', e => { if (!e.target.closest('button, input, label, a')) window.api.winMax() })
})
let currentMonth, currentYear, selectedDate = null
let allData = []
let filtroAtivo = 'todos'
const VERSION = '1.2.0'

// ─── NEGÓCIOS (0.7) ─────────────────────────────────────────────────────
let meta = null            // { businesses, settings, features, ui, colors, plan }
let bizFilter = 'all'      // 'all' ou id do negócio
const bizList  = () => (meta ? meta.businesses : []).filter(b => !b.archived)
const multi    = () => bizList().length > 1
const bizOf    = id => (meta ? meta.businesses : []).find(b => b.id === id)
const feat     = k => !meta || meta.features[k] !== false
// ─── Equipe (1.0): quem sou eu, meu papel, filtro por vendedor ───
let ownerFilter = 'all'    // 'all' | 'me' | id do vendedor | 'none' (carteira sem dono)
const myId     = () => meta && meta.account && meta.account.user ? meta.account.user.id : null
const roleIn   = id => meta && meta.account ? (meta.account.roles || {})[id] || null : null
const peopleOf = id => meta && meta.account ? (meta.account.people || {})[id] || [] : []
const isMgr    = id => ['owner', 'manager'].includes(roleIn(id))
const isMine   = f => f.owner === undefined || f.owner === myId() || !myId()
// negócio de loja em que eu sou dono/gerente e que está "na tela" agora
function teamBiz() {
  const id = bizFilter !== 'all' ? bizFilter : (bizList().length === 1 ? bizList()[0].id : null)
  const b = id && bizOf(id)
  // aparece com equipe OU quando sobrou cliente na carteira sem dono (pra redistribuir)
  return b && b.kind === 'store' && isMgr(id) && (peopleOf(id).length > 1 || allData.some(f => f.biz === id && f.owner === null)) ? id : null
}
const vis = () => {
  let l = bizFilter === 'all' ? allData : allData.filter(f => f.biz === bizFilter)
  if (teamBiz() && ownerFilter !== 'all') {
    l = l.filter(f => ownerFilter === 'none' ? f.owner === null : ownerFilter === 'me' ? isMine(f) : f.owner === ownerFilter)
  }
  return l
}
function ownerTag(f) {
  const b = bizOf(f.biz)
  if (!b || b.kind !== 'store' || !isMgr(f.biz) || isMine(f)) return ''
  if (f.owner === null) return `<span class="own-tag none">Sem responsável</span>`
  const p = peopleOf(f.biz).find(x => x.id === f.owner)
  return `<span class="own-tag">👤 ${esc(p ? p.name : 'vendedor')}</span>`
}
function applyAccent(hex) {
  const h = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#1db954'
  const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, L = c => Math.round(c + (255 - c) * 0.35)
  const st = document.documentElement.style
  st.setProperty('--green', h); st.setProperty('--acc-rgb', `${r},${g},${b}`); st.setProperty('--acc-light', `rgb(${L(r)},${L(g)},${L(b)})`)
}
const uid      = () => { try { return crypto.randomUUID() } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2) } }
async function loadMeta() {
  meta = await window.api.getMeta()
  Money.configure({ workSat: meta.settings.routine.workSat })
  bizFilter = meta.ui.bizFilter || 'all'
  if (bizFilter !== 'all' && !bizList().some(b => b.id === bizFilter)) bizFilter = 'all'
  distPerDay = meta.settings.routine.distPerDay || 5
  ownerFilter = meta.ui.ownerFilter || 'all'
  applyAccent(meta.settings.visual && meta.settings.visual.accent)
  renderSyncDot(meta.account && meta.account.sync)
  renderRoleChip()
  // a entrada só fecha sozinha quando ninguém está no meio de um passo (ex.: criar a senha do convite)
  if (meta.account && meta.account.gated) openGate(); else if (!['finish', 'mfa'].includes(gateView)) closeGate()
  const fs = meta.features
  ;['money', 'score', 'templates', 'cooling', 'week', 'history'].forEach(k => document.body.classList.toggle('no-' + k, fs[k] === false))
  document.body.classList.toggle('multi', multi())
}
const valChip = f => { if (!feat('money')) return ''; const v = Money.valueOf(f); return v ? `<span class="val-chip">${Money.fmtMoney(v)}</span>` : '' }
function bizTag(f) {
  if (!multi() || bizFilter !== 'all') return ''
  const b = bizOf(f.biz); if (!b) return ''
  return `<span class="biz-tag" style="--c:${b.color}">${esc(b.name)}</span>`
}
function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return d
}

// ─── CAMPOS PERSONALIZADOS (0.7.1) ─────────────────────────────────────
const bizFields = id => ((bizOf(id) || {}).fields || []).filter(fd => !fd.off)   // 1.3: campo desligado some do app
function fmtField(fd, v) {
  if (v === undefined || v === null || v === '') return ''
  if (fd.type === 'money') return Money.fmtMoney(v)
  if (fd.type === 'number') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return String(v)
}
// Chips "m³ 7,5 · Deck" nos cards (só campos com "mostrar no card")
function cfChips(f) {
  if (!f.fields) return ''
  return bizFields(f.biz).filter(fd => fd.onCard && f.fields[fd.id] !== undefined && !(fd.type === 'money' && feat('money')))
    .map(fd => `<span class="cf-chip"><em>${esc(fd.label)}</em> ${esc(fmtField(fd, f.fields[fd.id]))}</span>`).join('')
}
const fieldText = f => f.fields ? bizFields(f.biz).map(fd => fmtField(fd, f.fields[fd.id])).join(' ').toLowerCase() : ''

// Formulário: campos do negócio escolhido
let cfVals = {}
function renderCF(bizId) {
  const box = document.getElementById('cf-box'); if (!box) return
  const fields = bizFields(bizId)
  box.innerHTML = fields.map(fd => {
    const v = cfVals[fd.id]
    if (fd.type === 'choice') return `<div class="m-field"><label>${esc(fd.label)}</label><div class="cf-opts">${fd.options.map(o =>
      `<button type="button" class="cf-opt ${v === o ? 'on' : ''}" onclick="cfPick('${fd.id}', this)" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`
    const shown = v === undefined || v === '' ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : v)
    const ph = fd.type === 'money' ? 'R$ 0,00' : fd.type === 'number' ? '0' : ''
    return `<div class="m-field"><label>${esc(fd.label)}${fd.type === 'money' ? ' <span class="cf-hint">entra no dinheiro em jogo</span>' : ''}</label><input type="text" ${fd.type !== 'text' ? 'inputmode="decimal"' : ''} placeholder="${ph}" value="${esc(shown)}" oninput="cfVals['${fd.id}']=this.value" autocomplete="off"></div>`
  }).join('')
}
function cfPick(id, btn) {
  const v = btn.dataset.v
  cfVals[id] = cfVals[id] === v ? '' : v
  btn.parentElement.querySelectorAll('.cf-opt').forEach(b => b.classList.toggle('on', b.dataset.v === cfVals[id]))
}

function setBizFilter(id) {
  bizFilter = id
  window.api.setBizFilter(id)
  if (!teamBiz()) ownerFilter = 'all'
  refreshDone().then(render)
}

// Aviso "Abrindo pela Construpac · confira o número" (o Retoma não troca a conta do WhatsApp)
let hintTimer = null
function showHint(html, color) {
  const el = document.getElementById('hint-toast')
  el.innerHTML = html
  el.style.setProperty('--c', color || '#1db954')
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
  clearTimeout(hintTimer); hintTimer = setTimeout(() => el.classList.remove('show'), 4200)
}

const WPP = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`

function setPrio(p) {
  document.getElementById('inp-prio').value = p
  ;['alta','media','baixa'].forEach(x => {
    const btn = document.getElementById('btn-p-'+x)
    if (btn) btn.className = 'prio-btn' + (x === p ? ' sel-'+x : '')
  })
}

async function init() {
  const now = new Date()
  currentMonth = now.getMonth()
  currentYear  = now.getFullYear()
  await loadMeta()
  allData = await window.api.getData()
  await refreshDone()
  render()
  document.getElementById('pane').classList.add('anim'); setTimeout(() => document.getElementById('pane').classList.remove('anim'), 1200)
  if (window.api.onWinMax) window.api.onWinMax(m => { const b = document.getElementById('btn-max'); b.title = m ? 'Restaurar' : 'Maximizar'; b.innerHTML = m ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/></svg>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>' })
  setTimeout(maybeWelcome, 400)
  setInterval(checkNotifications, 30000)
  if (window.api.onWppHint) window.api.onWppHint(h => showHint(`📱 Abrindo pela <b>${esc(h.name)}</b> · confira se o WhatsApp está no ${esc(fmtPhone(h.phone))}`, h.color))
  if (window.api.onShowSettings) window.api.onShowSettings(async () => { await loadMeta(); showSettings() })
  if (window.api.onShowDone) window.api.onShowDone(() => showDone())
  if (window.api.onEditItem) window.api.onEditItem(async id => {
    allData = await window.api.getData(); selId = id; swapN++; nav('all'); openDetailDrawer()
  })
  if (window.api.onShowOverdue) window.api.onShowOverdue(async () => {
    allData = await window.api.getData(); render(); showOverdue()
  })
  window.api.onReload(async () => {
    await loadMeta()
    allData = await window.api.getData()
    await refreshDone()
    render()
  })
}

const todayStr = () => (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
const isLate   = f => f.date < todayStr()

function dateLabel(ds) {
  const [,m,d] = ds.split('-')
  return `${parseInt(d)} ${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(m)-1]}`
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
async function persist() { await window.api.setData(allData) }

// ─── DISTRIBUIR ATRASADOS ───────────────────────────────────────────────
let distPerDay = 5, distStartToday = true, distPlan = []
function openDistribute() {
  distStartToday = new Date().getHours() < 17   // depois das 17h começa amanhã
  renderDistribute()
  document.getElementById('dist-overlay').classList.add('open')
}
function closeDistribute() { document.getElementById('dist-overlay').classList.remove('open') }
function setDist(k, v) { if (k === 'per') distPerDay = v; else distStartToday = v; renderDistribute() }
function renderDistribute() {
  distPlan = Money.planDistribution(vis(), { perDay: distPerDay, startToday: distStartToday })
  document.querySelectorAll('[data-per]').forEach(b => b.classList.toggle('on', +b.dataset.per === distPerDay))
  document.querySelectorAll('[data-start]').forEach(b => b.classList.toggle('on', (b.dataset.start === 'today') === distStartToday))
  const by = {}
  distPlan.forEach(p => (by[p.to] = by[p.to] || []).push(p))
  const dot = { alta: '🔴', media: '🟡', baixa: '🟢' }
  document.getElementById('dist-preview').innerHTML = Object.keys(by).sort().map(ds => {
    const already = vis().filter(f => f.date === ds).length
    const v = !feat('money') ? 0 : Money.sumValues(by[ds].map(p => allData.find(f => f.id === p.id)))
    return `<div class="dist-day"><div class="dist-head"><b>${Money.shortDate(ds)}</b><span>+${by[ds].length}${already ? ` (já tinha ${already})` : ''}${v ? ' · ' + Money.fmtMoney(v) : ''}</span></div>
      <div class="dist-names">${by[ds].map(p => `<span>${dot[p.prio]} ${esc(p.name)}</span>`).join('')}</div></div>`
  }).join('') || '<div class="empty-msg">Nenhum atrasado 🎉</div>'
  document.getElementById('dist-go').textContent = distPlan.length ? `Distribuir ${distPlan.length}` : 'Fechar'
}
async function applyDistribute() {
  if (!distPlan.length) { closeDistribute(); return }
  const before = distPlan.map(p => ({ id: p.id, date: p.from }))
  distPlan.forEach(p => { const f = allData.find(x => x.id === p.id); if (f) f.date = p.to })
  const n = distPlan.length
  await persist(); closeDistribute(); render()
  if (currentView === 'overdue') goHome()
  showToast(`📅 ${n} atrasado${n > 1 ? 's' : ''}`, 'distribuídos na semana', async () => {
    const cur = await window.api.getData()
    before.forEach(b => { const it = cur.find(x => x.id === b.id); if (it) it.date = b.date })
    await window.api.setData(cur)
  })
}

function updateBadge() {
  window.api.updateBadge(allData.filter(f => f.date >= todayStr()).length)
}

function renderCalendar() {
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const lbl = document.getElementById('cal-month-label'), grid = document.getElementById('cal-grid')
  if (!lbl || !grid) return
  lbl.textContent = `${months[currentMonth]} ${currentYear}`
  grid.innerHTML = ''
  ;['D','S','T','Q','Q','S','S'].forEach(d => {
    const el=document.createElement('div'); el.className='cal-dow'; el.textContent=d; grid.appendChild(el)
  })
  const firstDay=new Date(currentYear,currentMonth,1).getDay()
  const daysInMonth=new Date(currentYear,currentMonth+1,0).getDate()
  const today=todayStr(); const dayMap={}
  vis().forEach(f => {
    const [fy,fm]=f.date.split('-').map(Number)
    if (fy===currentYear&&fm===currentMonth+1) {
      if (!dayMap[f.date]) dayMap[f.date]={count:0,hasLate:false}
      dayMap[f.date].count++
      if (isLate(f)) dayMap[f.date].hasLate=true
    }
  })
  for (let i=0;i<firstDay;i++){const el=document.createElement('div');el.className='cal-day empty';grid.appendChild(el)}
  for (let d=1;d<=daysInMonth;d++) {
    const ds=`${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const el=document.createElement('div'); el.className='cal-day'
    if (ds===today) el.classList.add('today')
    if (ds===(selectedDate||todayStr())) el.classList.add('selected')
    const num=document.createElement('div'); num.className='day-num'; num.textContent=d; el.appendChild(num)
    if (dayMap[ds]) {
      const dot=document.createElement('div')
      dot.className='day-dot'+(dayMap[ds].hasLate?' late':'')
      dot.textContent=`●${dayMap[ds].count}`; el.appendChild(dot)
    }
    el.onclick=()=>selectDay(ds); grid.appendChild(el)
  }
}

async function refreshDoneCache() { try { doneCache = await window.api.getDone(); doneAll = doneCache } catch (e) { doneCache = [] } }
function openModal(editId) {
  refreshDoneCache().then(updateHint)
  document.getElementById('modal-title').textContent=editId?'Editar retoma':'Novo retoma'
  document.getElementById('edit-id').value=editId||''
  if (editId) {
    const f=allData.find(x=>x.id===editId); if (!f) return
    document.getElementById('inp-name').value=f.name
    document.getElementById('inp-phone').value=f.phone
    document.getElementById('inp-note').value=f.note||''
    document.getElementById('inp-date').value=f.date
    document.getElementById('inp-time').value=f.time
    setPrio(f.prio||'media')
    cfVals = { ...(f.fields || {}) }
    setBizPick(f.biz)
    setOwnerPick(f.biz, f.owner === undefined ? myId() : f.owner)
  } else {
    document.getElementById('inp-name').value=''
    document.getElementById('inp-phone').value=''
    document.getElementById('inp-note').value=''
    document.getElementById('inp-date').value=selectedDate||todayStr()
    document.getElementById('inp-time').value='09:00'
    setPrio('media')
    cfVals = {}
    const last = meta && meta.ui.lastBiz
    setBizPick(bizFilter !== 'all' ? bizFilter : (last && bizList().some(b => b.id === last) ? last : (bizList()[0] || {}).id))
    setOwnerPick(document.getElementById('inp-biz').value, teamBiz() && !['all', 'me', 'none'].includes(ownerFilter) ? ownerFilter : myId())
  }
  document.getElementById('overlay').classList.add('open')
  setTimeout(()=>document.getElementById('inp-name').focus(),50)
}
function setBizPick(id) {
  const box = document.getElementById('biz-pick')
  document.getElementById('inp-biz').value = id || ''
  document.getElementById('biz-field').style.display = multi() ? '' : 'none'
  box.innerHTML = bizList().map(b => `<button type="button" class="bp-btn ${b.id === id ? 'on' : ''}" style="--c:${b.color}" onclick="setBizPick('${b.id}')"><i></i>${esc(b.name)}</button>`).join('')
  renderCF(id)
  if (document.getElementById('owner-field')) setOwnerPick(id, document.getElementById('inp-owner').value || myId())
  checkDup()
}
function closeModal(){document.getElementById('overlay').classList.remove('open')}

async function saveFollowup() {
  const name=document.getElementById('inp-name').value.trim()
  const phone=document.getElementById('inp-phone').value.trim()
  const note=document.getElementById('inp-note').value.trim()
  const date=document.getElementById('inp-date').value
  const time=document.getElementById('inp-time').value
  const editId=document.getElementById('edit-id').value
  const prio=document.getElementById('inp-prio').value
  const biz=document.getElementById('inp-biz').value || (bizList()[0] || {}).id
  if (!name||!phone||!date){alert('Preencha nome, número e data.');return}
  // campos personalizados: o main limpa (número, lista) e calcula o valor
  const fields = {}
  for (const [k, v] of Object.entries(cfVals)) if (v !== '' && v !== undefined && v !== null) fields[k] = v
  // responsável: gerente escolhe; vendedor é sempre ele mesmo
  const ownSel = document.getElementById('owner-field').style.display !== 'none' ? document.getElementById('inp-owner').value : null
  const owner = ownSel === null ? undefined : (ownSel === 'none' ? null : ownSel)
  const extra = owner === undefined ? {} : { owner }
  const newId = editId || uid()
  if (editId){const idx=allData.findIndex(x=>x.id===editId);if(idx!==-1)allData[idx]={...allData[idx],name,phone,note,date,time,prio,biz,fields,...extra}}
  else allData.push({id:newId,name,phone,note,date,time,prio,biz,fields,...extra})
  window.api.setLastBiz(biz); if (meta) meta.ui.lastBiz = biz
  await persist(); allData = await window.api.getData(); closeModal()
  selId = newId; swapN++; bumpN++
  if (!editId && currentView === 'today' && date > addDays(todayStr(), 7)) currentView = 'all'
  if (['done', 'team', 'settings', 'clients'].includes(currentView)) currentView = 'all'
  render()
  const nr = document.querySelector(`.row[data-id="${CSS.escape(newId)}"]`); if (nr) { nr.classList.add('flash'); nr.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
  openDetailDrawer()
}

async function done(id) {
  const item = allData.find(f => f.id === id)
  await window.api.complete(id)
  allData = await window.api.getData(); await refreshDone(); bumpN++; render()
  if (item) showUndo(item)
}

// ─── DESFAZER ───────────────────────────────────────────────────────────
let undoTimer = null
let undoAction = null
function showToast(prefix, name, action) {
  const t = document.getElementById('undo-toast')
  document.getElementById('undo-prefix').textContent = prefix
  document.getElementById('undo-name').textContent = name
  undoAction = action
  t.classList.remove('show', 'ask', 'final'); void t.offsetWidth; t.classList.add('show')
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => t.classList.remove('show'), 8000)
}
function showUndo(item) {
  showToast('✓ Concluído:', item.name, async () => { await window.api.restore(item.id) })
  const t = document.getElementById('undo-toast')
  if (feat('score')) t.classList.add('ask'); t.dataset.id = item.id
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => t.classList.remove('show', 'ask'), 12000)   // um pouco mais de tempo pra responder
}
async function setOutcomeFromToast(outcome) {
  const t = document.getElementById('undo-toast')
  const id = t.dataset.id
  t.classList.remove('ask')
  await window.api.setOutcome(id, outcome)
  const it = (await window.api.getDone()).find(x => x.id === id)
  const v = it && feat('money') ? Money.valueOf(it) : 0
  document.getElementById('undo-prefix').textContent = outcome === 'won' ? '💰 Fechou!' : 'Anotado:'
  document.getElementById('undo-name').textContent = outcome === 'won' ? (v ? Money.fmtMoney(v) + ' no placar' : 'no placar do mês') : 'não fechou'
  undoAction = null
  t.classList.add('final')
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.remove('final'), 500) }, 2600)
  renderScore()
}
async function undoLast() {
  const t = document.getElementById('undo-toast')
  t.classList.remove('show'); clearTimeout(undoTimer)
  const a = undoAction; undoAction = null
  if (!a) return
  await a()
  allData = await window.api.getData(); await refreshDone(); bumpN++; render()
}

// ─── ADIAR (snooze) ─────────────────────────────────────────────────────
let snoozeId = null
function openSnooze(id, btn) {
  const pop = document.getElementById('snooze-pop')
  if (snoozeId === id && pop.classList.contains('open')) { closeSnooze(); return }
  snoozeId = id
  const f = allData.find(x => x.id === id); if (!f) return
  document.getElementById('snooze-title').textContent = `Adiar ${f.name}`
  const loadOf = ds => allData.filter(x => x.date === ds && x.id !== id && x.biz === f.biz).length
  document.getElementById('snooze-opts').innerHTML = Money.snoozeOptions().map(o => {
    const n = loadOf(o.date)
    return `<button class="snz-opt" onclick="applySnooze('${o.date}')"><span>${o.label}</span><small>${o.sub}${n ? ` · <em class="${n >= 6 ? 'busy' : ''}">${n} marcado${n > 1 ? 's' : ''}</em>` : ''}</small></button>`
  }).join('') +
    `<button class="snz-opt other" onclick="closeSnooze();openModal('${esc(id)}');setTimeout(()=>document.getElementById('inp-date').focus(),80)"><span>Escolher data…</span></button>`
  // posiciona perto do botão, sem sair da janela
  const r = btn.getBoundingClientRect()
  pop.style.visibility = 'hidden'; pop.classList.add('open')
  const pw = pop.offsetWidth, ph = pop.offsetHeight
  let x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.right - pw))
  let y = r.bottom + 6
  if (y + ph > window.innerHeight - 8) y = r.top - ph - 6
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px'
  pop.style.visibility = ''
  pop.classList.remove('anim'); void pop.offsetWidth; pop.classList.add('anim')
}
function closeSnooze() { document.getElementById('snooze-pop').classList.remove('open', 'anim'); snoozeId = null }
async function applySnooze(date) {
  const id = snoozeId; closeSnooze()
  moveItem(id, date, 'adiado')
}
document.addEventListener('mousedown', e => {
  const pop = document.getElementById('snooze-pop')
  if (pop.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.snz')) closeSnooze()
})

// ─── CONCLUÍDOS ─────────────────────────────────────────────────────────
function doneWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  if (d.toDateString() === now.toDateString()) return `hoje ${hm}`
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `ontem ${hm}`
  return `${d.getDate()} ${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()]}`
}
function doneCard(f) {
  const tag = f.recovered ? '<span class="rec-tag">recuperado</span>' : `concluído ${doneWhen(f.doneAt)}`
  const oc = f.outcome
  const chips = f.recovered ? '' : `<div class="oc-row"><button class="oc-btn won ${oc==='won'?'on':''}" onclick="toggleOutcome('${esc(f.id)}','won')">💰 Fechou</button><button class="oc-btn lost ${oc==='lost'?'on':''}" onclick="toggleOutcome('${esc(f.id)}','lost')">Não fechou</button></div>`
  return `<div class="result-card done-card ${oc ? 'oc-' + oc : ''}"><div class="result-top"><div><div class="result-name">${esc(f.name)}${Money.valueOf(f) ? valChip(f) : ''}</div><div class="result-phone">${esc(f.phone)}</div><div class="result-meta">era ${dateLabel(f.date)} · ${esc(f.note||'—')} · ${tag}${bizTag(f)}</div>${chips}</div><div class="result-acts"><button class="sm-btn wpp" onclick="wpp('${esc(f.phone)}','${esc(f.biz||'')}')">${WPP}</button><button class="restore-btn" onclick="restoreDone('${esc(f.id)}', this)">↩ Restaurar</button><button class="del-btn" title="Excluir de vez" onclick="deleteForever('${esc(f.id)}', this)">🗑</button></div></div></div>`
}
async function toggleOutcome(id, o) {
  const it = (await window.api.getDone()).find(x => x.id === id)
  await window.api.setOutcome(id, it && it.outcome === o ? null : o)
  await refreshDone(); renderPane()
}
async function restoreDone(id, btn) {
  const card = btn.closest('.result-card'); card.classList.add('leaving')
  await window.api.restore(id)
  allData = await window.api.getData(); await refreshDone(); bumpN++
  setTimeout(render, 260)
}

function wpp(phone, biz){window.api.openWhatsapp(phone, biz)}

function checkNotifications(){
  if (meta && !meta.settings.system.notifyTime) return
  const now=new Date()
  allData.forEach(f=>{const dt=new Date(`${f.date}T${f.time}`);const diff=dt-now;if(diff>=0&&diff<30000)window.api.notify(`Retoma: ${f.name}`,f.note||'Hora de entrar em contato!')})
}

document.getElementById('overlay').addEventListener('click',e=>{if(e.target===document.getElementById('overlay'))closeModal()})
init()

// ─── MENSAGENS PRONTAS ──────────────────────────────────────────────────
let msgId = null, templates = null
function firstName(n) {
  const w = String(n || '').split(/[\/\-–(,]/)[0].trim().split(/\s+/)[0] || ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
}
function fillTemplate(text, f) {
  const v = Money.valueOf(f)
  // {m³}, {tipo de peça}… viram o valor do campo do cliente
  for (const fd of bizFields(f.biz)) {
    const re = new RegExp('\\{' + fd.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'gi')
    text = text.replace(re, fmtField(fd, f.fields && f.fields[fd.id]))
  }
  return text.replace(/\{nome\}/gi, firstName(f.name))
             .replace(/\{valor\}/gi, v ? Money.fmtMoney(v) : '')
             .replace(/\{assunto\}/gi, f.note || '')
             .replace(/\s+([,.!?])/g, '$1').replace(/ {2,}/g, ' ').trim()
}
async function openMsg(id, btn) {
  const pop = document.getElementById('msg-pop')
  if (msgId === id && pop.classList.contains('open')) { closeMsg(); return }
  closeSnooze()
  msgId = id
  const f = allData.find(x => x.id === id); if (!f) return
  templates = await window.api.getTemplates()
  document.getElementById('msg-title').textContent = `Mensagem pra ${firstName(f.name) || f.name}`
  const mine = templates.map((t, i) => ({ t, i })).filter(x => !x.t.biz || x.t.biz === f.biz)
  document.getElementById('msg-opts').innerHTML = (mine.length ? mine.map(({ t, i }) =>
    `<button class="msg-opt" onclick="sendTemplate(${i})"><b>${esc(t.title)}</b><span>${esc(fillTemplate(t.text, f))}</span></button>`).join('') : '<div class="msg-empty">Nenhuma mensagem pra este negócio</div>') +
    `<button class="msg-edit" onclick="closeMsg();openTemplates()">✏️ Editar mensagens</button>`
  const r = btn.getBoundingClientRect()
  pop.style.visibility = 'hidden'; pop.classList.add('open')
  const pw = pop.offsetWidth, ph = pop.offsetHeight
  const x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.right - pw))
  let y = r.bottom + 6
  if (y + ph > window.innerHeight - 8) y = r.top - ph - 6
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px'
  pop.style.visibility = ''
  pop.classList.remove('anim'); void pop.offsetWidth; pop.classList.add('anim')
}
function closeMsg() { document.getElementById('msg-pop').classList.remove('open', 'anim'); msgId = null }
function sendTemplate(i) {
  const f = allData.find(x => x.id === msgId); closeMsg(); if (!f || !templates[i]) return
  window.api.openWhatsappText(f.phone, fillTemplate(templates[i].text, f), f.biz)
}
async function openTemplates() {
  templates = await window.api.getTemplates()
  const labels = [...new Set(bizList().flatMap(b => (b.fields || []).filter(fd => !fd.off).map(fd => fd.label)))]
  document.getElementById('tpl-fields').innerHTML = labels.length ? `Campos: ${labels.map(l => `<code>{${esc(l)}}</code>`).join(' ')}` : ''
  renderTemplateEditor()
  document.getElementById('tpl-overlay').classList.add('open')
}
function renderTemplateEditor() {
  document.getElementById('tpl-list').innerHTML = templates.map((t, i) => `
    <div class="tpl-item">
      <div class="tpl-row"><input class="tpl-title" data-i="${i}" value="${esc(t.title)}" placeholder="Nome do modelo"><button class="tpl-del" title="Apagar" onclick="delTemplate(${i})">🗑</button></div>
      ${multi() ? `<select class="tpl-biz" data-i="${i}"><option value="">Todos os negócios</option>${bizList().map(b => `<option value="${b.id}" ${t.biz === b.id ? 'selected' : ''}>Só ${esc(b.name)}</option>`).join('')}</select>` : ''}
      <textarea class="tpl-text" data-i="${i}" rows="3" placeholder="Texto da mensagem">${esc(t.text)}</textarea>
    </div>`).join('')
}
function collectTemplates() {
  document.querySelectorAll('.tpl-title').forEach(el => { templates[+el.dataset.i].title = el.value })
  document.querySelectorAll('.tpl-text').forEach(el => { templates[+el.dataset.i].text = el.value })
  document.querySelectorAll('.tpl-biz').forEach(el => { if (el.value) templates[+el.dataset.i].biz = el.value; else delete templates[+el.dataset.i].biz })
}
function addTemplate() { collectTemplates(); templates.push({ title: '', text: 'Oi {nome}, ', ...(bizFilter !== 'all' ? { biz: bizFilter } : {}) }); renderTemplateEditor()
  const ts = document.querySelectorAll('.tpl-title'); ts[ts.length - 1].focus() }
function delTemplate(i) { collectTemplates(); templates.splice(i, 1); renderTemplateEditor() }
async function saveTemplates() {
  collectTemplates()
  await window.api.setTemplates(templates.filter(t => t.title.trim() && t.text.trim()))
  document.getElementById('tpl-overlay').classList.remove('open')
}
function closeTemplates() { document.getElementById('tpl-overlay').classList.remove('open') }
document.addEventListener('mousedown', e => {
  const pop = document.getElementById('msg-pop')
  if (pop.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.msg')) closeMsg()
})

// ─── HISTÓRICO DO CLIENTE (dica no formulário) ──────────────────────────
let doneCache = []
const digits = s => String(s || '').replace(/\D/g, '')
// 1.3: mesmo cliente = MESMO NÚMERO (só dígitos, sem +55, sem DDD, sem o 9 extra).
// Nome igual não conta mais (dava falso "já marcado").
const phoneKey = s => { let d = digits(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); if (d.length >= 10) d = d.slice(2); return d.length >= 8 ? d.slice(-8) : '' }
function samePerson(a, b) {
  const pa = phoneKey(a.phone)
  return !!pa && pa === phoneKey(b.phone)
}
function historyHint(name, phone, editId) {
  if (!phoneKey(phone)) return ''
  const me = { name, phone }
  const act = allData.filter(f => f.id !== editId && samePerson(me, f))
  const old = doneCache.filter(f => f.id !== editId && samePerson(me, f))
  if (!act.length && !old.length) return ''
  const parts = []
  const n = act.length + old.length + 1
  parts.push(`<b>${n}º contato</b>`)
  const last = old.sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))[0]
  if (last) parts.push(`último em ${dateLabel(Money.ymd(new Date(last.doneAt || last.date)))}${last.note ? ': ' + esc(last.note) : ''}${last.outcome === 'won' ? ' 💰' : last.outcome === 'lost' ? ' ✗' : ''}`)
  if (act.length) parts.push(`já tem retoma em ${act.map(f => dateLabel(f.date)).join(', ')}`)
  return '🕘 ' + parts.join(' · ')
}
function updateHint() {
  const el = document.getElementById('hist-hint')
  if (!feat('history')) { el.classList.remove('show'); return }
  const h = historyHint(document.getElementById('inp-name').value, document.getElementById('inp-phone').value, document.getElementById('edit-id').value)
  el.innerHTML = h; el.classList.toggle('show', !!h)
}
;['inp-name', 'inp-phone'].forEach(id => document.getElementById(id).addEventListener('input', updateHint))

// ─── CONFIGURAÇÕES (0.7) ────────────────────────────────────────────────
// Tudo salva na hora (sem botão "Salvar"). Negócios: criar, renomear, cor,
// número do WhatsApp, mostrar na pílula, arquivar.
let setOpenBiz = null, setShowArchived = false
const FEATURE_INFO = [
  ['money',     'Dinheiro em jogo',   'Lê o valor das anotações ("7,1 K", "R$ 2.500") e soma'],
  ['score',     'Placar "Fechou?"',   'Pergunta se fechou ao concluir e mostra o placar do mês'],
  ['templates', 'Mensagens prontas',  'Botão 💬 nos cards com textos prontos pro WhatsApp'],
  ['week',      'Faixa da semana',    'Próximos 5 dias úteis no topo do app'],
  ['cooling',   'Esfriando',          'Selo 🧊 quando um retoma foi adiado 3 vezes'],
  ['history',   'Histórico do cliente', 'Mostra os contatos anteriores ao digitar nome ou número'],
  ['brief',     'Resumo da manhã',    'Notificação 1x por dia com o que tem pra hoje'],
]

const tgl = (on, call) => `<button class="tgl ${on ? 'on' : ''}" onclick="${call}" role="switch" aria-checked="${on}"><i></i></button>`
function segBtns(vals, cur, call, fmt = x => x) {
  return `<div class="seg">${vals.map(x => `<button class="${x === cur ? 'on' : ''}" onclick="${call.replace('$', JSON.stringify(x).replace(/"/g, "'"))}">${fmt(x)}</button>`).join('')}</div>`
}

function renderSettings() {
  if (!meta) return
  const st = meta.settings
  const active = meta.businesses.filter(b => !b.archived), archived = meta.businesses.filter(b => b.archived)
  const count = id => allData.filter(f => f.biz === id).length
  const inPill = active.filter(b => b.showInPill).length
  const bizCard = b => {
    const open = setOpenBiz === b.id
    // vendedor numa loja: nome, cor, tipo e campos são do dono/gerente (só lê)
    const ro = b.kind === 'store' && roleIn(b.id) && !isMgr(b.id)
    return `<div class="sb ${open ? 'open' : ''}" style="--c:${b.color}">
      <button class="sb-head" onclick="toggleSetBiz('${b.id}')"><i></i><span class="sb-name">${esc(b.name)}</span><span class="sb-n">${count(b.id)} retoma${count(b.id) === 1 ? '' : 's'}</span><svg class="sb-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
      ${open ? `<div class="sb-body">
        ${ro ? `<div class="s-note ro-note">🔒 Nome, cor, tipo e campos desta loja são definidos pelo dono ou gerente.</div>` : ''}
        <fieldset class="s-fs" ${ro ? 'disabled' : ''}>
        <label class="s-lbl">Nome</label>
        <input class="s-inp" id="sb-name-${b.id}" value="${esc(b.name)}" maxlength="30" onchange="editBiz('${b.id}',{name:this.value})" onkeydown="if(event.key==='Enter')this.blur()">
        <label class="s-lbl">Tipo</label>
        ${segBtns(['personal', 'store'], b.kind, `editBiz('${b.id}',{kind:$})`, x => x === 'store' ? '🏪 Loja (com equipe)' : '👤 Só eu')}
        </fieldset>
        <label class="s-lbl">Meu WhatsApp neste negócio</label>
        <input class="s-inp" value="${esc(fmtPhone(b.phone))}" placeholder="(11) 99999-9999" inputmode="numeric" onchange="editBiz('${b.id}',{phone:this.value})" onkeydown="if(event.key==='Enter')this.blur()">
        <div class="s-note">Ao abrir uma conversa, o Retoma avisa qual número usar. Ele não troca a conta do WhatsApp sozinho.</div>
        <fieldset class="s-fs" ${ro ? 'disabled' : ''}>
        <label class="s-lbl">Cor</label>
        <div class="sw-row">${meta.colors.map(c => `<button class="sw ${c === b.color ? 'on' : ''}" style="--s:${c}" onclick="editBiz('${b.id}',{color:'${c}'})"></button>`).join('')}</div>
        <button class="s-link" onclick="document.getElementById('sec-fields').scrollIntoView({behavior:'smooth',block:'start'})">Campos do formulário (m³, tipo de peça…) →</button>
        </fieldset>
        ${b.kind === 'store' && !(meta.account && meta.account.user) ? teamSection(b) : ''}
        ${active.length > 1 ? `<div class="s-row"><div><b>Mostrar na pílula</b><small>${b.showInPill ? 'Bolinha própria na pílula' : 'Entra no total "outros"'}${!b.showInPill && inPill >= meta.maxInPill ? ` · máximo ${meta.maxInPill}` : ''}</small></div>${tgl(b.showInPill, `editBiz('${b.id}',{showInPill:${!b.showInPill}})`)}</div>` : ''}
        ${active.length > 1 ? `<button class="s-danger" onclick="editBiz('${b.id}',{archived:true})">Arquivar negócio</button>` : ''}
      </div>` : ''}
    </div>`
  }
  const sb = document.getElementById('set-body'); if (!sb) return
  sb.innerHTML = `
    ${accountSection()}
    <div class="s-sec">
      <div class="s-h">Negócios</div>
      ${active.map(bizCard).join('')}
      <button class="s-add" onclick="addBiz()">+ Novo negócio</button>
      ${archived.length ? `<button class="s-link" onclick="setShowArchived=!setShowArchived;renderSettings()">${setShowArchived ? '▾' : '▸'} Arquivados (${archived.length})</button>
        ${setShowArchived ? archived.map(b => `<div class="sb-arch" style="--c:${b.color}"><i></i><span>${esc(b.name)}</span><button onclick="editBiz('${b.id}',{archived:false})">Reativar</button></div>`).join('') : ''}` : ''}
    </div>
    <div class="s-sec" id="sec-fields">
      <div class="s-h">Campos do formulário</div>
      <div class="s-note" style="margin:-2px 0 10px">Campos extras de cada negócio (ex.: m³, tipo de peça). Desligue o que não usa: some do formulário, dos cards e da busca. Os valores já salvos ficam guardados.</div>
      ${active.map(b => { const ro = b.kind === 'store' && roleIn(b.id) && !isMgr(b.id); return `<div class="fe-biz" style="--c:${b.color}">${active.length > 1 ? `<div class="fe-bizname"><i></i>${esc(b.name)}</div>` : ''}${ro ? `<div class="s-note ro-note">🔒 Definidos pelo dono ou gerente.</div>` : ''}<fieldset class="s-fs" ${ro ? 'disabled' : ''}>${fieldsEditor(b, true)}</fieldset></div>` }).join('')}
    </div>
    <div class="s-sec">
      <div class="s-h">Recursos</div>
      ${FEATURE_INFO.map(([k, t, d]) => `<div class="s-row"><div><b>${t}</b><small>${d}</small></div>${tgl(st.features[k], `setSetting('features','${k}',${!st.features[k]})`)}</div>`).join('')}
    </div>
    <div class="s-sec">
      <div class="s-h">Rotina</div>
      <div class="s-row"><div><b>Sábado é dia útil</b><small>Vale pro Adiar, pra faixa da semana e pro Distribuir</small></div>${tgl(st.routine.workSat, `setSetting('routine','workSat',${!st.routine.workSat})`)}</div>
      <div class="s-blk"><b>Resumo da manhã a partir das</b>${segBtns([6, 7, 8, 9, 10], st.routine.briefHour, "setSetting('routine','briefHour',$)", x => x + 'h')}</div>
      <div class="s-blk"><b>Distribuir atrasados: máximo por dia</b>${segBtns([3, 4, 5, 6, 8], st.routine.distPerDay, "setSetting('routine','distPerDay',$)")}</div>
    </div>
    <div class="s-sec">
      <div class="s-h">Sistema</div>
      <div class="s-row"><div><b>Iniciar com o Windows</b><small>Abre sozinho ao ligar o PC</small></div>${tgl(meta.ui.autoStart, `setUiSetting('autoStart',${!meta.ui.autoStart})`)}</div>
      <div class="s-row"><div><b>Atalho Ctrl+Alt+R</b><small>Novo retoma com o número copiado</small></div>${tgl(st.system.shortcut, `setSetting('system','shortcut',${!st.system.shortcut})`)}</div>
      <div class="s-row"><div><b>Aviso no horário</b><small>Notificação na hora marcada do retoma</small></div>${tgl(st.system.notifyTime, `setSetting('system','notifyTime',${!st.system.notifyTime})`)}</div>
      <div class="s-blk"><b>Flutuante ao minimizar</b>${segBtns(['compact', 'pill'], meta.ui.mode, "setUiSetting('mode',$)", x => x === 'pill' ? 'Pílula' : 'Card')}</div>
      <div class="s-blk"><b>Cor de destaque</b><div class="sw-row">${(meta.accents || []).map(c => `<button class="sw ${c === st.visual.accent ? 'on' : ''}" style="--s:${c}" onclick="setSetting('visual','accent','${c}')"></button>`).join('')}</div></div>
    </div>
    ${dataSection()}
    <div class="s-foot">Retoma ${VERSION} · Plano ${meta.plan === 'free' ? 'Grátis' : esc(meta.plan)}${meta.update && meta.update.enabled ? ` · <a href="#" onclick="checkUpdate();return false">procurar atualização</a>` : ''}</div>`
}

function toggleSetBiz(id) {
  setOpenBiz = setOpenBiz === id ? null : id
  renderSettings()
}
async function saveBizList(list, okMsg) {
  const r = await window.api.setBusinesses(list)
  if (!r.ok) { showHint('⚠️ ' + esc(r.msg), '#e53935'); renderSettings(); return false }
  meta = r.meta
  await loadMeta()
  if (bizFilter !== 'all' && !bizList().some(b => b.id === bizFilter)) setBizFilter('all')
  render()
  if (okMsg) showHint(okMsg)
  return true
}
function editBiz(id, patch) {
  if ('name' in patch && !String(patch.name).trim()) { renderSettings(); return }
  const list = meta.businesses.map(b => b.id === id ? { ...b, ...patch } : b)
  const b = meta.businesses.find(x => x.id === id)
  let msg = '✓ Salvo'
  if (patch.archived === true) { msg = `📦 ${esc(b.name)} arquivado`; setOpenBiz = null }
  if (patch.archived === false) msg = `✓ ${esc(b.name)} reativado`
  saveBizList(list, msg)
}
async function addBiz() {
  const used = new Set(meta.businesses.filter(b => !b.archived).map(b => b.color))
  const color = meta.colors.find(c => !used.has(c)) || meta.colors[meta.businesses.length % meta.colors.length]
  let name = 'Novo negócio', n = 2
  while (meta.businesses.some(b => !b.archived && b.name.toLowerCase() === name.toLowerCase())) name = `Novo negócio ${n++}`
  const inPill = meta.businesses.filter(b => !b.archived && b.showInPill).length
  const before = new Set(meta.businesses.map(b => b.id))
  if (await saveBizList([...meta.businesses, { name, color, showInPill: inPill < meta.maxInPill }])) {
    const nb = meta.businesses.find(b => !before.has(b.id))
    if (nb) { setOpenBiz = nb.id; renderSettings(); setTimeout(() => { const el = document.getElementById('sb-name-' + nb.id); if (el) { el.focus(); el.select() } }, 60) }
  }
}
async function setSetting(group, key, val) {
  meta = await window.api.setSettings({ [group]: { [key]: val } })
  await loadMeta(); render()
}
async function setUiSetting(key, val) {
  meta = await window.api.setSettings({ ui: { [key]: val } })
  await loadMeta(); render()
}


// ─── Editor de campos (0.7.1) ───────────────────────────────────────────
let setOpenField = null
const FIELD_TYPES_UI = [['text', 'Texto'], ['number', 'Número'], ['money', 'Valor R$'], ['choice', 'Lista']]
const FIELD_PRESETS = {
  'Madeireira': [
    { label: 'm³', type: 'number' },
    { label: 'Tipo de peça', type: 'choice', options: ['Deck', 'Pergolado', 'Poste', 'Viga', 'Prancha', 'Ripa'] },
    { label: 'Valor', type: 'money', onCard: false },
  ],
  'Serviços': [
    { label: 'Plano', type: 'choice', options: ['Básico', 'Intermediário', 'Completo'] },
    { label: 'Valor mensal', type: 'money', onCard: false },
  ],
}
function fieldsEditor(b, bare) {
  const fields = b.fields || []
  const hasMoney = fields.some(f => f.type === 'money')
  const row = fd => {
    const open = setOpenField === fd.id
    const tl = (FIELD_TYPES_UI.find(t => t[0] === fd.type) || [])[1]
    return `<div class="fe ${open ? 'open' : ''} ${fd.off ? 'is-off' : ''}">
      <div class="fe-top"><button class="fe-head" onclick="toggleField('${fd.id}')"><span class="fe-lbl">${esc(fd.label)}</span><span class="fe-type">${fd.off ? 'desligado' : tl + (fd.type === 'choice' ? ' · ' + fd.options.length : '')}</span>${fd.onCard && !fd.off ? '<span class="fe-card" title="Aparece no card">card</span>' : ''}</button><span class="fe-use" title="${fd.off ? 'Ligar campo' : 'Desligar campo (some do formulário e dos cards)'}">${tgl(!fd.off, `editField('${b.id}','${fd.id}',{off:${!fd.off}})`)}</span></div>
      ${open ? `<div class="fe-body">
        <input class="s-inp" id="fe-lbl-${fd.id}" value="${esc(fd.label)}" maxlength="24" placeholder="Nome do campo" onchange="editField('${b.id}','${fd.id}',{label:this.value})" onkeydown="if(event.key==='Enter')this.blur()">
        <div class="seg fe-seg">${FIELD_TYPES_UI.map(([t, l]) => `<button class="${fd.type === t ? 'on' : ''}" ${t === 'money' && hasMoney && fd.type !== 'money' ? 'disabled title="Só um campo de valor por negócio"' : ''} onclick="editField('${b.id}','${fd.id}',{type:'${t}'})">${l}</button>`).join('')}</div>
        ${fd.type === 'choice' ? `<input class="s-inp" value="${esc(fd.options.join(', '))}" placeholder="Opções separadas por vírgula" onchange="editField('${b.id}','${fd.id}',{options:this.value})" onkeydown="if(event.key==='Enter')this.blur()">` : ''}
        ${fd.type === 'money' ? `<div class="s-note">Quando preenchido, este valor é o que conta no dinheiro em jogo (no lugar do "7,1 K" da anotação).</div>` : ''}
        <div class="s-row"><div><b>Mostrar no card</b><small>Aparece como etiqueta nos cards e na busca</small></div>${tgl(fd.onCard, `editField('${b.id}','${fd.id}',{onCard:${!fd.onCard}})`)}</div>
        <button class="s-danger" onclick="removeField('${b.id}','${fd.id}')">Remover campo</button>
      </div>` : ''}
    </div>`
  }
  return `${bare ? '' : '<label class="s-lbl">Campos do formulário</label>'}
    ${fields.length ? fields.map(row).join('') : `<div class="s-note" style="margin:0 0 6px">Campos extras pra este negócio, como m³ ou tipo de peça. Sugestões:</div>
      <div class="fe-presets">${Object.keys(FIELD_PRESETS).map(k => `<button onclick="usePreset('${b.id}','${k}')">${k}</button>`).join('')}</div>`}
    ${fields.length < 6 ? `<button class="s-add fe-add" onclick="addField('${b.id}')">+ Campo</button>` : '<div class="s-note">Máximo de 6 campos.</div>'}`
}
function toggleField(id) { setOpenField = setOpenField === id ? null : id; renderSettings() }
function editField(bizId, fid, patch) {
  const b = meta.businesses.find(x => x.id === bizId); if (!b) return
  if ('label' in patch && !String(patch.label).trim()) { renderSettings(); return }
  if ('options' in patch) patch.options = String(patch.options).split(',').map(o => o.trim()).filter(Boolean)
  const fields = b.fields.map(f => f.id === fid ? { ...f, ...patch } : f)
  if (patch.type === 'choice' && !fields.find(f => f.id === fid).options.length) fields.find(f => f.id === fid).options = ['Opção 1', 'Opção 2']
  saveBizList(meta.businesses.map(x => x.id === bizId ? { ...x, fields } : x), '✓ Salvo')
}
async function addField(bizId) {
  const b = meta.businesses.find(x => x.id === bizId); if (!b) return
  let label = 'Novo campo', n = 2
  while (b.fields.some(f => f.label.toLowerCase() === label.toLowerCase())) label = `Novo campo ${n++}`
  const before = new Set(b.fields.map(f => f.id))
  if (await saveBizList(meta.businesses.map(x => x.id === bizId ? { ...x, fields: [...x.fields, { label, type: 'text' }] } : x))) {
    const nf = (meta.businesses.find(x => x.id === bizId).fields || []).find(f => !before.has(f.id))
    if (nf) { setOpenField = nf.id; renderSettings(); setTimeout(() => { const el = document.getElementById('fe-lbl-' + nf.id); if (el) { el.focus(); el.select() } }, 60) }
  }
}
function removeField(bizId, fid) {
  setOpenField = null
  saveBizList(meta.businesses.map(x => x.id === bizId ? { ...x, fields: x.fields.filter(f => f.id !== fid) } : x), '🗑 Campo removido (os valores já salvos ficam guardados)')
}
function usePreset(bizId, name) {
  saveBizList(meta.businesses.map(x => x.id === bizId ? { ...x, fields: FIELD_PRESETS[name].map(f => ({ ...f })) } : x), `✓ Campos de ${name} adicionados`)
}

// ═══ 1.0: CONTA, SINCRONIZAÇÃO, EQUIPES ═══════════════════════════════════

if (window.api.onSyncStatus) window.api.onSyncStatus(st => {
  if (meta && meta.account) meta.account.sync = st
  renderSyncDot(st)
  if (currentView === 'settings') { const el = document.getElementById('acc-sync'); if (el) el.innerHTML = syncLine(st) }
})
function syncLine(st) {
  if (!st) return ''
  const when = st.lastSync ? new Date(st.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  return { idle: `✓ Sincronizado às ${when}`, syncing: '↻ Sincronizando…', offline: '○ Sem internet · as mudanças sobem quando voltar', error: '⚠️ ' + esc(st.error || 'Erro'), off: '' }[st.state] || ''
}

// ─── Configurações → Conta ───
function accountSection() {
  const a = meta.account || {}
  if (!a.cloud && a.missingKey) return `<div class="s-sec"><div class="s-h">Conta e sincronização</div>
    <div class="s-blk acc-cta"><b>⚠️ Falta a chave do Supabase</b><small class="s-small">O endereço do servidor já está no <code>retoma.config.json</code>, mas a chave pública (<code>supabaseAnonKey</code>) está vazia. Cole a chave <b>anon public</b> (Supabase → Project Settings → API Keys) e abra o Retoma de novo. Enquanto isso, ele funciona só neste computador.</small></div></div>`
  if (!a.cloud) return `<div class="s-sec"><div class="s-h">Conta e sincronização</div>
    <div class="s-blk"><b>Usando só neste computador</b><small class="s-small">Pra entrar com conta, sincronizar com outros aparelhos e montar equipes, a nuvem precisa ser configurada uma vez (guia em <code>supabase/LEIA-ME.md</code>). Tudo continua funcionando normalmente sem ela.</small></div></div>`
  if (!a.user) return `<div class="s-sec"><div class="s-h">Conta e sincronização</div>
    <div class="s-blk acc-cta"><b>Entre pra usar em outros aparelhos e com sua equipe</b><small class="s-small">Seus retomas continuam neste PC; ao entrar, eles sobem pra sua conta.</small>
      <div class="acc-btns"><button class="btn-acc" onclick="openAuth('login')">Entrar</button><button class="btn-acc ghost" onclick="openAuth('signup')">Criar conta</button></div></div></div>`
  const u = a.user
  return `<div class="s-sec"><div class="s-h">Conta</div>
    <div class="s-blk acc-card">
      <div class="acc-top"><div class="acc-av">${esc((u.name || u.email || '?')[0].toUpperCase())}</div><div><b>${esc(u.name || '')}</b><small class="s-small">${esc(u.email || '')}</small></div></div>
      <div class="acc-sync" id="acc-sync">${syncLine(a.sync)}</div>
      <div class="acc-btns"><button class="btn-acc ghost" onclick="syncNowUi(this)">Sincronizar agora</button><button class="btn-acc ghost" onclick="openJoin()">Tenho um código da loja</button></div>
    </div>
    <div class="s-row"><div><b>Verificação em 2 etapas</b><small>Pede um código do celular (Google Authenticator) ao entrar</small></div><button class="btn-mini" onclick="openMfa()">Configurar</button></div>
    <div class="s-row"><div><b>Senha</b><small>Trocar a senha desta conta</small></div><button class="btn-mini" onclick="openAuth('change')">Trocar</button></div>
    <div class="s-row"><div><b>Sair da conta</b><small>Os dados ficam guardados na nuvem</small></div><button class="btn-mini" onclick="signOutUi()">Sair</button></div>
  </div>`
}
function dataSection() {
  const a = meta.account || {}
  return `<div class="s-sec"><div class="s-h">Privacidade e dados</div>
    <div class="s-row"><div><b>Exportar meus dados</b><small>Arquivo com todos os retomas, negócios e configurações</small></div><button class="btn-mini" onclick="exportUi()">Exportar</button></div>
    <div class="s-row"><div><b>Política de privacidade</b><small>Como o Retoma trata os seus dados (LGPD)</small></div><button class="btn-mini" onclick="openPrivacy()">Ver</button></div>
    <div class="s-row"><div><b>Tour pelo app</b><small>Mostra de novo onde fica cada coisa</small></div><button class="btn-mini" onclick="goHome();setTimeout(startTour,350)">Ver tour</button></div>
    <button class="s-danger" onclick="wipeLocalUi()">Apagar os dados deste computador</button>
    ${a.user ? `<button class="s-danger" onclick="deleteAccountUi()">Excluir minha conta e meus dados</button>` : ''}
  </div>`
}
async function syncNowUi(btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; await window.api.syncNow(); await loadMeta(); renderSettings() }
async function exportUi() { const r = await window.api.exportData(); if (r.ok) showHint('✓ Dados exportados') }
function openPrivacy() {
  const u = meta.account && meta.account.siteUrl
  if (u) window.api.openUrl(u.replace(/\/+$/, '') + '/privacidade.html'); else showPrivacyLocal()
}
function showPrivacyLocal() {
  dialogBox(`<div class="dlg-t">Política de privacidade</div><div class="dlg-scroll">${PRIVACY_SHORT}</div>`, [{ t: 'Fechar' }])
}
const PRIVACY_SHORT = `<p><b>O que o Retoma guarda:</b> os retomas que você cadastra (nome e telefone do cliente, assunto, data, valores e campos que você criar), seus negócios e configurações.</p>
<p><b>Onde:</b> sempre no seu computador. Se você entrar com uma conta, também na nuvem (Supabase), pra sincronizar entre aparelhos e com a sua equipe.</p>
<p><b>Quem vê:</b> só você. Numa loja, o dono e o gerente veem os retomas da loja; cada vendedor vê só os dele.</p>
<p><b>WhatsApp:</b> o Retoma nunca lê, envia nem automatiza nada no WhatsApp. Ele só abre a conversa pra você.</p>
<p><b>Seus direitos (LGPD):</b> exportar todos os seus dados, apagar os dados deste computador e excluir sua conta a qualquer momento, aqui em Configurações.</p>
<p>Os clientes cadastrados são dados de terceiros: use-os só pra atender quem pediu orçamento ou já é cliente.</p>`

// ─── Caixinha de diálogo genérica ───
function dialogBox(html, buttons) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'dlg-ov'
    ov.innerHTML = `<div class="dlg">${html}<div class="dlg-btns">${buttons.map((b, i) => `<button class="${b.cls || (i === buttons.length - 1 ? 'dlg-main' : 'dlg-sec')}" data-i="${i}">${b.t}</button>`).join('')}</div></div>`
    document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add('open'))
    const close = v => { ov.classList.remove('open'); setTimeout(() => ov.remove(), 250); res(v) }
    ov.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) close({ i: +b.dataset.i, val: (ov.querySelector('.dlg-inp') || {}).value, checked: [...ov.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value) }); else if (e.target === ov) close(null) })
    const inp = ov.querySelector('.dlg-inp'); if (inp) setTimeout(() => inp.focus(), 60)
  })
}
async function signOutUi() {
  const r = await dialogBox(`<div class="dlg-t">Sair da conta?</div><p class="dlg-p">Seus dados continuam na nuvem. Neste computador, você prefere manter uma cópia ou apagar?</p>`,
    [{ t: 'Cancelar' }, { t: 'Sair e apagar daqui', cls: 'dlg-danger' }, { t: 'Sair e manter' }])
  if (!r || r.i === 0) return
  await window.api.auth('sign-out', { wipe: r.i === 1 })
  await loadMeta(); allData = await window.api.getData(); render(); renderSettings(); showHint('Você saiu da conta')
}
async function wipeLocalUi() {
  const r = await dialogBox(`<div class="dlg-t">Apagar os dados deste computador?</div><p class="dlg-p">Todos os retomas, negócios e configurações saem deste PC (uma cópia de segurança fica na pasta de backups). ${meta.account && meta.account.user ? 'O que já está na nuvem continua lá.' : 'Sem conta, isso não tem volta.'}</p><input class="dlg-inp" placeholder="Digite APAGAR pra confirmar">`,
    [{ t: 'Cancelar' }, { t: 'Apagar', cls: 'dlg-danger' }])
  if (!r || r.i !== 1) return
  if (String(r.val || '').trim().toUpperCase() !== 'APAGAR') { showHint('⚠️ Digite APAGAR pra confirmar', '#e53935'); return }
  await window.api.wipeLocal(); location.reload()
}
async function deleteAccountUi() {
  const r = await dialogBox(`<div class="dlg-t">Excluir sua conta?</div><p class="dlg-p">Apaga sua conta e seus dados da nuvem: negócios pessoais e o login. Lojas que você é dono passam pro gerente (ou pro membro mais antigo). Seus clientes em lojas de outros ficam com a loja, sem responsável. <b>Não tem volta.</b></p><input class="dlg-inp" placeholder="Digite EXCLUIR pra confirmar">`,
    [{ t: 'Cancelar' }, { t: 'Excluir conta', cls: 'dlg-danger' }])
  if (!r || r.i !== 1) return
  if (String(r.val || '').trim().toUpperCase() !== 'EXCLUIR') { showHint('⚠️ Digite EXCLUIR pra confirmar', '#e53935'); return }
  const res = await window.api.auth('delete-account')
  if (!res.ok) { showHint('⚠️ ' + esc(res.error), '#e53935'); return }
  await loadMeta(); renderSettings(); showHint('Conta excluída')
}

// ─── Tela de login (os 6 pilares: ver auth.js) ───
let authMode = 'login', authEmail = '', authFactor = null
function openAuth(mode = 'login') {
  authMode = mode
  document.getElementById('auth-ov').classList.add('open')
  renderAuth()
}
function closeAuth() { document.getElementById('auth-ov').classList.remove('open') }
function renderAuth(msg = '', isErr = true) {
  const box = document.getElementById('auth-box')
  const em = esc(authEmail)
  const google = `<button class="btn-google" onclick="authGoogle(this)"><svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continuar com Google</button><div class="auth-or"><span>ou</span></div>`
  const note = msg ? `<div class="auth-msg ${isErr ? 'err' : 'ok'}" role="alert">${msg}</div>` : ''
  const views = {
    login: `<div class="auth-t">Entrar</div>${google}
      <label class="s-lbl">E-mail</label><input class="s-inp" id="au-email" type="email" autocomplete="email" value="${em}">
      <label class="s-lbl">Senha</label><input class="s-inp" id="au-pass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')authLogin(document.getElementById('au-go'))">
      ${note}<button class="btn-acc full" id="au-go" onclick="authLogin(this)">Entrar</button>
      <div class="auth-links"><a href="#" onclick="authMode='forgot';renderAuth();return false">Esqueci a senha</a><a href="#" onclick="authMode='signup';renderAuth();return false">Criar conta</a></div>`,
    signup: `<div class="auth-t">Criar conta</div>${google}
      <label class="s-lbl">Seu nome</label><input class="s-inp" id="au-name" autocomplete="name">
      <label class="s-lbl">E-mail</label><input class="s-inp" id="au-email" type="email" autocomplete="email" value="${em}">
      <label class="s-lbl">Senha (8+ caracteres, letras e números)</label><input class="s-inp" id="au-pass" type="password" autocomplete="new-password">
      <label class="s-lbl">Repita a senha</label><input class="s-inp" id="au-pass2" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')authSignup(document.getElementById('au-go'))">
      ${note}<button class="btn-acc full" id="au-go" onclick="authSignup(this)">Criar conta</button>
      <div class="auth-links"><a href="#" onclick="authMode='login';renderAuth();return false">Já tenho conta</a></div>`,
    confirm: `<div class="auth-t">Confirme seu e-mail</div><p class="dlg-p">Mandamos um link pra <b>${em}</b>. Clique nele e depois volte aqui pra entrar.</p>
      ${note}<button class="btn-acc full" onclick="authMode='login';renderAuth()">Já confirmei, entrar</button>
      <div class="auth-links"><a href="#" onclick="authResend(this);return false">Reenviar e-mail</a></div>`,
    forgot: `<div class="auth-t">Esqueci a senha</div><p class="dlg-p">Digite seu e-mail: vamos mandar um código de 6 números.</p>
      <label class="s-lbl">E-mail</label><input class="s-inp" id="au-email" type="email" value="${em}" onkeydown="if(event.key==='Enter')authForgot(document.getElementById('au-go'))">
      ${note}<button class="btn-acc full" id="au-go" onclick="authForgot(this)">Mandar código</button>
      <div class="auth-links"><a href="#" onclick="authMode='login';renderAuth();return false">Voltar</a></div>`,
    reset: `<div class="auth-t">Nova senha</div><p class="dlg-p">Digite o código que chegou em <b>${em}</b> e a nova senha.</p>
      <label class="s-lbl">Código</label><input class="s-inp code" id="au-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      <label class="s-lbl">Nova senha</label><input class="s-inp" id="au-pass" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')authReset(document.getElementById('au-go'))">
      ${note}<button class="btn-acc full" id="au-go" onclick="authReset(this)">Salvar e entrar</button>
      <div class="auth-links"><a href="#" onclick="authForgot(null);return false">Mandar outro código</a></div>`,
    mfa: `<div class="auth-t">Verificação em 2 etapas</div><p class="dlg-p">Abra o aplicativo autenticador do celular e digite o código do Retoma.</p>
      <input class="s-inp code" id="au-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" onkeydown="if(event.key==='Enter')authMfa(document.getElementById('au-go'))">
      ${note}<button class="btn-acc full" id="au-go" onclick="authMfa(this)">Confirmar</button>`,
    change: `<div class="auth-t">Trocar senha</div>
      <label class="s-lbl">Nova senha</label><input class="s-inp" id="au-pass" type="password" autocomplete="new-password">
      <label class="s-lbl">Repita</label><input class="s-inp" id="au-pass2" type="password" autocomplete="new-password">
      ${note}<button class="btn-acc full" id="au-go" onclick="authChange(this)">Salvar</button>`,
  }
  box.innerHTML = `<button class="auth-x" onclick="closeAuth()" title="Fechar">×</button>` + views[authMode]
  setTimeout(() => { const f = box.querySelector('input'); if (f && !f.value) f.focus() }, 60)
}
const val = id => (document.getElementById(id) || {}).value || ''
// Pilar 4: botão desabilitado + "carregando" até a resposta (o main corta em 15s)
async function authCall(btn, fn, boxId = 'auth-box') {
  const box = document.getElementById(boxId)
  const old = btn ? btn.innerHTML : ''
  box.querySelectorAll('button,input').forEach(el => el.disabled = true)
  if (btn) btn.innerHTML = '<span class="spin"></span>'
  try { return await fn() }
  catch (e) { return { ok: false, error: 'Algo deu errado. Tente de novo.' } }
  finally { box.querySelectorAll('button,input').forEach(el => el.disabled = false); if (btn) btn.innerHTML = old }
}
async function afterAuth(r) {
  if (!r.ok) { renderAuth(esc(r.error)); return }
  if (r.mfaRequired) { authFactor = r.factorId; authMode = 'mfa'; renderAuth(); return }
  if (r.needsConfirmation) { authMode = 'confirm'; renderAuth(); return }
  closeAuth()
  await loadMeta(); allData = await window.api.getData(); render(); if (currentView === 'settings') renderSettings()
  showHint(`✓ Entrou como ${esc((r.user && (r.user.name || r.user.email)) || '')}`)
  wizardAfterLogin && wizardAfterLogin()
}
async function authLogin(btn) {
  authEmail = val('au-email').trim()
  afterAuth(await authCall(btn, () => window.api.auth('sign-in', { email: authEmail, password: val('au-pass') })))
}
async function authSignup(btn) {
  authEmail = val('au-email').trim()
  if (val('au-pass') !== val('au-pass2')) { renderAuth('As senhas não são iguais.'); return }
  afterAuth(await authCall(btn, () => window.api.auth('sign-up', { email: authEmail, password: val('au-pass'), name: val('au-name') })))
}
async function authGoogle(btn) {
  renderAuth('Abrimos o navegador: escolha sua conta Google e volte pra cá.', false)
  afterAuth(await authCall(document.querySelector('.btn-google'), () => window.api.auth('google')))
}
async function authForgot(btn) {
  if (document.getElementById('au-email')) authEmail = val('au-email').trim()
  const r = await authCall(btn, () => window.api.auth('reset-request', { email: authEmail }))
  if (!r.ok) { renderAuth(esc(r.error)); return }
  authMode = 'reset'; renderAuth('Se existir uma conta com esse e-mail, o código chega em instantes.', false)
}
async function authReset(btn) {
  afterAuth(await authCall(btn, () => window.api.auth('reset-confirm', { email: authEmail, code: val('au-code'), password: val('au-pass') })))
}
async function authMfa(btn) {
  afterAuth(await authCall(btn, () => window.api.auth('mfa-login', { factorId: authFactor, code: val('au-code') })))
}
async function authResend(a) {
  const r = await window.api.auth('resend', { email: authEmail })
  renderAuth(r.ok ? 'E-mail reenviado.' : esc(r.error), !r.ok)
}
async function authChange(btn) {
  if (val('au-pass') !== val('au-pass2')) { renderAuth('As senhas não são iguais.'); return }
  const r = await authCall(btn, () => window.api.auth('change-password', { password: val('au-pass') }))
  if (!r.ok) { renderAuth(esc(r.error)); return }
  closeAuth(); showHint('✓ Senha trocada')
}

// ─── Verificação em 2 etapas: ativar/desativar ───
async function openMfa() {
  const st = await window.api.auth('mfa-status')
  if (!st.ok) { showHint('⚠️ ' + esc(st.error), '#e53935'); return }
  if (st.enabled) {
    const r = await dialogBox(`<div class="dlg-t">Verificação em 2 etapas ativa ✓</div><p class="dlg-p">Ao entrar num computador novo, o Retoma pede o código do aplicativo autenticador.</p>`, [{ t: 'Fechar' }, { t: 'Desativar', cls: 'dlg-danger' }])
    if (r && r.i === 1) { const d = await window.api.auth('mfa-disable', { factorId: st.factorId }); showHint(d.ok ? 'Verificação em 2 etapas desativada' : '⚠️ ' + esc(d.error), d.ok ? null : '#e53935') }
    return
  }
  const en = await window.api.auth('mfa-enroll')
  if (!en.ok) { showHint('⚠️ ' + esc(en.error), '#e53935'); return }
  for (let tries = 0; tries < 3; tries++) {
    const r = await dialogBox(`<div class="dlg-t">Ativar verificação em 2 etapas</div>
      <p class="dlg-p">1. No celular, abra o Google Authenticator (ou outro) e leia o código:</p>
      <div class="mfa-qr"><img src="${en.qr}" alt="QR code"></div>
      <p class="dlg-p small">Ou digite a chave: <code>${esc(en.secret)}</code></p>
      <p class="dlg-p">2. Digite os 6 números que aparecem:</p>
      <input class="dlg-inp code" inputmode="numeric" maxlength="6" placeholder="000000">`, [{ t: 'Cancelar' }, { t: 'Ativar' }])
    if (!r || r.i !== 1) return
    const a = await window.api.auth('mfa-activate', { factorId: en.factorId, code: r.val })
    if (a.ok) { showHint('✓ Verificação em 2 etapas ativada'); return }
    showHint('⚠️ ' + esc(a.error), '#e53935')
  }
}

// ─── Equipe da loja (Configurações → negócio do tipo Loja) ───
function teamSection(b) {
  const a = meta.account || {}
  if (!a.cloud || !a.user) return `<label class="s-lbl">Equipe</label><div class="s-note">${a.cloud ? 'Entre na sua conta pra convidar vendedores e gerentes.' : 'Equipes precisam da nuvem configurada (supabase/LEIA-ME.md).'}</div>`
  const role = roleIn(b.id), people = peopleOf(b.id)
  if (!role) return `<label class="s-lbl">Equipe</label><div class="s-note">Sincronize pra criar a loja na nuvem e convidar a equipe.</div><button class="btn-mini" onclick="syncNowUi(this)">Sincronizar</button>`
  const RL = { owner: 'Dono', manager: 'Gerente', seller: 'Vendedor' }
  const me = myId()
  const row = p => {
    const acts = []
    if (role === 'owner' && p.role !== 'owner') acts.push(`<button class="tm-a" onclick="teamRole('${b.id}','${p.id}','${p.role === 'manager' ? 'seller' : 'manager'}')">${p.role === 'manager' ? 'Tornar vendedor' : 'Tornar gerente'}</button>`)
    if (isMgr(b.id) && p.role !== 'owner' && p.id !== me && !(p.role === 'manager' && role !== 'owner')) acts.push(`<button class="tm-a danger" onclick="teamRemove('${b.id}','${p.id}','${esc(p.name)}')">Remover</button>`)
    const n = allData.filter(f => f.biz === b.id && f.owner === p.id).length
    return `<div class="tm-row"><div class="tm-av">${esc((p.name || '?')[0].toUpperCase())}</div><div class="tm-info"><b>${esc(p.name)}${p.id === me ? ' (você)' : ''}</b><small>${RL[p.role]}${isMgr(b.id) ? ` · ${n} retoma${n === 1 ? '' : 's'}` : ''}</small></div><div class="tm-acts">${acts.join('')}</div></div>`
  }
  return `<label class="s-lbl">Equipe</label>
    <div class="tm-list">${people.map(row).join('')}</div>
    ${isMgr(b.id) ? `<div class="acc-btns"><button class="btn-acc ghost" onclick="teamInvite('${b.id}','seller')">+ Convidar vendedor</button>${role === 'owner' ? `<button class="btn-acc ghost" onclick="teamInvite('${b.id}','manager')">+ Convidar gerente</button>` : ''}</div>
      <div class="s-note">Quem sai da loja deixa os clientes na <b>carteira sem dono</b>: o gerente redistribui depois.</div>`
      : `<button class="s-danger" onclick="teamLeave('${b.id}','${esc(b.name)}')">Sair desta loja</button>`}`
}
async function teamInvite(biz, role) {
  const r = await window.api.team('invite', { biz, role })
  if (!r.ok) { showHint('⚠️ ' + esc(r.error), '#e53935'); return }
  const code = r.data
  const d = await dialogBox(`<div class="dlg-t">Convite de ${role === 'manager' ? 'gerente' : 'vendedor'}</div>
    <p class="dlg-p">Passe este código pra pessoa. No Retoma dela: <b>Fui convidado → Tenho o código da loja</b> (ou Equipe → Tenho um código da loja).</p>
    <div class="inv-code">${esc(code)}</div><p class="dlg-p small">Vale 7 dias.</p>`, [{ t: 'Fechar' }, { t: 'Copiar código' }])
  if (d && d.i === 1) { try { await navigator.clipboard.writeText(code); showHint('✓ Código copiado') } catch (e) {} }
}
async function openJoin() {
  const r = await dialogBox(`<div class="dlg-t">Entrar numa loja</div><p class="dlg-p">Digite o código de 6 letras que o dono ou gerente te passou.</p><input class="dlg-inp code" maxlength="6" placeholder="ABC234" style="text-transform:uppercase">`, [{ t: 'Cancelar' }, { t: 'Entrar' }])
  if (!r || r.i !== 1) return
  const res = await window.api.team('accept', { code: r.val })
  if (!res.ok) { showHint('⚠️ ' + esc(res.error), '#e53935'); return }
  await loadMeta(); allData = await window.api.getData(); render(); renderSettings(); showHint('✓ Você entrou na loja')
}
async function teamRole(biz, user, role) {
  const r = await window.api.team('set-role', { biz, user, role })
  if (!r.ok) { showHint('⚠️ ' + esc(r.error), '#e53935'); return }
  await loadMeta(); renderSettings()
}
async function teamRemove(biz, user, name) {
  const d = await dialogBox(`<div class="dlg-t">Remover ${name}?</div><p class="dlg-p">Os retomas ativos dele vão pra carteira sem dono. Depois você redistribui.</p>`, [{ t: 'Cancelar' }, { t: 'Remover', cls: 'dlg-danger' }])
  if (!d || d.i !== 1) return
  const r = await window.api.team('remove', { biz, user })
  if (!r.ok) { showHint('⚠️ ' + esc(r.error), '#e53935'); return }
  await loadMeta(); allData = await window.api.getData(); render(); renderSettings(); showHint(`${name} saiu · ${r.data || 0} cliente(s) na carteira sem dono`)
}
async function teamLeave(biz, name) {
  const d = await dialogBox(`<div class="dlg-t">Sair de ${name}?</div><p class="dlg-p">Seus clientes desta loja ficam com a loja (na carteira sem dono) e somem deste computador.</p>`, [{ t: 'Cancelar' }, { t: 'Sair da loja', cls: 'dlg-danger' }])
  if (!d || d.i !== 1) return
  const r = await window.api.team('leave', { biz })
  if (!r.ok) { showHint('⚠️ ' + esc(r.error), '#e53935'); return }
  await loadMeta(); allData = await window.api.getData(); render(); renderSettings()
}

function setOwnerFilter(id) { ownerFilter = id; window.api.setUi({ ownerFilter: id }); render() }
async function openRedistribute(bizId) {
  const tb = bizId || teamBiz(); if (!tb) return
  const items = allData.filter(f => f.biz === tb && f.owner === null)
  const people = peopleOf(tb)
  const r = await dialogBox(`<div class="dlg-t">Redistribuir ${items.length} cliente${items.length === 1 ? '' : 's'}</div>
    <p class="dlg-p">Divide por igual entre quem você marcar (prioridade alta e maior valor primeiro, alternando).</p>
    <div class="redis-list">${people.map(p => `<label class="redis-it"><input type="checkbox" value="${p.id}" ${p.role !== 'owner' || people.length === 1 ? 'checked' : ''}> ${esc(p.name)} <small>${{ owner: 'dono', manager: 'gerente', seller: 'vendedor' }[p.role]}</small></label>`).join('')}</div>`,
    [{ t: 'Cancelar' }, { t: 'Redistribuir' }])
  if (!r || r.i !== 1) return
  const ids = r.checked || []
  if (!ids.length) { showHint('⚠️ Marque pelo menos uma pessoa', '#e53935'); return }
  const P = { alta: 0, media: 1, baixa: 2 }
  const order = items.slice().sort((a, b) => (P[a.prio] ?? 1) - (P[b.prio] ?? 1) || (Money.valueOf(b) || 0) - (Money.valueOf(a) || 0))
  const before = order.map(f => ({ id: f.id, owner: f.owner }))
  order.forEach((f, i) => { const x = allData.find(y => y.id === f.id); if (x) x.owner = ids[i % ids.length] })
  await persist(); allData = await window.api.getData()
  ownerFilter = 'all'; window.api.setUi({ ownerFilter: 'all' }); render()
  showUndoGeneric(`Redistribuídos ${order.length} entre ${ids.length} pessoa${ids.length === 1 ? '' : 's'}`, async () => {
    before.forEach(b => { const x = allData.find(y => y.id === b.id); if (x) x.owner = b.owner }); await persist(); allData = await window.api.getData(); render()
  })
}
function showUndoGeneric(text, undo) {
  const html = `${esc(text)} · <a href="#" id="hint-undo">Desfazer</a>`
  showHint(html)
  const a = document.getElementById('hint-undo')
  if (a) a.onclick = async e => { e.preventDefault(); document.getElementById('hint-toast').classList.remove('show'); await undo() }
}

// ─── Formulário: responsável + aviso de cliente duplicado ───
function setOwnerPick(bizId, cur) {
  const field = document.getElementById('owner-field'), sel = document.getElementById('inp-owner')
  const b = bizOf(bizId)
  const show = b && b.kind === 'store' && isMgr(bizId) && peopleOf(bizId).length > 1
  field.style.display = show ? '' : 'none'
  if (!show) { sel.innerHTML = ''; return }
  const me = myId()
  sel.innerHTML = peopleOf(bizId).map(p => `<option value="${p.id}">${esc(p.name)}${p.id === me ? ' (eu)' : ''}</option>`).join('') + `<option value="none">Sem responsável</option>`
  sel.value = cur === null ? 'none' : (cur && peopleOf(bizId).some(p => p.id === cur) ? cur : me)
}
let dupT = null
function checkDup() {
  clearTimeout(dupT)
  const el = document.getElementById('dup-hint'); if (!el) return
  const phone = val('inp-phone'), biz = val('inp-biz'), editId = val('edit-id')
  const p8 = phoneKey(phone)
  el.classList.remove('show')
  const b = bizOf(biz)
  if (p8.length < 8 || !b || b.kind !== 'store') return
  // 1) o que já está neste computador (gerente vê a loja toda)
  const local = allData.find(f => f.id !== editId && f.biz === biz && phoneKey(f.phone) === p8 && !isMine(f))
  if (local) {
    const p = peopleOf(biz).find(x => x.id === local.owner)
    el.innerHTML = `⚠️ Esse cliente já está com <b>${esc(p ? p.name : 'outro vendedor')}</b>`; el.classList.add('show'); return
  }
  // 2) na nuvem (vendedor não enxerga os clientes dos colegas)
  dupT = setTimeout(async () => {
    const who = await window.api.team('phone-owner', { biz, phone })
    if (who && val('inp-phone') === phone) { el.innerHTML = `⚠️ Esse cliente já está com <b>${esc(who)}</b>`; el.classList.add('show') }
  }, 600)
}
document.getElementById('inp-phone').addEventListener('input', checkDup)

// ─── Concluídos: excluir de vez ───
async function deleteForever(id, btn) {
  const f = (await window.api.getDone()).find(x => x.id === id)
  const r = await dialogBox(`<div class="dlg-t">Excluir de vez?</div><p class="dlg-p">${esc(f ? f.name : 'Este retoma')} sai do histórico${meta.account && meta.account.user ? ' em todos os aparelhos' : ''}. Não dá pra restaurar depois.</p>`, [{ t: 'Cancelar' }, { t: 'Excluir', cls: 'dlg-danger' }])
  if (!r || r.i !== 1) return
  const card = btn.closest('.result-card'); if (card) { card.style.transition = 'opacity .25s, transform .25s'; card.style.opacity = '0'; card.style.transform = 'translateX(20px)' }
  await window.api.deleteForever(id)
  setTimeout(() => showDone(), 260)
}

// ─── Atualização automática ───
async function checkUpdate() { const st = await window.api.updateCheck(); showHint(st && st.ready ? 'Atualização pronta: reinicie pelo ícone da bandeja' : 'Procurando atualização…') }
if (window.api.onUpdateState) window.api.onUpdateState(st => {
  if (st && st.ready) showHint(`⬆️ Retoma ${esc(st.version)} pronto · <a href="#" onclick="window.api.updateInstall();return false">Reiniciar e atualizar</a>`)
})

// ═══ 1.0: BOAS-VINDAS, MODELOS PRONTOS, TOUR ═══════════════════════════
const MODELS = {
  madeireira: {
    icon: '🪵', title: 'Madeireira', sub: 'Madeira, material de construção', kind: 'store', name: 'Minha madeireira',
    fields: () => FIELD_PRESETS['Madeireira'].map(f => ({ ...f })),
    templates: [
      { title: 'Cobrar orçamento', text: 'Oi {nome}, tudo bem? Conseguiu avaliar o orçamento de {tipo de peça}? Se quiser, ajusto as medidas ou a quantidade.' },
      { title: 'Fechar pedido', text: 'Oi {nome}! Consigo segurar esse preço até sexta. Fechamos o pedido?' },
      { title: 'Combinar entrega', text: 'Oi {nome}! Seu pedido está separado. Qual o melhor dia pra entrega?' },
    ],
  },
  servicos: {
    icon: '💼', title: 'Serviços', sub: 'Agência, consultoria, assinaturas', kind: 'personal', name: 'Meus serviços',
    fields: () => FIELD_PRESETS['Serviços'].map(f => ({ ...f })),
    templates: [
      { title: 'Enviar proposta', text: 'Oi {nome}, tudo bem? Segue a proposta do plano {plano}. Qualquer dúvida estou à disposição!' },
      { title: 'Retomar conversa', text: 'Oi {nome}! Conseguiu ver a proposta? Posso te ligar pra tirar dúvidas?' },
      { title: 'Renovação', text: 'Oi {nome}, seu plano vence em breve. Vamos renovar?' },
    ],
  },
  generico: {
    icon: '🛍️', title: 'Outro', sub: 'Qualquer tipo de venda', kind: 'personal', name: 'Meu negócio',
    fields: () => [],
    templates: [
      { title: 'Cobrar retorno', text: 'Oi {nome}, tudo bem? Passando pra saber se conseguiu avaliar o orçamento. Qualquer dúvida estou à disposição!' },
      { title: 'Fechar pedido', text: 'Oi {nome}! Conseguimos fechar? Se quiser, já deixo tudo separado pra você.' },
      { title: 'Cobrar pagamento', text: 'Oi {nome}, tudo certo? Passando pra lembrar do pagamento combinado. Qualquer coisa me avisa!' },
    ],
  },
}
let wiz = { step: 0, model: null, name: '', phone: '', kind: 'personal' }
let wizardAfterLogin = null
async function maybeWelcome() {
  if (!meta || (meta.account && meta.account.gated)) return
  if (await window.api.consumeUi('companyNew')) return openCompanySetup()
  if (await window.api.consumeUi('sellerNew')) return sellerWelcome()
  if (!meta.ui.onboarded) {
    const fresh = !allData.length && meta.businesses.filter(b => !b.archived).length === 1 && meta.businesses[0]._auto
    if (fresh) return openWizard()
    window.api.setUi({ onboarded: true })
  }
  if (meta.ui.whatsNew10) { window.api.setUi({ whatsNew10: false, seen12: true }); return showWhatsNew() }
  if (!meta.ui.seen12) showWhatsNew12()
}
async function showWhatsNew12() {
  window.api.setUi({ seen12: true })
  const r = await dialogBox(`<div class="dlg-t">O Retoma cresceu 🎉</div>
    <p class="dlg-p">Agora é uma janela de computador de verdade: maximize, redimensione e arraste pela barra de cima.</p>
    <ul class="wz-list left"><li><b>Menu na esquerda</b>: passe o mouse pra ver os nomes (Hoje, Retomas, Calendário, Clientes, Concluídos, Equipe)</li>
    <li><b>Clique num cliente</b>: o painel da direita mostra tudo e cada campo se edita ali mesmo</li>
    <li><b>WhatsApp, mensagem pronta e adiar</b> aparecem ao passar o mouse no cliente</li>
    <li><b>Flutuante</b> continua: botão ao lado do minimizar, ou feche a janela</li></ul>`, [{ t: 'Depois' }, { t: 'Ver o tour' }])
  if (r && r.i === 1) startTour()
}
function openWizard() { wiz = { step: 0, model: null, name: '', phone: '', kind: 'personal' }; document.getElementById('wiz').classList.add('open'); renderWizard() }
function closeWizard() { document.getElementById('wiz').classList.remove('open') }
function renderWizard() {
  const box = document.getElementById('wiz-box')
  const cloud = false   // 1.1: a conta já foi criada na tela de entrada
  const steps = cloud ? 4 : 3
  const dots = `<div class="wz-dots">${Array.from({ length: steps }, (_, i) => `<i class="${i <= wiz.step - 1 ? 'on' : ''}"></i>`).join('')}</div>`
  const views = [
    () => `<div class="wz-hero"><img src="icon.png" alt=""><div class="wz-title">Retoma</div><div class="wz-slogan">Nenhum cliente esquecido.</div></div>
      <ul class="wz-list"><li>📅 Marque quando retomar cada cliente</li><li>💬 Abra a conversa no WhatsApp com 1 clique (sem risco de ban)</li><li>💰 Veja quanto dinheiro está em jogo e o que esfriou</li></ul>
      <button class="btn-acc full" onclick="wiz.step=1;renderWizard()">Começar</button>`,
    () => `${dots}<div class="wz-h">O que você vende?</div><p class="dlg-p">O Retoma já vem com campos e mensagens pro seu tipo de venda. Dá pra mudar tudo depois.</p>
      <div class="wz-models">${Object.entries(MODELS).map(([k, m]) => `<button class="wz-model ${wiz.model === k ? 'on' : ''}" onclick="wizPick('${k}')"><span class="wz-ic">${m.icon}</span><b>${m.title}</b><small>${m.sub}</small></button>`).join('')}</div>`,
    () => `${dots}<div class="wz-h">Seu negócio</div>
      <label class="s-lbl">Nome</label><input class="s-inp" id="wz-name" maxlength="30" value="${esc(wiz.name)}">
      <label class="s-lbl">Seu WhatsApp de trabalho</label><input class="s-inp" id="wz-phone" inputmode="numeric" placeholder="(11) 99999-9999" value="${esc(wiz.phone)}">
      ${wiz.company ? '' : `<label class="s-lbl">Quem vai usar?</label>
      <div class="seg"><button class="${wiz.kind === 'personal' ? 'on' : ''}" onclick="wizSave();wiz.kind='personal';renderWizard()">👤 Só eu</button><button class="${wiz.kind === 'store' ? 'on' : ''}" onclick="wizSave();wiz.kind='store';renderWizard()">🏪 Loja com equipe</button></div>`}
      ${wiz.kind === 'store' ? '<div class="s-note">Depois você convida os vendedores na tela Equipe.</div>' : ''}
      <div class="wz-nav"><button class="btn-acc ghost" onclick="wizSave();wiz.step=1;renderWizard()">Voltar</button><button class="btn-acc" onclick="wizApply(this)">Continuar</button></div>`,
    () => cloud ? `${dots}<div class="wz-h">Quer usar em mais de um aparelho?</div><p class="dlg-p">Com uma conta, seus retomas ficam guardados na nuvem, aparecem no celular e em outro PC, e você pode montar equipe. É grátis.</p>
      <button class="btn-acc full" onclick="wizardAfterLogin=wizDone;openAuth('signup')">Criar conta</button>
      <button class="btn-acc ghost full" onclick="wizardAfterLogin=wizDone;openAuth('login')">Já tenho conta</button>
      <button class="s-link center" onclick="wizDone()">Agora não (dá pra entrar depois)</button>` : wizDoneView(),
    () => wizDoneView(),
  ]
  box.innerHTML = views[Math.min(wiz.step, views.length - 1)]()
  const f = box.querySelector('input'); if (f) setTimeout(() => f.focus(), 80)
}
function wizDoneView() {
  return `<div class="wz-hero"><div class="wz-check">✓</div><div class="wz-title sm">Tudo pronto!</div></div>
    <p class="dlg-p center">Quer um tour rápido de 30 segundos pelo app?</p>
    <button class="btn-acc full" onclick="closeWizard();window.api.setUi({onboarded:true});setTimeout(startTour,300)">Fazer o tour</button>
    <button class="s-link center" onclick="closeWizard();window.api.setUi({onboarded:true,tutorialDone:true})">Pular</button>`
}
function wizPick(k) { wiz.model = k; if (!wiz.company) wiz.kind = MODELS[k].kind; wiz.name = wiz.name || MODELS[k].name; wiz.step = 2; renderWizard() }
function wizSave() { const n = document.getElementById('wz-name'), p = document.getElementById('wz-phone'); if (n) wiz.name = n.value; if (p) wiz.phone = p.value }
async function wizApply(btn) {
  wizSave()
  if (!wiz.name.trim()) { document.getElementById('wz-name').style.borderColor = '#e53935'; return }
  btn.disabled = true
  const m = MODELS[wiz.model || 'generico']
  const b = (wiz.company && mainCompany() ? mainCompany().b : meta.businesses.find(x => !x.archived)) || {}
  const list = meta.businesses.map(x => x.id === b.id ? { ...x, name: wiz.name.trim(), phone: wiz.phone, kind: wiz.kind, fields: m.fields() } : x)
  const ok = await saveBizList(list)
  btn.disabled = false
  if (!ok) return
  await window.api.setTemplates(m.templates)
  window.api.setLastBiz(b.id)
  wiz.step = 3; renderWizard()
}
function wizDone() { wizardAfterLogin = null; wiz.step = 4; document.getElementById('wiz').classList.add('open'); renderWizard() }

async function showWhatsNew() {
  window.api.setUi({ whatsNew10: false })
  const r = await dialogBox(`<div class="dlg-t">Novidades do Retoma 1.0 🎉</div>
    <ul class="wz-list left"><li>🏪 <b>Negócios</b> com cor, campos próprios (m³, tipo de peça…) e WhatsApp de cada um</li>
    <li>☁️ <b>Conta e sincronização</b>: mesmo Retoma no PC, no notebook e no celular</li>
    <li>👥 <b>Equipe</b>: convide vendedores, o gerente vê tudo e redistribui</li>
    <li>⚙️ <b>Configurações</b>: ligue e desligue o que quiser, troque a cor do app</li></ul>
    <p class="dlg-p small">Seus retomas continuam aqui, agora no negócio "Construpac".</p>`, [{ t: 'Depois' }, { t: 'Ver o tour' }])
  if (r && r.i === 1) startTour()
}

// ─── Tour guiado ───
const TOUR = [
  ['#btn-new', 'Novo retoma', 'Marque quando retomar cada cliente. Atalhos: tecla N, ou Ctrl+Alt+R com o número copiado (abre já preenchido).'],
  ['#ring-card', 'Seu dia', 'Quantos você já fez hoje e a semana em barrinhas. Clique num dia pra abrir o calendário.'],
  ['#pane .row .chk', 'Feito', 'Falou com o cliente? Clique no círculo: ele sai da lista e o Retoma pergunta se fechou.'],
  ['#pane .row .r-main', 'Abrir o cliente', 'Clique no nome: o painel da direita mostra tudo. Clique em qualquer campo pra editar, ali mesmo.'],
  ['#d-wa', 'WhatsApp', 'Abre a conversa com o cliente. O Retoma não manda nada sozinho: só abre pra você.'],
  ['#biz-sw', 'Negócios', 'Troque entre seus negócios. Cada um tem cor, campos e WhatsApp próprios.'],
  ['#nav-today', 'Menu', 'Passe o mouse no menu pra ver os nomes: Hoje, Retomas, Calendário, Clientes, Concluídos e Equipe.'],
  ['#nav-settings', 'Configurações', 'Negócios, campos, conta, cor do app e recursos liga/desliga.'],
  ['#btn-float', 'Flutuante', 'Vira um card (ou pílula) no canto da tela, sempre à vista do lado do WhatsApp.'],
]
let tourSteps = [], tourI = 0
function startTour() {
  nav('today')
  const c = mainCompany()
  const extra = c ? [['#nav-me', `Você é ${ROLE_NAME[c.role].toLowerCase()} da ${c.b.name}`, ROLE_TEXT[c.role] + ' Seu papel fica sempre aqui no pé do menu; clique pra ver a equipe.']] : []
  const tail = c && c.role !== 'seller' ? [['#nav-team', 'Convide sua equipe', 'Em Equipe → Convidar vendedor: a pessoa recebe um e-mail e entra direto na sua empresa. Lá você vê os números de cada um.']] : []
  tourSteps = [...extra, ...TOUR, ...tail].filter(([sel]) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' })
  tourI = 0
  document.getElementById('tour').classList.add('open')
  showTourStep()
}
function showTourStep() {
  const [sel, title, text] = tourSteps[tourI]
  const el = document.querySelector(sel)
  el.scrollIntoView({ block: 'nearest' })
  const r = el.getBoundingClientRect(), pad = 6
  const hole = document.getElementById('tour-hole'), tip = document.getElementById('tour-tip')
  Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' })
  tip.innerHTML = `<div class="tt-n">${tourI + 1} de ${tourSteps.length}</div><b>${title}</b><p>${text}</p>
    <div class="tt-btns"><button class="s-link" onclick="endTour()">Pular</button><button class="btn-acc" onclick="nextTour()">${tourI === tourSteps.length - 1 ? 'Concluir' : 'Próximo'}</button></div>`
  const below = r.bottom + 160 < window.innerHeight
  tip.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - tip.offsetHeight - 14)) + 'px'
  tip.style.left = Math.min(window.innerWidth - 270, Math.max(10, r.left + r.width / 2 - 130)) + 'px'
  tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in')
}
function nextTour() { if (++tourI >= tourSteps.length) endTour(); else showTourStep() }
function endTour() { document.getElementById('tour').classList.remove('open'); window.api.setUi({ tutorialDone: true }) }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('tour').classList.contains('open')) { e.stopPropagation(); endTour() } }, true)

// ═══ 1.1: ENTRADA OBRIGATÓRIA + PAPEL CLARO ═══════════════════════════════
const ROLE_NAME = { owner: 'Dono', manager: 'Gerente', seller: 'Vendedor' }
const ROLE_TEXT = {
  owner: 'Você vê os clientes de toda a empresa, convida vendedores e gerentes e redistribui a carteira.',
  manager: 'Você vê os clientes de toda a empresa, convida vendedores e redistribui a carteira.',
  seller: 'Você vê e cuida só dos seus clientes. O dono e o gerente acompanham os seus também.',
}
// Empresas (negócios do tipo Loja) em que eu tenho papel
function myCompanies() {
  return bizList().filter(b => b.kind === 'store' && roleIn(b.id)).map(b => ({ b, role: roleIn(b.id) }))
}
function mainCompany() {
  const list = myCompanies(); if (!list.length) return null
  return list.find(x => x.b.id === bizFilter) || list.find(x => x.role !== 'seller') || list[0]
}
// ─── Configurações → Minha empresa ───
let companyInvites = {}
function companySection() {
  const a = meta.account || {}
  if (!a.user) return ''
  const list = myCompanies()
  if (!list.length) return `<div class="s-sec"><div class="s-h">Minha empresa</div>
    <div class="s-blk"><b>Você ainda não está numa empresa</b><small class="s-small">Se um gerente te convidou, confirme o convite abaixo. Pra criar a sua, transforme um negócio em "Loja" em Negócios.</small>
    <div id="pending-inv"></div><div class="acc-btns"><button class="btn-acc ghost" onclick="openJoin()">Tenho um código da loja</button></div></div></div>`
  return list.map(({ b, role }) => {
    const people = peopleOf(b.id), me = myId()
    const mgr = people.filter(p => p.role !== 'seller' && p.id !== me).map(p => p.name)
    const inv = companyInvites[b.id] || []
    const row = p => {
      const acts = []
      if (role === 'owner' && p.role !== 'owner') acts.push(`<button class="tm-a" onclick="teamRole('${b.id}','${p.id}','${p.role === 'manager' ? 'seller' : 'manager'}')">${p.role === 'manager' ? 'Tornar vendedor' : 'Tornar gerente'}</button>`)
      if (isMgr(b.id) && p.role !== 'owner' && p.id !== me && !(p.role === 'manager' && role !== 'owner')) acts.push(`<button class="tm-a danger" onclick="teamRemove('${b.id}','${p.id}','${esc(p.name)}')">Remover</button>`)
      const n = allData.filter(f => f.biz === b.id && f.owner === p.id).length
      return `<div class="tm-row"><div class="tm-av">${esc((p.name || '?')[0].toUpperCase())}</div><div class="tm-info"><b>${esc(p.name)}${p.id === me ? ' (você)' : ''}</b><small>${ROLE_NAME[p.role]}${isMgr(b.id) ? ` · ${n} cliente${n === 1 ? '' : 's'}` : ''}</small></div><div class="tm-acts">${acts.join('')}</div></div>`
    }
    return `<div class="s-sec"><div class="s-h">Minha empresa</div>
      <div class="s-blk co-card" style="--c:${b.color}">
        <div class="co-top"><i></i><b>${esc(b.name)}</b><span class="role-chip ${role}">${ROLE_NAME[role]}</span></div>
        <small class="s-small">${ROLE_TEXT[role]}${role === 'seller' && mgr.length ? ` Seu gerente: <b>${esc(mgr.join(', '))}</b>.` : ''}</small>
      </div>
      ${isMgr(b.id) ? `
        <label class="s-lbl">Equipe (${people.length})</label>
        <div class="tm-list">${people.map(row).join('')}</div>
        ${inv.length ? `<label class="s-lbl">Convites pendentes</label><div class="tm-list">${inv.map(i => `<div class="tm-row"><div class="tm-av inv">✉</div><div class="tm-info"><b>${esc(i.email)}</b><small>${ROLE_NAME[i.role]} · código ${esc(i.code)}</small></div><div class="tm-acts"><button class="tm-a" onclick="teamInviteEmail('${b.id}','${i.role}','${esc(i.email)}')">Reenviar</button><button class="tm-a danger" onclick="cancelInvite('${b.id}','${esc(i.code)}')">Cancelar</button></div></div>`).join('')}</div>` : ''}
        <div class="acc-btns"><button class="btn-acc" onclick="teamInviteEmail('${b.id}','seller')">✉ Convidar vendedor</button>${role === 'owner' ? `<button class="btn-acc ghost" onclick="teamInviteEmail('${b.id}','manager')">Convidar gerente</button>` : ''}</div>`
      : `<button class="s-danger" onclick="teamLeave('${b.id}','${esc(b.name)}')">Sair desta empresa</button>`}
    </div>`
  }).join('') + `<div id="pending-inv"></div>`
}
async function loadCompanyExtras() {
  for (const { b } of myCompanies()) if (isMgr(b.id)) companyInvites[b.id] = await window.api.team('invites', { biz: b.id })
  const pend = meta.account && meta.account.user ? await window.api.auth('pending-invites') : []
  if (!['team', 'settings'].includes(currentView)) return
  if (currentView === 'team') renderPane()
  const el = document.getElementById('pending-inv')
  if (el && pend.length) el.innerHTML = `<div class="s-blk inv-banner">${pend.map(p => `<b>📩 Convite: ${esc(p.workspace_name)}</b><small class="s-small">${esc(p.invited_by || 'O gerente')} te convidou como ${ROLE_NAME[p.role].toLowerCase()}.</small>`).join('')}<div class="acc-btns"><button class="btn-acc" onclick="acceptPending()">Aceitar convite</button></div></div>`
}
async function teamInviteEmail(biz, role, preset = '') {
  const isMgrRole = role === 'manager'
  const r = await dialogBox(`<div class="dlg-t">Convidar ${isMgrRole ? 'gerente' : 'vendedor'}</div>
    <p class="dlg-p">A pessoa recebe um e-mail com um código. No Retoma dela: <b>Fui convidado</b> → e-mail → código → cria a senha e já entra na ${esc((bizOf(biz) || {}).name || 'empresa')}.</p>
    <input class="dlg-inp" type="email" placeholder="email@dovendedor.com" value="${esc(preset)}">`, [{ t: 'Cancelar' }, { t: 'Enviar convite' }])
  if (!r || r.i !== 1) return
  const email = String(r.val || '').trim()
  showHint('Enviando convite…')
  const res = await window.api.team('invite-email', { biz, email, role })
  if (!res.ok) { showHint('⚠️ ' + esc(res.error), '#e53935'); return }
  const d = await dialogBox(`<div class="dlg-t">${res.emailSent ? '✓ Convite enviado' : 'Convite criado'}</div>
    ${res.emailSent ? `<p class="dlg-p">Mandamos o e-mail pra <b>${esc(email)}</b>. Peça pra pessoa abrir o Retoma → <b>Fui convidado</b>.</p><p class="dlg-p">Se o e-mail não chegar, passe este <b>código da loja</b> (vale 1 vez, por 7 dias):</p>`
      : `<p class="dlg-p">Não conseguimos mandar o e-mail agora${res.emailError ? ` (${esc(res.emailError)})` : ''}. Passe este <b>código da loja</b> pela conversa: no Retoma ela escolhe <b>Fui convidado → Tenho o código da loja</b>.</p>`}
    <div class="inv-code">${esc(res.code)}</div>`, [{ t: 'Fechar' }, { t: 'Copiar código' }])
  if (d && d.i === 1) { try { await navigator.clipboard.writeText(res.code); showHint('✓ Código copiado') } catch (e) {} }
  loadCompanyExtras()
}
async function cancelInvite(biz, code) {
  const r = await window.api.team('cancel-invite', { code })
  showHint(r.ok ? 'Convite cancelado' : '⚠️ ' + esc(r.error), r.ok ? null : '#e53935'); loadCompanyExtras()
}
async function acceptPending() {
  const s1 = await window.api.auth('accept-request')
  if (!s1.ok) { showHint('⚠️ ' + esc(s1.error), '#e53935'); return }
  for (let i = 0; i < 3; i++) {
    const r = await dialogBox(`<div class="dlg-t">Confirmar convite</div><p class="dlg-p">Mandamos um código de 6 números pro seu e-mail (${esc(meta.account.user.email)}). Digite aqui:</p><input class="dlg-inp code" inputmode="numeric" maxlength="6" placeholder="000000">`, [{ t: 'Cancelar' }, { t: 'Confirmar' }])
    if (!r || r.i !== 1) return
    const v = await window.api.auth('accept-verify', { code: r.val })
    if (v.ok) { await loadMeta(); allData = await window.api.getData(); nav('team'); showHint(`✓ Você entrou na ${esc((v.joined || []).join(', ') || 'empresa')}`); loadCompanyExtras(); return }
    showHint('⚠️ ' + esc(v.error), '#e53935')
  }
}

// ─── Tela de entrada (obrigatória quando a nuvem está ligada) ───
let gateView = 'home', gateEmail = '', gateFactor = null, gateNext = null
function openGate() {
  const g = document.getElementById('gate'); if (!g) return
  if (!g.classList.contains('open')) { gateView = 'home'; g.classList.add('open'); renderGate() }
}
function closeGate() { const g = document.getElementById('gate'); if (g) g.classList.remove('open') }
function gv(v, msg, ok) { gateView = v; renderGate(msg, ok) }
function renderGate(msg = '', ok = false) {
  const box = document.getElementById('gate-box')
  const em = esc(gateEmail)
  const localN = allData.length
  const note = msg ? `<div class="auth-msg ${ok ? 'ok' : 'err'}" role="alert">${msg}</div>` : ''
  const back = (to = 'home') => `<button class="g-back" onclick="gv('${to}')">‹ Voltar</button>`
  const google = meta && meta.account && meta.account.google ? `<button class="btn-google" onclick="gateGoogle()"><svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Entrar com Google</button><div class="auth-or"><span>ou</span></div>` : ''
  const V = {
    home: `<div class="wz-hero"><img src="icon.png" alt=""><div class="wz-title">Retoma</div><div class="wz-slogan">Nenhum cliente esquecido.</div></div>
      <button class="door" onclick="gv('company')"><span class="door-ic">🏪</span><span><b>Criar minha empresa</b><small>Sou dono ou gerente: vou convidar meus vendedores</small></span></button>
      <button class="door" onclick="gv('invited')"><span class="door-ic">📩</span><span><b>Fui convidado</b><small>Sou vendedor: recebi um convite do meu gerente</small></span></button>
      <div class="g-login">Já tem conta? <a href="#" onclick="gv('login');return false">Entrar</a></div>
      ${localN ? `<div class="g-local">💾 ${localN} retoma${localN === 1 ? '' : 's'} deste computador vão junto pra sua conta.</div>` : ''}`,
    company: `${back()}<div class="auth-t">Criar minha empresa</div><p class="dlg-p">Você vai ser o <b>dono</b>: vê os clientes de todos e convida a equipe.</p>
      <label class="s-lbl">Nome da empresa</label><input class="s-inp" id="g-company" maxlength="30" placeholder="Ex.: Construpac" value="${esc((bizList().find(b => !b._auto) || {}).name || '')}">
      <label class="s-lbl">Seu nome</label><input class="s-inp" id="g-name" autocomplete="name">
      <label class="s-lbl">Seu e-mail</label><input class="s-inp" id="g-email" type="email" autocomplete="email" value="${em}">
      <label class="s-lbl">Senha (8+ caracteres, letras e números)</label><input class="s-inp" id="g-pass" type="password" autocomplete="new-password">
      <label class="s-lbl">Repita a senha</label><input class="s-inp" id="g-pass2" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')gateCompany(document.getElementById('g-go'))">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateCompany(this)">Criar empresa</button>`,
    confirm: `${back('company')}<div class="auth-t">Confirme seu e-mail</div><p class="dlg-p">Mandamos um código de 6 números pra <b>${em}</b>.</p>
      <input class="s-inp code" id="g-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" onkeydown="if(event.key==='Enter')gateConfirm(document.getElementById('g-go'))">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateConfirm(this)">Confirmar</button>`,
    invited: `${back()}<div class="auth-t">Fui convidado</div><p class="dlg-p">Digite o e-mail em que você recebeu o convite. O código de acesso está nesse e-mail.</p>
      <label class="s-lbl">Seu e-mail</label><input class="s-inp" id="g-email" type="email" autocomplete="email" value="${em}">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateInvited(this, false)">Já tenho o código do e-mail</button>
      <button class="btn-acc ghost full" onclick="gateInvited(this, true)">Mandar o código de novo</button>
      <div class="auth-links"><a href="#" onclick="gv('storecode');return false">Não recebi e-mail: tenho o código da loja</a></div>`,
    invcode: `${back('invited')}<div class="auth-t">Código do convite</div><p class="dlg-p">Digite os 6 números do e-mail enviado pra <b>${em}</b>.</p>
      <input class="s-inp code" id="g-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" onkeydown="if(event.key==='Enter')gateInvCode(document.getElementById('g-go'))">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateInvCode(this)">Entrar</button>`,
    finish: `<div class="auth-t">Quase lá!</div><p class="dlg-p">Crie sua senha pra entrar nos próximos acessos.</p>
      <label class="s-lbl">Seu nome</label><input class="s-inp" id="g-name" autocomplete="name">
      <label class="s-lbl">Senha (8+ caracteres, letras e números)</label><input class="s-inp" id="g-pass" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')gateFinish(document.getElementById('g-go'))">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateFinish(this)">Concluir</button>`,
    storecode: `${back('invited')}<div class="auth-t">Código da loja</div><p class="dlg-p">Use o código de 6 letras que o gerente te passou.</p>
      <label class="s-lbl">Código da loja</label><input class="s-inp code" id="g-scode" maxlength="6" style="text-transform:uppercase" placeholder="ABC234">
      <label class="s-lbl">Seu nome</label><input class="s-inp" id="g-name" autocomplete="name">
      <label class="s-lbl">Seu e-mail</label><input class="s-inp" id="g-email" type="email" autocomplete="email" value="${em}">
      <label class="s-lbl">Senha (8+ caracteres, letras e números)</label><input class="s-inp" id="g-pass" type="password" autocomplete="new-password">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateStoreCode(this)">Entrar na loja</button>`,
    login: `${back()}<div class="auth-t">Entrar</div>${google}
      <label class="s-lbl">E-mail</label><input class="s-inp" id="g-email" type="email" autocomplete="email" value="${em}">
      <label class="s-lbl">Senha</label><input class="s-inp" id="g-pass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')gateLogin(document.getElementById('g-go'))">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateLogin(this)">Entrar</button>
      <div class="auth-links"><a href="#" onclick="gv('forgot');return false">Esqueci a senha</a></div>`,
    forgot: `${back('login')}<div class="auth-t">Esqueci a senha</div><p class="dlg-p">Vamos mandar um código de 6 números pro seu e-mail.</p>
      <label class="s-lbl">E-mail</label><input class="s-inp" id="g-email" type="email" value="${em}">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateForgot(this)">Mandar código</button>`,
    reset: `${back('login')}<div class="auth-t">Nova senha</div><p class="dlg-p">Código enviado pra <b>${em}</b>.</p>
      <label class="s-lbl">Código</label><input class="s-inp code" id="g-code" inputmode="numeric" maxlength="6">
      <label class="s-lbl">Nova senha</label><input class="s-inp" id="g-pass" type="password" autocomplete="new-password">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateReset(this)">Salvar e entrar</button>`,
    mfa: `<div class="auth-t">Verificação em 2 etapas</div><p class="dlg-p">Digite o código do aplicativo autenticador.</p>
      <input class="s-inp code" id="g-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      ${note}<button class="btn-acc full" id="g-go" onclick="gateMfa(this)">Confirmar</button>`,
  }
  box.innerHTML = V[gateView]
  setTimeout(() => { const f = [...box.querySelectorAll('input')].find(x => !x.value); if (f) f.focus() }, 60)
}
const gval = id => (document.getElementById(id) || {}).value || ''
const gcall = (btn, fn) => authCall(btn, fn, 'gate-box')
async function gateDone(r, okMsg) {
  if (!r.ok) { renderGate(esc(r.error)); return false }
  if (r.mfaRequired) { gateFactor = r.factorId; gv('mfa'); return false }
  gateView = 'home'; closeGate()
  await loadMeta(); allData = await window.api.getData(); render()
  if (okMsg) showHint(okMsg)
  maybeWelcome()
  return true
}
async function gateCompany(btn) {
  gateEmail = gval('g-email').trim()
  if (gval('g-pass') !== gval('g-pass2')) { renderGate('As senhas não são iguais.'); return }
  const company = gval('g-company')
  const r = await gcall(btn, () => window.api.auth('create-company', { company, name: gval('g-name'), email: gateEmail, password: gval('g-pass') }))
  if (r.ok && r.needsConfirmation) { gv('confirm'); return }
  gateDone(r, `✓ Empresa ${esc(company)} criada`)
}
async function gateConfirm(btn) { gateDone(await gcall(btn, () => window.api.auth('confirm-signup', { email: gateEmail, code: gval('g-code') }))) }
async function gateInvited(btn, resend) {
  gateEmail = gval('g-email').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(gateEmail)) { renderGate('Digite o e-mail do convite.'); return }
  if (resend) {
    const r = await gcall(btn, () => window.api.auth('invite-request', { email: gateEmail }))
    if (!r.ok) { renderGate(esc(r.error)); return }
    gv('invcode', 'Código enviado. Confira a caixa de entrada e o spam.', true); return
  }
  gv('invcode')
}
async function gateInvCode(btn) {
  const r = await gcall(btn, () => window.api.auth('invite-verify', { email: gateEmail, code: gval('g-code') }))
  if (!r.ok) { renderGate(esc(r.error)); return }
  if (r.mfaRequired) { gateFactor = r.factorId; gv('mfa'); return }
  gateNext = r.joined || []
  if (r.needsPassword) { gv('finish', r.joined && r.joined.length ? `✓ Convite da <b>${esc(r.joined.join(', '))}</b> aceito.` : '', true); return }
  gateDone(r, r.joined && r.joined.length ? `✓ Você entrou na ${esc(r.joined.join(', '))}` : '')
}
async function gateFinish(btn) {
  const r = await gcall(btn, () => window.api.auth('finish-profile', { name: gval('g-name'), password: gval('g-pass') }))
  gateDone(r, gateNext && gateNext.length ? `✓ Bem-vindo à ${esc(gateNext.join(', '))}` : '✓ Conta pronta')
}
async function gateStoreCode(btn) {
  gateEmail = gval('g-email').trim()
  const r = await gcall(btn, () => window.api.auth('join-with-code', { code: gval('g-scode'), name: gval('g-name'), email: gateEmail, password: gval('g-pass') }))
  gateDone(r, r.joined && r.joined.length ? `✓ Você entrou na ${esc(r.joined.join(', '))}` : '')
}
async function gateLogin(btn) {
  gateEmail = gval('g-email').trim()
  gateDone(await gcall(btn, () => window.api.auth('sign-in', { email: gateEmail, password: gval('g-pass') })))
}
async function gateGoogle() {
  renderGate('Abrimos o navegador: escolha sua conta Google e volte pra cá.', true)
  gateDone(await gcall(document.querySelector('#gate .btn-google'), () => window.api.auth('google')))
}
async function gateForgot(btn) {
  gateEmail = gval('g-email').trim() || gateEmail
  const r = await gcall(btn, () => window.api.auth('reset-request', { email: gateEmail }))
  if (!r.ok) { renderGate(esc(r.error)); return }
  gv('reset', 'Se existir uma conta com esse e-mail, o código chega em instantes.', true)
}
async function gateReset(btn) { gateDone(await gcall(btn, () => window.api.auth('reset-confirm', { email: gateEmail, code: gval('g-code'), password: gval('g-pass') }))) }
async function gateMfa(btn) { gateDone(await gcall(btn, () => window.api.auth('mfa-login', { factorId: gateFactor, code: gval('g-code') }))) }

// ─── Depois de entrar ───
// Dono novo: escolhe o modelo (Madeireira…) e o WhatsApp; depois o tour de dono
function openCompanySetup() {
  const c = mainCompany() || { b: bizList()[0] }
  wiz = { step: 1, model: null, name: c.b ? c.b.name : '', phone: '', kind: 'store', company: true }
  document.getElementById('wiz').classList.add('open'); renderWizard()
}
async function sellerWelcome() {
  const c = mainCompany()
  const r = await dialogBox(`<div class="dlg-t">Bem-vindo${c ? ' à ' + esc(c.b.name) : ''}! 👋</div>
    <p class="dlg-p">Você é <b>vendedor</b>. ${ROLE_TEXT.seller}</p>
    <ul class="wz-list left"><li>➕ Marque seus clientes em <b>Novo retoma</b> (ou tecla N, ou Ctrl+Alt+R)</li><li>📱 Confira o seu WhatsApp de trabalho em Configurações → Negócios</li><li>☁️ Tudo sincroniza com a empresa sozinho</li></ul>`, [{ t: 'Depois' }, { t: 'Ver o tour' }])
  window.api.setUi({ onboarded: true })
  if (r && r.i === 1) startTour()
}


// ═══ 1.2: JANELA DE PC — menu lateral, telas, painel do cliente ═══════════
let currentView = 'today'   // today | all | cal | clients | done | team | settings | search
let selId = null            // retoma aberto no painel
let tabFilter = 'all'       // Hoje: all | late | today | week
let prioFilter = 'todos'    // todos | alta | media | baixa
let doneAll = []            // concluídos (60 dias) — pro "feitos hoje", histórico e equipe
let scoreCache = null
let swapN = 0, bumpN = 0
let clientQ = ''

const ICON = {
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5 9.5-10"/></svg>',
  wa: (s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42"/></svg>`,
  snooze: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 3 2 6M22 6l-3-3"/></svg>',
  msg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  pen: '<svg class="pen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  cold: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18"/></svg>',
  spread: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 5v14"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  shield: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/></svg>',
}
const PT = '<i class="pt"></i>'.repeat(8)
const pbars = p => `<span class="pb ${p || 'media'}" aria-hidden="true"><i></i><i></i><i></i></span>`
const PRIO_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
const PRIO_ORDER = { alta: 0, media: 1, baixa: 2 }
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DOW_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MES_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const parseYmd = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d, 12) }
const addDays = (ds, n) => { const d = parseYmd(ds); d.setDate(d.getDate() + n); return Money.ymd(d) }
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000)
const longDate = ds => { const d = parseYmd(ds); return `${DOW_LONG[d.getDay()]}, ${d.getDate()} de ${MES_LONG[d.getMonth()]}` }
const shortDay = ds => { const d = parseYmd(ds); return `${DOW[d.getDay()]}, ${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}` }
const valueOf = f => feat('money') ? (Money.valueOf(f) || 0) : 0
const prioOf = f => f.prio || 'media'
const firstWord = n => String(n || '').trim().split(/\s+/)[0] || ''

function whenOf(f) {
  const t = todayStr()
  if (f.date < t) { const n = daysBetween(f.date, t); return { kind: 'late', label: n === 1 ? 'ontem' : `há ${n} dias`, color: 'var(--late)' } }
  if (f.date === t) return { kind: 'today', label: f.time || 'hoje', color: 'var(--acc-light)' }
  const n = daysBetween(t, f.date)
  return { kind: 'later', label: n === 1 ? `amanhã${f.time && f.time !== '09:00' ? ' · ' + f.time : ''}` : shortDay(f.date), color: 'var(--text2)' }
}
const sortItems = (a, b) => (PRIO_ORDER[prioOf(a)] - PRIO_ORDER[prioOf(b)]) || (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '') || (valueOf(b) - valueOf(a))
const byPrio = l => prioFilter === 'todos' ? l : l.filter(f => prioOf(f) === prioFilter)

// ─── navegação ───
const TITLES = { today: 'Hoje', all: 'Retomas', cal: 'Calendário', clients: 'Clientes', done: 'Concluídos', team: 'Equipe', settings: 'Configurações', search: 'Busca' }
function nav(view, opts = {}) {
  if (view !== 'search') { const si = document.getElementById('search-input'); if (si && si.value) si.value = '' }
  const changed = currentView !== view
  currentView = view
  closeSnooze(); closeMsg(); closeBizMenu()
  if (changed) document.body.classList.remove('d-open')
  const pane = document.getElementById('pane')
  if (changed || opts.anim) { pane.scrollTop = 0; pane.classList.add('anim'); clearTimeout(nav._t); nav._t = setTimeout(() => pane.classList.remove('anim'), 1200) }
  render()
  if (view === 'done') refreshDone().then(() => currentView === 'done' && renderPane())
  if (view === 'team') loadCompanyExtras()
  if (view === 'settings') loadCompanyExtras()
}
const goHome = () => nav('today')
function showSettings() { nav('settings') }
function showDone() { nav('done') }
function showOverdue() { tabFilter = 'late'; nav('today', { anim: true }) }
function refreshCurrentView() { render() }

async function refreshDone() {
  try { doneAll = await window.api.getDone() } catch (e) { doneAll = [] }
  doneCache = doneAll
  try { scoreCache = feat('score') ? await window.api.getScore(bizFilter) : null } catch (e) { scoreCache = null }
}
function renderScore() { refreshDone().then(() => { if (['today', 'done'].includes(currentView)) renderPane() }) }

function render() {
  renderRail()
  document.getElementById('tb-title').textContent = TITLES[currentView] || ''
  const split = document.getElementById('split')
  split.classList.toggle('no-detail', ['done', 'team', 'settings', 'clients'].includes(currentView))
  renderPane()
  renderDetail()
  updateBadge()
}

// ─── menu lateral ───
function renderRail() {
  ;['today', 'all', 'cal', 'clients', 'done', 'team', 'settings'].forEach(v => {
    const el = document.getElementById('nav-' + v); if (el) el.classList.toggle('on', currentView === v)
  })
  const t = todayStr(), list = vis()
  const late = list.filter(f => f.date < t).length, today = list.filter(f => f.date === t).length
  const bd = document.getElementById('badge-today')
  bd.textContent = late + today ? String(late + today) : ''
  bd.classList.toggle('late', late > 0)
  // negócio atual
  const sw = document.getElementById('biz-sw')
  const b = bizFilter !== 'all' ? bizOf(bizFilter) : (bizList().length === 1 ? bizList()[0] : null)
  const name = b ? b.name : 'Todos os negócios'
  document.getElementById('bz-sq').textContent = (b ? b.name : 'T').trim()[0].toUpperCase()
  document.getElementById('bz-sq').style.setProperty('--c', b ? b.color : '#9aa19e')
  document.getElementById('bz-name').textContent = name
  document.getElementById('bz-sub').textContent = multi() ? `${bizList().length} negócios · trocar` : 'ajustar negócio'
  sw.setAttribute('aria-label', 'Negócio: ' + name)
  // equipe aparece pra quem está numa empresa
  document.getElementById('nav-team').style.display = myCompanies().length || (meta && meta.account && meta.account.user) ? '' : 'none'
  renderRoleChip()
}
function openBizMenu(btn) {
  if (document.querySelector('.bz-menu')) { closeBizMenu(); return }
  if (!multi()) { nav('settings'); return }
  const t = todayStr()
  const cnt = id => (id === 'all' ? allData : allData.filter(f => f.biz === id)).filter(f => f.date <= t).length
  const m = document.createElement('div'); m.className = 'bz-menu'; m.setAttribute('role', 'menu')
  m.innerHTML = `<button role="menuitem" class="${bizFilter === 'all' ? 'on' : ''}" onclick="closeBizMenu();setBizFilter('all')"><i style="--c:#9aa19e"></i>Todos os negócios<span class="bm-n">${cnt('all') || ''}</span></button>` +
    bizList().map(b => `<button role="menuitem" class="${bizFilter === b.id ? 'on' : ''}" onclick="closeBizMenu();setBizFilter('${b.id}')"><i style="--c:${b.color}"></i>${esc(b.name)}<span class="bm-n">${cnt(b.id) || ''}</span></button>`).join('') +
    `<hr><button role="menuitem" onclick="closeBizMenu();nav('settings')">Gerenciar negócios…</button>`
  document.body.appendChild(m)
  const r = btn.getBoundingClientRect()
  m.style.left = Math.min(window.innerWidth - m.offsetWidth - 8, r.right + 8) + 'px'
  m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.top)) + 'px'
}
function closeBizMenu() { const m = document.querySelector('.bz-menu'); if (m) m.remove() }
document.addEventListener('mousedown', e => { if (!e.target.closest('.bz-menu') && !e.target.closest('#biz-sw')) closeBizMenu() })

// papel + nome no rodapé do menu
function renderRoleChip() {
  const u = meta && meta.account && meta.account.user
  const c = mainCompany()
  document.getElementById('me-av').textContent = u ? (u.name || u.email || '?')[0].toUpperCase() : '·'
  document.getElementById('me-name').textContent = u ? (u.name || u.email) : 'Sem conta'
  const r = document.getElementById('me-role')
  r.className = c ? c.role : ''
  r.textContent = c ? `${ROLE_NAME[c.role]} · ${c.b.name}` : (u ? 'conta pessoal' : 'só neste PC')
  document.getElementById('nav-me').setAttribute('aria-label', c ? `${ROLE_NAME[c.role]} da ${c.b.name}` : 'Minha conta')
}

// ─── sincronização (barra de cima) ───
function renderSyncDot(st) {
  const el = document.getElementById('sync-dot'); if (!el) return
  const user = meta && meta.account && meta.account.user
  if (!user || !st) { el.style.display = 'none'; return }
  el.style.display = ''
  const state = st.state || 'idle'
  el.className = 'sync ' + state
  const when = st.lastSync ? new Date(st.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
  document.getElementById('sync-txt').textContent = { idle: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sem internet', error: 'Erro ao sincronizar' }[state] || ''
  el.title = { idle: `Sincronizado${when ? ' às ' + when : ''}`, syncing: 'Sincronizando…', offline: st.error || 'Sem internet: as mudanças sobem quando voltar', error: 'Erro ao sincronizar: ' + (st.error || '') }[state] || ''
}

// ─── telas ───
function renderPane() {
  const pane = document.getElementById('pane')
  const keep = pane.scrollTop
  const V = { today: todayView, all: allView, search: searchView, cal: calView, clients: clientsView, done: doneView, team: teamView, settings: settingsView }
  pane.className = 'pane' + (pane.classList.contains('anim') ? ' anim' : '') + (['team', 'settings', 'done', 'clients'].includes(currentView) ? ' wide' : '')
  pane.innerHTML = (V[currentView] || todayView)()
  if (currentView === 'settings') renderSettings()
  if (currentView === 'cal') renderCalendar()
  pane.scrollTop = keep
}

// Linha de um retoma (lista)
function rowHtml(f, i = 0) {
  const w = whenOf(f), b = bizOf(f.biz), v = valueOf(f)
  const cold = feat('cooling') && (f.snoozes || 0) >= 3 ? `<span class="tg cold" title="Adiado ${f.snoozes} vezes: hora de decidir">${ICON.cold}adiado ${f.snoozes}x</span>` : ''
  const own = ownerTag2(f)
  const bt = multi() && bizFilter === 'all' && b ? `<span class="tg biz">${esc(b.name)}</span>` : ''
  const sub = [f.note, ...(f.fields ? bizFields(f.biz).filter(fd => fd.onCard && f.fields[fd.id] !== undefined && fd.type !== 'money').map(fd => `${fd.label} ${fmtField(fd, f.fields[fd.id])}`) : [])].filter(Boolean).join(' · ') || fmtPhone(f.phone)
  return `<div class="row ${f.id === selId ? 'sel' : ''}" data-id="${esc(f.id)}" style="animation-delay:${Math.min(i, 14) * 40}ms">
    <button class="chk" aria-label="Marcar ${esc(f.name)} como feito" onclick="doneFx('${esc(f.id)}')">${ICON.check}${PT}</button>
    <button class="r-main" onclick="selectItem('${esc(f.id)}')">
      <span class="r-txt"><span class="r-name"><span class="bd" style="--c:${b ? b.color : 'var(--green)'}"></span><span class="nm">${esc(f.name)}</span><span title="Prioridade ${PRIO_LABEL[prioOf(f)]}" role="img" aria-label="Prioridade ${PRIO_LABEL[prioOf(f)]}">${pbars(prioOf(f))}</span>${cold}${own}${bt}</span>
      <span class="r-sub">${esc(sub)}</span></span>
      <span class="r-meta">${v ? `<span class="v">${Money.fmtMoney(v)}</span>` : ''}<span class="w" style="--wc:${w.color}">${esc(w.label)}</span></span>
    </button>
    <div class="r-acts">
      <button class="wa" onclick="wpp('${esc(f.phone)}','${esc(f.biz || '')}')" title="Abrir no WhatsApp" aria-label="Abrir ${esc(f.name)} no WhatsApp">${ICON.wa(17)}</button>
      ${feat('templates') ? `<button class="ghost msg" onclick="openMsg('${esc(f.id)}', this)" title="Mensagem pronta" aria-label="Mensagem pronta">${ICON.msg}</button>` : ''}
      <button class="ghost snz" onclick="openSnooze('${esc(f.id)}', this)" title="Adiar" aria-label="Adiar ${esc(f.name)}">${ICON.snooze}</button>
    </div>
  </div>`
}
function ownerTag2(f) {
  const b = bizOf(f.biz)
  if (!b || b.kind !== 'store' || !isMgr(f.biz) || isMine(f)) return ''
  if (f.owner === null) return `<span class="tg none">sem responsável</span>`
  const p = peopleOf(f.biz).find(x => x.id === f.owner)
  return `<span class="tg own">${esc(firstWord(p ? p.name : 'vendedor'))}</span>`
}
function groupHtml(label, color, items, extra = '', live = false, idx = { i: 0 }) {
  if (!items.length) return ''
  const v = items.reduce((a, f) => a + valueOf(f), 0)
  return `<div class="grp"><div class="grp-h" style="--gc:${color}"><span class="gd ${live ? 'live' : ''}"></span><span class="gl">${label}</span><span class="gn">${items.length}</span>${extra || (v ? `<span class="gv">${Money.fmtMoney(v)}</span>` : '')}</div>
    ${items.map(f => rowHtml(f, idx.i++)).join('')}</div>`
}
function ownerBarHtml() {
  const tb = teamBiz(); if (!tb) return ''
  const base = allData.filter(f => f.biz === tb), today = todayStr()
  const people = peopleOf(tb).filter(p => p.id !== myId())
  const cnt = fn => base.filter(fn).filter(f => f.date <= today).length
  const chip = (id, label, n, cls = '') => `<button class="chip ${cls} ${ownerFilter === id ? 'on' : ''}" onclick="setOwnerFilter('${id}')">${esc(label)}${n ? `<b>${n}</b>` : ''}</button>`
  const none = base.filter(f => f.owner === null).length
  return `<div class="own2"><span class="ol">Vendedor</span>${chip('all', 'Todos', 0)}${chip('me', 'Eu', cnt(isMine))}${people.map(p => chip(p.id, firstWord(p.name), cnt(f => f.owner === p.id))).join('')}${none ? chip('none', 'Sem dono', none, 'warn') : ''}${ownerFilter === 'none' && none ? `<button class="prim" style="height:30px;padding:0 12px;font-size:12.5px" onclick="openRedistribute('${tb}')">Redistribuir</button>` : ''}</div>`
}
function prioSegHtml() {
  const opts = ['todos', 'alta', 'media', 'baixa'], i = opts.indexOf(prioFilter)
  const bg = { todos: '#2a2e2c', alta: 'rgba(255,107,107,.2)', media: 'rgba(250,204,21,.18)', baixa: '#2a2e2c' }[prioFilter]
  return `<div class="seg2 dark" role="tablist" aria-label="Prioridade"><span class="pill" style="left:${3 + i * 80}px;width:76px;background-color:${bg}"></span>${opts.map(p =>
    `<button class="${p === prioFilter ? 'on' : ''}" role="tab" style="width:76px" onclick="setPrioFilter('${p}')">${p === 'todos' ? 'Todas' : pbars(p) + PRIO_LABEL[p]}</button>`).join('')}</div>`
}
function setPrioFilter(p) { prioFilter = p; renderPane() }
function setTab(t) { tabFilter = t; renderPane() }

// HOJE
function todayView() {
  const t = todayStr(), list = vis()
  const late = byPrio(list.filter(f => f.date < t)).sort(sortItems)
  const today = byPrio(list.filter(f => f.date === t)).sort(sortItems)
  const week = byPrio(list.filter(f => f.date > t && f.date <= addDays(t, 7))).sort((a, b) => a.date.localeCompare(b.date) || sortItems(a, b))
  const n = list.filter(f => f.date <= t).length
  const doneToday = doneAll.filter(f => (bizFilter === 'all' || f.biz === bizFilter) && f.doneAt && Money.ymd(new Date(f.doneAt)) === t && !f.recovered).length
  const total = n + doneToday, C = 2 * Math.PI * 22, p = total ? doneToday / total : 0
  const stake = list.filter(f => f.date <= t).reduce((a, f) => a + valueOf(f), 0)
  const h = new Date().getHours(), u = meta && meta.account && meta.account.user
  const hello = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + (u && u.name ? ', ' + esc(firstWord(u.name)) : '')
  const sc = scoreCache && scoreCache.decided && feat('score') ? `<button class="h-score ghost" style="border:0;padding:0" onclick="nav('done')">Placar de ${MES_LONG[new Date().getMonth()]}: ${feat('money') && scoreCache.wonValue ? '<b>' + Money.fmtMoney(scoreCache.wonValue) + '</b> fechados · ' : ''}${scoreCache.won} de ${scoreCache.decided}</button>` : ''
  const days = Money.businessDays(6)
  const wk = feat('week') ? `<span class="rc-sep"></span><div class="wk2" id="week-strip" role="group" aria-label="Retomas dos próximos dias">${days.map(ds => {
    const c = list.filter(f => f.date === ds || (ds === t && f.date < t)).length
    const d = parseYmd(ds)
    return `<button class="${ds === t ? 'is-t' : ''}" onclick="jumpToDay('${ds}')" title="${c} retoma${c === 1 ? '' : 's'} · ${shortDay(ds)}"><span class="wb-box"><span class="wb" style="height:${c ? Math.min(30, 6 + c * 4) : 3}px;${c || ds === t ? '' : 'background:rgba(255,255,255,.08)'}"></span></span><small>${ds === t ? 'hoje' : DOW[d.getDay()]}</small><span class="wn">${c || ''}</span></button>`
  }).join('')}</div>` : ''
  const tabs = [['all', 'Tudo', late.length + today.length + week.length], ['late', 'Atrasos', late.length], ['today', 'Hoje', today.length], ['week', 'Semana', week.length]]
  const ti = tabs.findIndex(x => x[0] === tabFilter)
  const idx = { i: 0 }
  const show = k => tabFilter === 'all' || tabFilter === k
  const groups = (show('late') ? groupHtml('Atrasados', 'var(--late)', late, late.length > 1 ? `<button class="ghost spread" onclick="openDistribute()">${ICON.spread}Distribuir pela semana</button>` : '', true, idx) : '') +
    (show('today') ? groupHtml('Hoje', 'var(--acc-light)', today, '', false, idx) : '') +
    (show('week') ? groupHtml('Próximos 7 dias', 'var(--text2)', week, '', false, idx) : '')
  return `<div class="hero">
      <div class="hero-l"><div class="h-date">${hello} · ${longDate(t)}</div>
        ${n ? `<div class="h-big">Você tem <em class="b${bumpN % 2}">${n === 1 ? '1 cliente' : n + ' clientes'}</em><br>pra retomar hoje.</div>` : `<div class="h-big">Tudo em dia hoje.<br><em>Nenhum cliente esquecido.</em></div>`}
        ${stake ? `<div class="h-sub"><b class="mono">${Money.fmtMoney(stake)}</b> em orçamentos esperando resposta${late.length ? ` · <span style="color:var(--late)">${late.length} atrasado${late.length > 1 ? 's' : ''}</span>` : ''}</div>` : (late.length ? `<div class="h-sub" style="color:var(--late)">${late.length} atrasado${late.length > 1 ? 's' : ''}</div>` : '')}
        ${sc}
      </div>
      <div class="ring-card" id="ring-card">
        <div class="ringbox" id="ringbox"><svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label="${doneToday} de ${total} feitos hoje"><circle cx="30" cy="30" r="22" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/><circle class="ring" cx="30" cy="30" r="22" fill="none" stroke="var(--green)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 30 30)"/></svg>${['#4ade80', '#facc15', '#60a5fa', '#f2f4f3'].map((c, k) => [0, 1, 2].map(j => `<span class="cp" style="--r:${(k * 3 + j) * 30}deg;background:${c};animation-delay:${j * 20}ms"></span>`).join('')).join('')}</div>
        <div class="rc-n"><b class="mono">${doneToday}<span>/${total}</span></b><small>feitos hoje</small></div>
        ${wk}
      </div>
    </div>
    ${ownerBarHtml()}
    <div class="filters">
      <div class="seg2 light" role="tablist" aria-label="Quando"><span class="pill" style="left:${3 + ti * 92}px;width:88px;background-color:#f2f4f3"></span>${tabs.map(([k, l, c]) =>
        `<button class="${k === tabFilter ? 'on' : ''}" role="tab" style="width:88px" onclick="setTab('${k}')">${l} <span class="n">${c}</span></button>`).join('')}</div>
      ${prioSegHtml()}
    </div>
    ${groups || `<div class="empty2"><b>${prioFilter !== 'todos' || tabFilter !== 'all' ? 'Nada com esse filtro.' : 'Tudo em dia.'}</b><span>${prioFilter !== 'todos' || tabFilter !== 'all' ? 'Troque o filtro pra ver os outros.' : 'Use “Novo retoma” pra marcar o próximo cliente.'}</span></div>`}`
}
function jumpToDay(ds) { selectedDate = ds; const [y, m] = ds.split('-').map(Number); currentYear = y; currentMonth = m - 1; nav('cal') }

// RETOMAS (todos os ativos, por data)
function listByDate(items) {
  const t = todayStr(), idx = { i: 0 }
  const late = items.filter(f => f.date < t).sort(sortItems)
  const rest = items.filter(f => f.date >= t).sort((a, b) => a.date.localeCompare(b.date) || sortItems(a, b))
  const by = {}; rest.forEach(f => (by[f.date] = by[f.date] || []).push(f))
  return groupHtml('Atrasados', 'var(--late)', late, late.length > 1 ? `<button class="ghost spread" onclick="openDistribute()">${ICON.spread}Distribuir pela semana</button>` : '', true, idx) +
    Object.keys(by).map(ds => groupHtml(ds === t ? 'Hoje' : ds === addDays(t, 1) ? 'Amanhã' : shortDay(ds), ds === t ? 'var(--acc-light)' : 'var(--text2)', by[ds], '', false, idx)).join('')
}
function allView() {
  const items = byPrio(vis())
  const v = items.reduce((a, f) => a + valueOf(f), 0)
  return `<div class="ph"><div class="ph-l"><h1>Retomas</h1><p>${items.length} cliente${items.length === 1 ? '' : 's'} pra retomar${v ? ` · <span class="mono" style="color:var(--text)">${Money.fmtMoney(v)}</span> em jogo` : ''}</p></div></div>
    ${ownerBarHtml()}<div class="filters">${prioSegHtml()}</div>
    ${listByDate(items) || `<div class="empty2"><b>Nenhum retoma marcado.</b><span>Clique em “Novo retoma” pra começar.</span></div>`}`
}
// BUSCA
function handleSearch() {
  const q = document.getElementById('search-input').value.trim()
  if (!q) { if (currentView === 'search') nav('today'); return }
  if (currentView !== 'search') { currentView = 'search'; render() } else renderPane()
}
function searchView() {
  const raw = document.getElementById('search-input').value.trim(), q = raw.toLowerCase(), qd = q.replace(/\D/g, '')
  const r = vis().filter(f => f.name.toLowerCase().includes(q) || (qd.length >= 3 && String(f.phone).replace(/\D/g, '').includes(qd)) || (f.note || '').toLowerCase().includes(q) || fieldText(f).includes(q))
  const old = doneAll.filter(f => (bizFilter === 'all' || f.biz === bizFilter) && (f.name.toLowerCase().includes(q) || (qd.length >= 3 && String(f.phone).replace(/\D/g, '').includes(qd))))
  return `<div class="ph"><div class="ph-l"><h1 style="font-size:26px">Busca: “${esc(raw)}”</h1><p>${r.length} retoma${r.length === 1 ? '' : 's'} ativo${r.length === 1 ? '' : 's'}${old.length ? ` · ${old.length} nos concluídos` : ''}</p></div></div>
    ${listByDate(r) || `<div class="empty2"><b>Nenhum retoma ativo com isso.</b><span>${old.length ? 'Tem nos concluídos: veja em Concluídos.' : 'Confira o nome ou o número.'}</span></div>`}`
}
// CALENDÁRIO
function calView() {
  const ds = selectedDate || todayStr()
  const items = byPrio(vis().filter(f => f.date === ds)).sort(sortItems)
  const v = items.reduce((a, f) => a + valueOf(f), 0)
  return `<div class="cal2"><div class="cal-card">
      <div class="cal-header"><button class="cal-nav" onclick="changeMonth(-1)" aria-label="Mês anterior">‹</button><span class="cal-month" id="cal-month-label"></span><button class="cal-nav" onclick="changeMonth(1)" aria-label="Próximo mês">›</button></div>
      <div class="cal-grid" id="cal-grid"></div></div>
    <div class="cal-list"><h2>${longDate(ds)}</h2><div class="cl-sub">${items.length} retoma${items.length === 1 ? '' : 's'}${v ? ' · ' + Money.fmtMoney(v) : ''}</div>
      <div class="filters">${prioSegHtml()}</div>
      ${items.length ? `<div class="grp">${items.map(rowHtml).join('')}</div>` : `<div class="empty2"><b>Dia livre.</b><span><a href="#" onclick="openModal();return false">Marcar um retoma neste dia</a></span></div>`}
    </div></div>`
}
function selectDay(ds) { selectedDate = ds; renderPane() }
function closePanel() { selectedDate = null; renderPane() }
function changeMonth(dir) {
  currentMonth += dir
  if (currentMonth > 11) { currentMonth = 0; currentYear++ }
  if (currentMonth < 0) { currentMonth = 11; currentYear-- }
  renderCalendar()
}
// CLIENTES (todo mundo que já passou pelo Retoma)
function clientsView() {
  const people = []
  const add = (f, active) => {
    let p = people.find(x => samePerson(x, f))
    if (!p) { p = { name: f.name, phone: f.phone, biz: f.biz, active: [], done: [] }; people.push(p) }
    ;(active ? p.active : p.done).push(f)
  }
  vis().forEach(f => add(f, true))
  doneAll.filter(f => bizFilter === 'all' || f.biz === bizFilter).forEach(f => add(f, false))
  const q = clientQ.trim().toLowerCase()
  const list = people.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.phone).includes(q))
    .sort((a, b) => (b.active.length ? 1 : 0) - (a.active.length ? 1 : 0) || a.name.localeCompare(b.name, 'pt-BR'))
  const won = p => p.done.filter(f => f.outcome === 'won').length
  clientsView._list = list
  return `<div class="page"><div class="ph"><div class="ph-l"><h1>Clientes</h1><p>${people.length} cliente${people.length === 1 ? '' : 's'} · ${people.filter(p => p.active.length).length} com retoma marcado</p></div>
    <div class="btns"><label class="search" style="width:300px"><input placeholder="Filtrar por nome ou número" value="${esc(clientQ)}" oninput="clientQ=this.value;renderPane();const i=document.querySelector('.pane .search input');i.focus();i.setSelectionRange(i.value.length,i.value.length)"></label></div></div>
    <div class="grp">${list.map((p, i) => {
      const b = bizOf(p.biz), nxt = p.active.slice().sort((a, b) => a.date.localeCompare(b.date))[0]
      const last = p.done.slice().sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))[0]
      return `<div class="row cl-row" style="animation-delay:${Math.min(i, 14) * 30}ms"><button class="r-main" onclick="${nxt ? `openClientRetoma('${esc(nxt.id)}')` : `newForClient(${i})`}">
        <span class="r-txt"><span class="r-name"><span class="bd" style="--c:${b ? b.color : 'var(--green)'}"></span><span class="nm">${esc(p.name)}</span>${won(p) ? `<span class="tg" style="background:rgba(251,191,36,.12);color:#fbbf24">fechou ${won(p)}x</span>` : ''}</span>
        <span class="r-sub mono">${esc(fmtPhone(p.phone))} · <span class="cl-n">${p.active.length + p.done.length} contato${p.active.length + p.done.length === 1 ? '' : 's'}${last ? ' · último ' + dateLabel(Money.ymd(new Date(last.doneAt || last.date))) : ''}</span></span></span>
        <span class="r-meta">${nxt ? `<span class="w" style="--wc:${whenOf(nxt).color}">${esc(whenOf(nxt).label)}</span>` : `<span class="w" style="--wc:var(--text3)">sem retoma · marcar</span>`}</span></button>
        <div class="r-acts"><button class="wa" onclick="wpp('${esc(p.phone)}','${esc(p.biz || '')}')" title="Abrir no WhatsApp" aria-label="WhatsApp de ${esc(p.name)}">${ICON.wa(17)}</button></div></div>`
    }).join('') || `<div class="empty2"><b>Nenhum cliente ainda.</b><span>Cada retoma que você marcar entra aqui.</span></div>`}</div></div>`
}
function openClientRetoma(id) { selId = id; nav('all'); setTimeout(() => { const r = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 60); openDetailDrawer() }
function newForClient(i) {
  const p = (clientsView._list || [])[i]; if (!p) return
  openModal()
  document.getElementById('inp-name').value = p.name; document.getElementById('inp-phone').value = p.phone
  if (p.biz && bizList().some(b => b.id === p.biz)) setBizPick(p.biz)
  updateHint()
}
// CONCLUÍDOS
// ─── 1.3: CONCLUÍDOS por período (mês/semana) + relatório ───
let donePer = { mode: 'month', off: 0 }   // off 0 = atual, -1 = anterior…
function periodRange(mode, off) {
  const now = parseYmd(todayStr())
  if (mode === 'week') {
    const d = new Date(now); const dow = (d.getDay() + 6) % 7   // segunda = 0
    d.setDate(d.getDate() - dow + off * 7)
    const start = Money.ymd(d), end = addDays(start, 6)
    const lbl = off === 0 ? 'Esta semana' : off === -1 ? 'Semana passada' : `Semana de ${shortDay(start)}`
    return { start, end, label: lbl, sub: `${shortDay(start)} a ${shortDay(end)}` }
  }
  const d = new Date(now.getFullYear(), now.getMonth() + off, 1)
  const start = Money.ymd(d), end = Money.ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  const nm = MES_LONG[d.getMonth()]
  return { start, end, label: nm.charAt(0).toUpperCase() + nm.slice(1) + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''), sub: off === 0 ? 'mês atual' : String(d.getFullYear()) }
}
const doneDay = f => f.doneAt ? Money.ymd(new Date(f.doneAt)) : ''
function periodStats(mode, off) {
  const r = periodRange(mode, off)
  const inBiz = f => bizFilter === 'all' || f.biz === bizFilter
  const list = doneAll.filter(f => inBiz(f) && doneDay(f) >= r.start && doneDay(f) <= r.end).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
  const won = list.filter(f => f.outcome === 'won'), lost = list.filter(f => f.outcome === 'lost'), open = list.filter(f => !f.outcome)
  const decided = won.length + lost.length
  const days = []; for (let d = r.start; d <= r.end; d = addDays(d, 1)) days.push({ d, n: list.filter(f => doneDay(f) === d).length, w: won.filter(f => doneDay(f) === d).length })
  const created = [...allData, ...doneAll].filter(f => inBiz(f) && f.createdAt && Money.ymd(new Date(f.createdAt)) >= r.start && Money.ymd(new Date(f.createdAt)) <= r.end).length
  const byBiz = multi() && bizFilter === 'all' ? bizList().map(b => { const l = list.filter(f => f.biz === b.id), w = l.filter(f => f.outcome === 'won'); return { b, n: l.length, won: w.length, val: Money.sumValues(w) } }).filter(x => x.n) : []
  const byOwner = {}
  for (const f of list) { const b = bizOf(f.biz); if (!b || b.kind !== 'store' || !isMgr(f.biz)) continue; const p = peopleOf(f.biz).find(x => x.id === f.owner); const k = p ? p.name : 'Sem dono'; (byOwner[k] = byOwner[k] || { n: 0, won: 0, val: 0 }); byOwner[k].n++; if (f.outcome === 'won') { byOwner[k].won++; byOwner[k].val += valueOf(f) } }
  const best = [...won].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 5)
  return { r, list, won, lost, open, decided, pct: decided ? Math.round(won.length / decided * 100) : 0, wonVal: Money.sumValues(won), lostVal: Money.sumValues(lost), days, created, byBiz, byOwner, best, late: allData.filter(f => inBiz(f) && f.date < todayStr()).length }
}
function setDonePer(mode, off) { donePer = { mode, off: Math.min(0, off) }; renderPane() }
function doneView() {
  const { mode, off } = donePer, S = periodStats(mode, off)
  const money = feat('money')
  const mx = Math.max(1, ...S.days.map(x => x.n))
  const kpi = (lbl, v, cls = '') => `<div class="dk ${cls}"><small>${lbl}</small><b>${v}</b></div>`
  return `<div class="page narrow done-list">
    <div class="ph"><div class="ph-l"><h1>Concluídos</h1><p>Veja como foi cada mês ou semana · marque se fechou pra montar o placar</p></div>
      <div class="btns"><button class="prim" onclick="openReport()" ${S.list.length ? '' : 'disabled title="Nada concluído neste período"'}>Relatório</button></div></div>
    <div class="per-bar">
      <div class="seg per-seg"><button class="${mode === 'month' ? 'on' : ''}" onclick="setDonePer('month',0)">Mês</button><button class="${mode === 'week' ? 'on' : ''}" onclick="setDonePer('week',0)">Semana</button></div>
      <div class="per-nav"><button class="per-arr" onclick="setDonePer('${mode}',${off - 1})" title="Anterior" aria-label="Anterior">‹</button>
        <div class="per-lbl"><b>${esc(S.r.label)}</b><small>${esc(S.r.sub)}</small></div>
        <button class="per-arr" onclick="setDonePer('${mode}',${off + 1})" ${off >= 0 ? 'disabled' : ''} title="Próximo" aria-label="Próximo">›</button></div>
      ${off < 0 ? `<button class="s-link per-now" onclick="setDonePer('${mode}',0)">Voltar pra ${mode === 'month' ? 'este mês' : 'esta semana'}</button>` : ''}
    </div>
    <div class="dk-grid">
      ${kpi('Concluídos', S.list.length)}
      ${kpi('Fecharam', S.won.length + (money && S.wonVal ? `<em>${Money.fmtMoney(S.wonVal)}</em>` : ''), 'won')}
      ${kpi('Não fecharam', S.lost.length, 'lost')}
      ${kpi('Taxa de fechamento', S.decided ? S.pct + '%' : '—')}
    </div>
    ${S.list.length ? `<div class="dk-chart" aria-label="Concluídos por dia">${S.days.map(x => `<i title="${shortDay(x.d)}: ${x.n} concluído${x.n === 1 ? '' : 's'}${x.w ? ' · ' + x.w + ' fechou' : ''}" style="--h:${Math.round(x.n / mx * 100)}%" class="${x.w ? 'w' : ''}"></i>`).join('')}</div>` : ''}
    ${S.list.length ? S.list.map(doneCard).join('') : `<div class="empty2"><b>Nada concluído ${off === 0 ? (mode === 'month' ? 'neste mês' : 'nesta semana') : 'neste período'}.</b><span>Use as setas pra ver ${mode === 'month' ? 'meses' : 'semanas'} anteriores.</span></div>`}</div>`
}
// Relatório: prévia + salvar em PDF
function reportHtml(S) {
  const money = feat('money'), fm = v => Money.fmtMoney(v)
  const bizName = bizFilter === 'all' ? (multi() ? 'Todos os negócios' : (bizList()[0] || {}).name || '') : (bizOf(bizFilter) || {}).name
  const mx = Math.max(1, ...S.days.map(x => x.n))
  const rows = (arr) => arr.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')
  const lines = []
  lines.push(`${S.list.length} cliente${S.list.length === 1 ? '' : 's'} concluído${S.list.length === 1 ? '' : 's'} no período.`)
  if (S.decided) lines.push(`${S.won.length} fechou${money && S.wonVal ? ` (${fm(S.wonVal)})` : ''} e ${S.lost.length} não fechou: taxa de ${S.pct}%.`)
  if (S.open.length) lines.push(`${S.open.length} sem marcar se fechou: vale marcar pra o placar ficar certo.`)
  if (S.created) lines.push(`${S.created} retoma${S.created === 1 ? '' : 's'} novo${S.created === 1 ? '' : 's'} criado${S.created === 1 ? '' : 's'} no período.`)
  if (donePer.off === 0 && S.late) lines.push(`Hoje há ${S.late} atrasado${S.late === 1 ? '' : 's'}.`)
  const bestDay = [...S.days].sort((a, b) => b.n - a.n)[0]
  if (bestDay && bestDay.n > 1) lines.push(`Dia mais produtivo: ${shortDay(bestDay.d)} (${bestDay.n}).`)
  return `<div class="rp">
    <div class="rp-h"><div><div class="rp-k">Relatório Retoma</div><h2>${esc(S.r.label)}</h2><p>${esc(S.r.start.split('-').reverse().join('/'))} a ${esc(S.r.end.split('-').reverse().join('/'))} · ${esc(bizName)}</p></div><div class="rp-logo">R</div></div>
    <div class="rp-kpis"><div><small>Concluídos</small><b>${S.list.length}</b></div><div class="w"><small>Fecharam</small><b>${S.won.length}</b>${money && S.wonVal ? `<em>${fm(S.wonVal)}</em>` : ''}</div><div class="l"><small>Não fecharam</small><b>${S.lost.length}</b>${money && S.lostVal ? `<em>${fm(S.lostVal)}</em>` : ''}</div><div><small>Taxa</small><b>${S.decided ? S.pct + '%' : '—'}</b></div></div>
    <h3>Resumo</h3><ul class="rp-ul">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <h3>Concluídos por dia</h3><div class="rp-chart">${S.days.map(x => `<div><i style="height:${Math.round(x.n / mx * 70)}px" class="${x.w ? 'w' : ''}"></i><small>${Number(x.d.slice(8))}</small></div>`).join('')}</div>
    ${S.best.length ? `<h3>Maiores fechamentos</h3><table class="rp-t">${rows(S.best.map(f => [esc(f.name), money && valueOf(f) ? fm(valueOf(f)) : '✓']))}</table>` : ''}
    ${S.byBiz.length ? `<h3>Por negócio</h3><table class="rp-t">${rows(S.byBiz.map(x => [esc(x.b.name), `${x.n} concluídos · ${x.won} fecharam${money && x.val ? ' · ' + fm(x.val) : ''}`]))}</table>` : ''}
    ${Object.keys(S.byOwner).length > 1 ? `<h3>Por vendedor</h3><table class="rp-t">${rows(Object.entries(S.byOwner).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [esc(k), `${v.n} concluídos · ${v.won} fecharam${money && v.val ? ' · ' + fm(v.val) : ''}`]))}</table>` : ''}
    <h3>Clientes do período</h3><table class="rp-t">${rows(S.list.map(f => [`${esc(f.name)}<small>${esc(fmtPhone(f.phone) || '')}${f.note ? ' · ' + esc(f.note) : ''}</small>`, `${shortDay(doneDay(f))} · ${f.outcome === 'won' ? 'Fechou' + (money && valueOf(f) ? ' ' + fm(valueOf(f)) : '') : f.outcome === 'lost' ? 'Não fechou' : '—'}`]))}</table>
    <div class="rp-f">Gerado pelo Retoma em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div></div>`
}
function openReport() {
  const S = periodStats(donePer.mode, donePer.off)
  let ov = document.getElementById('rep-overlay')
  if (!ov) { ov = document.createElement('div'); ov.id = 'rep-overlay'; ov.className = 'rep-ov'; document.body.appendChild(ov); ov.addEventListener('mousedown', e => { if (e.target === ov) closeReport() }) }
  ov.innerHTML = `<div class="rep-box"><div class="rep-bar"><b>Relatório · ${esc(S.r.label)}</b><div class="btns"><button class="ghost" onclick="closeReport()">Fechar</button><button class="prim" id="rep-pdf" onclick="saveReportPdf()">Salvar PDF</button></div></div><div class="rep-scroll" id="rep-body">${reportHtml(S)}</div></div>`
  requestAnimationFrame(() => ov.classList.add('open'))
}
function closeReport() { const ov = document.getElementById('rep-overlay'); if (ov) { ov.classList.remove('open'); setTimeout(() => ov.remove(), 250) } }
async function saveReportPdf() {
  const S = periodStats(donePer.mode, donePer.off), btn = document.getElementById('rep-pdf')
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando…' }
  const css = Array.from(document.querySelectorAll('style')).map(x => x.textContent).join('\n')
  const r = await window.api.reportPdf({ html: reportHtml(S), css, name: `Retoma - ${S.r.label} (${S.r.start} a ${S.r.end})` })
  if (btn) { btn.disabled = false; btn.textContent = 'Salvar PDF' }
  if (r && r.ok) { showHint('📄 Relatório salvo em PDF'); closeReport() } else if (r && !r.canceled) showHint('⚠️ Não deu pra salvar o PDF', '#e53935')
}
// EQUIPE
function teamView() {
  const a = meta.account || {}
  const list = myCompanies()
  if (!a.user) return `<div class="page narrow"><div class="ph"><div class="ph-l"><h1>Equipe</h1><p>Pra montar equipe, entre na sua conta.</p></div></div>
    <div class="cta-box"><b>Use o Retoma com seus vendedores</b><p>O dono e o gerente veem os clientes de todos; cada vendedor vê os dele. Convide por e-mail.</p><div class="btns"><button class="prim" onclick="nav('settings')">Ir pra Conta</button></div></div></div>`
  if (!list.length) return `<div class="page narrow"><div class="ph"><div class="ph-l"><h1>Equipe</h1><p>Você ainda não está numa empresa.</p></div></div>
    <div id="pending-inv"></div>
    <div class="cta-box"><b>Foi convidado?</b><p>Confirme o convite que chegou no seu e-mail ou use o código da loja que o gerente te passou.</p><div class="btns"><button class="prim" onclick="openJoin()">Tenho um código da loja</button></div></div>
    <div class="cta-box"><b>Quer criar a sua?</b><p>Em Configurações → Negócios, mude o tipo do negócio pra <b>Loja (com equipe)</b> e depois convide os vendedores aqui.</p><div class="btns"><button class="ghost" onclick="nav('settings')">Abrir Negócios</button></div></div></div>`
  return `<div class="page">` + list.map(({ b, role }) => teamCompanyHtml(b, role)).join('<div style="height:30px"></div>') + `<div id="pending-inv"></div></div>`
}
function teamCompanyHtml(b, role) {
  const people = peopleOf(b.id), me = myId(), t = todayStr(), mgr = isMgr(b.id)
  const items = allData.filter(f => f.biz === b.id)
  const weekAgo = addDays(t, -6)
  const doneB = doneAll.filter(f => f.biz === b.id && f.doneAt && Money.ymd(new Date(f.doneAt)) >= weekAgo)
  const inv = companyInvites[b.id] || []
  const others = people.filter(p => p.role !== 'seller' && p.id !== me).map(p => p.name)
  const head = `<div class="ph"><div class="ph-l"><div class="badge ${role}">${ICON.shield}${ROLE_NAME[role]}: ${role === 'seller' ? 'você vê só os seus clientes' : 'você vê a equipe toda'}</div>
      <h1>Equipe da ${esc(b.name)}</h1><p>${people.length} pessoa${people.length === 1 ? '' : 's'} · ${esc(ROLE_TEXT[role])}${role === 'seller' && others.length ? ` Gerente: <b style="color:var(--text)">${esc(others.join(', '))}</b>.` : ''}</p></div>
    ${mgr ? `<div class="btns"><button class="ghost" onclick="teamInviteEmail('${b.id}','manager')" ${role !== 'owner' ? 'style="display:none"' : ''}>Convidar gerente</button><button class="prim" onclick="teamInviteEmail('${b.id}','seller')">${ICON.mail}Convidar vendedor</button></div>` : ''}</div>`
  if (!mgr) return head + `<div class="cta-box"><b>Seus números</b><p>${items.filter(f => f.date <= t).length} pra retomar hoje · ${items.filter(f => f.date < t).length} atrasados · ${doneB.length} feitos nos últimos 7 dias</p><div class="btns"><button class="ghost" style="color:#ff8a80;border-color:rgba(229,57,53,.3)" onclick="teamLeave('${b.id}','${esc(b.name)}')">Sair desta empresa</button></div></div>`
  const tiles = [['Pra retomar hoje', items.filter(f => f.date <= t).length, ''], ['Atrasados', items.filter(f => f.date < t).length, 'color:var(--late)'], ['Feitos nos últimos 7 dias', doneB.length, 'color:var(--acc-light)']]
  if (feat('money')) tiles.push(['Em orçamentos abertos', Money.fmtMoney(items.reduce((a, f) => a + valueOf(f), 0)), ''])
  const card = (p, i) => {
    const mine = items.filter(f => f.owner === p.id || (p.id === me && f.owner === undefined))
    const dn = doneB.filter(f => f.owner === p.id || (p.id === me && f.owner === undefined))
    const bars = Array.from({ length: 7 }, (_, k) => { const ds = addDays(t, k - 6); return dn.filter(f => Money.ymd(new Date(f.doneAt)) === ds).length })
    const mx = Math.max(1, ...bars)
    const acts = []
    if (role === 'owner' && p.role !== 'owner') acts.push(`<button class="ghost" onclick="teamRole('${b.id}','${p.id}','${p.role === 'manager' ? 'seller' : 'manager'}')">${p.role === 'manager' ? 'Tornar vendedor' : 'Tornar gerente'}</button>`)
    if (p.role !== 'owner' && p.id !== me && !(p.role === 'manager' && role !== 'owner')) acts.push(`<button class="ghost danger" onclick="teamRemove('${b.id}','${p.id}','${esc(p.name)}')">Remover</button>`)
    if (p.id !== me && mine.length) acts.unshift(`<button class="ghost" onclick="setBizFilter('${b.id}');setOwnerFilter('${p.id}');nav('all')">Ver clientes</button>`)
    return `<div class="pcard" style="animation-delay:${i * 50}ms"><div class="pc-top"><span class="pc-av ${p.role}">${esc(initials(p.name))}</span><div><b>${esc(p.name)}${p.id === me ? ' (você)' : ''}</b><small class="${p.role}">${ROLE_NAME[p.role]}</small></div></div>
      <div class="pc-nums"><div><b>${mine.filter(f => f.date <= t).length}</b><small>hoje</small></div><div><b class="${mine.some(f => f.date < t) ? 'late' : ''}">${mine.filter(f => f.date < t).length}</b><small>atrasados</small></div>
      <div class="spark"><span class="bars" aria-hidden="true">${bars.map((v, k) => `<i class="${k === 6 ? 't' : ''}" style="height:${3 + Math.round(v / mx * 26)}px"></i>`).join('')}</span><small>${dn.length} feitos em 7 dias</small></div></div>
      ${acts.length ? `<div class="pc-acts">${acts.join('')}</div>` : ''}</div>`
  }
  const orphans = items.filter(f => f.owner === null)
  const orphanCard = orphans.length ? `<div class="pcard orphan"><div class="pc-top"><span class="pc-av">${ICON.mail.replace('16', '18')}</span><div><b>Carteira sem dono</b><small class="o">${orphans.length} cliente${orphans.length === 1 ? '' : 's'} de quem saiu da equipe</small></div></div>
      <div class="pc-acts"><button class="prim" style="height:36px;padding:0 14px" onclick="openRedistribute('${b.id}')">Redistribuir</button><button class="ghost" onclick="setBizFilter('${b.id}');setOwnerFilter('none');nav('all')">Ver clientes</button></div></div>` : ''
  return head + `<div class="tiles">${tiles.map(([l, v, s], i) => `<div class="tile" style="animation-delay:${i * 40}ms"><small>${l}</small><b style="${s}">${v}</b></div>`).join('')}</div>
    <div class="cards">${people.map(card).join('')}${orphanCard}</div>
    ${inv.length ? `<div class="sec-t">Convites esperando resposta</div><div class="tbl">${inv.map(i => `<div class="tr"><span>${esc(i.email || 'código ' + i.code)}</span><span class="r ${i.role}">${ROLE_NAME[i.role]}</span><span class="d mono">código ${esc(i.code)}</span><span class="a">${i.email ? `<button class="ghost" onclick="teamInviteEmail('${b.id}','${i.role}','${esc(i.email)}')">Reenviar</button>` : ''}<button class="ghost" onclick="cancelInvite('${b.id}','${esc(i.code)}')">Cancelar</button></span></div>`).join('')}</div>` : ''}`
}
const initials = n => { const w = String(n || '?').trim().split(/\s+/); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() }
// CONFIGURAÇÕES
function settingsView() { return `<div class="page narrow"><div class="ph"><div class="ph-l"><h1>Configurações</h1><p>Tudo salva na hora.</p></div></div><div class="set-wrap" id="set-body"></div></div>` }

// ─── painel do cliente ───
function selectItem(id) {
  if (selId === id) { openDetailDrawer(); return }
  selId = id; swapN++
  document.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel'))
  const r = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`); if (r) r.classList.add('sel')
  closeMsg(); closeSnooze()
  renderDetail(); openDetailDrawer()
}
function openDetailDrawer() { if (window.innerWidth <= 1080) document.body.classList.add('d-open') }
function closeDetailDrawer() { document.body.classList.remove('d-open') }
function visibleList() {
  const t = todayStr()
  if (currentView === 'today') return vis().filter(f => f.date <= addDays(t, 7))
  if (currentView === 'cal') return vis().filter(f => f.date === (selectedDate || t))
  return vis()
}
function renderDetail() {
  const el = document.getElementById('detail'); if (!el) return
  if (['done', 'team', 'settings', 'clients'].includes(currentView)) { el.innerHTML = ''; return }
  let f = allData.find(x => x.id === selId)
  const rowsIn = document.querySelectorAll('#pane .row[data-id]').length
  const inPane = f && document.querySelector(`#pane .row[data-id="${CSS.escape(f.id)}"]`)
  // 1.3: NUNCA seleciona sozinho. Painel fica vazio até a pessoa clicar num cliente.
  if (!f || !vis().includes(f) || (rowsIn && !inPane)) { f = null; selId = null }
  // não perde o campo em que a pessoa está digitando
  const ae = document.activeElement, focusId = ae && el.contains(ae) ? ae.id : null, caret = focusId && ae.selectionStart
  el.innerHTML = f ? detailHtml(f) : `<div class="d-empty"><div class="d-empty-ic">👈</div><b>Nenhum cliente selecionado</b><span>Clique em um cliente da lista pra ver e editar.</span></div>`
  if (focusId) { const n = document.getElementById(focusId); if (n) { n.focus(); try { n.setSelectionRange(caret, caret) } catch (e) {} } }
}
function detailHtml(f) {
  const b = bizOf(f.biz), w = whenOf(f), p = prioOf(f), ro = false
  const people = b && b.kind === 'store' && isMgr(f.biz) ? peopleOf(f.biz) : []
  const own = f.owner === undefined ? null : peopleOf(f.biz).find(x => x.id === f.owner)
  const status = w.kind === 'late' ? `Atrasado · ${w.label}` : w.kind === 'today' ? `Retomar hoje · ${f.time || ''}` : `Agendado · ${shortDay(f.date)}`
  const hist = doneAll.filter(x => samePerson(f, x)).sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 5)
  const ppos = { alta: 0, media: 1, baixa: 2 }[p], pbg = { alta: 'rgba(255,107,107,.2)', media: 'rgba(250,204,21,.18)', baixa: '#2a2e2c' }[p]
  const halfN = bizFields(f.biz).filter(fd => fd.type !== 'choice').length
  let halfI = 0
  const fields = bizFields(f.biz).map(fd => {
    const v = f.fields ? f.fields[fd.id] : undefined
    const full = fd.type !== 'choice' && halfN % 2 === 1 && ++halfI === halfN
    if (fd.type === 'choice') return `<div class="full"><label>${esc(fd.label)}</label><div class="cf-opts">${fd.options.map(o => `<button type="button" class="cf-opt ${v === o ? 'on' : ''}" onclick="saveField('${esc(f.id)}','${fd.id}',${JSON.stringify(v === o ? '' : o).replace(/"/g, '&quot;')})">${esc(o)}</button>`).join('')}</div></div>`
    const shown = v === undefined || v === '' ? '' : (fd.type === 'money' ? Money.fmtMoney(v) : typeof v === 'number' ? String(v).replace('.', ',') : v)
    return `<div class="${full ? 'full' : ''}"><label for="d-cf-${fd.id}">${esc(fd.label)}</label><div class="edw"><input id="d-cf-${fd.id}" class="ed ${fd.type !== 'text' ? 'mono' : ''}" value="${esc(shown)}" ${fd.type !== 'text' ? 'inputmode="decimal"' : ''} placeholder="${fd.type === 'money' ? 'R$ 0,00' : '—'}" onchange="saveField('${esc(f.id)}','${fd.id}',this.value)" onkeydown="if(event.key==='Enter')this.blur()">${ICON.pen}</div></div>`
  }).join('')
  const opts = Money.snoozeOptions()
  return `<div class="d-wrap ${swapN % 2 ? 'inA' : 'inB'}">
    <div class="d-top"><span class="bd" style="--c:${b ? b.color : 'var(--green)'}"></span>${esc(b ? b.name : '')}${own ? ` · com ${esc(firstWord(own.name))}` : ''}<span class="sv" id="d-saved">${ICON.check}Salvo</span><button class="d-close" onclick="closeDetailDrawer()" aria-label="Fechar painel">${ICON.x}</button></div>
    <div class="d-name"><div class="edw"><input id="d-name" class="ed" aria-label="Nome do cliente" value="${esc(f.name)}" onchange="saveItem('${esc(f.id)}',{name:this.value})" onkeydown="if(event.key==='Enter')this.blur()">${ICON.pen}</div></div>
    <div class="d-phone"><div class="edw"><input id="d-phone" class="ed" aria-label="Telefone" value="${esc(fmtPhone(f.phone) || f.phone)}" inputmode="tel" onchange="saveItem('${esc(f.id)}',{phone:this.value})" onkeydown="if(event.key==='Enter')this.blur()">${ICON.pen}</div>
      <button class="ghost" onclick="copyPhone('${esc(f.phone)}')" title="Copiar número" aria-label="Copiar número">${ICON.copy}</button>
      <button class="wa d-wa" id="d-wa" onclick="wpp('${esc(f.phone)}','${esc(f.biz || '')}')" title="Abrir no WhatsApp" aria-label="Abrir no WhatsApp">${ICON.wa(21)}</button></div>
    ${feat('templates') ? `<button class="ghost d-msg msg" onclick="openMsg('${esc(f.id)}', this)">${ICON.msg}Mensagem pronta</button>` : ''}
    <div class="d-when ${w.kind}" style="--wc:${w.color}">
      <div class="dw-top"><span style="color:${w.color};display:flex">${ICON.clock}</span><b>${esc(status)}</b></div>
      <div class="dw-in"><input id="d-date" type="date" value="${esc(f.date)}" aria-label="Data" onchange="moveItem('${esc(f.id)}',this.value,null)"><input id="d-time" type="time" value="${esc(f.time || '')}" aria-label="Hora" onchange="saveItem('${esc(f.id)}',{time:this.value})"></div>
      <div class="dw-mv"><span>Remarcar:</span>${opts.map(o => `<button class="ghost" title="${esc(o.sub)}" onclick="moveItem('${esc(f.id)}','${o.date}','${esc(o.label.toLowerCase())}')">${esc(o.label)}</button>`).join('')}</div>
    </div>
    <div><div class="d-lbl">Prioridade</div><div class="seg2 dark" role="radiogroup" aria-label="Prioridade do cliente" style="display:inline-flex"><span class="pill" style="left:${3 + ppos * 92}px;width:88px;background-color:${pbg}"></span>${['alta', 'media', 'baixa'].map(k =>
      `<button class="${k === p ? 'on' : ''}" role="radio" aria-checked="${k === p}" style="width:88px;${k === p ? `color:var(--${k})` : ''}" onclick="saveItem('${esc(f.id)}',{prio:'${k}'})">${pbars(k)}${PRIO_LABEL[k]}</button>`).join('')}</div></div>
    <div class="d-grid">
      <div class="full"><label for="d-note">Assunto / anotação${feat('money') ? ' <span style="color:var(--text3)">· “R$ 2.500” ou “7,1 K” entram no valor</span>' : ''}</label><div class="edw"><input id="d-note" class="ed" value="${esc(f.note || '')}" placeholder="Orçamento, retorno…" onchange="saveItem('${esc(f.id)}',{note:this.value})" onkeydown="if(event.key==='Enter')this.blur()">${ICON.pen}</div></div>
      ${fields}
      ${people.length > 1 ? `<div class="full"><label for="d-owner">Responsável</label><select id="d-owner" onchange="saveItem('${esc(f.id)}',{owner:this.value==='none'?null:this.value})">${people.map(x => `<option value="${x.id}" ${f.owner === x.id || (f.owner === undefined && x.id === myId()) ? 'selected' : ''}>${esc(x.name)}${x.id === myId() ? ' (eu)' : ''}</option>`).join('')}<option value="none" ${f.owner === null ? 'selected' : ''}>Sem responsável</option></select></div>` : ''}
      ${multi() ? `<div class="full"><label for="d-biz">Negócio</label><select id="d-biz" onchange="saveItem('${esc(f.id)}',{biz:this.value})">${bizList().map(x => `<option value="${x.id}" ${x.id === f.biz ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    </div>
    ${feat('history') && hist.length ? `<div class="d-hist"><div class="d-lbl">Contatos anteriores</div>${hist.map(h => `<div class="hi"><i class="${h.outcome === 'won' ? 'won' : ''}"></i><div><small>${esc(dateLabel(Money.ymd(new Date(h.doneAt || h.date))))}${h.outcome === 'won' ? ' · fechou' : h.outcome === 'lost' ? ' · não fechou' : ''}</small><span>${esc(h.note || 'Retoma concluído')}</span></div></div>`).join('')}</div>` : ''}
    <button class="prim d-done" id="d-done" onclick="doneFx('${esc(f.id)}')">${ICON.check.replace(/14/g, '19')}Feito, falei com ${esc(firstWord(f.name) || 'ele')}</button>
  </div>`
}
function copyPhone(p) { try { navigator.clipboard.writeText(String(p).replace(/\D/g, '')); showHint('Número copiado') } catch (e) {} }
function flashSaved() { const s = document.getElementById('d-saved'); if (!s) return; s.classList.remove('on'); void s.offsetWidth; s.classList.add('on') }

// Salvar edições do painel (o main limpa números e valores e sobe pra nuvem)
async function saveItem(id, patch) {
  const f = allData.find(x => x.id === id); if (!f) return
  if ('name' in patch && !String(patch.name).trim()) { renderDetail(); return }
  if ('phone' in patch) { patch.phone = String(patch.phone).trim(); if (patch.phone.replace(/\D/g, '').length < 8) { showHint('⚠️ Número muito curto', '#e53935'); renderDetail(); return } }
  Object.assign(f, patch)
  await persist(); allData = await window.api.getData(); bumpN++
  renderRail(); renderPane()
  if ('prio' in patch || 'biz' in patch || 'owner' in patch) renderDetail()
  flashSaved()
}
async function saveField(id, fid, value) {
  const f = allData.find(x => x.id === id); if (!f) return
  f.fields = { ...(f.fields || {}) }
  if (value === '' || value === null) delete f.fields[fid]; else f.fields[fid] = value
  await persist(); allData = await window.api.getData(); bumpN++
  renderPane(); renderDetail(); flashSaved()
}
// Remarcar com efeito: a linha desce e reaparece no lugar novo com brilho
async function moveItem(id, date, label) {
  const f = allData.find(x => x.id === id); if (!f || !date) return
  const old = f.date
  if (old === date) return
  const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)
  if (row) { row.classList.add('moving'); await new Promise(r => setTimeout(r, 380)) }
  f.date = date
  if (label) f.snoozes = (f.snoozes || 0) + 1
  await persist(); allData = await window.api.getData(); bumpN++
  render()
  const nr = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`); if (nr) nr.classList.add('flash')
  showToast('Remarcado pra ' + Money.shortDate(date) + ':', f.name, async () => {
    const cur = await window.api.getData(); const it = cur.find(x => x.id === id)
    if (it) { it.date = old; if (label) it.snoozes = Math.max(0, (it.snoozes || 1) - 1); await window.api.setData(cur) }
  })
}
// ✓ com efeito: o círculo estoura, a linha brilha e sai, depois conclui de verdade
let doneBusy = false
async function doneFx(id) {
  if (doneBusy) return
  doneBusy = true
  const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)
  const chk = row && row.querySelector('.chk')
  const t = todayStr(), f = allData.find(x => x.id === id)
  const lastOfDay = f && f.date <= t && vis().filter(x => x.date <= t && x.id !== id).length === 0
  if (chk) { chk.classList.add('pop'); row.classList.add('popping') }
  const btn = document.getElementById('d-done'); if (btn && selId === id) btn.style.transform = 'scale(.97)'
  await new Promise(r => setTimeout(r, row ? 420 : 0))
  if (row) { row.classList.add('leaving'); await new Promise(r => setTimeout(r, 380)) }
  if (selId === id) { selId = null; swapN++ }
  doneBusy = false
  await done(id)
  if (lastOfDay) { const rb = document.getElementById('ringbox'); if (rb) { rb.classList.add('cele'); setTimeout(() => rb.classList.remove('cele'), 2200) } }
}

// ─── teclado ───
document.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const s = document.getElementById('search-input'); s.focus(); s.select(); return }
  if (e.key === 'Escape') {
    if (document.querySelector('.bz-menu')) closeBizMenu()
    else if (document.getElementById('dist-overlay').classList.contains('open')) closeDistribute()
    else if (document.getElementById('tpl-overlay').classList.contains('open')) closeTemplates()
    else if (document.getElementById('msg-pop').classList.contains('open')) closeMsg()
    else if (document.getElementById('snooze-pop').classList.contains('open')) closeSnooze()
    else if (document.getElementById('overlay').classList.contains('open')) closeModal()
    else if (typing) e.target.blur()
    else if (document.body.classList.contains('d-open')) closeDetailDrawer()
    else if (currentView !== 'today') nav('today')
    return
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return
  if (document.querySelector('.overlay.open, .dlg-ov.open, .auth-ov.open, .wiz.open, .gate.open, .tour.open')) return
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openModal() }
})
