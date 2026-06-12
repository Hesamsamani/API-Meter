import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_USAGE_PAGE_URL,
  classifyBucketKey,
  parseGeminiUsagePageSource,
  mapUsagePageToSnapshot,
  parseGeminiResetTime,
  parseResetTimesFromPageText,
  bucketLabelForKey,
} from '../../src/shared/gemini-usage-page.js';

test('GEMINI_USAGE_PAGE_URL matches official usage route', () => {
  assert.equal(GEMINI_USAGE_PAGE_URL, 'https://gemini.google.com/usage?pageId=none');
});

test('classifyBucketKey maps official usage labels to window keys', () => {
  assert.equal(classifyBucketKey('Current usage'), 'current');
  assert.equal(classifyBucketKey('Weekly limit'), 'weekly');
  assert.equal(classifyBucketKey('Gemini 3.1 Pro'), 'pro');
  assert.equal(classifyBucketKey('Thinking model'), 'thinking');
  assert.equal(classifyBucketKey('', 'current'), 'current');
});

test('bucketLabelForKey uses compact 5H and WEEK labels', () => {
  assert.equal(bucketLabelForKey('current'), '5H');
  assert.equal(bucketLabelForKey('weekly'), 'WEEK');
});

test('parseGeminiUsagePageSource reads 5-hour and weekly percent cards', () => {
  const pageText = [
    'Usage limits',
    'PRO',
    'Current usage',
    '2% used',
    'Resets at 10:04 AM',
    'Weekly limit',
    '3% used',
    'Resets Jun 16 at 11:04 AM',
  ].join('\n');
  const parsed = parseGeminiUsagePageSource({
    buckets: [
      { label: 'Current usage', used: 2, limit: 100, kind: 'current' },
      { label: 'Weekly limit', used: 3, limit: 100, kind: 'weekly' },
    ],
    pageText,
    resetTimes: {
      current: '10:04 AM',
      weekly: 'Jun 16 at 11:04 AM',
    },
  });
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].key, 'current');
  assert.equal(parsed.windows[0].label, '5H');
  assert.equal(parsed.windows[0].utilization, 2);
  assert.equal(parsed.windows[1].key, 'weekly');
  assert.equal(parsed.windows[1].label, 'WEEK');
  assert.equal(parsed.windows[1].utilization, 3);
});

test('parseGeminiUsagePageSource still reads legacy progressbar buckets', () => {
  const parsed = parseGeminiUsagePageSource({
    buckets: [
      { label: 'Gemini 3.1 Pro', used: 25, limit: 100 },
      { label: 'Thinking', used: 4, limit: 300 },
    ],
  });
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].key, 'pro');
  assert.equal(parsed.windows[0].utilization, 25);
});

test('parseGeminiUsagePageSource drops day bucket when rolling limits are present', () => {
  const parsed = parseGeminiUsagePageSource({
    buckets: [
      { label: 'Current usage', used: 2, limit: 100, kind: 'current' },
      { label: 'Weekly limit', used: 3, limit: 100, kind: 'weekly' },
      { label: 'Day', used: 2, limit: 100 },
    ],
  });
  assert.equal(parsed.windows.length, 2);
  assert.ok(!parsed.windows.some((w) => w.key === 'day'));
});

test('parseResetTimesFromPageText extracts reset strings from usage page text', () => {
  const text = [
    'Current usage',
    '2% used',
    'Resets at 10:04 AM',
    'Weekly limit',
    '3% used',
    'Resets Jun 16 at 11:04 AM',
  ].join('\n');
  const resets = parseResetTimesFromPageText(text);
  assert.equal(resets.current, '10:04 AM');
  assert.equal(resets.weekly, 'Jun 16 at 11:04 AM');
});

test('parseGeminiResetTime parses time-only and dated reset strings', () => {
  const now = new Date('2026-06-12T05:00:00');
  const sameDay = parseGeminiResetTime('10:04 AM', now);
  assert.ok(sameDay);
  assert.equal(new Date(sameDay).getHours(), 10);
  assert.equal(new Date(sameDay).getMinutes(), 4);

  const weekly = parseGeminiResetTime('Jun 16 at 11:04 AM', now);
  assert.ok(weekly);
  assert.equal(new Date(weekly).getMonth(), 5);
  assert.equal(new Date(weekly).getDate(), 16);
});

test('mapUsagePageToSnapshot attaches per-window reset timestamps', () => {
  const snap = mapUsagePageToSnapshot(
    [
      { key: 'current', label: '5H', utilization: 2 },
      { key: 'weekly', label: 'WEEK', utilization: 3 },
    ],
    {
      resetTimes: {
        current: '10:04 AM',
        weekly: 'Jun 16 at 11:04 AM',
      },
    },
  );
  assert.equal(snap.windows[0].label, '5H');
  assert.equal(snap.windows[1].label, 'WEEK');
  assert.ok(snap.windows[0].resetsAt);
  assert.ok(snap.windows[1].resetsAt);
});