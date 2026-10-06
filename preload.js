const { contextBridge, ipcRenderer: ipc } = require('electron');
contextBridge.exposeInMainWorld('nx', {
  ai: o => ipc.invoke('ai', o), getKeys: () => ipc.invoke('keys:get'), setKeys: k => ipc.invoke('keys:set', k),
  stats: () => ipc.invoke('stats'), win: a => ipc.send('win', a)
});
