// tests/main/usage-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageStore } from '../../src/main/usage-store.js';
import { isAuthErrorMessage } from '../../src/shared/auth-errors.js';

const live = {
  providerId: 'claude-code',
  source: 'live',
  plan: 'Pro',
  windows: [{ key: 'five_hour', label: '5H', utilization: 10 }],
  fetchedAt: new Date().toISOString(),
};

test('setSnapshot stores snapshot retrievable by id', () => {
  const store = new UsageStore();
  store.setSnapshot('claude-code', live);
  assert.deepEqual(store.get('claude-code'), live);
});

test('setSnapshot preserves local source and error from adapter fallback', () => {
  const store = new UsageStore();
  const fallback = {
    providerId: 'gemini',
    source: 'local',
    plan: 'AI Pro',
    windows: [{ key: 'day', label: 'DAY', utilization: 5 }],
    error: 'InvalidJSON: ...',
    fetchedAt: new Date().toISOString(),
  };
  store.setSnapshot('gemini', fallback);
  const snap = store.get('gemini');
  assert.equal(snap.source, 'local');
  assert.equal(snap.error, fallback.error);
  assert.equal(snap.authRequired, undefined);
});

test('setError keeps last good snapshot as stale', () => {
  const store = new UsageStore();
  store.setSnapshot('claude-code', live);
  store.setError('claude-code', 'network');
  const snap = store.get('claude-code');
  assert.equal(snap.source, 'stale');
  assert.equal(snap.error, 'network');
});

test('setError clears windows on auth failures', () => {
  const store = new UsageStore();
  store.setSnapshot('claude-ai', live);
  store.setError('claude-ai', 'Claude.ai login required');
  const snap = store.get('claude-ai');
  assert.equal(snap.authRequired, true);
  assert.deepEqual(snap.windows, []);
});

test('setError sets authRequired for Setting cookie failed', () => {
  const message = 'Setting cookie failed (sessionKey): net::ERR_FAILED';
  assert.equal(isAuthErrorMessage(message), true);

  const store = new UsageStore();
  store.setSnapshot('claude-ai', live);
  store.setError('claude-ai', message);
  const snap = store.get('claude-ai');
  assert.equal(snap.authRequired, true);
  assert.equal(snap.error, message);
  assert.deepEqual(snap.windows, []);
});

test('getAll returns map of all providers', () => {
  const store = new UsageStore();
  store.setSnapshot('cursor', { ...live, providerId: 'cursor' });
  assert.equal(Object.keys(store.getAll()).length, 1);
});