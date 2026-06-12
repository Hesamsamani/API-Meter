const fs = require('fs');
const path = require('path');
const { geminiTmpPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');
const { postViaWindow, fetchGeminiUsagePage } = require('../main/fetch-via-window');
const {
  GEMINI_USAGE_PAGE_URL,
  parseGeminiUsagePageSource,
  mapUsagePageToSnapshot,
} = require('../shared/gemini-usage-page');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret } = require('../main/store');

const AI_PRO_DAILY_LIMIT = 1000;
const GEMINI_POST_TIMEOUT_MS = 75000;
const GEMINI_ORIGIN = 'https://gemini.google.com/';
const GEMINI_COOKIE_NAMES = ['__Secure-1PSID', '__Secure-3PSID', 'SID', '__Secure-1PSIDTS', '__Secure-1PSIDCC'];
const GEMINI_QUOTA_BATCH_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b&rt=c&source-path=%2Fusage';

function geminiAuthWindowOptions() {
  return {
    providerId: 'gemini',
    externalBrowser: true,
    loginUrl: GEMINI_USAGE_PAGE_URL,
    domain: '.google.com',
    extraDomains: ['.gemini.google.com'],
    cookieNames: ['__Secure-1PSID', '__Secure-3PSID', 'SID'],
    secretKey: 'gemini-session',
    title: 'Login to Gemini',
    probeUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b',
    probeExpectJson: false,
  };
}

async function clearGeminiAuthState({ disconnect = true, purgeAllGoogleCookies = false } = {}) {
  const { setSecret, setProviderDisconnected } = require('../main/store');
  const { clearProviderCookies, flushCookies, getProviderSession } = require('../main/provider-session');
  const { clearGeminiCookieJar } = require('../main/gemini-cookie-jar');
  setSecret('gemini-session', '');
  setSecret('gemini-session-cookie-name', '');
  clearGeminiCookieJar();
  setProviderDisconnected('gemini', disconnect);
  await clearProviderCookies({
    domain: '.google.com',
    names: purgeAllGoogleCookies ? [] : GEMINI_COOKIE_NAMES,
  });
  await flushCookies(getProviderSession());
}

function buildGeminiQuotaBatchUrl() {
  return `${GEMINI_QUOTA_BATCH_URL}&_reqid=${Date.now()}`;
}

function buildGeminiQuotaReqBody() {
  const fReq = JSON.stringify([[['otAQ7b', '[]', null, 'generic']]]);
  return `f.req=${encodeURIComponent(fReq)}`;
}

function countTodaySessions() {
  const base = geminiTmpPath();
  if (!fs.existsSync(base)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const chats = path.join(base, dir.name, 'chats');
    if (!fs.existsSync(chats)) continue;
    for (const f of fs.readdirSync(chats)) {
      if (f.startsWith(`session-${today}`)) count += 1;
    }
  }
  return count;
}

function mapLocalGemini(sessionsToday) {
  const utilization = clampPercent((sessionsToday / AI_PRO_DAILY_LIMIT) * 100);
  const end = new Date();
  end.setUTCHours(24, 0, 0, 0);
  return {
    providerId: 'gemini',
    source: 'local',
    plan: 'AI Pro',
    windows: [{ key: 'current', label: '5H', utilization, resetsAt: end.toISOString() }],
    fetchedAt: new Date().toISOString(),
  };
}

function stripGeminiBatchPrefix(bodyText) {
  return String(bodyText || '').replace(/^\)\]\}'\s*/, '').trim();
}

function geminiBatchJsonCandidates(bodyText) {
  const text = stripGeminiBatchPrefix(bodyText);
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => !/^\d+$/.test(line) && (line.startsWith('[') || line.startsWith('{')));
  if (candidates.length) return candidates;
  return [text];
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPlausibleQuotaPair(used, limit) {
  if (used == null || limit == null) return false;
  if (limit <= 0 || used < 0 || used > limit || limit > 1_000_000) return false;
  return true;
}

