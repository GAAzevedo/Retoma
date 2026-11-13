// "electron" falso pra testar módulos do processo principal em Node puro
const os = require('os'), path = require('path'), fs = require('fs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retoma-test-'))
module.exports = {
  app: { getPath: () => dir, getVersion: () => '1.0.0', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { opened: [], openExternal(u) { this.opened.push(u); return Promise.resolve() } },
}
