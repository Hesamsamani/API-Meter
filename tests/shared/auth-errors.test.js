import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthErrorMessage } from '../../src/shared/auth-errors.js';

test('isAuthErrorMessage detects login and cloudflare errors', () => {
  assert.equal(isAuthErrorMessage('Claude.ai login required'), true);
  assert.equal(isAuthErrorMessage('CloudflareBlocked: Just a moment'), true);
  assert.equal(isAuthErrorMessage('network timeout'), false);
});

test('isAuthErrorMessage does not treat 429 rate limits as auth errors', () => {
  assert.equal(isAuthErrorMessage('HTTP 429 Too Many Requests'), false);
  assert.equal(isAuthErrorMessage('rate limit exceeded'), false);
});

test('isAuthErrorMessage does not treat fetch parse errors as auth errors', () => {
  assert.equal(isAuthErrorMessage('InvalidJSON: empty response'), false);
});