function quotaPairFromArray(node) {
  if (!Array.isArray(node)) return null;
  const nums = node.map(toFiniteNumber).filter((n) => n != null);
  if (nums.length >= 2 && isPlausibleQuotaPair(nums[0], nums[1])) {
    return { used: nums[0], limit: nums[1] };
  }
  for (const item of node) {
    const hit = quotaPairFromArray(item);
    if (hit) return hit;
  }
  return null;
}

function normalizeQuotaShape(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const used = toFiniteNumber(raw.dayUsed ?? raw.used ?? raw.promptCount ?? raw.requestCount);
  const limit = toFiniteNumber(raw.dayLimit ?? raw.limit ?? raw.promptLimit ?? raw.requestLimit);
  if (used != null || limit != null) {
    return { ...raw, dayUsed: used ?? raw.dayUsed, dayLimit: limit ?? raw.dayLimit };
  }
  return raw;
}

function quotaHasUsage(quota) {
  if (!quota || typeof quota !== 'object') return false;
  const normalized = normalizeQuotaShape(quota);
  return toFiniteNumber(normalized.dayUsed) != null
    || toFiniteNumber(normalized.dayLimit) != null
    || toFiniteNumber(normalized.used) != null
    || toFiniteNumber(normalized.limit) != null;
}

function inferGeminiPlan(quota = {}) {
  const tier = String(
    quota.plan
    || quota.tier
    || quota.subscriptionTier
    || quota.subscription_tier
    || quota.productTier
    || '',
  ).toLowerCase();
  if (/ultra|advanced/i.test(tier)) return 'Ultra';
  if (/pro/i.test(tier)) return 'AI Pro';
  if (/free/i.test(tier)) return 'Free';
  const limit = toFiniteNumber(quota.dayLimit ?? quota.limit);
  if (limit != null && limit >= 1000) return 'AI Pro';
  if (limit != null && limit > 0 && limit < 100) return 'Free';
  return 'AI Pro';
}

function parseGeminiBatchRows(outer) {
  if (!Array.isArray(outer)) return null;

  let fallback = null;

  for (const row of outer) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const rpcId = row[1];
    const payload = row[2];
    if (typeof payload !== 'string') continue;
    try {
      const inner = JSON.parse(payload);
      const candidate = Array.isArray(inner)
        ? inner
        : (inner && typeof inner === 'object' ? inner : null);
      if (!candidate) continue;
      const quota = extractGeminiQuota(candidate);
      if (rpcId === 'otAQ7b' && quotaHasUsage(quota)) return candidate;
      if (!fallback && quotaHasUsage(quota)) fallback = candidate;
    } catch {
      /* try next row */
    }
  }

  return fallback;
}

function parseGeminiBatchExecute(bodyText) {
  const candidates = geminiBatchJsonCandidates(bodyText);
  let lastParseErr = null;

  for (const jsonLine of candidates) {
    try {
      const outer = JSON.parse(jsonLine);
      const parsed = parseGeminiBatchRows(outer);
      if (parsed) return parsed;
    } catch (err) {
      lastParseErr = err;
    }
  }

  throw lastParseErr || new Error('Gemini batchexecute: quota data not found');
}

