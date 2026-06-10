/**
 * Provider verification inside Electron (browser session + better-sqlite3 ABI).
 * Run: npx electron scripts/e2e-verify-electron.js
 */
const fs = require('fs');
const path = require('path');
const {
  claudeCredentialsPath,
  grokAuthPath,
  geminiTmpPath,
  cursorStateDbPath,
} = require('../src/shared/paths');

const { app } = require('electron');

const results = [];

function record(providerId, status, detail) {
  results.push({ providerId, status, ...detail });
}

async function verify() {
  const { createRegistry } = require('../src/providers/registry');
  const registry = createRegistry();

  for (const adapter of registry.list()) {
    const credPath = {
      'claude-code': claudeCredentialsPath(),
      grok: grokAuthPath(),
      gemini: geminiTmpPath(),
      cursor: cursorStateDbPath(),
    }[adapter.id];

    const credExists = credPath ? fs.existsSync(credPath) : null;
    let available = false;
    let authenticated = false;
    try {
      available = await adapter.isAvailable();
      authenticated = await adapter.isAuthenticated();
    } catch (e) {
      record(adapter.id, 'ERROR', {
        credPath,
        credExists,
        error: `isAvailable/isAuthenticated: ${e.message}`,
      });
      continue;
    }

    try {
      const snap = await adapter.fetchUsage();
      const labels = (snap.windows || []).map((w) => `${w.label}:${w.utilization}%`).join(', ');
      record(adapter.id, snap.source === 'live' ? 'LIVE' : 'LOCAL', {
        credPath,
        credExists,
        authenticated,
        available,
        source: snap.source,
        plan: snap.plan,
        windows: snap.windows,
        labels,
        error: snap.error || null,
        fetchedAt: snap.fetchedAt,
      });
    } catch (err) {
      const msg = err.message || String(err);
      const loginRequired = /login required|not logged in|not signed in/i.test(msg);
      record(adapter.id, loginRequired ? 'LOGIN_REQUIRED' : 'FAIL', {
        credPath,
        credExists,
        authenticated,
        available,
        error: msg,
      });
    }
  }

  const outPath = path.join(__dirname, 'e2e-verify-electron-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  app.exit(0);
}

app.whenReady().then(verify).catch((e) => {
  console.error(e);
  app.exit(1);
});