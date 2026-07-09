const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openISO:      ()       => ipcRenderer.invoke('dialog:openISO'),
  openInstallers: ()     => ipcRenderer.invoke('dialog:openInstallers'),
  saveISO:      (name)   => ipcRenderer.invoke('dialog:saveISO', name),
  checkDeps:    ()       => ipcRenderer.invoke('check:deps'),
  generateXML:  (cfg)    => ipcRenderer.invoke('xml:generate', cfg),
  saveXMLFile:  (cfg)    => ipcRenderer.invoke('xml:save', cfg),
  processISO:    (cfg)    => ipcRenderer.send('iso:process', cfg),
  onLog:         (cb)     => ipcRenderer.on('iso:log',  (_, d) => cb(d)),
  onDone:        (cb)     => ipcRenderer.on('iso:done', (_, d) => cb(d)),
  removeAll:     ()       => {
    ipcRenderer.removeAllListeners('iso:log')
    ipcRenderer.removeAllListeners('iso:done')
  },
  checkUnattend:  (path)   => ipcRenderer.invoke('iso:hasUnattend', path),
  openFolder:     (path)   => ipcRenderer.invoke('shell:openFolder', path),
  quitApp:        ()       => ipcRenderer.invoke('app:quit'),
  listUSB:        ()       => ipcRenderer.invoke('usb:list'),
  listUSBDisks:   ()       => ipcRenderer.invoke('usb:listDisks'),
  createBootable: (cfg)    => ipcRenderer.send('usb:createBootable', cfg),
  readUSBXML:     (mp)     => ipcRenderer.invoke('usb:readXML', mp),
  readDeviceXML:  (dev)    => ipcRenderer.invoke('usb:readXMLDevice', dev),
  mountUSB:       (dev)    => ipcRenderer.invoke('usb:mount', dev),
  listRootDir:    (mp)     => ipcRenderer.invoke('usb:listRoot', mp),
  injectXML:      (mp, x, inst) => ipcRenderer.invoke('usb:injectXML', mp, x, inst),
})