function extractGeminiQuota(inner) {
  const walk = (node) => {
    if (!node) return null;
    if (Array.isArray(node)) {
      const pair = quotaPairFromArray(node);
      if (pair) return normalizeQuotaShape(pair);
      for (const item of node) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node === 'object') {
      const direct = normalizeQuotaShape(node);
      if (quotaHasUsage(direct)) return direct;
      if (node.quota) return walk(node.quota);
      for (const value of Object.values(node)) {
        const hit = walk(value);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(inner) || {};
}

async function prepareGeminiSession() {
  const { ensureGeminiCookiesInPartition } = require('../main/gemini-cookie-jar');
  if (!getSecret('gemini-session')) throw new Error('Gemini login required');
  await ensureGeminiCookiesInPartition();
}

async function fetchGeminiFromUsagePage() {
  const pagePayload = await fetchGeminiUsagePage({ timeoutMs: GEMINI_POST_TIMEOUT_MS });
  const parsed = parseGeminiUsagePageSource(pagePayload);
  const mapped = mapUsagePageToSnapshot(parsed.windows, { resetTimes: parsed.resetTimes });
  if (!mapped?.windows?.length) {
    throw new Error('Gemini usage page: quota data not found');
  }
  const primary = parsed.windows.find((w) => w.key === 'current')
    || parsed.windows.find((w) => w.key === 'weekly')
    || parsed.windows.find((w) => w.key === 'pro')
    || parsed.windows[0];
  return {
    providerId: 'gemini',
    source: 'live',
    plan: inferGeminiPlan({ dayLimit: primary?.limit, tier: primary?.label }),
    windows: mapped.windows,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchGeminiFromBatchExecute() {
  const raw = await postViaWindow(
    GEMINI_USAGE_PAGE_URL,
    buildGeminiQuotaBatchUrl(),
    buildGeminiQuotaReqBody(),
    { appendGoogleAtToken: true, timeoutMs: GEMINI_POST_TIMEOUT_MS },
  );
  const inner = parseGeminiBatchExecute(raw);
  const quota = extractGeminiQuota(inner);
  if (!quotaHasUsage(quota)) {
    throw new Error('Gemini batchexecute: quota data not found');
  }
  const normalized = normalizeQuotaShape(quota);
  const dayUsed = toFiniteNumber(normalized.dayUsed ?? normalized.used) ?? 0;
  const dayLimit = toFiniteNumber(normalized.dayLimit ?? normalized.limit) ?? AI_PRO_DAILY_LIMIT;
  return {
    providerId: 'gemini',
    source: 'live',
    plan: inferGeminiPlan(normalized),
    windows: [{
      key: 'current',
      label: '5H',
      utilization: clampPercent((dayUsed / dayLimit) * 100),
      resetsAt: new Date(Date.now() + 5 * 3600000).toISOString(),
    }],
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchLiveGemini() {
  await prepareGeminiSession();
  let pageErr = null;
  try {
    return await fetchGeminiFromUsagePage();
  } catch (err) {
    pageErr = err;
  }
  try {
    return await fetchGeminiFromBatchExecute();
  } catch (batchErr) {
    const detail = pageErr ? `${pageErr.message}; ${batchErr.message}` : batchErr.message;
    throw new Error(detail);
  }
}

function createGeminiAdapter() {
  return {
    id: 'gemini',
    name: 'GEMINI',
    authMethod: 'browser',
    async isAvailable() { return true; },
    async isAuthenticated() {
      return !!getSecret('gemini-session');
    },
    async login() {
      const { setProviderDisconnected } = require('../main/store');
      setProviderDisconnected('gemini', false);
      await openAuthWindow(geminiAuthWindowOptions());
    },
    async logout() {
      await clearGeminiAuthState({ disconnect: true, purgeAllGoogleCookies: false });
    },
    async reset() {
      await clearGeminiAuthState({ disconnect: false, purgeAllGoogleCookies: true });
      await openAuthWindow(geminiAuthWindowOptions());
    },
    async fetchUsage() {
      const { isProviderDisconnected } = require('../main/store');
      if (isProviderDisconnected('gemini')) throw new Error('Gemini disconnected');
      if (!getSecret('gemini-session')) throw new Error('Gemini login required');
      try {
        return await fetchLiveGemini();
      } catch (err) {
        const local = mapLocalGemini(countTodaySessions());
        local.error = err.message;
        local.refreshFailed = true;
        return local;
      }
    },
    detectPlan(snap) { return snap?.plan || 'AI Pro'; },
  };
}

module.exports = {
  createGeminiAdapter,
  parseGeminiBatchExecute,
  extractGeminiQuota,
  quotaHasUsage,
  inferGeminiPlan,
  normalizeQuotaShape,
  mapLocalGemini,
  buildGeminiQuotaReqBody,
  GEMINI_QUOTA_BATCH_URL,
  GEMINI_USAGE_PAGE_URL,
  GEMINI_POST_TIMEOUT_MS,
  buildGeminiQuotaBatchUrl,
  fetchGeminiFromUsagePage,
  fetchGeminiFromBatchExecute,
  clearGeminiAuthState,
  geminiAuthWindowOptions,
  GEMINI_COOKIE_NAMES,
};