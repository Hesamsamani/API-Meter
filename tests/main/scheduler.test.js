import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectorScheduler, FAILURE_BACKOFF_MS } from '../../src/main/scheduler.js';

function mockSettings(data = {}) {
  const store = {
    refreshIntervalMinutes: 5,
    autoRefreshEnabled: true,
    providers: {
      'claude-ai': { enabled: true },
      'claude-code': { enabled: true },
      gemini: { enabled: true },
      perplexity: { enabled: true },
      grok: { enabled: true },
      cursor: { enabled: true },
    },
    ...data,
  };
  return {
    get(key, fallback) {
      return store[key] ?? fallback;
    },
    set(key, value) {
      store[key] = value;
    },
    get store() { return store; },
  };
}

function createHarness(settingsData) {
  const settings = mockSettings(settingsData);
  const usageStore = {
    setLive() {},
    setError() {},
  };
  const good = {
    id: 'cursor',
    async fetchUsage() {
      return { providerId: 'cursor', source: 'live', windows: [{ key: 'total', label: 'TOTAL', utilization: 10 }], fetchedAt: new Date().toISOString() };
    },
    detectPlan() { return 'Free'; },
  };
  const bad = {
    id: 'perplexity',
    async fetchUsage() {
      throw new Error('login required');
    },
    detectPlan() { return 'Pro'; },
  };
  const registry = {
    list() { return [good, bad]; },
    get(id) { return [good, bad].find((a) => a.id === id); },
  };
  let updates = 0;
  const scheduler = new CollectorScheduler({
    registry,
    store: usageStore,
    settings,
    onUpdate: () => { updates += 1; },
  });
  return { scheduler, settings, updates, good, bad };
}

test('getEnabledAdapters skips disabled providers', () => {
  const { scheduler } = createHarness({
    providers: { cursor: { enabled: true }, perplexity: { enabled: false } },
  });
  const ids = scheduler.getEnabledAdapters().map((a) => a.id);
  assert.deepEqual(ids, ['cursor']);
});

test('nextDelay uses failure backoff on error', () => {
  const { scheduler } = createHarness();
  assert.equal(scheduler.nextDelay('perplexity', false), FAILURE_BACKOFF_MS);
});

test('nextDelay uses refresh interval after success', () => {
  const { scheduler } = createHarness({ refreshIntervalMinutes: 2 });
  scheduler.backoff.set('cursor', scheduler.getSuccessIntervalMs());
  assert.equal(scheduler.nextDelay('cursor', true), 120000);
});

test('refreshProvider skips disabled adapter', async () => {
  const { scheduler } = createHarness({
    providers: { cursor: { enabled: false }, perplexity: { enabled: true } },
  });
  const result = await scheduler.refreshProvider({ id: 'cursor', async fetchUsage() { throw new Error('nope'); } });
  assert.equal(result, true);
});