import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrayIconPng } from '../../src/main/tray-icon-buffer.js';

test('createTrayIconPng returns valid PNG signature', () => {
  const buf = createTrayIconPng('green', 16);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf[0], 0x89);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  assert.ok(buf.length > 80);
});

test('createTrayIconPng supports all status levels', () => {
  for (const level of ['green', 'amber', 'red']) {
    const buf = createTrayIconPng(level, 32);
    assert.ok(buf.length > 100, `${level} icon should be non-trivial`);
  }
});