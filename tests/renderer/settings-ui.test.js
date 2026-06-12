import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(root, 'src/renderer/settings/index.html'), 'utf8');
const js = readFileSync(path.join(root, 'src/renderer/settings/settings.js'), 'utf8');

test('settings uses sidebar navigation with categorized panels', () => {
  assert.match(html, /settings-sidebar/);
  assert.match(html, /data-panel="general"/);
  assert.match(html, /data-panel="refresh"/);
  assert.match(html, /data-panel="alerts"/);
  assert.match(html, /data-panel="widget"/);
  assert.match(html, /data-panel="providers"/);
  assert.match(html, /data-panel="accounts"/);
  assert.match(html, /settings-footer/);
});

test('settings accounts panel wires provider auth actions', () => {
  assert.match(html, /provider-auth-list/);
  assert.match(js, /renderProviderAuthList/);
  assert.match(js, /loginProvider/);
  assert.match(js, /logoutProvider/);
  assert.match(js, /resetProvider/);
  assert.match(js, /id === 'gemini'/);
});