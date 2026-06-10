import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponseBody } from '../../src/main/fetch-via-window.js';

test('parseResponseBody parses valid JSON', () => {
  const data = parseResponseBody('{"ok":true}');
  assert.deepEqual(data, { ok: true });
});

test('parseResponseBody rejects cloudflare challenge HTML', () => {
  assert.throws(
    () => parseResponseBody('Just a moment...'),
    /CloudflareBlocked/,
  );
});