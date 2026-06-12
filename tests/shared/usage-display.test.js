import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsageDisplayMode,
  displayPercent,
  displayFillPercent,
  worstDisplayPercent,
  formatWindowPercent,
  formatWindowPercentShort,
} from '../../src/shared/usage-display.js';

test('normalizeUsageDisplayMode defaults to used', () => {
  assert.equal(normalizeUsageDisplayMode(undefined), 'used');
  assert.equal(normalizeUsageDisplayMode('invalid'), 'used');
  assert.equal(normalizeUsageDisplayMode('remaining'), 'remaining');
});

test('displayPercent shows used by default and remaining when configured', () => {
  assert.equal(displayPercent(10, 'used'), 10);
  assert.equal(displayPercent(10, 'remaining'), 90);
  assert.equal(displayPercent(100, 'remaining'), 0);
});

test('displayFillPercent matches displayPercent', () => {
  assert.equal(displayFillPercent(42, 'used'), 42);
  assert.equal(displayFillPercent(42, 'remaining'), 58);
});

test('worstDisplayPercent picks highest displayed window', () => {
  const snap = {
    windows: [
      { key: 'a', label: '5H', utilization: 30 },
      { key: 'b', label: '7D', utilization: 88 },
    ],
  };
  assert.equal(worstDisplayPercent(snap, 'used'), 88);
  assert.equal(worstDisplayPercent(snap, 'remaining'), 70);
});

test('formatWindowPercent annotates remaining mode', () => {
  const win = { label: '5H', utilization: 25 };
  assert.equal(formatWindowPercent(win, 'used'), '5H 25%');
  assert.equal(formatWindowPercent(win, 'remaining'), '5H 75% left');
  assert.equal(formatWindowPercentShort(win, 'used'), '5H 25%');
  assert.equal(formatWindowPercentShort(win, 'remaining'), '5H 75% left');
});