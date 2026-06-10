/**
 * E2E provider verification — calls adapter.fetchUsage() (collect equivalent).
 * Run: node scripts/e2e-verify-providers.js
 */
const fs = require('fs');
const path = require('path');
const {
  claudeCredentialsPath,
  grokAuthPath,
  geminiTmpPath,
  cursorStateDbPath,
} = require('../src/shared/paths');

const results = [];

function record(providerId, status, detail) {
  results.push({ providerId, status, ...detail });
}

async function tryFetch(adapter) {
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
    return record(adapter.id, 'ERROR', {
      credPath,
      credExists,
      error: `isAvailable/isAuthenticated: ${e.message}`,
    });
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

async function main() {
  const { createRegistry } = require('../src/providers/registry');
  const registry = createRegistry();
  for (const adapter of registry.list()) {
    await tryFetch(adapter);
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});