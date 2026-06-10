import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiBatchExecute, extractGeminiQuota } from '../../src/providers/gemini.js';

test('parseGeminiBatchExecute strips XSS prefix and parses nested JSON', () => {
  const inner = { dayUsed: 12, dayLimit: 1000 };
  const body = `)]}'\n\n[["wrb.fr","otAQ7b",${JSON.stringify(JSON.stringify(inner))},null,null]]`;
  const parsed = parseGeminiBatchExecute(body);
  assert.ok(parsed);
  const quota = extractGeminiQuota(parsed);
  assert.equal(quota.dayUsed, 12);
  assert.equal(quota.dayLimit, 1000);
});