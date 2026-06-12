import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  partitionHasGeminiSession,
  GEMINI_PRIMARY_NAMES,
} from '../../src/main/gemini-cookie-jar.js';

const geminiJarSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/gemini-cookie-jar.js'),
  'utf8',
);
const geminiSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/providers/gemini.js'),
  'utf8',
);

test('partitionHasGeminiSession detects primary google session cookies', () => {
  assert.equal(partitionHasGeminiSession([{ name: 'NID', value: 'x' }]), false);
  assert.equal(partitionHasGeminiSession([{ name: '__Secure-1PSID', value: 'sid' }]), true);
  assert.ok(GEMINI_PRIMARY_NAMES.includes('__Secure-3PSID'));
});

test('ensureGeminiCookiesInPartition skips overwrite when partition already has session', () => {
  assert.match(geminiJarSrc, /if \(partitionHasGeminiSession\(existing\)\)/);
  assert.match(geminiJarSrc, /await flushCookies\(ses\);\s*return;/);
});

test('prepareGeminiSession delegates to ensureGeminiCookiesInPartition', () => {
  assert.match(geminiSrc, /ensureGeminiCookiesInPartition/);
  assert.doesNotMatch(geminiSrc, /url:\s*'https:\/\/gemini\.google\.com'/);
});

test('cookie import persists gemini cookie jar for refresh', () => {
  const cookieImportSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/cookie-import.js'),
    'utf8',
  );
  assert.match(cookieImportSrc, /saveGeminiCookieJar\(toSet\)/);
});