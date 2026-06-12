import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const orbSrc = readFileSync(path.join(root, 'src/renderer/shared/widget-orb.js'), 'utf8');

test('orb uses concentric inner and outer rings for dual windows', () => {
  assert.match(orbSrc, /widget-orb--dual/);
  assert.match(orbSrc, /widget-orb__ring-fg--\$\{layer\}/);
  assert.match(orbSrc, /layer: 'inner'/);
  assert.match(orbSrc, /layer: 'outer'/);
  assert.match(orbSrc, /renderConcentricOrb/);
});

test('orb legends respect usage display mode', () => {
  assert.match(orbSrc, /widget-orb__legends/);
  assert.match(orbSrc, /widget-orb__legend--\$\{layer\}/);
  assert.match(orbSrc, /displayPercent/);
  assert.match(orbSrc, /getUsageDisplayMode/);
});

test('orb sizes are larger than old compact layout', () => {
  assert.match(orbSrc, /small: 52/);
  assert.match(orbSrc, /medium: 64/);
  assert.match(orbSrc, /large: 76/);
});

test('countOrbSlots is one cluster per provider', () => {
  assert.match(orbSrc, /return Math\.max\(1, providers\.length\)/);
});

test('updateOrbCluster rebuilds when orb node is missing', () => {
  assert.match(orbSrc, /if \(!orb\) \{/);
  assert.match(orbSrc, /renderOrbCluster\(snap, handlers\)/);
});