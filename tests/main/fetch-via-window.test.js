import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResponseBody,
  postViaWindow,
  geminiLoadCandidates,
  waitForGeminiTokens,
} from '../../src/main/fetch-via-window.js';

test('parseResponseBody parses valid JSON', () => {
  const data = parseResponseBody('{"ok":true}');
  assert.deepEqual(data, { ok: true });
});

test('postViaWindow is exported', () => {
  assert.equal(typeof postViaWindow, 'function');
});

test('geminiLoadCandidates tries root and app paths', () => {
  const urls = geminiLoadCandidates('https://gemini.google.com/');
  assert.deepEqual(urls, [
    'https://gemini.google.com/',
    'https://gemini.google.com/app',
  ]);
});

test('waitForGeminiTokens is exported for gemini quota polling', () => {
  assert.equal(typeof waitForGeminiTokens, 'function');
});

test('parseResponseBody rejects cloudflare challenge HTML', () => {
  assert.throws(
    () => parseResponseBody('Just a moment...'),
    /CloudflareBlocked/,
  );
});