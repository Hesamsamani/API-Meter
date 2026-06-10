const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { cursorStateDbPath } = require('../shared/paths');
const { clampPercent } = require('../shared/normalize');
const { isProviderDisconnected, setProviderDisconnected } = require('../main/store');

function readCursorTokens() {
  const dbPath = cursorStateDbPath();
  if (!fs.existsSync(dbPath)) return null;

  const tmpDb = path.join(os.tmpdir(), `api-meter-cursor-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  try {
    fs.copyFileSync(dbPath, tmpDb);
  } catch {
    return null;
  }

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(tmpDb, { readonly: true, fileMustExist: true });
    const row = (key) => db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key)?.value;
    const accessToken = row('cursorAuth/accessToken');
    const refreshToken = row('cursorAuth/refreshToken');
    const membership = row('cursorAuth/stripeMembershipType');
    if (!accessToken) return null;
    return { accessToken, refreshToken, membership };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  }
}

function postCursor(apiPath, token, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api2.cursor.sh',
      path: apiPath,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode === 401) {
          return reject(new Error('Cursor session expired — open Cursor IDE and sign in again'));
        }
        if (res.statusCode !== 200) return reject(new Error(`Cursor HTTP ${res.statusCode}`));
        resolve(JSON.parse(raw));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function mapCursorUsage({ planInfo, usage }) {
  const pu = usage?.planUsage || {};
  const windows = [
    {
      key: 'total',
      label: 'TOTAL',
      utilization: clampPercent(pu.totalPercentUsed),
      resetsAt: usage?.billingCycleEnd
        ? new Date(Number(usage.billingCycleEnd)).toISOString()
        : undefined,
    },
  ];
  if (Number.isFinite(pu.autoPercentUsed)) {
    windows.push({
      key: 'auto',
      label: 'AUTO',
      utilization: clampPercent(pu.autoPercentUsed),
    });
  }
  if (Number.isFinite(pu.apiPercentUsed)) {
    windows.push({
      key: 'api',
      label: 'API',
      utilization: clampPercent(pu.apiPercentUsed),
    });
  }
  return {
    providerId: 'cursor',
    source: 'live',
    plan: planInfo?.planName || null,
    windows,
    fetchedAt: new Date().toISOString(),
  };
}

function createCursorAdapter() {
  return {
    id: 'cursor',
    name: 'CURSOR',
    authMethod: 'local-db',
    async isAvailable() { return fs.existsSync(cursorStateDbPath()); },
    async isAuthenticated() {
      if (isProviderDisconnected('cursor')) return false;
      return !!readCursorTokens()?.accessToken;
    },
    async login() {
      setProviderDisconnected('cursor', false);
      throw new Error('Open Cursor IDE and sign in');
    },
    async logout() {
      setProviderDisconnected('cursor', true);
    },
    async fetchUsage() {
      if (isProviderDisconnected('cursor')) throw new Error('Cursor disconnected');
      const tokens = readCursorTokens();
      if (!tokens) throw new Error('Cursor not installed, not signed in, or database locked — close Cursor and retry');
      const [usage, plan] = await Promise.all([
        postCursor('/aiserver.v1.DashboardService/GetCurrentPeriodUsage', tokens.accessToken),
        postCursor('/aiserver.v1.DashboardService/GetPlanInfo', tokens.accessToken),
      ]);
      const snap = mapCursorUsage({ planInfo: plan?.planInfo, usage });
      if (!snap.plan && tokens.membership) snap.plan = tokens.membership;
      return snap;
    },
    detectPlan(snap) { return snap.plan; },
  };
}

module.exports = { createCursorAdapter, mapCursorUsage, readCursorTokens };