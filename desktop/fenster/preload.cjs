// Brücke Start-Fenster <-> Main-Prozess (contextIsolation).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hajime', {
    onStatus: (cb) => ipcRenderer.on('status', (_e, text, anteil) => cb(text, anteil)),
    onKopplungNoetig: (cb) => ipcRenderer.on('kopplung-noetig', (_e, grund) => cb(grund)),
    koppeln: (code) => ipcRenderer.invoke('koppeln', code),
    serverAdresse: (eingabe) => ipcRenderer.invoke('server-adresse', eingabe)
});
