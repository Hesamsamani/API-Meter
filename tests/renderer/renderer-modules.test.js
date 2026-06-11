import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isAuthErrorMessage } from '../../src/renderer/shared/auth-errors.js';
import { thresholdClass, setAlertThresholds } from '../../src/renderer/shared/alert-thresholds.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('renderer auth-errors is valid ESM with export syntax', () => {
  const src = readFileSync(path.join(root, 'src/renderer/shared/auth-errors.js'), 'utf8');
  assert.match(src, /export function isAuthErrorMessage/);
  assert.doesNotMatch(src, /module\.exports/);
  assert.equal(isAuthErrorMessage('login required'), true);
});

test('renderer alert-thresholds is valid ESM', () => {
  setAlertThresholds({ warnThreshold: 80, dangerThreshold: 95 });
  assert.equal(thresholdClass(50), 'green');
  assert.equal(thresholdClass(85), 'amber');
  assert.equal(thresholdClass(96), 'red');
});

test('provider-card imports only renderer-local shared modules', () => {
  const src = readFileSync(path.join(root, 'src/renderer/shared/provider-card.js'), 'utf8');
  assert.doesNotMatch(src, /\.\.\/\.\.\/\.\.\/shared\//);
  assert.match(src, /from '\.\/auth-errors\.js'/);
});