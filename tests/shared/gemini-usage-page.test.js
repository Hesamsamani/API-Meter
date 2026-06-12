import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_USAGE_PAGE_URL,
  classifyBucketKey,
  parseGeminiUsagePageSource,
  mapUsagePageToSnapshot,
} from '../../src/shared/gemini-usage-page.js';

test('GEMINI_USAGE_PAGE_URL matches official usage route', () => {
  assert.equal(GEMINI_USAGE_PAGE_URL, 'https://gemini.google.com/usage?pageId=none');
});

test('classifyBucketKey maps usage labels to window keys', () => {
  assert.equal(classifyBucketKey('Gemini 3.1 Pro'), 'pro');
  assert.equal(classifyBucketKey('Thinking model'), 'thinking');
  assert.equal(classifyBucketKey('Fast Flash'), 'flash');
});

test('parseGeminiUsagePageSource reads progressbar buckets from collector payload', () => {
  const parsed = parseGeminiUsagePageSource({
    buckets: [
      { label: 'Gemini 3.1 Pro', used: 25, limit: 100 },
      { label: 'Thinking', used: 4, limit: 300 },
    ],
  });
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].key, 'pro');
  assert.equal(parsed.windows[0].utilization, 25);
  assert.equal(parsed.windows[1].key, 'thinking');
  assert.equal(parsed.windows[1].utilization, Math.round((4 / 300) * 100));
});

test('parseGeminiUsagePageSource extracts tiered quota from embedded html json', () => {
  const html = '<script>{"dayUsed":12,"dayLimit":100,"tier":"pro"}</script>';
  const parsed = parseGeminiUsagePageSource({ buckets: [], html });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].key, 'pro');
  assert.equal(parsed.windows[0].utilization, 12);
});

test('mapUsagePageToSnapshot attaches reset timestamps', () => {
  const snap = mapUsagePageToSnapshot([
    { key: 'pro', label: 'PRO', utilization: 40 },
  ]);
  assert.equal(snap.windows[0].label, 'PRO');
  assert.ok(snap.windows[0].resetsAt);
});