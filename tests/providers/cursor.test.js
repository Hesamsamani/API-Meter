// tests/providers/cursor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCursorUsage } from '../../src/providers/cursor.js';

test('mapCursorUsage uses totalPercentUsed', () => {
  const snap = mapCursorUsage({
    planInfo: { planName: 'Free', price: '$0/mo' },
    usage: {
      billingCycleEnd: '1771077734000',
      planUsage: { totalPercentUsed: 46.4, autoPercentUsed: 10, apiPercentUsed: 20 },
    },
  });
  assert.equal(snap.plan, 'Free');
  assert.equal(snap.windows[0].utilization, 46);
  assert.equal(snap.windows[1].label, 'AUTO');
});