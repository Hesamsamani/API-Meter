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

test('computeWidgetBounds uses compact empty state for providerCount 0', () => {
  const fw = normalizeWidgetSettings({ displayMode: 'single', size: 'medium' });
  const empty = computeWidgetBounds(fw, 0);
  const one = computeWidgetBounds(fw, 1);
  assert.ok(empty.height < one.height);
});

test('computeWidgetBounds single medium is tall enough for mini card', () => {
  const fw = normalizeWidgetSettings({ displayMode: 'single', size: 'medium' });
  const bounds = computeWidgetBounds(fw, 1);
  assert.ok(bounds.height >= 210);
  assert.ok(bounds.height <= 240);
});

test('computeWidgetBounds grid mode has no phantom footer padding', () => {
  const fw = normalizeWidgetSettings({ displayMode: 'grid', size: 'medium' });
  const one = computeWidgetBounds(fw, 1);
  assert.equal(one.height, 35 + 16 + 184);
});

test('computeWidgetBounds empty state respects display mode width', () => {
  const grid = normalizeWidgetSettings({ displayMode: 'grid', size: 'medium' });
  const compact = normalizeWidgetSettings({ displayMode: 'compact', size: 'medium' });
  assert.equal(computeWidgetBounds(grid, 0).width, 320);
  assert.equal(computeWidgetBounds(compact, 0).width, 280);
});

test('normalizeWidgetSettings includes clickThrough default false', () => {
  assert.equal(normalizeWidgetSettings({}).clickThrough, false);
  assert.equal(normalizeWidgetSettings({ clickThrough: true }).clickThrough, true);
});

test('computeWidgetBounds orb mode is narrower than compact for one provider', () => {
  const compact = normalizeWidgetSettings({ displayMode: 'compact', size: 'medium' });
  const orb = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium' });
  const compactBounds = computeWidgetBounds(compact, 1);
  const orbBounds = computeWidgetBounds(orb, 1, 2);
  assert.ok(orbBounds.width < compactBounds.width);
  assert.ok(orbBounds.height < 120);
});

test('computeWidgetBounds orb scales with orb slot count', () => {
  const orb = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium' });
  const two = computeWidgetBounds(orb, 1, 2);
  const four = computeWidgetBounds(orb, 2, 4);
  assert.ok(four.width >= two.width);
});