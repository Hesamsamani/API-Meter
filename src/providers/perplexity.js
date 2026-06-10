const { clampPercent } = require('../shared/normalize');

const LIMITS = {
  remaining_pro: { key: 'pro', label: 'PRO', total: 200 },
  remaining_research: { key: 'research', label: 'RES', total: 20 },
  remaining_labs: { key: 'labs', label: 'LABS', total: 25 },
};

function mapPerplexityRateLimits(body) {
  const windows = Object.entries(LIMITS).flatMap(([field, meta]) => {
    if (body[field] === undefined) return [];
    const remaining = Number(body[field]);
    const used = meta.total - remaining;
    return [{ ...meta, utilization: clampPercent((used / meta.total) * 100) }];
  });
  return {
    providerId: 'perplexity',
    source: 'live',
    plan: 'Pro',
    windows,
    fetchedAt: new Date().toISOString(),
  };
}

async function ensurePerplexityCookies() {
  const { session } = require('electron');
  const { getSecret } = require('../main/store');
  const token = getSecret('perplexity-session');
  if (!token) throw new Error('Perplexity login required');
  const cookieName = getSecret('perplexity-session-cookie-name') || 'pplx.session';
  await session.defaultSession.cookies.set({
    url: 'https://www.perplexity.ai',
    name: cookieName,
    value: token,
    domain: '.perplexity.ai',
    path: '/',
    secure: cookieName.startsWith('__Secure-'),
  });
}

function createPerplexityAdapter() {
  const { openAuthWindow } = require('../main/auth-window');
  const { getSecret } = require('../main/store');

  return {
    id: 'perplexity',
    name: 'PPLX',
    authMethod: 'browser',
    async isAvailable() { return true; },
    async isAuthenticated() { return !!getSecret('perplexity-session'); },
    async login() {
      await openAuthWindow({
        loginUrl: 'https://www.perplexity.ai/',
        domain: '.perplexity.ai',
        cookieNames: ['pplx.session', '__Secure-next-auth.session-token'],
        secretKey: 'perplexity-session',
        title: 'Login to Perplexity',
      });
    },
    async logout() {
      const { setSecret } = require('../main/store');
      setSecret('perplexity-session', '');
      setSecret('perplexity-session-cookie-name', '');
    },
    async fetchUsage() {
      const { fetchViaWindow } = require('../main/fetch-via-window');
      await ensurePerplexityCookies();
      const body = await fetchViaWindow('https://www.perplexity.ai/rest/rate-limit/all');
      return mapPerplexityRateLimits(body);
    },
    detectPlan() { return 'Pro'; },
  };
}

module.exports = { createPerplexityAdapter, mapPerplexityRateLimits };