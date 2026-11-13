// ─── Núcleo de dados do Retoma (0.7) ────────────────────────────────────
// Funções puras sobre o objeto de dados (o mesmo JSON de sempre).
// Ficam separadas do Electron para poder testar e, no futuro, reaproveitar
// no servidor / celular.
//
// Formato (schema 2):
//   businesses: [{ id, name, color, phone, showInPill, archived, kind, createdAt, updatedAt }]
//   followups / done: cada item ganha  biz, createdAt, updatedAt
//   settings: { features, routine, system }   (o que fica ligado/desligado)
//   account:  { plan: 'free' }                (pronto pra cobrar no futuro)
const crypto = require('crypto')

const SCHEMA = 2
const COLORS = ['#1db954', '#a855f7', '#3b82f6', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#94a3b8']
const MAX_IN_PILL = 3
const MAX_FIELDS = 6
const FIELD_TYPES = ['text', 'number', 'money', 'choice']   // texto, número, valor (R$), lista

const DEFAULT_SETTINGS = {
  features: {
    money: true,      // dinheiro em jogo (valores lidos das anotações)
    score: true,      // placar "Fechou?"
    templates: true,  // mensagens prontas
    cooling: true,    // selo "esfriando" (adiado 3x)
    week: true,       // faixa da semana
    history: true,    // histórico do cliente no formulário
    brief: true,      // resumo da manhã
  },
  routine: {
    workSat: false,   // sábado conta como dia útil
    briefHour: 7,     // resumo da manhã a partir desta hora
    distPerDay: 5,    // padrão do "Distribuir atrasados"
  },
  system: {
    shortcut: true,   // Ctrl+Alt+R
    notifyTime: true, // notificação no horário do retoma
  },
  visual: {
    accent: '#1db954', // cor de destaque do app
  },
}
const ACCENTS = ['#1db954', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#06b6d4']

// Recursos que um plano pode liberar ou não (hoje o grátis libera tudo).
const PLANS = { free: { features: Object.keys(DEFAULT_SETTINGS.features), maxBusinesses: Infinity } }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
const nowIso = () => new Date().toISOString()

function cleanPhone(p) { return String(p || '').replace(/\D/g, '').slice(0, 15) }
function cleanColor(c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : COLORS[0] }

// Campos personalizados de um negócio (0.7.1): ex. "m³" (número), "Tipo de peça" (lista)
// { id, label, type, options[], onCard }   — no máximo 6, só 1 do tipo "valor"
function cleanFields(list) {
  if (!Array.isArray(list)) return []
  const out = [], labels = new Set()
  let hasMoney = false
  for (const raw of list.slice(0, MAX_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue
    const label = String(raw.label || '').trim().slice(0, 24)
    if (!label || labels.has(label.toLowerCase())) continue
    let type = FIELD_TYPES.includes(raw.type) ? raw.type : 'text'
    if (type === 'money') { if (hasMoney) type = 'number'; else hasMoney = true }
    const options = type === 'choice'
      ? [...new Set((Array.isArray(raw.options) ? raw.options : String(raw.options || '').split(','))
          .map(o => String(o).trim().slice(0, 30)).filter(Boolean))].slice(0, 12)
      : []
    labels.add(label.toLowerCase())
    out.push({ id: raw.id || uid(), label, type, options, onCard: raw.onCard !== false, off: raw.off === true })
  }
  return out
}

// Limpa os valores de um retoma conforme os campos do negócio.
// Campo "valor" vira f.value (número) — é o que o dinheiro em jogo usa.
function applyFieldValues(f, business) {
  const fields = (business && business.fields) || []
  const src = f.fields && typeof f.fields === 'object' ? f.fields : {}
  const out = {}
  for (const fd of fields) {
    let v = src[fd.id]
    if (v === undefined || v === null || v === '') continue
    if (fd.type === 'number' || fd.type === 'money') {
      const n = typeof v === 'number' ? v : parseNumberBR(v)
      if (!Number.isFinite(n)) continue
      v = n
    } else if (fd.type === 'choice') {
      v = String(v).trim().slice(0, 30)   // opção que saiu da lista continua guardada
    } else v = String(v).trim().slice(0, 120)
    if (v === '') continue
    out[fd.id] = v
  }
  // valores de campos que não existem mais ficam guardados (não perde nada se recriar)
  for (const k of Object.keys(src)) if (!(k in out) && !fields.some(fd => fd.id === k)) out[k] = src[k]
  const res = { ...f }
  if (Object.keys(out).length) res.fields = out; else delete res.fields
  const money = fields.find(fd => fd.type === 'money' && !fd.off)
  if (money && typeof out[money.id] === 'number' && out[money.id] > 0) res.value = out[money.id]
  else delete res.value
  return res
}
// "7,5" → 7.5 · "2.500" → 2500 · "R$ 2.500,50" → 2500.5 · "3k" → 3000
function parseNumberBR(v) {
  let t = String(v).toLowerCase().replace(/r\$|\s/g, '')
  let mult = 1
  if (/(k|mil)$/.test(t)) { mult = 1000; t = t.replace(/(k|mil)$/, '') }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) && t !== '' ? Math.round(n * mult * 100) / 100 : NaN
}

function makeBusiness(o = {}, i = 0) {
  const t = nowIso()
  return {
    id: o.id || uid(),
    name: String(o.name || 'Meu negócio').trim().slice(0, 30) || 'Meu negócio',
    color: o.color ? cleanColor(o.color) : COLORS[i % COLORS.length],
    phone: cleanPhone(o.phone),
    showInPill: o.showInPill !== false,
    archived: !!o.archived,
    kind: o.kind === 'store' ? 'store' : 'personal',   // espaço pessoal ou de loja (equipes na 0.9)
    fields: cleanFields(o.fields),
    createdAt: o.createdAt || t,
    updatedAt: o.updatedAt || t,
    // marcas da sincronização (só locais)
    ...(o._s ? { _s: o._s } : {}), ...(o._remote ? { _remote: true } : {}), ...(o._auto ? { _auto: true } : {}),
  }
}

// Data de criação a partir do id antigo (Date.now().toString())
function createdFromId(id) {
  const n = Number(id)
  return Number.isFinite(n) && n > 1e12 && n < 4e12 ? new Date(n).toISOString() : null
}

// Garante o formato schema 2. Idempotente: pode rodar em toda abertura
// (e corrige itens gravados por uma versão antiga sem "biz").
// Retorna true se mudou alguma coisa.
function normalize(data) {
  let changed = false
  const t = nowIso()
  if (!Array.isArray(data.businesses) || !data.businesses.length) {
    const hasData = (data.followups || []).length || (data.done || []).length
    // Quem já usava (0.6.1): tudo que existe vira "Construpac".
    // Instalação nova: "Meu negócio" provisório (o assistente de boas-vindas renomeia).
    data.businesses = [hasData
      ? makeBusiness({ name: 'Construpac', color: COLORS[0], kind: 'store' })
      : makeBusiness({ name: 'Meu negócio', color: COLORS[0], _auto: true })]
    changed = true
  }
  data.businesses = data.businesses.map((b, i) => makeBusiness(b, i))
  const ids = new Set(data.businesses.map(b => b.id))
  const fallback = (data.businesses.find(b => !b.archived) || data.businesses[0]).id
  for (const key of ['followups', 'done']) {
    if (!Array.isArray(data[key])) { if (key === 'followups') { data[key] = []; changed = true } continue }
    for (const f of data[key]) {
      if (!f || typeof f !== 'object') continue
      if (!f.biz || !ids.has(f.biz)) { f.biz = fallback; changed = true }
      if (!f.createdAt) { f.createdAt = createdFromId(f.id) || t; changed = true }
      if (!f.updatedAt) { f.updatedAt = f.createdAt; changed = true }
    }
  }
  if (!data.account) { data.account = { plan: 'free' }; changed = true }
  if (data.schema !== SCHEMA) { data.schema = SCHEMA; changed = true }
  return changed
}

function getSettings(data) {
  const s = data.settings || {}
  return {
    features: { ...DEFAULT_SETTINGS.features, ...(s.features || {}) },
    routine:  { ...DEFAULT_SETTINGS.routine,  ...(s.routine  || {}) },
    system:   { ...DEFAULT_SETTINGS.system,   ...(s.system   || {}) },
    visual:   { ...DEFAULT_SETTINGS.visual,   ...(s.visual   || {}) },
  }
}

// Só aceita chaves conhecidas, com o tipo certo
function patchSettings(data, patch = {}) {
  const cur = getSettings(data)
  for (const group of ['features', 'routine', 'system', 'visual']) {
    const p = patch[group]; if (!p || typeof p !== 'object') continue
    for (const k of Object.keys(DEFAULT_SETTINGS[group])) {
      if (!(k in p)) continue
      const def = DEFAULT_SETTINGS[group][k]
      if (k === 'accent') { if (ACCENTS.includes(String(p[k]).toLowerCase())) cur[group][k] = String(p[k]).toLowerCase() }
      else if (typeof def === 'boolean') cur[group][k] = !!p[k]
      else if (typeof def === 'number') {
        const n = Number(p[k])
        if (Number.isFinite(n)) cur[group][k] = k === 'briefHour' ? Math.min(12, Math.max(5, Math.round(n))) : Math.min(12, Math.max(1, Math.round(n)))
      }
    }
  }
  data.settings = cur
  return cur
}

// Recurso ligado = o plano libera E a pessoa não desligou
function featureOn(data, key) {
  const plan = PLANS[(data.account && data.account.plan) || 'free'] || PLANS.free
  return plan.features.includes(key) && getSettings(data).features[key] !== false
}
function effectiveFeatures(data) {
  const out = {}
  for (const k of Object.keys(DEFAULT_SETTINGS.features)) out[k] = featureOn(data, k)
  return out
}

// Salvar a lista de negócios vinda da tela de Configurações.
// Regras: pelo menos 1 ativo; arquivar só sem retomas ativos; até 3 na pílula.
function saveBusinesses(data, list) {
  if (!Array.isArray(list)) return { ok: false, msg: 'Lista inválida' }
  const old = new Map((data.businesses || []).map(b => [b.id, b]))
  const active = data.followups || []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] || {}
    const prev = old.get(raw.id)
    if (Array.isArray(raw.fields)) {
      const ls = raw.fields.map(f => String((f && f.label) || '').trim().toLowerCase())
      if (ls.some(l => !l)) return { ok: false, msg: 'Campo sem nome.' }
      if (new Set(ls).size !== ls.length) return { ok: false, msg: 'Já existe um campo com esse nome.' }
      if (raw.fields.length > MAX_FIELDS) return { ok: false, msg: `Máximo de ${MAX_FIELDS} campos por negócio.` }
    }
    const b = makeBusiness({ ...(prev || {}), ...raw, id: prev ? prev.id : undefined, createdAt: prev && prev.createdAt }, i)
    if (b.archived && !(prev && prev.archived)) {
      const n = active.filter(f => f.biz === b.id).length
      if (n) return { ok: false, msg: `${b.name} ainda tem ${n} retoma${n > 1 ? 's' : ''}. Conclua ou mude de negócio antes de arquivar.` }
    }
    if (b.archived) b.showInPill = false
    if (prev && prev._auto && (b.name !== prev.name || b.fields.length || b.phone)) delete b._auto
    const same = prev && ['name', 'color', 'phone', 'showInPill', 'archived', 'kind'].every(k => prev[k] === b[k]) && JSON.stringify(prev.fields || []) === JSON.stringify(b.fields)
    b.updatedAt = same ? prev.updatedAt : nowIso()
    out.push(b)
  }
  // Negócio que sumiu da lista: não apaga, arquiva (só se não tiver retomas)
  for (const [id, prev] of old) {
    if (out.some(b => b.id === id)) continue
    if (active.some(f => f.biz === id)) return { ok: false, msg: `${prev.name} ainda tem retomas.` }
    out.push({ ...prev, archived: true, showInPill: false, updatedAt: nowIso() })
  }
  if (!out.some(b => !b.archived)) return { ok: false, msg: 'Precisa ter pelo menos um negócio ativo.' }
  if (out.filter(b => !b.archived && b.showInPill).length > MAX_IN_PILL) return { ok: false, msg: `A pílula mostra no máximo ${MAX_IN_PILL} negócios.` }
  const names = out.filter(b => !b.archived).map(b => b.name.toLowerCase())
  if (new Set(names).size !== names.length) return { ok: false, msg: 'Já existe um negócio com esse nome.' }
  data.businesses = out
  // campos mudaram → recalcula os valores guardados (ex. campo "Valor" removido)
  const byId = new Map(out.map(b => [b.id, b]))
  for (const key of ['followups', 'done']) if (Array.isArray(data[key])) data[key] = data[key].map(f => f && f.biz ? applyFieldValues(f, byId.get(f.biz)) : f)
  return { ok: true, businesses: out }
}

