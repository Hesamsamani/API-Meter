const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiMeter', {
  getUsage: () => ipcRenderer.invoke('usage:getAll'),
  getHistory: (providerId) => ipcRenderer.invoke('usage:getHistory', providerId),
  refreshAll: () => ipcRenderer.invoke('usage:refreshAll'),
  loginProvider: (id) => ipcRenderer.invoke('provider:login', id),
  logoutProvider: (id) => ipcRenderer.invoke('provider:logout', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  openSettings: () => ipcRenderer.invoke('app:showSettings'),
  onUsageUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('usage:updated', listener);
    return () => ipcRenderer.removeListener('usage:updated', listener);
  },
  onSettingsUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('settings:updated', listener);
    return () => ipcRenderer.removeListener('settings:updated', listener);
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  showDashboard: () => ipcRenderer.invoke('app:showDashboard'),
  toggleFloatingWidget: () => ipcRenderer.invoke('app:toggleWidget'),
});