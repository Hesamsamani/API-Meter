const fs = require('fs');
const https = require('https');
const { grokAuthPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');

function readGrokAuth() {
  const p = grokAuthPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function grokGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'cli-chat-proxy.grok.com',
      path: `/v1${path}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        Accept: 'application/json',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Grok HTTP ${res.statusCode}`));
        resolve(JSON.parse(raw));
      });
    });
    req.on('error', reject);
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
    async isAuthenticated() { return !!readGrokAuth()?.access_token; },
    async login() { throw new Error('Run `grok login` in terminal'); },
    async logout() {},
    async fetchUsage() {
      const auth = readGrokAuth();
      const token = auth?.access_token;
      if (!token) throw new Error('Grok not logged in. Run `grok login`.');
      const [billing, settings] = await Promise.all([
        grokGet('/billing', token),
        grokGet('/settings', token),
      ]);
      return mapGrokBilling(billing, settings);
    },
    detectPlan(snap) { return snap.plan; },
  };
}

module.exports = { createGrokAdapter, mapGrokBilling };