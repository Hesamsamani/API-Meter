import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextSize, prevSize } from '../../src/shared/widget-presets.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const widgetSrc = readFileSync(path.join(root, 'src/renderer/floating-widget/widget.js'), 'utf8');

test('widget resize handlers pass provider count to IPC', () => {
  assert.match(widgetSrc, /applyResize\(-1\)/);
  assert.match(widgetSrc, /applyResize\(1\)/);
  assert.match(widgetSrc, /resizeWidget\(direction,\s*providerCountForResize\(\)\)/);
  assert.match(widgetSrc, /fitWindowIfNeeded/);
});

test('widget passes onLogin and gauge options to provider cards', () => {
  assert.match(widgetSrc, /onLogin:\s*\(\)\s*=>\s*handleLogin/);
  assert.match(widgetSrc, /gauge:\s*gaugeOptions\(\)/);
  assert.match(widgetSrc, /SIZE_GAUGE/);
});

test('widget uses incremental card updates and provider id tracking', () => {
  assert.match(widgetSrc, /upsertWidgetCard/);
  assert.match(widgetSrc, /activeProviderId/);
  assert.match(widgetSrc, /lastFingerprints\.get\(id\) === fp/);
});

test('widget supports orb mode, layout cycle, and click-through', () => {
  assert.match(widgetSrc, /renderOrbMode/);
  assert.match(widgetSrc, /cycleLayout/);
  assert.match(widgetSrc, /cycleWidgetDisplayMode/);
  assert.match(widgetSrc, /setWidgetClickThrough/);
  assert.match(widgetSrc, /header\.hidden = cfg\.clickThrough/);
  assert.match(widgetSrc, /contextmenu/);
  assert.match(widgetSrc, /'orb'/);
});

test('resize at boundaries does not change size', () => {
  assert.equal(nextSize('large'), 'large');
  assert.equal(prevSize('small'), 'small');
});