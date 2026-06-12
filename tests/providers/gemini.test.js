import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseGeminiBatchExecute,
  extractGeminiQuota,
  buildGeminiQuotaReqBody,
  inferGeminiPlan,
  GEMINI_QUOTA_BATCH_URL,
  GEMINI_POST_TIMEOUT_MS,
  GEMINI_USAGE_PAGE_URL,
  buildGeminiQuotaBatchUrl,
  GEMINI_COOKIE_NAMES,
} from '../../src/providers/gemini.js';

const geminiSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/providers/gemini.js'),
  'utf8',
);
import { extractGeminiPageTokens } from '../../src/shared/gemini-page-tokens.js';

test('fetchLiveGemini uses shared GEMINI_POST_TIMEOUT_MS', () => {
  assert.equal(GEMINI_POST_TIMEOUT_MS, 75000);
  assert.match(geminiSrc, /timeoutMs:\s*GEMINI_POST_TIMEOUT_MS/);
});

test('gemini adapter exposes reset that purges google cookies and reopens auth', () => {
  assert.ok(GEMINI_COOKIE_NAMES.includes('__Secure-1PSID'));
  assert.match(geminiSrc, /async reset\(\)/);
  assert.match(geminiSrc, /purgeAllGoogleCookies:\s*true/);
  assert.match(geminiSrc, /loginUrl:\s*GEMINI_USAGE_PAGE_URL/);
});

test('fetchLiveGemini prefers official usage page then batchexecute fallback', () => {
  assert.equal(GEMINI_USAGE_PAGE_URL, 'https://gemini.google.com/usage?pageId=none');
  assert.match(geminiSrc, /fetchGeminiFromUsagePage/);
  assert.match(geminiSrc, /fetchGeminiFromBatchExecute/);
  assert.match(buildGeminiQuotaBatchUrl(), /source-path=%2Fusage/);
});

test('extractGeminiQuota rejects implausible numeric pairs', () => {
  const swapped = extractGeminiQuota([null, [1000, 12]]);
  assert.equal(swapped.dayUsed, undefined);
  assert.equal(swapped.dayLimit, undefined);
  const valid = extractGeminiQuota([null, [12, 1000]]);
  assert.equal(valid.dayUsed, 12);
  assert.equal(valid.dayLimit, 1000);
});

test('buildGeminiQuotaReqBody encodes otAQ7b batchexecute payload', () => {
  const body = buildGeminiQuotaReqBody();
  assert.match(body, /^f\.req=/);
  const fReq = decodeURIComponent(body.slice('f.req='.length));
  assert.deepEqual(JSON.parse(fReq), [[['otAQ7b', '[]', null, 'generic']]]);
  assert.match(GEMINI_QUOTA_BATCH_URL, /rpcids=otAQ7b/);
});

test('parseGeminiBatchExecute strips XSS prefix and parses nested JSON', () => {
  const inner = { dayUsed: 12, dayLimit: 1000 };
  const body = `)]}'\n\n[["wrb.fr","otAQ7b",${JSON.stringify(JSON.stringify(inner))},null,null]]`;
  const parsed = parseGeminiBatchExecute(body);
  assert.ok(parsed);
  const quota = extractGeminiQuota(parsed);
  assert.equal(quota.dayUsed, 12);
  assert.equal(quota.dayLimit, 1000);
});

test('parseGeminiBatchExecute prefers otAQ7b row over other rpc ids', () => {
  const otInner = { dayUsed: 7, dayLimit: 1000 };
  const otherInner = { dayUsed: 99, dayLimit: 1000 };
  const body = `)]}'\n\n[["wrb.fr","otherRpc",${JSON.stringify(JSON.stringify(otherInner))},null,null],["wrb.fr","otAQ7b",${JSON.stringify(JSON.stringify(otInner))},null,null]]`;
  const parsed = parseGeminiBatchExecute(body);
  const quota = extractGeminiQuota(parsed);
  assert.equal(quota.dayUsed, 7);
  assert.equal(quota.dayLimit, 1000);
});

test('extractGeminiPageTokens reads SNlM0e, FdrFJe, and bl from page HTML', () => {
  const html = '"SNlM0e":"abc123","FdrFJe":"1234567890","bl":"boq_assistant-bard-web-server_20260101.00_p0"';
  const tokens = extractGeminiPageTokens(html);
  assert.equal(tokens.at, 'abc123');
  assert.equal(tokens.sid, '1234567890');
  assert.match(tokens.bl, /boq_assistant-bard-web-server_/);
});

test('extractGeminiPageTokens reads escaped SNlM0e from script payloads', () => {
  const html = 'SNlM0e\\":\\"token-from-script\\",\\"FdrFJe\\":\\"9876543210\\"';
  const tokens = extractGeminiPageTokens(html);
  assert.equal(tokens.at, 'token-from-script');
  assert.equal(tokens.sid, '9876543210');
});

test('extractGeminiPageTokens finds bl in cfb2h field', () => {
  const html = '"cfb2h":"boq_assistant-bard-web-server_20260301.00_p0"';
  const tokens = extractGeminiPageTokens(html);
  assert.match(tokens.bl, /boq_assistant-bard-web-server_20260301/);
});

test('extractGeminiQuota parses nested numeric pair arrays', () => {
  const quota = extractGeminiQuota([null, [12, 1000]]);
  assert.equal(quota.dayUsed, 12);
  assert.equal(quota.dayLimit, 1000);
});

test('inferGeminiPlan maps tier and limit hints', () => {
  assert.equal(inferGeminiPlan({ tier: 'ultra' }), 'Ultra');
  assert.equal(inferGeminiPlan({ dayLimit: 50 }), 'Free');
  assert.equal(inferGeminiPlan({ dayLimit: 1000 }), 'AI Pro');
});

test('parseGeminiBatchExecute skips Google length-prefixed batchexecute lines', () => {
  const inner = { dayUsed: 42, dayLimit: 1000 };
  const json = `[["wrb.fr","otAQ7b",${JSON.stringify(JSON.stringify(inner))},null,null]]`;
  const body = `)]}'\n\n${json.length}\n${json}`;
  const parsed = parseGeminiBatchExecute(body);
  const quota = extractGeminiQuota(parsed);
  assert.equal(quota.dayUsed, 42);
  assert.equal(quota.dayLimit, 1000);
});