import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrayIconPng, createAppIconPng, drawMeterIcon, STATUS_RGB } from '../../src/main/tray-icon-buffer.js';

test('createTrayIconPng returns valid PNG signature', () => {
  const buf = createTrayIconPng('green', 16, 42);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf[0], 0x89);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  assert.ok(buf.length > 80);
});

test('createTrayIconPng supports all status levels and utilization fill', () => {
  const low = createTrayIconPng('green', 32, 10);
  const high = createTrayIconPng('red', 32, 95);
  assert.ok(low.length > 100);
  assert.ok(high.length > 100);

  const lowPx = Buffer.alloc(32 * 32 * 4, 0);
  const highPx = Buffer.alloc(32 * 32 * 4, 0);
  drawMeterIcon(lowPx, 32, { rgb: STATUS_RGB.green, utilization: 8, variant: 'tray' });
  drawMeterIcon(highPx, 32, { rgb: STATUS_RGB.green, utilization: 92, variant: 'tray' });
  assert.notDeepEqual(lowPx, highPx);
});

test('createAppIconPng returns large branded icon', () => {
  const buf = createAppIconPng(256, 38);
  assert.ok(buf.length > 2000);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
});