import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWidgetSettings,
  computeWidgetBounds,
  nextSize,
  prevSize,
} from '../../src/shared/widget-presets.js';

test('normalizeWidgetSettings applies defaults', () => {
  const fw = normalizeWidgetSettings({});
  assert.equal(fw.displayMode, 'single');
  assert.equal(fw.size, 'medium');
  assert.equal(fw.theme, 'dark');
});

test('computeWidgetBounds scales with grid rows', () => {
  const fw = normalizeWidgetSettings({ displayMode: 'grid', size: 'medium' });
  const one = computeWidgetBounds(fw, 1);
  const four = computeWidgetBounds(fw, 4);
  assert.ok(four.height > one.height);
});

test('nextSize and prevSize stay in range', () => {
  assert.equal(nextSize('small'), 'medium');
  assert.equal(prevSize('large'), 'medium');
  assert.equal(prevSize('small'), 'small');
});