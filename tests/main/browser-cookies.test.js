import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostSuffix, decryptChromiumCookie } from '../../src/main/browser-cookies.js';

test('hostSuffix strips leading dot', () => {
  assert.equal(hostSuffix('.claude.ai'), 'claude.ai');
  assert.equal(hostSuffix('google.com'), 'google.com');
});

test('decryptChromiumCookie returns plaintext string values', () => {
  assert.equal(decryptChromiumCookie('abc123', null), 'abc123');
});

test('decryptChromiumCookie returns null for app-bound v20 cookies', () => {
  const buf = Buffer.concat([Buffer.from('v20'), Buffer.alloc(20)]);
  assert.equal(decryptChromiumCookie(buf, Buffer.alloc(32)), null);
});