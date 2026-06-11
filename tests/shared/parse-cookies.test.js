import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookieString,
  pickSessionCookie,
  detectCookieExportFormat,
  filterCookiesForProvider,
  cookieSetUrl,
} from '../../src/shared/parse-cookies.js';

const EDITTHISCOOKIE_CLAUDE = JSON.stringify([
  {
    domain: '.claude.ai',
    expirationDate: 1780000000,
    hostOnly: false,
    httpOnly: true,
    name: 'sessionKey',
    path: '/',
    sameSite: 'lax',
    secure: true,
    session: false,
    storeId: '0',
    value: 'sk-ant-session-abc',
    id: 1,
  },
  {
    domain: '.claude.ai',
    hostOnly: false,
    httpOnly: false,
    name: 'anthropic-device-id',
    path: '/',
    secure: true,
    session: true,
    value: 'device-uuid',
    id: 2,
  },
  {
    domain: '.google.com',
    name: 'SID',
    path: '/',
    secure: true,
    value: 'wrong-domain',
    id: 3,
  },
]);

const EDITTHISCOOKIE_GEMINI = JSON.stringify([
  {
    domain: '.google.com',
    hostOnly: false,
    httpOnly: true,
    name: '__Secure-1PSID',
    path: '/',
    sameSite: 'no_restriction',
    secure: true,
    value: 'gemini-sid-1',
    id: 1,
  },
  {
    domain: '.google.com',
    name: '__Secure-3PSID',
    path: '/',
    secure: true,
    value: 'gemini-sid-3',
    id: 2,
  },
  {
    domain: '.google.com',
    name: 'NID',
    path: '/',
    secure: true,
    value: 'nid-value',
    id: 3,
  },
  {
    domain: '.perplexity.ai',
    name: 'pplx.session',
    path: '/',
    secure: true,
    value: 'other-site',
    id: 4,
  },
]);

describe('parseCookieString', () => {
  it('parses semicolon-separated document.cookie style', () => {
    const out = parseCookieString('sessionKey=abc123; foo=bar');
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'sessionKey');
    assert.equal(out[0].secure, true);
  });

  it('strips Cookie: header prefix', () => {
    const out = parseCookieString('Cookie: pplx.session=token99; other=x');
    assert.equal(out[0].name, 'pplx.session');
  });

  it('parses EditThisCookie JSON with full metadata', () => {
    const out = parseCookieString(EDITTHISCOOKIE_CLAUDE);
    assert.equal(out.length, 3);
    const session = out.find((c) => c.name === 'sessionKey');
    assert.equal(session.value, 'sk-ant-session-abc');
    assert.equal(session.domain, '.claude.ai');
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, 'lax');
    assert.equal(session.expirationDate, 1780000000);
  });

  it('parses Netscape cookie file rows', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '.google.com\tTRUE\t/\tTRUE\t0\t__Secure-1PSID\tsid123',
    ].join('\n');
    const out = parseCookieString(text);
    assert.equal(out[0].name, '__Secure-1PSID');
    assert.equal(out[0].domain, '.google.com');
    assert.equal(out[0].secure, true);
  });

  it('returns empty for bare token without equals', () => {
    assert.deepEqual(parseCookieString('only-a-token-value'), []);
  });
});

describe('detectCookieExportFormat', () => {
  it('detects EditThisCookie JSON', () => {
    assert.equal(detectCookieExportFormat(EDITTHISCOOKIE_GEMINI), 'editthiscookie-json');
  });
});

describe('filterCookiesForProvider', () => {
  it('keeps only claude.ai cookies from mixed EditThisCookie export', () => {
    const parsed = parseCookieString(EDITTHISCOOKIE_CLAUDE);
    const filtered = filterCookiesForProvider(parsed, {
      domain: '.claude.ai',
      loginUrl: 'https://claude.ai/login',
    });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((c) => c.domain?.includes('claude.ai')));
  });

  it('keeps google.com cookies for Gemini provider', () => {
    const parsed = parseCookieString(EDITTHISCOOKIE_GEMINI);
    const filtered = filterCookiesForProvider(parsed, {
      domain: '.google.com',
      loginUrl: 'https://gemini.google.com/',
    });
    assert.equal(filtered.length, 3);
    assert.ok(!filtered.some((c) => c.name === 'pplx.session'));
  });
});

describe('pickSessionCookie', () => {
  it('prefers named session cookies from EditThisCookie export', () => {
    const parsed = parseCookieString(EDITTHISCOOKIE_CLAUDE);
    const relevant = filterCookiesForProvider(parsed, { domain: '.claude.ai', loginUrl: 'https://claude.ai' });
    const hit = pickSessionCookie(relevant, ['sessionKey', 'anthropic-session']);
    assert.equal(hit.name, 'sessionKey');
    assert.equal(hit.value, 'sk-ant-session-abc');
  });

  it('picks __Secure-1PSID for Gemini from EditThisCookie export', () => {
    const parsed = parseCookieString(EDITTHISCOOKIE_GEMINI);
    const relevant = filterCookiesForProvider(parsed, { domain: '.google.com', loginUrl: 'https://gemini.google.com/' });
    const hit = pickSessionCookie(relevant, ['__Secure-1PSID', '__Secure-3PSID', 'SID']);
    assert.equal(hit.name, '__Secure-1PSID');
  });
});

describe('cookieSetUrl', () => {
  it('builds https URL from domain and path', () => {
    const url = cookieSetUrl({ domain: '.claude.ai', path: '/', secure: true });
    assert.equal(url, 'https://claude.ai/');
  });
});