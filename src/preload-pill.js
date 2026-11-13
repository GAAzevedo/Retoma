const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  toCard:   ()       => ipcRenderer.send('to-card'),
  dragStart: ()      => ipcRenderer.send('pill-drag-start'),
  dragEnd:  ()       => ipcRenderer.send('pill-drag-end'),
  menu:     ()       => ipcRenderer.send('pill-menu'),
  onUpdate: (cb)     => ipcRenderer.on('compact-update', (_, d) => cb(d)),
})
