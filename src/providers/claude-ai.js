const { fetchViaWindow } = require('../main/fetch-via-window');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret, setSecret, isProviderDisconnected, setProviderDisconnected } = require('../main/store');
const { getProviderSession, setCookies, flushCookies } = require('../main/provider-session');
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

async function ensureClaudeSession(sessionKey) {
  const ses = getProviderSession();
  const cookieName = getSecret('claude-ai-session-cookie-name') || 'sessionKey';
  await setCookies(ses, [
    {
      url: 'https://claude.ai',
      name: cookieName,
      value: sessionKey,
      domain: '.claude.ai',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    },
    {
      url: 'https://claude.ai',
      name: 'sessionKey',
      value: sessionKey,
      domain: '.claude.ai',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    },
  ]);
  await flushCookies(ses);
}

async function fetchWithSession(sessionKey) {
  await ensureClaudeSession(sessionKey);
  const orgs = await fetchViaWindow('https://claude.ai/api/organizations');
  const orgId = orgs?.[0]?.uuid || orgs?.organizations?.[0]?.uuid;
  if (!orgId) throw new Error('Claude.ai session expired — re-login required');
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
    async isAuthenticated() {
      if (isProviderDisconnected('claude-ai')) return false;
      return !!getSecret('claude-ai-session');
    },
    async login() {
      setProviderDisconnected('claude-ai', false);
      await openAuthWindow({
        loginUrl: 'https://claude.ai/login',
        domain: '.claude.ai',
        cookieNames: ['sessionKey', 'anthropic-session'],
        secretKey: 'claude-ai-session',
        title: 'Login to Claude.ai',
      });
    },
    async logout() {
      setSecret('claude-ai-session', '');
      setSecret('claude-ai-session-cookie-name', '');
      setProviderDisconnected('claude-ai', true);
    },
    async fetchUsage() {
      if (isProviderDisconnected('claude-ai')) throw new Error('Claude.ai disconnected');
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

module.exports = { createClaudeAiAdapter, mapUsage, ensureClaudeSession };