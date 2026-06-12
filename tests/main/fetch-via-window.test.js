import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResponseBody,
  postViaWindow,
  geminiLoadCandidates,
  waitForGeminiTokens,
  verifyGeminiPageSession,
  GEMINI_USAGE_PAGE_URL,
} from '../../src/main/fetch-via-window.js';

test('parseResponseBody parses valid JSON', () => {
  const data = parseResponseBody('{"ok":true}');
  assert.deepEqual(data, { ok: true });
});

test('postViaWindow is exported', () => {
  assert.equal(typeof postViaWindow, 'function');
});

test('geminiLoadCandidates prioritizes official usage page', () => {
  const urls = geminiLoadCandidates('https://gemini.google.com/');
  assert.equal(urls[0], GEMINI_USAGE_PAGE_URL);
  assert.ok(urls.includes('https://gemini.google.com/usage?pageId=none'));
  assert.ok(urls.includes('https://gemini.google.com/app'));
});

test('verifyGeminiPageSession is exported for cookie paste verification', () => {
  assert.equal(typeof verifyGeminiPageSession, 'function');
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