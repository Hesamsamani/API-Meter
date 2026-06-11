import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCookieSetDetails } from '../../src/main/provider-session.js';

test('buildCookieSetDetails aligns claude sessionKey url and domain', () => {
  const details = buildCookieSetDetails({
    name: 'sessionKey',
    value: 'sk-ant-sid01-test',
    domain: '.claude.ai',
    path: '/',
    secure: true,
    sameSite: 'lax',
    httpOnly: true,
  }, { loginUrl: 'https://claude.ai/', domain: '.claude.ai' });

  assert.equal(details.name, 'sessionKey');
  assert.equal(details.domain, '.claude.ai');
  assert.ok(details.url.startsWith('https://claude.ai'));
  assert.equal(details.sameSite, 'lax');
});

test('buildCookieSetDetails omits domain for __Host- cookies', () => {
  const details = buildCookieSetDetails({
    name: '__Host-test',
    value: 'abc',
    domain: '.claude.ai',
    path: '/',
    secure: true,
  }, { domain: '.claude.ai' });

  assert.equal(details.domain, undefined);
  assert.equal(details.path, '/');
  assert.equal(details.secure, true);
});

test('buildCookieSetDetails returns null for empty values', () => {
  assert.equal(buildCookieSetDetails({ name: 'x', value: '' }), null);
  assert.equal(buildCookieSetDetails({ name: '', value: 'y' }), null);
});