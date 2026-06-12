const { getSecret, setSecret } = require('./store');
const {
  getProviderSession,
  setCookies,
  flushCookies,
  findSessionCookies,
  cookieUrlsFor,
} = require('./provider-session');

const GEMINI_COOKIE_JAR_KEY = 'gemini-session-cookie-jar';
const GEMINI_PRIMARY_NAMES = ['__Secure-1PSID', '__Secure-3PSID', 'SID'];
const GEMINI_SESSION_OPTS = {
  loginUrl: 'https://gemini.google.com/usage?pageId=none',
  domain: '.google.com',
  cookieNames: [
    '__Secure-1PSID',
    '__Secure-3PSID',
    'SID',
    '__Secure-1PSIDTS',
    '__Secure-3PSIDTS',
    '__Secure-1PSIDCC',
    '__Secure-3PSIDCC',
  ],
};

function saveGeminiCookieJar(cookies) {
  const list = Array.isArray(cookies) ? cookies.filter((c) => c?.name && c?.value) : [];
  if (!list.length) {
    setSecret(GEMINI_COOKIE_JAR_KEY, '');
    return;
  }
  setSecret(GEMINI_COOKIE_JAR_KEY, JSON.stringify(list));
}

function loadGeminiCookieJar() {
  const raw = getSecret(GEMINI_COOKIE_JAR_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c) => c?.name && c?.value) : [];
  } catch {
    return [];
  }
}

function clearGeminiCookieJar() {
  setSecret(GEMINI_COOKIE_JAR_KEY, '');
}

async function findGeminiPartitionCookies() {
  const ses = getProviderSession();
  return findSessionCookies(ses, {
    urls: cookieUrlsFor(GEMINI_SESSION_OPTS),
    domain: GEMINI_SESSION_OPTS.domain,
    names: GEMINI_SESSION_OPTS.cookieNames,
  });
}

function partitionHasGeminiSession(cookies) {
  return cookies.some((c) => GEMINI_PRIMARY_NAMES.includes(c.name) && c.value);
}

/**
 * Keep imported Gemini cookies intact. Only seed the partition when empty.
 */
async function ensureGeminiCookiesInPartition() {
  const ses = getProviderSession();
  const existing = await findGeminiPartitionCookies();

  if (partitionHasGeminiSession(existing)) {
    await flushCookies(ses);
    return;
  }

  const jar = loadGeminiCookieJar();
  if (jar.length) {
    await setCookies(ses, jar, {
      loginUrl: GEMINI_SESSION_OPTS.loginUrl,
      domain: GEMINI_SESSION_OPTS.domain,
    });
    await flushCookies(ses);
    return;
  }

  const sid = getSecret('gemini-session');
  if (!sid) throw new Error('Gemini login required');

  const cookieName = getSecret('gemini-session-cookie-name') || '__Secure-1PSID';
  await setCookies(ses, [
    {
      url: 'https://google.com/',
      name: cookieName,
      value: sid,
      domain: '.google.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
    },
  ], {
    loginUrl: GEMINI_SESSION_OPTS.loginUrl,
    domain: GEMINI_SESSION_OPTS.domain,
    requiredNames: [cookieName],
  });
  await flushCookies(ses);
}

module.exports = {
  GEMINI_COOKIE_JAR_KEY,
  GEMINI_PRIMARY_NAMES,
  saveGeminiCookieJar,
  loadGeminiCookieJar,
  clearGeminiCookieJar,
  ensureGeminiCookiesInPartition,
  partitionHasGeminiSession,
  findGeminiPartitionCookies,
};