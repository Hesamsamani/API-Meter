const { fetchViaWindow } = require('../main/fetch-via-window');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret, setSecret, isProviderDisconnected, setProviderDisconnected } = require('../main/store');
const {
  getProviderSession,
  setCookies,
  flushCookies,
  clearProviderCookies,
  findSessionCookies,
  cookieUrlsFor,
} = require('../main/provider-session');
const { clampPercent } = require('../shared/normalize');

const CLAUDE_DOMAIN = '.claude.ai';
const CLAUDE_LOGIN_URL = 'https://claude.ai/login';
const CLAUDE_ORIGIN = 'https://claude.ai/';
const CLAUDE_COOKIE_NAMES = ['sessionKey', 'anthropic-session'];

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

/**
 * Resolve organization UUID from claude.ai /api/organizations response shapes.
 * @param {unknown} orgs
 * @returns {string|null}
 */
function extractOrgId(orgs) {
  if (!orgs) return null;
  if (Array.isArray(orgs)) {
    const hit = orgs.find((o) => o && typeof o === 'object' && o.uuid);
    return hit?.uuid || null;
  }
  if (typeof orgs === 'object') {
    const list = orgs.organizations || orgs.data || orgs.items;
    if (Array.isArray(list)) {
      const hit = list.find((o) => o && typeof o === 'object' && o.uuid);
      if (hit?.uuid) return hit.uuid;
    }
    if (typeof orgs.uuid === 'string') return orgs.uuid;
  }
  return null;
}

function validateOrganizationsProbe(body) {
  if (extractOrgId(body)) return null;
  return 'No organization found — sessionKey cookie may be missing or expired';
}

async function ensureClaudeSession(storedValue) {
  const ses = getProviderSession();
  const sessionOpts = {
    loginUrl: CLAUDE_ORIGIN,
    domain: CLAUDE_DOMAIN,
    cookieNames: CLAUDE_COOKIE_NAMES,
  };

  const existing = await findSessionCookies(ses, {
    urls: cookieUrlsFor(sessionOpts),
    domain: CLAUDE_DOMAIN,
    names: CLAUDE_COOKIE_NAMES,
  });

  if (!existing.length && storedValue) {
    const cookieName = getSecret('claude-ai-session-cookie-name') || 'sessionKey';
    await setCookies(ses, [{
      name: cookieName,
      value: storedValue,
      domain: CLAUDE_DOMAIN,
      path: '/',
      secure: true,
      sameSite: 'lax',
    }], {
      loginUrl: CLAUDE_ORIGIN,
      domain: CLAUDE_DOMAIN,
      requiredNames: [cookieName],
    });
  }

  await flushCookies(ses);
}

async function fetchWithSession(sessionKey) {
  await ensureClaudeSession(sessionKey);
  const orgs = await fetchViaWindow('https://claude.ai/api/organizations');
  const orgId = extractOrgId(orgs);
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
        loginUrl: CLAUDE_LOGIN_URL,
        domain: CLAUDE_DOMAIN,
        cookieNames: CLAUDE_COOKIE_NAMES,
        secretKey: 'claude-ai-session',
        title: 'Login to Claude.ai',
        probeUrl: 'https://claude.ai/api/organizations',
        probeValidate: validateOrganizationsProbe,
      });
    },
    async logout() {
      setSecret('claude-ai-session', '');
      setSecret('claude-ai-session-cookie-name', '');
      await clearProviderCookies({
        domain: CLAUDE_DOMAIN,
        names: CLAUDE_COOKIE_NAMES,
      });
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

module.exports = {
  createClaudeAiAdapter,
  mapUsage,
  ensureClaudeSession,
  extractOrgId,
  validateOrganizationsProbe,
  CLAUDE_COOKIE_NAMES,
};