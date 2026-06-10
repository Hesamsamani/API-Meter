// tests/main/usage-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageStore } from '../../src/main/usage-store.js';

const live = {
  providerId: 'claude-code',
  source: 'live',
  plan: 'Pro',
  windows: [{ key: 'five_hour', label: '5H', utilization: 10 }],
  fetchedAt: new Date().toISOString(),
};

test('setLive stores snapshot retrievable by id', () => {
  const store = new UsageStore();
  store.setLive('claude-code', live);
  assert.deepEqual(store.get('claude-code'), live);
});

test('setError keeps last good snapshot as stale', () => {
  const store = new UsageStore();
  store.setLive('claude-code', live);
  store.setError('claude-code', 'network');
  const snap = store.get('claude-code');
  assert.equal(snap.source, 'stale');
  assert.equal(snap.error, 'network');
});

test('getAll returns map of all providers', () => {
  const store = new UsageStore();
  store.setLive('cursor', { ...live, providerId: 'cursor' });
  assert.equal(Object.keys(store.getAll()).length, 1);
});