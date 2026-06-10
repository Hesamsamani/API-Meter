// tests/main/alerts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertManager } from '../../src/main/alerts.js';

test('notifyOnce fires only once until reset', () => {
  const fired = [];
  const mgr = new AlertManager({
    warn: 75,
    danger: 90,
    notify: (msg) => fired.push(msg),
  });
  mgr.evaluate('cursor', 'total', 91);
  mgr.evaluate('cursor', 'total', 92);
  assert.equal(fired.length, 1);
  mgr.evaluate('cursor', 'total', 50);
  mgr.evaluate('cursor', 'total', 91);
  assert.equal(fired.length, 2);
});