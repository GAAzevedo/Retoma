// ─── Valores e datas — compartilhado entre app principal e flutuante ─────
// Lê o valor do negócio que já é escrito na anotação: "7,1 K", ">15k",
// "R$ 2.500", "3 mil", "Cobrar 3k", "6.14 k". Telefones e números soltos
// são ignorados (só conta com k / mil / R$).
;(function (g) {
  function toNum(raw) {
    let s = String(raw).trim()
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 2.500,00
    else s = s.replace(',', '.')                                                          // 7,1 / 6.14
    const n = parseFloat(s)
    return isFinite(n) ? n : null
  }

  function parseValue(note) {
    if (!note) return null
    const t = String(note)
    let m = t.match(/(\d+(?:[.,]\d+)?)\s*(k|mil)\b/i)
    if (m) { const n = toNum(m[1]); return n != null ? Math.round(n * 1000) : null }
    m = t.match(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/i)
    if (m) { const n = toNum(m[1]); return n != null ? Math.round(n) : null }
    return null
  }

  // R$ 7,1 mil · R$ 182 mil · R$ 1,2 mi · R$ 850
  function fmtMoney(n) {
    if (!n) return 'R$ 0'
    if (n >= 1e6) return 'R$ ' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + ' mi'
    if (n >= 1000) {
      const k = n / 1000
      return 'R$ ' + (k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10)).toString().replace('.', ',') + ' mil'
    }
    return 'R$ ' + n
  }

  // valor do retoma: primeiro a anotação, depois o nome ("Bruno >2K")
  // 0.7.1: se o negócio tem campo "Valor (R$)" preenchido, ele manda; senão lê a anotação/nome
  function valueOf(f) { return f ? ((typeof f.value === 'number' && f.value > 0 ? f.value : null) || parseValue(f.note) || parseValue(f.name) || null) : null }
  function sumValues(list) { return list.reduce((s, f) => s + (valueOf(f) || 0), 0) }

  // ─── Datas (sempre horário local) ─────────────────────────────────────
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

  // ─── Dias úteis ───────────────────────────────────────────────────────
  // Sábado conta como dia útil? (Configurações → Rotina)
  let workSat = false
  function configure(o = {}) { if ('workSat' in o) workSat = !!o.workSat }
  const isWeekend = d => d.getDay() === 0 || (d.getDay() === 6 && !workSat)
  function addBusinessDays(from, n) {
    const d = new Date(from); d.setHours(12, 0, 0, 0)
    let left = n
    while (left > 0) { d.setDate(d.getDate() + 1); if (!isWeekend(d)) left-- }
    return d
  }
  function nextMonday(from) { const d = new Date(from); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d }

  // Opções do "Adiar" — sempre 3, sempre em dia útil:
  // Amanhã (sexta/sábado/domingo → segunda) · +2 dias úteis · Próx. semana
  function snoozeOptions(now = new Date()) {
    const lbl = d => `${DIAS[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`
    const tom = addBusinessDays(now, 1)
    const two = addBusinessDays(now, 2)
    let wk = nextMonday(now)
    if (ymd(wk) === ymd(tom) || ymd(wk) === ymd(two)) { wk = new Date(now); wk.setDate(wk.getDate() + 7); while (isWeekend(wk)) wk.setDate(wk.getDate() + 1) }
    return [
      { key: 'tom', label: 'Amanhã',          sub: lbl(tom), date: ymd(tom) },
      { key: 'two', label: '+2 dias úteis',   sub: lbl(two), date: ymd(two) },
      { key: 'wk',  label: 'Próx. semana',    sub: lbl(wk),  date: ymd(wk) },
    ]
  }

  // Próximos N dias úteis a partir de hoje (hoje entra se for dia útil)
  function businessDays(n, from = new Date()) {
    const out = []; const d = new Date(from); d.setHours(12, 0, 0, 0)
    while (isWeekend(d)) d.setDate(d.getDate() + 1)
    while (out.length < n) { if (!isWeekend(d)) out.push(ymd(d)); d.setDate(d.getDate() + 1) }
    return out
  }

  // Distribuir atrasados: prioridade alta primeiro, depois maior valor.
  // Respeita o que já está marcado em cada dia (perDay = máximo por dia).
  function planDistribution(all, { perDay = 5, startToday = true, now = new Date() } = {}) {
    const today = ymd(now)
    const late = all.filter(f => f.date < today)
    const order = { alta: 0, media: 1, baixa: 2 }
    late.sort((a, b) => (order[a.prio || 'media'] - order[b.prio || 'media']) || ((valueOf(b) || 0) - (valueOf(a) || 0)))
    const start = startToday && !isWeekend(now) ? now : addBusinessDays(now, 1)
    const days = businessDays(60, start)
    const load = {}
    all.forEach(f => { if (f.date >= today) load[f.date] = (load[f.date] || 0) + 1 })
    const plan = []
    let i = 0
    for (const f of late) {
      while (i < days.length && (load[days[i]] || 0) >= perDay) i++
      const day = days[Math.min(i, days.length - 1)]
      load[day] = (load[day] || 0) + 1
      plan.push({ id: f.id, name: f.name, prio: f.prio || 'media', value: valueOf(f), from: f.date, to: day })
    }
    return plan
  }

  function shortDate(ds) {
    const [y, m, d] = ds.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    return `${DIAS[dt.getDay()]}, ${d} ${MESES[m - 1]}`
  }

  g.Money = { configure, parseValue, valueOf, fmtMoney, sumValues, snoozeOptions, shortDate, ymd, businessDays, planDistribution, addBusinessDays }
})(typeof window !== 'undefined' ? window : globalThis)
