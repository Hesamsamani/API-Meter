// tests/providers/perplexity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPerplexityRateLimits } from '../../src/providers/perplexity.js';

test('mapPerplexityRateLimits converts remaining to utilization', () => {
  const snap = mapPerplexityRateLimits({
    remaining_pro: 140,
    remaining_research: 5,
  });
  const pro = snap.windows.find((w) => w.key === 'pro');
  assert.equal(pro.utilization, 30);
  assert.equal(snap.plan, 'Pro');
});