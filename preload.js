const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

function resolveProviderLogoPath(providerId) {
  const fileName = `${providerId}.png`;
  const candidates = [
    path.join(__dirname, 'src', 'renderer', 'assets', 'providers', fileName),
    path.join(__dirname, 'assets', 'providers', fileName),
    path.join(process.resourcesPath, 'assets', 'providers', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

contextBridge.exposeInMainWorld('apiMeter', {
  providerLogoUrl: (providerId) => pathToFileURL(resolveProviderLogoPath(providerId)).href,
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
  cancelAuthPrompt: () => ipcRenderer.invoke('auth-prompt:cancel'),
  retryAuthPrompt: () => ipcRenderer.invoke('auth-prompt:retry'),
  submitAuthPrompt: (value) => ipcRenderer.invoke('auth-prompt:submit', value),
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
});