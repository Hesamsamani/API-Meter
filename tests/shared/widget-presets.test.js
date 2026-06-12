import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWidgetSettings,
  computeWidgetBounds,
  clampWidgetPosition,
  nextSize,
  prevSize,
  nextDisplayMode,
  DISPLAY_MODE_ORDER,
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

test('normalizeWidgetSettings defaults layerOrder to always-on-top', () => {
  assert.equal(normalizeWidgetSettings({}).layerOrder, 'always-on-top');
  assert.equal(normalizeWidgetSettings({ layerOrder: 'desktop' }).layerOrder, 'desktop');
  assert.equal(normalizeWidgetSettings({ layerOrder: 'bogus' }).layerOrder, 'always-on-top');
});

test('normalizeWidgetSettings preserves saved widget position', () => {
  assert.equal(normalizeWidgetSettings({}).position, null);
  assert.deepEqual(
    normalizeWidgetSettings({ position: { x: 120.4, y: 340.8 } }).position,
    { x: 120, y: 341 },
  );
});

test('clampWidgetPosition keeps widget inside work area', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(clampWidgetPosition(100, 200, 280, 220, area), { x: 100, y: 200 });
  assert.deepEqual(clampWidgetPosition(-50, 200, 280, 220, area), { x: 0, y: 200 });
  assert.deepEqual(clampWidgetPosition(1800, 900, 280, 220, area), { x: 1640, y: 820 });
});

test('computeWidgetBounds orb mode fits concentric cluster', () => {
  const orb = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium' });
  const one = computeWidgetBounds(orb, 1);
  assert.ok(one.width >= 80);
  assert.ok(one.height >= 100);
});

test('computeWidgetBounds orb scales with provider count', () => {
  const orb = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium' });
  const one = computeWidgetBounds(orb, 1);
  const three = computeWidgetBounds(orb, 3);
  assert.ok(three.width >= one.width);
});

test('computeWidgetBounds shrinks when click-through hides chrome', () => {
  const normal = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium' });
  const through = normalizeWidgetSettings({ displayMode: 'orb', size: 'medium', clickThrough: true });
  const normalBounds = computeWidgetBounds(normal, 1);
  const throughBounds = computeWidgetBounds(through, 1);
  assert.ok(throughBounds.height < normalBounds.height);
  assert.equal(normalBounds.height - throughBounds.height, 30);
});

test('nextDisplayMode cycles through all layouts', () => {
  let mode = 'single';
  const seen = new Set();
  for (let i = 0; i < DISPLAY_MODE_ORDER.length; i++) {
    seen.add(mode);
    mode = nextDisplayMode(mode);
  }
  assert.equal(seen.size, DISPLAY_MODE_ORDER.length);
});