// Marca updatedAt nos retomas que mudaram (comparando com a lista anterior)
// e garante biz/createdAt nos novos.
function stampChanges(prevList, nextList, data) {
  const prev = new Map((prevList || []).map(f => [f.id, f]))
  const ids = new Set((data.businesses || []).map(b => b.id))
  const fallback = ((data.businesses || []).find(b => !b.archived) || {}).id
  const t = nowIso()
  const strip = f => { const { updatedAt, ...r } = f; return JSON.stringify(r) }
  const bizById = new Map((data.businesses || []).map(b => [b.id, b]))
  return (nextList || []).filter(f => f && typeof f === 'object' && f.id).map(f => {
    let n = { ...f }
    if (!n.biz || !ids.has(n.biz)) n.biz = fallback
    n = applyFieldValues(n, bizById.get(n.biz))
    if (!n.createdAt) n.createdAt = createdFromId(n.id) || t
    const p = prev.get(n.id)
    if (!p || strip(p) !== strip(n)) n.updatedAt = t
    else n.updatedAt = p.updatedAt || t
    return n
  })
}

module.exports = {
  SCHEMA, COLORS, ACCENTS, MAX_IN_PILL, MAX_FIELDS, FIELD_TYPES, cleanFields, applyFieldValues, parseNumberBR, DEFAULT_SETTINGS, PLANS,
  uid, normalize, getSettings, patchSettings, featureOn, effectiveFeatures,
  saveBusinesses, stampChanges, makeBusiness, cleanPhone,
}
