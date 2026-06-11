const { session } = require('electron');

const PARTITION = 'persist:api-meter';

function getProviderSession() {
  return session.fromPartition(PARTITION);
}

/**
 * @param {import('electron').Session} ses
 * @param {import('electron').CookiesSetDetails} details
 */
async function setCookie(ses, details) {
  await ses.cookies.set(details);
}

/**
 * @param {import('electron').Session} ses
 * @param {import('electron').CookiesSetDetails[]} cookies
 */
async function setCookies(ses, cookies) {
  for (const cookie of cookies) {
    await setCookie(ses, cookie);
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

async function syncElectronCookiesToPartition(opts) {
  const ses = getProviderSession();
  const names = opts.cookieNames || [opts.cookieName].filter(Boolean);
  const hits = await findSessionCookies(ses, {
    urls: cookieUrlsFor(opts),
    domain: opts.domain,
    names,
  });
  if (!hits.length) return null;

  const primary = hits.find((c) => names.includes(c.name)) || hits[0];
  for (const hit of hits) {
    await setCookies(ses, [{
      url: opts.loginUrl || `https://${hit.domain?.replace(/^\./, '') || 'localhost'}`,
      name: hit.name,
      value: hit.value,
      domain: hit.domain || opts.domain,
      path: hit.path || '/',
      secure: hit.secure !== false,
      sameSite: 'no_restriction',
    }]);
  }
  await flushCookies(ses);
  return primary;
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