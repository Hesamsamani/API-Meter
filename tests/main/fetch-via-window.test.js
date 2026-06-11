import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponseBody, postViaWindow } from '../../src/main/fetch-via-window.js';

test('parseResponseBody parses valid JSON', () => {
  const data = parseResponseBody('{"ok":true}');
  assert.deepEqual(data, { ok: true });
});

test('postViaWindow is exported', () => {
  assert.equal(typeof postViaWindow, 'function');
});

test('parseResponseBody rejects cloudflare challenge HTML', () => {
  assert.throws(
    () => parseResponseBody('Just a moment...'),
    /CloudflareBlocked/,
  );
});