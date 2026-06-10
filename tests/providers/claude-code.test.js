// tests/providers/claude-code.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapClaudeCodeResponse } from '../../src/providers/claude-code.js';

test('mapClaudeCodeResponse maps five_hour and seven_day', () => {
  const snap = mapClaudeCodeResponse({
    five_hour: { utilization: 0.1, resets_at: '2026-06-10T20:00:00Z' },
    seven_day: { utilization: 0.44, resets_at: '2026-06-12T20:00:00Z' },
    rate_limit_tier: 'default_claude_ai_pro',
  });
  assert.equal(snap.windows[0].label, '5H');
  assert.equal(snap.windows[0].utilization, 10);
  assert.equal(snap.windows[1].utilization, 44);
  assert.equal(snap.plan, 'Pro');
});