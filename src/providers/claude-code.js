const fs = require('fs');
const https = require('https');
const { clampPercent } = require('../shared/normalize');
const { claudeCredentialsPath } = require('../shared/paths');

function inferPlan(body) {
  const tier = body.rate_limit_tier || body.subscriptionType || '';
  if (/max/i.test(tier)) return 'Max';
  if (/pro|default_claude_ai_pro/i.test(tier)) return 'Pro';
  if (/team/i.test(tier)) return 'Team';
  return null;
}

function mapClaudeCodeResponse(body) {
  const windows = [];
  if (body.five_hour) {
    windows.push({
      key: 'five_hour',
      label: '5H',
      utilization: clampPercent(body.five_hour.utilization),
      resetsAt: body.five_hour.resets_at,
    });
  }
  if (body.seven_day) {
    windows.push({
      key: 'seven_day',
      label: '7D',
      utilization: clampPercent(body.seven_day.utilization),
      resetsAt: body.seven_day.resets_at,
    });
  }
  return {
    providerId: 'claude-code',
    source: 'live',
    plan: inferPlan(body),
    windows,
    fetchedAt: new Date().toISOString(),
  };
}

function readAccessToken() {
  const p = claudeCredentialsPath();
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return data?.claudeAiOauth?.accessToken || null;
}

function fetchUsageApi(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Claude Code usage HTTP ${res.statusCode}`));
        resolve(mapClaudeCodeResponse(JSON.parse(raw)));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function createClaudeCodeAdapter() {
  return {
    id: 'claude-code',
    name: 'CODE',
    authMethod: 'local-oauth',
    async isAvailable() { return fs.existsSync(claudeCredentialsPath()); },
    async isAuthenticated() { return !!readAccessToken(); },
    async login() { throw new Error('Run `claude` CLI and authenticate'); },
    async logout() {},
    async fetchUsage() {
      const token = readAccessToken();
      if (!token) throw new Error('Claude Code not logged in');
      return fetchUsageApi(token);
    },
    detectPlan(snap) { return snap.plan; },
  };
}

module.exports = { createClaudeCodeAdapter, mapClaudeCodeResponse };