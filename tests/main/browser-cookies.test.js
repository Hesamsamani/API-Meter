import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostSuffix, decryptChromiumCookie, diagnoseBrowserCookie } from '../../src/main/browser-cookies.js';

test('hostSuffix strips leading dot', () => {
  assert.equal(hostSuffix('.claude.ai'), 'claude.ai');
  assert.equal(hostSuffix('google.com'), 'google.com');
});

test('decryptChromiumCookie returns plaintext string values', () => {
  assert.equal(decryptChromiumCookie('abc123', null).value, 'abc123');
});

test('decryptChromiumCookie returns null for app-bound v20 cookies', () => {
  const buf = Buffer.concat([Buffer.from('v20'), Buffer.alloc(20)]);
  const result = decryptChromiumCookie(buf, Buffer.alloc(32));
  assert.equal(result.value, null);
  assert.equal(result.issue, 'v20_encrypted');
});

test('diagnoseBrowserCookie reports unsupported platform off Windows', () => {
  if (process.platform === 'win32') return;
  const diag = diagnoseBrowserCookie({ cookieNames: ['sessionKey'], domain: '.claude.ai' });
  assert.equal(diag.reason, 'unsupported_platform');
});