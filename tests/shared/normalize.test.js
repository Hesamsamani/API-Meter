// tests/shared/normalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPercent, formatResetCountdown, worstUtilization } from '../../src/shared/normalize.js';

test('clampPercent bounds 0-100', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(0.42), 42);
  assert.equal(clampPercent(150), 100);
});

test('worstUtilization picks highest window', () => {
  const snap = {
    windows: [
      { key: 'a', label: '5H', utilization: 30 },
      { key: 'b', label: '7D', utilization: 88 },
    ],
  };
  assert.equal(worstUtilization(snap), 88);
});

test('formatResetCountdown returns human readable delta', () => {
  const future = new Date(Date.now() + 3 * 60 * 60 * 1000 + 12 * 60 * 1000).toISOString();
  const text = formatResetCountdown(future);
  assert.match(text, /3h/);
});