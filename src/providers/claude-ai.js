const { fetchViaWindow } = require('../main/fetch-via-window');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret, setSecret } = require('../main/store');
const { clampPercent } = require('../shared/normalize');

function mapUsage(body) {
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
  return windows;
}

async function fetchWithSession(sessionKey) {
  const { session } = require('electron');
  await session.defaultSession.cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: sessionKey,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true,
  });
  const orgs = await fetchViaWindow('https://claude.ai/api/organizations');
  const orgId = orgs?.[0]?.uuid || orgs?.organizations?.[0]?.uuid;
  if (!orgId) throw new Error('Claude.ai org not found');
  const usage = await fetchViaWindow(`https://claude.ai/api/organizations/${orgId}/usage`);
  return {
    providerId: 'claude-ai',
    source: 'live',
    plan: null,
    windows: mapUsage(usage),
    fetchedAt: new Date().toISOString(),
  };
}

function createClaudeAiAdapter() {
  return {
    id: 'claude-ai',
    name: 'CLAUDE',
    authMethod: 'browser',
    async isAvailable() { return true; },
    async isAuthenticated() { return !!getSecret('claude-ai-session'); },
    async login() {
      await openAuthWindow({
        loginUrl: 'https://claude.ai/login',
        domain: '.claude.ai',
        cookieNames: ['sessionKey'],
        secretKey: 'claude-ai-session',
        title: 'Login to Claude.ai',
      });
    },
    async logout() { setSecret('claude-ai-session', ''); },
    async fetchUsage() {
      const sessionKey = getSecret('claude-ai-session');
      if (!sessionKey) throw new Error('Claude.ai login required');
      return fetchWithSession(sessionKey);
    },
    detectPlan(snap) {
      const wk = snap.windows.find((w) => w.key === 'seven_day');
      return wk && wk.utilization > 0 ? 'Pro/Max' : null;
    },
  };
}

module.exports = { createClaudeAiAdapter, mapUsage };