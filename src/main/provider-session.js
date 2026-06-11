const { session } = require('electron');

const PARTITION = 'persist:api-meter';

function getProviderSession() {
  return session.fromPartition(PARTITION);
}

function cookieSetUrlFromParts({ domain, path, secure }) {
  const host = (domain || '').replace(/^\./, '') || 'localhost';
  const scheme = secure !== false ? 'https' : 'http';
  const p = path?.startsWith('/') ? path : `/${path || ''}`;
  return `${scheme}://${host}${p}`;
}

function normalizeSameSite(val) {
  const v = String(val || '').toLowerCase();
  if (v === 'none') return 'no_restriction';
  if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(v)) return v;
  return 'lax';
}

/**
 * Build Electron-safe cookie.set details with url/domain alignment.
 * @param {object} raw
 * @param {{ domain?: string, loginUrl?: string, sameSite?: string }} [fallback]
 */
function buildCookieSetDetails(raw, fallback = {}) {
  const name = raw?.name;
  const value = raw?.value == null ? '' : String(raw.value);
  if (!name || !value) return null;

  const domain = raw.domain || fallback.domain;
  const path = raw.path || '/';
  const secure = raw.secure !== false;
  let url = raw.url || fallback.loginUrl || cookieSetUrlFromParts({ domain, path, secure });

  const details = {
    url,
    name,
    value,
    path: path || '/',
    secure,
    sameSite: normalizeSameSite(raw.sameSite || fallback.sameSite || 'lax'),
  };

  if (name.startsWith('__Host-')) {
    details.path = '/';
    details.secure = true;
    const host = (domain || fallback.domain || '').replace(/^\./, '') || 'localhost';
    details.url = `https://${host}/`;
  } else if (domain) {
    const host = domain.replace(/^\./, '');
    details.domain = domain.startsWith('.') ? domain : `.${host}`;
    try {
      const parsed = new URL(details.url);
      if (!parsed.hostname.endsWith(host)) {
        details.url = cookieSetUrlFromParts({ domain, path: details.path, secure });
      }
    } catch {
      details.url = cookieSetUrlFromParts({ domain, path: details.path, secure });
    }
  }

  if (raw.httpOnly === true) details.httpOnly = true;
  if (Number.isFinite(raw.expirationDate)) details.expirationDate = raw.expirationDate;

  return details;
}

/**
 * @param {import('electron').Session} ses
 * @param {object} raw
 * @param {{ domain?: string, loginUrl?: string }} [fallback]
 */
async function setCookie(ses, raw, fallback = {}) {
  const details = buildCookieSetDetails(raw, fallback);
  if (!details) return false;

  const attempts = [
    details,
    { ...details, httpOnly: undefined },
    { ...details, sameSite: 'lax', httpOnly: undefined },
    { ...details, sameSite: 'unspecified', httpOnly: undefined },
    {
      url: details.url,
      name: details.name,
      value: details.value,
      path: details.path || '/',
      secure: details.secure,
      ...(details.domain ? { domain: details.domain } : {}),
    },
    {
      url: details.url,
      name: details.name,
      value: details.value,
      path: details.path || '/',
      secure: details.secure,
    },
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      await ses.cookies.set(attempt);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`Setting cookie failed (${details.name}): ${lastErr?.message || lastErr}`);
}

/**
 * @param {import('electron').Session} ses
 * @param {object[]} cookies
 * @param {{ domain?: string, loginUrl?: string, requiredNames?: string[] }} [opts]
 */
async function setCookies(ses, cookies, opts = {}) {
  const required = new Set(opts.requiredNames || []);
  const failures = [];

  for (const cookie of cookies) {
    try {
      await setCookie(ses, cookie, opts);
    } catch (err) {
      failures.push(err);
      if (required.has(cookie.name)) throw err;
    }
  }

  if (failures.length && failures.length === cookies.length) {
    throw failures[0];
  }
}

async function flushCookies(ses) {
  if (typeof ses.cookies.flushStore === 'function') {
    await ses.cookies.flushStore();
  }
}

