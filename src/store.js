const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// Pastas onde as versões antigas (Follow-up) guardavam os agendamentos.
// npm start usava "followup-construpac"; o instalador .exe usava "Follow-up Construpac".
const Core = require('./core.js')
const LEGACY_DIRS = ['followup-construpac', 'Follow-up Construpac']
const FILE = 'followup-data.json'

class Store {
  constructor() {
    this.path = path.join(app.getPath('userData'), FILE)
    this._migrateLegacy()
    this.data = this._load()
    this._dailyBackup()
  }

  // Backup diário: guarda uma cópia por dia em userData/backups (últimos 7 dias)
  _dailyBackup() {
    try {
      if (!fs.existsSync(this.path)) return
      const dir = path.join(path.dirname(this.path), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const d = new Date()
      const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      const target = path.join(dir, `followup-data-${stamp}.json`)
      if (!fs.existsSync(target)) fs.copyFileSync(this.path, target)
      const files = fs.readdirSync(dir).filter(f => /^followup-data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
      files.slice(0, Math.max(0, files.length - 7)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)) } catch (e) {} })
    } catch (e) {}
  }

  // Retomas que existiam nas cópias antigas e não estão mais nos ativos
  // (usado uma única vez para preencher a lista de Concluídos)
  legacyMissing(activeIds) {
    const out = []
    try {
      const appData = app.getPath('appData')
      const seen = new Set(activeIds)
      for (const dir of LEGACY_DIRS) {
        const p = path.join(appData, dir, FILE)
        if (!fs.existsSync(p) || path.resolve(p) === path.resolve(this.path)) continue
        try {
          const when = fs.statSync(p).mtime.toISOString()
          for (const f of (JSON.parse(fs.readFileSync(p, 'utf8')).followups || [])) {
            if (!f || !f.id || seen.has(f.id)) continue
            seen.add(f.id)
            out.push({ ...f, doneAt: when, recovered: true })
          }
        } catch (e) {}
      }
    } catch (e) {}
    return out
  }

  // Na primeira vez que o Retoma abre, COPIA (não move) os agendamentos antigos.
  // Se existir mais de uma pasta antiga, usa a que tiver mais agendamentos.
  _migrateLegacy() {
    try {
      if (fs.existsSync(this.path)) return
      const appData = app.getPath('appData')
      let best = null, bestCount = -1
      for (const dir of LEGACY_DIRS) {
        const p = path.join(appData, dir, FILE)
        if (!fs.existsSync(p) || path.resolve(p) === path.resolve(this.path)) continue
        try {
          const n = (JSON.parse(fs.readFileSync(p, 'utf8')).followups || []).length
          if (n > bestCount) { best = p; bestCount = n }
        } catch (e) {}
      }
      if (best) {
        fs.mkdirSync(path.dirname(this.path), { recursive: true })
        fs.copyFileSync(best, this.path)
      }
    } catch (e) {}
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf8'))
    } catch (e) {}
    return {}
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true })
      // grava num arquivo temporário e troca: se o PC desligar no meio, o arquivo bom continua
      const tmp = this.path + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.path)
    } catch (e) {
      try { fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8') } catch (e2) {}
    }
    if (this.onSave) { try { this.onSave() } catch (e) {} }
  }
  // cópia avulsa com nome (ex.: antes de trocar de conta)
  backup(label) {
    try {
      const dir = path.join(path.dirname(this.path), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `followup-data-${label}-${Date.now()}.json`), JSON.stringify(this.data, null, 2), 'utf8')
    } catch (e) {}
  }
  reload() { this.data = this._load() }

  // 0.7: garante o formato novo (negócios etc.). Antes da 1ª migração guarda
  // uma cópia intacta em backups/followup-data-antes-0.7.json.
  migrate() {
    try {
      if (this.data.schema !== Core.SCHEMA && fs.existsSync(this.path)) {
        const dir = path.join(path.dirname(this.path), 'backups')
        fs.mkdirSync(dir, { recursive: true })
        const target = path.join(dir, 'followup-data-antes-0.7.json')
        if (!fs.existsSync(target)) fs.copyFileSync(this.path, target)
      }
    } catch (e) {}
    if (Core.normalize(this.data)) this._save()
  }
  save() { this._save() }
  get(key, def) { return this.data[key] !== undefined ? this.data[key] : def }
  set(key, value) { this.data[key] = value; this._save() }
}

module.exports = Store
