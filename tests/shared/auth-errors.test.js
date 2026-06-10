import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthErrorMessage } from '../../src/shared/auth-errors.js';

test('isAuthErrorMessage detects login and cloudflare errors', () => {
  assert.equal(isAuthErrorMessage('Claude.ai login required'), true);
  assert.equal(isAuthErrorMessage('CloudflareBlocked: Just a moment'), true);
  assert.equal(isAuthErrorMessage('network timeout'), false);
});