import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapUsage,
  extractOrgId,
  validateOrganizationsProbe,
  CLAUDE_COOKIE_NAMES,
} from '../../src/providers/claude-ai.js';

test('CLAUDE_COOKIE_NAMES prioritizes sessionKey', () => {
  assert.deepEqual(CLAUDE_COOKIE_NAMES, ['sessionKey', 'anthropic-session']);
});

test('extractOrgId handles array response', () => {
  const orgs = [{ uuid: 'org-1', name: 'Personal' }];
  assert.equal(extractOrgId(orgs), 'org-1');
});

test('extractOrgId handles organizations wrapper', () => {
  const orgs = { organizations: [{ uuid: 'org-2' }] };
  assert.equal(extractOrgId(orgs), 'org-2');
});

test('extractOrgId handles data wrapper', () => {
  const orgs = { data: [{ uuid: 'org-3' }] };
  assert.equal(extractOrgId(orgs), 'org-3');
});

test('extractOrgId returns null for empty or invalid payloads', () => {
  assert.equal(extractOrgId(null), null);
  assert.equal(extractOrgId([]), null);
  assert.equal(extractOrgId({}), null);
  assert.equal(extractOrgId({ organizations: [] }), null);
});

test('validateOrganizationsProbe passes when org id present', () => {
  assert.equal(validateOrganizationsProbe([{ uuid: 'x' }]), null);
});

test('validateOrganizationsProbe fails when org id missing', () => {
  assert.match(
    validateOrganizationsProbe({ organizations: [] }),
    /sessionKey/i,
  );
});

test('mapUsage maps five_hour and seven_day windows', () => {
  const windows = mapUsage({
    five_hour: { utilization: 42, resets_at: '2026-06-11T12:00:00Z' },
    seven_day: { utilization: 10, resets_at: '2026-06-18T12:00:00Z' },
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].key, 'five_hour');
  assert.equal(windows[0].utilization, 42);
  assert.equal(windows[1].key, 'seven_day');
});