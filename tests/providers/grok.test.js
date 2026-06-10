// tests/providers/grok.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mapGrokBilling, readGrokAuth } from '../../src/providers/grok.js';

test('mapGrokBilling maps credits utilization', () => {
  const snap = mapGrokBilling(
    { config: { used: { val: 25 }, monthlyLimit: { val: 100 }, billingPeriodEnd: '2026-07-01' } },
    { subscription_tier_display: 'SuperGrok' },
  );
  assert.equal(snap.providerId, 'grok');
  assert.equal(snap.windows[0].label, 'CRD');
  assert.equal(snap.windows[0].utilization, 25);
  assert.equal(snap.plan, 'SuperGrok');
});

test('readGrokAuth reads nested Grok CLI auth format', () => {
  const dir = join(tmpdir(), `grok-auth-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const authFile = join(dir, 'auth.json');
  writeFileSync(
    authFile,
    JSON.stringify({
      'https://auth.x.ai::test': { key: 'jwt-token', refresh_token: 'rt' },
    }),
  );
  const orig = process.env.USERPROFILE;
  const home = join(tmpdir(), `home-grok-${Date.now()}`);
  mkdirSync(join(home, '.grok'), { recursive: true });
  writeFileSync(join(home, '.grok', 'auth.json'), readFileSync(authFile));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    const auth = readGrokAuth();
    assert.equal(auth.access_token, 'jwt-token');
  } finally {
    process.env.USERPROFILE = orig;
    delete process.env.HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});