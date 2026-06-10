// tests/smoke.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('package.json exists with electron entry', () => {
  assert.ok(existsSync('package.json'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.main, 'main.js');
  assert.ok(pkg.scripts.test);
});