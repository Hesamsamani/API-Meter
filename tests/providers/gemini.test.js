import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGeminiBatchExecute,
  extractGeminiQuota,
  buildGeminiQuotaReqBody,
  GEMINI_QUOTA_BATCH_URL,
} from '../../src/providers/gemini.js';

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

test('parseGeminiBatchExecute skips Google length-prefixed batchexecute lines', () => {
  const inner = { dayUsed: 42, dayLimit: 1000 };
  const json = `[["wrb.fr","otAQ7b",${JSON.stringify(JSON.stringify(inner))},null,null]]`;
  const body = `)]}'\n\n${json.length}\n${json}`;
  const parsed = parseGeminiBatchExecute(body);
  const quota = extractGeminiQuota(parsed);
  assert.equal(quota.dayUsed, 42);
  assert.equal(quota.dayLimit, 1000);
});