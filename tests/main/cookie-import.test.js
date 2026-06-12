import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  looksLikeCookiePaste,
  isGeminiBatchExecuteProbe,
  buildGeminiProbePostUrl,
} from '../../src/main/cookie-import.js';

const cookieImportSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/cookie-import.js'),
  'utf8',
);

const ETC_EXPORT = JSON.stringify([
  { domain: '.claude.ai', name: 'sessionKey', path: '/', secure: true, value: 'x', httpOnly: true },
]);

test('looksLikeCookiePaste detects cookie strings', () => {
  assert.equal(looksLikeCookiePaste('a=1; b=2'), true);
  assert.equal(looksLikeCookiePaste('Cookie: session=x'), true);
  assert.equal(looksLikeCookiePaste('[{"name":"x","value":"y"}]'), true);
  assert.equal(looksLikeCookiePaste(ETC_EXPORT), true);
  assert.equal(looksLikeCookiePaste('bare-token-only'), false);
});

test('isGeminiBatchExecuteProbe matches gemini batchexecute probes only', () => {
  const probeUrl = 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b';
  assert.equal(isGeminiBatchExecuteProbe({ providerId: 'gemini', probeUrl }), true);
  assert.equal(isGeminiBatchExecuteProbe({ secretKey: 'gemini-session', probeUrl }), true);
  assert.equal(isGeminiBatchExecuteProbe({ providerId: 'claude-ai', probeUrl }), false);
  assert.equal(isGeminiBatchExecuteProbe({ probeUrl: 'https://claude.ai/api/organizations' }), false);
});

test('verifyImportedSession Gemini probe uses GEMINI_POST_TIMEOUT_MS', () => {
  assert.match(cookieImportSrc, /GEMINI_POST_TIMEOUT_MS/);
  assert.match(cookieImportSrc, /timeoutMs:\s*GEMINI_POST_TIMEOUT_MS/);
});

test('buildGeminiProbePostUrl normalizes batchexecute URL for POST', () => {
  const url = buildGeminiProbePostUrl(
    'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b',
  );
  assert.match(url, /batchexecute\?rpcids=otAQ7b/);
  assert.match(url, /rt=c/);
  assert.match(url, /_reqid=\d+/);
});