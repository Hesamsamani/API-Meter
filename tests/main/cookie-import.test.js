import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCookiePaste } from '../../src/main/cookie-import.js';

test('looksLikeCookiePaste detects cookie strings', () => {
  assert.equal(looksLikeCookiePaste('a=1; b=2'), true);
  assert.equal(looksLikeCookiePaste('Cookie: session=x'), true);
  assert.equal(looksLikeCookiePaste('[{"name":"x","value":"y"}]'), true);
  assert.equal(looksLikeCookiePaste('bare-token-only'), false);
});