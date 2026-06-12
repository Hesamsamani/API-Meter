const fs = require('fs');
const path = require('path');
const { geminiTmpPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');
const { postViaWindow } = require('../main/fetch-via-window');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret } = require('../main/store');

const AI_PRO_DAILY_LIMIT = 1000;
const GEMINI_ORIGIN = 'https://gemini.google.com/';
const GEMINI_QUOTA_BATCH_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b&rt=c';

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
    windows: [{ key: 'day', label: 'DAY', utilization, resetsAt: end.toISOString() }],
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

function quotaPairFromArray(node) {
  if (!Array.isArray(node)) return null;
  const nums = node.map(toFiniteNumber).filter((n) => n != null);
  if (nums.length >= 2) {
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

  let otRow = null;
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
      if (rpcId === 'otAQ7b') {
        if (quotaHasUsage(quota)) return candidate;
        if (!otRow) otRow = candidate;
        continue;
      }
      if (!fallback && quotaHasUsage(quota)) fallback = candidate;
    } catch {
      /* try next row */
    }
  }

  return otRow || fallback;
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

async function fetchLiveGemini() {
  const { getProviderSession, setCookies, flushCookies, syncElectronCookiesToPartition } = require('../main/provider-session');
  const sid = getSecret('gemini-session');
  if (!sid) throw new Error('Gemini login required');
  const cookieName = getSecret('gemini-session-cookie-name') || '__Secure-1PSID';
  const ses = getProviderSession();
  await setCookies(ses, [
    {
      url: 'https://gemini.google.com',
      name: cookieName,
      value: sid,
      domain: '.google.com',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    },
  ]);
  await syncElectronCookiesToPartition({
    loginUrl: 'https://gemini.google.com/',
    domain: '.google.com',
    cookieNames: ['__Secure-1PSID', '__Secure-3PSID', 'SID', '__Secure-1PSIDTS', '__Secure-1PSIDCC'],
  });
  await flushCookies(ses);
  const raw = await postViaWindow(
    GEMINI_ORIGIN,
    `${GEMINI_QUOTA_BATCH_URL}&_reqid=${Date.now()}`,
    buildGeminiQuotaReqBody(),
    { appendGoogleAtToken: true, timeoutMs: 75000 },
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
      key: 'day',
      label: 'DAY',
      utilization: clampPercent((dayUsed / dayLimit) * 100),
      resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    }],
    fetchedAt: new Date().toISOString(),
  };
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
      await openAuthWindow({
        providerId: 'gemini',
        loginUrl: 'https://gemini.google.com/',
        domain: '.google.com',
        cookieNames: ['__Secure-1PSID', '__Secure-3PSID', 'SID'],
        secretKey: 'gemini-session',
        title: 'Login to Gemini',
        probeUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b',
        probeExpectJson: false,
      });
    },
    async logout() {
      const { setSecret, setProviderDisconnected } = require('../main/store');
      const { clearProviderCookies } = require('../main/provider-session');
      setSecret('gemini-session', '');
      setSecret('gemini-session-cookie-name', '');
      await clearProviderCookies({
        domain: '.google.com',
        names: ['__Secure-1PSID', '__Secure-3PSID', 'SID', '__Secure-1PSIDTS', '__Secure-1PSIDCC'],
      });
      setProviderDisconnected('gemini', true);
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
};