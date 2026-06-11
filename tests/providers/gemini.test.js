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