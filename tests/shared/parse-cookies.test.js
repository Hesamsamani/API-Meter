import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookieString,
  pickSessionCookie,
} from '../../src/shared/parse-cookies.js';

describe('parseCookieString', () => {
  it('parses semicolon-separated document.cookie style', () => {
    const out = parseCookieString('sessionKey=abc123; foo=bar');
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { name: 'sessionKey', value: 'abc123', path: '/' });
    assert.deepEqual(out[1], { name: 'foo', value: 'bar', path: '/' });
  });

  it('strips Cookie: header prefix', () => {
    const out = parseCookieString('Cookie: pplx.session=token99; other=x');
    assert.equal(out[0].name, 'pplx.session');
    assert.equal(out[0].value, 'token99');
  });

  it('parses JSON array from DevTools export', () => {
    const json = JSON.stringify([
      { name: '__Secure-1PSID', value: 'sid-value' },
      { name: 'SID', value: 'sid2' },
    ]);
    const out = parseCookieString(json);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, '__Secure-1PSID');
  });

  it('parses Netscape cookie file rows', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '.google.com\tTRUE\t/\tTRUE\t0\t__Secure-1PSID\tsid123',
      '.google.com\tTRUE\t/\tTRUE\t0\tSID\tsid456',
    ].join('\n');
    const out = parseCookieString(text);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, '__Secure-1PSID');
    assert.equal(out[0].domain, '.google.com');
  });

  it('returns empty for bare token without equals', () => {
    assert.deepEqual(parseCookieString('only-a-token-value'), []);
  });
});

describe('pickSessionCookie', () => {
  it('prefers named session cookies', () => {
    const parsed = [
      { name: 'foo', value: '1' },
      { name: 'sessionKey', value: 'real' },
    ];
    const hit = pickSessionCookie(parsed, ['sessionKey', 'anthropic-session']);
    assert.equal(hit.name, 'sessionKey');
    assert.equal(hit.value, 'real');
  });
});