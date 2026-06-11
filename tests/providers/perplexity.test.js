// tests/providers/perplexity.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mapPerplexityRateLimits } from '../../src/providers/perplexity.js';

const require = createRequire(import.meta.url);
const perplexityPath = require.resolve('../../src/providers/perplexity.js');
const providerSessionPath = require.resolve('../../src/main/provider-session.js');
const storePath = require.resolve('../../src/main/store.js');
const authWindowPath = require.resolve('../../src/main/auth-window.js');

const MOCKED_MODULES = [perplexityPath, providerSessionPath, storePath, authWindowPath];

function clearMockedModules() {
  for (const modulePath of MOCKED_MODULES) {
    delete require.cache[modulePath];
  }
}

afterEach(() => {
  clearMockedModules();
});

function loadPerplexityAdapterWithMocks() {
  const clearCalls = [];
  const secrets = {
    'perplexity-session': 'token',
    'perplexity-session-cookie-name': 'pplx.session',
  };
  let disconnected = false;

  require.cache[providerSessionPath] = {
    id: providerSessionPath,
    filename: providerSessionPath,
    loaded: true,
    exports: {
      clearProviderCookies: async (opts) => {
        clearCalls.push(opts);
      },
    },
    children: [],
    paths: [],
  };

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getSecret: (key) => secrets[key] || '',
      setSecret: (key, value) => {
        if (!value) delete secrets[key];
        else secrets[key] = value;
      },
      isProviderDisconnected: () => disconnected,
      setProviderDisconnected: (_id, value) => {
        disconnected = value;
      },
    },
    children: [],
    paths: [],
  };

  require.cache[authWindowPath] = {
    id: authWindowPath,
    filename: authWindowPath,
    loaded: true,
    exports: {
      openAuthWindow: async () => {},
    },
    children: [],
    paths: [],
  };

  delete require.cache[perplexityPath];
  const { createPerplexityAdapter } = require(perplexityPath);

  return {
    adapter: createPerplexityAdapter(),
    clearCalls,
    secrets,
    getDisconnected: () => disconnected,
  };
}

test('mapPerplexityRateLimits converts remaining to utilization', () => {
  const snap = mapPerplexityRateLimits({
    remaining_pro: 140,
    remaining_research: 5,
  });
  const pro = snap.windows.find((w) => w.key === 'pro');
  assert.equal(pro.utilization, 30);
  assert.equal(snap.plan, 'Pro');
});

test('perplexity.js imports clearProviderCookies from provider-session at module scope', () => {
  const src = readFileSync(perplexityPath, 'utf8');
  const importLine = src
    .split('\n')
    .find((line) => line.includes('../main/provider-session') && line.includes('clearProviderCookies'));

  assert.ok(
    importLine,
    'clearProviderCookies must be imported from provider-session at top level (logout ReferenceError guard)',
  );
});

test('perplexity logout clears secrets and calls clearProviderCookies', async () => {
  const { adapter, clearCalls, secrets, getDisconnected } = loadPerplexityAdapterWithMocks();

  await assert.doesNotReject(() => adapter.logout());

  assert.equal(secrets['perplexity-session'], undefined);
  assert.equal(secrets['perplexity-session-cookie-name'], undefined);
  assert.equal(getDisconnected(), true);
  assert.equal(clearCalls.length, 1);
  assert.deepEqual(clearCalls[0], {
    domain: '.perplexity.ai',
    names: ['pplx.session', '__Secure-next-auth.session-token'],
  });
});