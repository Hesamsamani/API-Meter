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

function parseGeminiBatchExecute(bodyText) {
  const cleaned = String(bodyText || '').replace(/^\)\]\}'\s*/, '').trim();
  const outer = JSON.parse(cleaned);
  if (!Array.isArray(outer)) throw new Error('Gemini batchexecute: unexpected payload');

  for (const row of outer) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const payload = row[2];
    if (typeof payload !== 'string') continue;
    try {
      const inner = JSON.parse(payload);
      if (Array.isArray(inner)) return inner;
      if (inner && typeof inner === 'object') return inner;
    } catch {
      /* try next row */
    }
  }
  throw new Error('Gemini batchexecute: quota data not found');
}

function extractGeminiQuota(inner) {
  const walk = (node) => {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node === 'object') {
      if (Number.isFinite(node.dayUsed) || Number.isFinite(node.dayLimit)) return node;
      if (node.quota) return node.quota;
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
    { appendGoogleAtToken: true },
  );
  const inner = parseGeminiBatchExecute(raw);
  const quota = extractGeminiQuota(inner);
  const dayUsed = Number(quota.dayUsed ?? quota.used ?? 0);
  const dayLimit = Number(quota.dayLimit ?? quota.limit ?? AI_PRO_DAILY_LIMIT);
  return {
    providerId: 'gemini',
    source: 'live',
    plan: 'AI Pro',
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
        return local;
      }
    },
    detectPlan() { return 'AI Pro'; },
  };
}

module.exports = {
  createGeminiAdapter,
  parseGeminiBatchExecute,
  extractGeminiQuota,
  mapLocalGemini,
  buildGeminiQuotaReqBody,
  GEMINI_QUOTA_BATCH_URL,
};