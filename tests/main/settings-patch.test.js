import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainSrc = readFileSync(path.join(root, 'main.js'), 'utf8');

test('settings patch deep-merges floatingWidget instead of replacing it', () => {
  assert.match(mainSrc, /function mergeSettingsPatch/);
  assert.match(mainSrc, /key === 'floatingWidget'/);
  assert.match(mainSrc, /\.\.\.settings\.get\('floatingWidget'\)/);
});

test('widget bounds handlers use last fit provider count', () => {
  assert.match(mainSrc, /lastWidgetProviderCount/);
  assert.match(mainSrc, /widget:setClickThrough.*providerCount/);
  assert.match(mainSrc, /widgetProviderCountForBounds/);
});