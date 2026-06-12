const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiMeter', {
  providerLogoUrl: (providerId) => ipcRenderer.invoke('asset:providerLogo', providerId),
  isReady: () => ipcRenderer.invoke('app:ping'),
  getUsage: () => ipcRenderer.invoke('usage:getAll'),
  getHistory: (providerId) => ipcRenderer.invoke('usage:getHistory', providerId),
  refreshAll: () => ipcRenderer.invoke('usage:refreshAll'),
  refreshProvider: (id) => ipcRenderer.invoke('usage:refreshProvider', id),
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
  fitWidgetWindow: (providerCount, orbSlots) => ipcRenderer.invoke('widget:fitWindow', providerCount, orbSlots),
  resizeWidget: (direction, providerCount) => ipcRenderer.invoke('widget:resize', direction, providerCount),
  cycleWidgetTheme: () => ipcRenderer.invoke('widget:cycleTheme'),
  cycleWidgetDisplayMode: (providerCount) => ipcRenderer.invoke('widget:cycleDisplayMode', providerCount),
  setWidgetClickThrough: (enabled) => ipcRenderer.invoke('widget:setClickThrough', enabled),
  cancelAuthPrompt: () => ipcRenderer.invoke('auth-prompt:cancel'),
  retryAuthPrompt: () => ipcRenderer.invoke('auth-prompt:retry'),
  submitAuthPrompt: (value) => ipcRenderer.invoke('auth-prompt:submit', value),
  setAuthTab: (tab) => ipcRenderer.invoke('auth-prompt:set-tab', tab),
  readClipboardCookies: () => ipcRenderer.invoke('auth-prompt:read-clipboard'),
  onAuthPromptInit: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('auth-prompt:init', listener);
    return () => ipcRenderer.removeListener('auth-prompt:init', listener);
  },
  onAuthPromptStatus: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('auth-prompt:status', listener);
    return () => ipcRenderer.removeListener('auth-prompt:status', listener);
  },
  onAuthPromptClipboard: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('auth-prompt:clipboard', listener);
    return () => ipcRenderer.removeListener('auth-prompt:clipboard', listener);
  },
});