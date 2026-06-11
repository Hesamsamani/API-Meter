import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAlertThresholds,
  getAlertThresholds,
  thresholdClass,
} from '../../src/shared/alert-thresholds.js';

test('thresholdClass uses configured warn and danger thresholds', () => {
  setAlertThresholds({ warnThreshold: 80, dangerThreshold: 95 });
  assert.equal(thresholdClass(50), 'green');
  assert.equal(thresholdClass(80), 'amber');
  assert.equal(thresholdClass(95), 'red');
  assert.deepEqual(getAlertThresholds(), { warnThreshold: 80, dangerThreshold: 95 });
  setAlertThresholds({ warnThreshold: 75, dangerThreshold: 90 });
});