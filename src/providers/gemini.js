const fs = require('fs');
const path = require('path');
const { geminiTmpPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');
const { fetchViaWindow } = require('../main/fetch-via-window');
const { openAuthWindow } = require('../main/auth-window');
const { getSecret } = require('../main/store');

const AI_PRO_DAILY_LIMIT = 1000;

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

async function fetchLiveGemini() {
  const { session } = require('electron');
  const sid = getSecret('gemini-session');
  if (!sid) throw new Error('Gemini login required');
  await session.defaultSession.cookies.set({
    url: 'https://gemini.google.com',
    name: 'SID',
    value: sid,
    domain: '.google.com',
    path: '/',
  });
  const body = await fetchViaWindow('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b');
  const dayUsed = Number(body?.dayUsed || body?.quota?.dayUsed || 0);
  const dayLimit = Number(body?.dayLimit || body?.quota?.dayLimit || AI_PRO_DAILY_LIMIT);
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
    async isAuthenticated() { return !!getSecret('gemini-session') || fs.existsSync(geminiTmpPath()); },
    async login() {
      await openAuthWindow({
        loginUrl: 'https://gemini.google.com/',
        domain: '.google.com',
        cookieName: 'SID',
        secretKey: 'gemini-session',
        title: 'Login to Gemini',
      });
    },
    async logout() {
      const { setSecret } = require('../main/store');
      setSecret('gemini-session', '');
    },
    async fetchUsage() {
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

module.exports = { createGeminiAdapter, mapLocalGemini, countTodaySessions };