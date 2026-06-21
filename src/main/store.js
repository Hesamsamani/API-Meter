const Store = require('electron-store');
const { safeStorage } = require('electron');

const settings = new Store({
  defaults: {
    refreshIntervalMinutes: 5,
    autoRefreshEnabled: true,
    usageDisplayMode: 'used',
    theme: 'dark',
    launchAtStartup: false,
    floatingWidget: {
      enabled: false,
      pinnedProviders: [],
      autoRotate: false,
      displayMode: 'single',
      size: 'medium',
      theme: 'dark',
      opacity: 0.92,
      clickThrough: false,
      layerOrder: 'always-on-top',
      desktopPinAvailable: null,
      position: null,
    },
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

const SECRET_KEY_PATTERN = /^secret_/;
const SECRET_META_KEY_PATTERN = /^secret_meta_/;

function isSecretSettingsKey(key) {
  return SECRET_KEY_PATTERN.test(key) || SECRET_META_KEY_PATTERN.test(key);
}

function redactSettingsForRenderer(storeObject = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(storeObject)) {
    if (isSecretSettingsKey(key)) continue;
    redacted[key] = value;
  }
  return redacted;
}

function secretMetaKey(key) {
  return `secret_meta_${key}`;
}

function setSecret(key, value) {
  if (!value) {
    settings.delete(`secret_${key}`);
    settings.delete(secretMetaKey(key));
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available; refusing to persist secret');
  }
  settings.set(`secret_${key}`, safeStorage.encryptString(String(value)).toString('base64'));
  settings.set(secretMetaKey(key), 'enc');
}

function getSecret(key) {
  const raw = settings.get(`secret_${key}`);
  if (!raw) return null;
  if (!safeStorage.isEncryptionAvailable()) return String(raw);

  const meta = settings.get(secretMetaKey(key), 'enc');
  if (meta === 'plain') {
    setSecret(key, String(raw));
    return String(raw);
  }

  try {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return String(raw);
  }
}

function setProviderDisconnected(providerId, disconnected) {
  const providers = settings.get('providers') || {};
  providers[providerId] = { ...(providers[providerId] || {}), disconnected: !!disconnected };
  settings.set('providers', providers);
}

function isProviderDisconnected(providerId) {
  return settings.get('providers')?.[providerId]?.disconnected === true;
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

module.exports = {
  settings,
  isSecretSettingsKey,
  redactSettingsForRenderer,
  setSecret,
  getSecret,
  setProviderDisconnected,
  isProviderDisconnected,
  appendHistory,
  getHistory,
};