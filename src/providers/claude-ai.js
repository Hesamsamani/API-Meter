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
  if (body.seven_day_sonnet) {
    windows.push({
      key: 'seven_day_sonnet',
      label: 'SONNET',
      utilization: clampPercent(body.seven_day_sonnet.utilization),
      resetsAt: body.seven_day_sonnet.resets_at,
    });
  }
  if (body.seven_day_opus) {
    windows.push({
      key: 'seven_day_opus',
      label: 'OPUS',
      utilization: clampPercent(body.seven_day_opus.utilization),
      resetsAt: body.seven_day_opus.resets_at,
    });
  }
  return windows;
}

function firstOrgRecord(orgs) {
  if (!orgs) return null;
  if (Array.isArray(orgs)) return orgs.find((o) => o && typeof o === 'object') || null;
  if (typeof orgs === 'object') {
    const list = orgs.organizations || orgs.data || orgs.items;
    if (Array.isArray(list)) return list.find((o) => o && typeof o === 'object') || null;
    return orgs;
  }
  return null;
}

function inferClaudePlan(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const tier = source.rate_limit_tier
      || source.subscriptionType
      || source.subscription_type
      || source.account_type
      || source.plan_type
      || source.membership
      || source.plan
      || source.tier
      || '';
    const t = String(tier).toLowerCase();
    if (/enterprise/i.test(t)) return 'Enterprise';
    if (/max/i.test(t)) return 'Max';
    if (/team/i.test(t)) return 'Team';
    if (/pro|default_claude_ai_pro/i.test(t)) return 'Pro';
    if (/free/i.test(t)) return 'Free';
  }
  return null;
}

function inferClaudePlanFromWindows(windows = []) {
  const keys = new Set(windows.map((w) => w.key));
  if (keys.has('seven_day') || keys.has('seven_day_sonnet') || keys.has('seven_day_opus')) {
    return 'Pro';
  }
  if (keys.has('five_hour')) return 'Free';
  return null;
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
  const orgRecord = firstOrgRecord(orgs);
  const usage = await fetchViaWindow(`https://claude.ai/api/organizations/${orgId}/usage`);
  let account = null;
  try {
    account = await fetchViaWindow('https://claude.ai/api/account');
  } catch {
    /* account endpoint is optional */
  }
  const windows = mapUsage(usage);
  const plan = inferClaudePlan(usage, account, orgRecord)
    || inferClaudePlanFromWindows(windows);
  return {
    providerId: 'claude-ai',
    source: 'live',
    plan,
    windows,
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
      return snap?.plan
        || inferClaudePlan(snap)
        || inferClaudePlanFromWindows(snap?.windows);
    },
  };
}

module.exports = {
  createClaudeAiAdapter,
  mapUsage,
  ensureClaudeSession,
  extractOrgId,
  inferClaudePlan,
  inferClaudePlanFromWindows,
  validateOrganizationsProbe,
  CLAUDE_COOKIE_NAMES,
};