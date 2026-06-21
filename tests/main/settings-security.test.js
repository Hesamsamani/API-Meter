import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainSrc = readFileSync(path.join(root, 'main.js'), 'utf8');
const storeSrc = readFileSync(path.join(root, 'src/main/store.js'), 'utf8');

test('isSecretSettingsKey matches secret_ and secret_meta_ store keys', () => {
  assert.match(storeSrc, /function isSecretSettingsKey/);
  assert.match(storeSrc, /SECRET_KEY_PATTERN = \/\^secret_\//);
  assert.match(storeSrc, /SECRET_META_KEY_PATTERN = \/\^secret_meta_\//);
});

test('redactSettingsForRenderer strips secret keys before renderer IPC', () => {
  assert.match(storeSrc, /function redactSettingsForRenderer/);
  assert.match(storeSrc, /isSecretSettingsKey\(key\)/);
});

test('settings:get and broadcastSettings redact secrets for renderer', () => {
  assert.match(mainSrc, /redactSettingsForRenderer\(settings\.store\)/);
  assert.match(mainSrc, /settings:get.*redactSettingsForRenderer/s);
  assert.match(mainSrc, /function broadcastSettings/);
  assert.match(mainSrc, /settings:updated.*payload/s);
});

test('mergeSettingsPatch rejects secret_ patch keys', () => {
  assert.match(mainSrc, /isSecretSettingsKey\(key\)/);
  assert.match(mainSrc, /if \(isSecretSettingsKey\(key\)\) continue/);
});

test('setSecret fails closed when safeStorage is unavailable', () => {
  assert.match(storeSrc, /safeStorage encryption is not available; refusing to persist secret/);
  assert.doesNotMatch(storeSrc, /settings\.set\(`secret_\$\{key\}`, value\)/);
});