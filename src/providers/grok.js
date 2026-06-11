const fs = require('fs');
const https = require('https');
const { grokAuthPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');
const { isProviderDisconnected, setProviderDisconnected } = require('../main/store');

function readGrokAuth() {
  const p = grokAuthPath();
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (data?.access_token) return data;
  const entry = Object.values(data).find(
    (v) => v && typeof v === 'object' && (v.access_token || v.key),
  );
  if (!entry) return null;
  return { ...entry, access_token: entry.access_token || entry.key };
}

function isGrokTokenExpired(auth) {
  if (!auth?.expires_at && !auth?.expiresAt) return false;
  const expires = Number(auth.expires_at || auth.expiresAt);
  if (!Number.isFinite(expires)) return false;
  const ms = expires > 1e12 ? expires : expires * 1000;
  return Date.now() >= ms;
}

function formatGrokHttpError(statusCode, raw = '') {
  let detail = '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.message) {
        detail = String(parsed.message);
      } else {
        detail = raw.slice(0, 200);
      }
    } catch {
      detail = raw.slice(0, 200);
    }
  }
  return detail
    ? `Grok HTTP ${statusCode}: ${detail}`
    : `Grok HTTP ${statusCode}`;
}

function grokGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'cli-chat-proxy.grok.com',
      path: `/v1${path}`,
      method: 'GET',
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        Accept: 'application/json',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode === 401) {
          return reject(new Error('Grok session expired — run `grok login` in terminal'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(formatGrokHttpError(res.statusCode, raw)));
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Grok returned invalid JSON'));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Grok request timed out — check network connection'));
    });
    req.on('error', (err) => {
      const msg = err.message || String(err);
      if (/hang up|ECONNRESET|ETIMEDOUT/i.test(msg)) {
        reject(new Error('Grok network error — check connection and retry'));
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

function mapGrokBilling(billing, settings) {
  const cfg = billing?.config || {};
  const used = Number(cfg.used?.val || 0);
  const limit = Number(cfg.monthlyLimit?.val || 1);
  const pct = clampPercent((used / limit) * 100);
  return {
    providerId: 'grok',
    source: 'live',
    plan: settings?.subscription_tier_display || 'SuperGrok',
    windows: [{
      key: 'credits',
      label: 'CRD',
      utilization: pct,
      resetsAt: cfg.billingPeriodEnd,
    }],
    fetchedAt: new Date().toISOString(),
  };
}

function createGrokAdapter() {
  return {
    id: 'grok',
    name: 'GROK',
    authMethod: 'local-oauth',
    async isAvailable() { return fs.existsSync(grokAuthPath()); },
    async isAuthenticated() {
      if (isProviderDisconnected('grok')) return false;
      const auth = readGrokAuth();
      return !!auth?.access_token && !isGrokTokenExpired(auth);
    },
    async login() {
      setProviderDisconnected('grok', false);
      throw new Error('Run `grok login` in terminal');
    },
    async logout() {
      setProviderDisconnected('grok', true);
    },
    async fetchUsage() {
      if (isProviderDisconnected('grok')) throw new Error('Grok disconnected');
      const auth = readGrokAuth();
      const token = auth?.access_token;
      if (!token) throw new Error('Grok not logged in. Run `grok login`.');
      if (isGrokTokenExpired(auth)) {
        throw new Error('Grok session expired — run `grok login` in terminal');
      }
      const [billing, settings] = await Promise.all([
        grokGet('/billing', token),
        grokGet('/settings', token),
      ]);
      return mapGrokBilling(billing, settings);
    },
    detectPlan(snap) { return snap.plan; },
  };
}

module.exports = {
  createGrokAdapter,
  mapGrokBilling,
  readGrokAuth,
  isGrokTokenExpired,
  formatGrokHttpError,
};