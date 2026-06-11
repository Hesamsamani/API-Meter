const {
  parseCookieString,
  pickSessionCookie,
  filterCookiesForProvider,
  cookieSetUrl,
  detectCookieExportFormat,
} = require('../shared/parse-cookies');
const { getProviderSession, setCookies, flushCookies } = require('./provider-session');
const { setSecret } = require('./store');
const { fetchViaWindow } = require('./fetch-via-window');

function looksLikeCookiePaste(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (text.startsWith('[') || text.startsWith('{')) return true;
  if (text.includes('\t') && text.includes('\n')) return true;
  if (/^cookie:\s*/i.test(text)) return true;
  return text.includes('=') && (text.includes(';') || text.split('=').length > 2);
}

function formatImportSummary(result) {
  const format = result.format === 'editthiscookie-json' ? 'EditThisCookie' : result.format;
  return `${result.imported} cookie${result.imported === 1 ? '' : 's'} imported (${format}) — session: ${result.primary.name}`;
}

/**
 * Import cookies from EditThisCookie / DevTools paste into the Electron session partition.
 * @returns {Promise<{ primary: object, imported: number, names: string[], format: string, scanned: number }>}
 */
async function importCookiesFromPaste(opts, rawInput) {
  const parsed = parseCookieString(rawInput);
  if (!parsed.length) {
    throw new Error(
      'No cookies found. In EditThisCookie click Export → paste here, or use DevTools cookie string.',
    );
  }

  const format = detectCookieExportFormat(rawInput);
  const relevant = filterCookiesForProvider(parsed, opts);
  const preferred = (opts.cookieNames || [opts.cookieName]).filter(Boolean);
  const primary = pickSessionCookie(relevant, preferred);

  if (!primary?.value) {
    const found = relevant.map((c) => c.name).slice(0, 8).join(', ');
    throw new Error(
      preferred.length
        ? `Session cookie not found (expected ${preferred.join(' or ')}). Found: ${found || 'none'}`
        : 'Could not identify a session cookie in export.',
    );
  }

  const ses = getProviderSession();
  const defaultDomain = opts.domain;
  const loginUrl = opts.loginUrl || `https://${(defaultDomain || '').replace(/^\./, '')}/`;

  const toSet = relevant
    .filter((c) => c.name && c.value != null)
    .map((c) => ({
      url: c.domain ? cookieSetUrl(c) : loginUrl,
      name: c.name,
      value: c.value,
      domain: c.domain || defaultDomain,
      path: c.path || '/',
      secure: c.secure !== false,
      httpOnly: c.httpOnly === true,
      sameSite: c.sameSite || 'no_restriction',
      expirationDate: c.expirationDate,
    }));

  await setCookies(ses, toSet);
  await flushCookies(ses);

  setSecret(opts.secretKey, primary.value);
  setSecret(`${opts.secretKey}-cookie-name`, primary.name);

  return {
    primary,
    imported: toSet.length,
    scanned: parsed.length,
    names: toSet.map((c) => c.name),
    format,
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
  if (typeof opts.probeValidate === 'function') {
    const err = opts.probeValidate(body);
    if (err) throw new Error(err);
  }
  return true;
}

module.exports = {
  looksLikeCookiePaste,
  importCookiesFromPaste,
  verifyImportedSession,
  formatImportSummary,
};