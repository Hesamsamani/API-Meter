const { parseCookieString, pickSessionCookie } = require('../shared/parse-cookies');
const { getProviderSession, setCookies, flushCookies } = require('./provider-session');
const { setSecret } = require('./store');
const { fetchViaWindow } = require('./fetch-via-window');

function looksLikeCookiePaste(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (text.startsWith('[')) return true;
  if (text.includes('\t') && text.includes('\n')) return true;
  if (/^cookie:\s*/i.test(text)) return true;
  return text.includes('=') && (text.includes(';') || text.split('=').length > 2);
}

/**
 * Import all cookies from a pasted string into the Electron session partition.
 * @returns {Promise<{ primary: { name: string, value: string }, imported: number, names: string[] }>}
 */
async function importCookiesFromPaste(opts, rawInput) {
  const parsed = parseCookieString(rawInput);
  if (!parsed.length) {
    throw new Error('No cookies found — paste the full cookie string (name=value; …) from DevTools.');
  }

  const preferred = (opts.cookieNames || [opts.cookieName]).filter(Boolean);
  const primary = pickSessionCookie(parsed, preferred);
  if (!primary?.value) {
    throw new Error(
      preferred.length
        ? `Session cookie not found. Expected one of: ${preferred.join(', ')}`
        : 'Could not identify a session cookie in paste.',
    );
  }

  const ses = getProviderSession();
  const loginUrl = opts.loginUrl || `https://${(opts.domain || '').replace(/^\./, '')}/`;
  const defaultDomain = opts.domain;

  const toSet = parsed.filter((c) => c.name && c.value != null).map((c) => ({
    url: loginUrl,
    name: c.name,
    value: c.value,
    domain: c.domain || defaultDomain,
    path: c.path || '/',
    secure: true,
    sameSite: 'no_restriction',
  }));

  await setCookies(ses, toSet);
  await flushCookies(ses);

  setSecret(opts.secretKey, primary.value);
  setSecret(`${opts.secretKey}-cookie-name`, primary.name);

  return {
    primary,
    imported: toSet.length,
    names: toSet.map((c) => c.name),
  };
}

async function verifyImportedSession(opts) {
  if (!opts.probeUrl) return true;
  const body = await fetchViaWindow(opts.probeUrl, {
    expectJson: opts.probeExpectJson !== false,
  });
  if (opts.probeExpectJson === false && typeof body === 'string' && body.length < 8) {
    throw new Error('Empty response — session may be invalid');
  }
  return true;
}

module.exports = {
  looksLikeCookiePaste,
  importCookiesFromPaste,
  verifyImportedSession,
};