function cookieUrlsFor(opts) {
  const urls = new Set();
  if (opts.loginUrl) {
    urls.add(opts.loginUrl);
    try {
      const origin = new URL(opts.loginUrl).origin;
      urls.add(`${origin}/`);
      if (origin.includes('claude.ai')) {
        urls.add(`${origin}/chat`);
        urls.add(`${origin}/new`);
      }
    } catch { /* ignore */ }
  }
  if (opts.domain) {
    const host = opts.domain.replace(/^\./, '');
    urls.add(`https://${host}/`);
    urls.add(`https://www.${host}/`);
    if (host === 'claude.ai') {
      urls.add(`https://${host}/chat`);
      urls.add(`https://${host}/new`);
    }
  }
  return [...urls];
}

/**
 * @param {import('electron').Session} ses
 * @param {string} domain
 */
async function findAllDomainCookies(ses, domain) {
  const host = domain.replace(/^\./, '');
  const seen = new Map();
  for (const query of [{ domain: host }, { domain }]) {
    const cookies = await ses.cookies.get(query);
    for (const cookie of cookies) {
      if (cookie.value && !seen.has(cookie.name)) seen.set(cookie.name, cookie);
    }
  }
  return [...seen.values()];
}

/**
 * @param {import('electron').Session} ses
 * @param {{ url?: string, urls?: string[], domain?: string, names?: string[] }} opts
 */
async function findSessionCookies(ses, { url, urls = [], domain, names = [] }) {
  const queryUrls = [...new Set([...(url ? [url] : []), ...urls])];
  const seen = new Map();

  for (const queryUrl of queryUrls) {
    const cookies = await ses.cookies.get({ url: queryUrl });
    for (const cookie of cookies) {
      if (!names.length || names.includes(cookie.name)) {
        if (cookie.value && !seen.has(cookie.name)) seen.set(cookie.name, cookie);
      }
    }
  }

  if (!seen.size && domain) {
    const host = domain.replace(/^\./, '');
    const domainCookies = await ses.cookies.get({ domain: host });
    for (const cookie of domainCookies) {
      if (!names.length || names.includes(cookie.name)) {
        if (cookie.value && !seen.has(cookie.name)) seen.set(cookie.name, cookie);
      }
    }
    const dotCookies = await ses.cookies.get({ domain });
    for (const cookie of dotCookies) {
      if (!names.length || names.includes(cookie.name)) {
        if (cookie.value && !seen.has(cookie.name)) seen.set(cookie.name, cookie);
      }
    }
  }

  return [...seen.values()];
}

async function findSessionCookie(ses, opts) {
  const hits = await findSessionCookies(ses, opts);
  if (!opts.names?.length) return hits[0] || null;
  for (const name of opts.names) {
    const hit = hits.find((c) => c.name === name);
    if (hit?.value) return hit;
  }
  return hits[0] || null;
}

/** Cookies already live in the partition after login/import — just locate the primary. */
async function syncElectronCookiesToPartition(opts) {
  const ses = getProviderSession();
  const names = opts.cookieNames || [opts.cookieName].filter(Boolean);
  const hits = await findSessionCookies(ses, {
    urls: cookieUrlsFor(opts),
    domain: opts.domain,
    names,
  });
  if (!hits.length) return null;
  return hits.find((c) => names.includes(c.name)) || hits[0];
}

async function clearProviderCookies({ domain, names = [] }) {
  const ses = getProviderSession();
  const host = domain?.replace(/^\./, '');
  if (!host) return;

  const all = [
    ...(await ses.cookies.get({ domain: host })),
    ...(await ses.cookies.get({ domain: `.${host}` })),
  ];

  for (const cookie of all) {
    if (names.length && !names.includes(cookie.name)) continue;
    const scheme = cookie.secure ? 'https' : 'http';
    const cookieDomain = cookie.domain?.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    const url = `${scheme}://${cookieDomain}${cookie.path || '/'}`;
    try {
      await ses.cookies.remove(url, cookie.name);
    } catch { /* ignore */ }
  }
  await flushCookies(ses);
}

module.exports = {
  PARTITION,
  getProviderSession,
  buildCookieSetDetails,
  setCookie,
  setCookies,
  flushCookies,
  cookieUrlsFor,
  findSessionCookie,
  findSessionCookies,
  findAllDomainCookies,
  syncElectronCookiesToPartition,
  clearProviderCookies,
};