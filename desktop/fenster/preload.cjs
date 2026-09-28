// Brücke Start-Fenster <-> Main-Prozess (contextIsolation).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hajime', {
    onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
    onKopplungNoetig: (cb) => ipcRenderer.on('kopplung-noetig', (_e, grund) => cb(grund)),
    koppeln: (code) => ipcRenderer.invoke('koppeln', code)
});
