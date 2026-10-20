const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hajimePasswort', {
    setzen: (passwort) => ipcRenderer.invoke('steuerung-passwort:setzen', passwort),
    spaeter: () => ipcRenderer.send('steuerung-passwort:spaeter')
});
