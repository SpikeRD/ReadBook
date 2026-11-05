// 预加载：只暴露启动器需要的几个方法给界面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  pickDataDir: () => ipcRenderer.invoke('data:pick'),
  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  getState: () => ipcRenderer.invoke('server:state'),
  openSite: (url) => ipcRenderer.invoke('app:openSite', url),
  openDataDir: (dir) => ipcRenderer.invoke('app:openDataDir', dir),
  copy: (text) => ipcRenderer.invoke('app:copy', text),
  onState: (cb) => ipcRenderer.on('server:state', (_e, state) => cb(state)),
});
