const Store = require('electron-store');
const { safeStorage } = require('electron');

const settings = new Store({
  defaults: {
    refreshIntervalMinutes: 5,
    theme: 'dark',
    launchAtStartup: false,
    floatingWidget: { enabled: false, pinnedProviders: [], autoRotate: false },
    alerts: { enabled: true, warnThreshold: 75, dangerThreshold: 90 },
    providers: {
      'claude-ai': { enabled: true },
      'claude-code': { enabled: true },
      gemini: { enabled: true },
      perplexity: { enabled: true },
      grok: { enabled: true },
      cursor: { enabled: true },
    },
  },
});

function setSecret(key, value) {
  if (!safeStorage.isEncryptionAvailable()) {
    settings.set(`secret_${key}`, value);
    return;
  }
  settings.set(`secret_${key}`, safeStorage.encryptString(value).toString('base64'));
}

function getSecret(key) {
  const raw = settings.get(`secret_${key}`);
  if (!raw) return null;
  if (!safeStorage.isEncryptionAvailable()) return raw;
  return safeStorage.decryptString(Buffer.from(raw, 'base64'));
}

function appendHistory(providerId, entry) {
  const key = `usageHistory_${providerId}`;
  const history = settings.get(key, []);
  history.push(entry);
  const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const trimmed = history.filter((e) => e.timestamp > cutoff).slice(-10000);
  settings.set(key, trimmed);
}

function getHistory(providerId) {
  return settings.get(`usageHistory_${providerId}`, []);
}

module.exports = { settings, setSecret, getSecret, appendHistory, getHistory };