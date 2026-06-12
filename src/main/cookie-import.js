const {
  parseCookieString,
  pickSessionCookie,
  filterCookiesForProvider,
  cookieSetUrl,
  detectCookieExportFormat,
} = require('../shared/parse-cookies');
const { getProviderSession, setCookies, flushCookies } = require('./provider-session');
const { setSecret } = require('./store');
const { fetchViaWindow, postViaWindow } = require('./fetch-via-window');

const GEMINI_ORIGIN = 'https://gemini.google.com/';

const GOOGLE_SESSION_COOKIE_NAMES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  'NID',
  'COMPASS',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  '__Secure-1PSIDRTS',
  '__Secure-3PSIDRTS',
  '__Secure-BUCKET',
  '__Secure-ENID',
  '__Secure-STRP',
  'AEC',
]);

function isGoogleCookieDomain(domain) {
  const d = String(domain || '').replace(/^\./, '').toLowerCase();
  return d === 'google.com' || d.endsWith('.google.com');
}

function shouldForceSecureGoogle(cookie) {
  if (!isGoogleCookieDomain(cookie.domain)) return false;
  const name = cookie.name || '';
  if (name.startsWith('__Secure-') || name.startsWith('__Host-')) return true;
  return GOOGLE_SESSION_COOKIE_NAMES.has(name);
}

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

  const toImport = relevant.filter((c) => c.name && c.value != null);

  const toSet = toImport.map((c) => {
    const forceSecure = shouldForceSecureGoogle(c);
    const secure = forceSecure ? true : c.secure !== false;
    const withSecure = forceSecure ? { ...c, secure: true } : c;
    return {
      url: c.domain ? cookieSetUrl(withSecure) : loginUrl,
      name: c.name,
      value: c.value,
      domain: c.domain || defaultDomain,
      path: c.path || '/',
      secure,
      httpOnly: c.httpOnly === true,
      sameSite: c.sameSite || 'lax',
      expirationDate: c.expirationDate,
    };
  });

  await setCookies(ses, toSet, {
    loginUrl,
    domain: defaultDomain,
    requiredNames: [primary.name],
  });
  await flushCookies(ses);
  await new Promise((r) => setTimeout(r, 250));

  setSecret(opts.secretKey, primary.value);
  setSecret(`${opts.secretKey}-cookie-name`, primary.name);
  if (opts.secretKey === 'gemini-session') {
    const { saveGeminiCookieJar } = require('./gemini-cookie-jar');
    saveGeminiCookieJar(toSet);
  }

  return {
    primary,
    imported: toSet.length,
    scanned: parsed.length,
    names: toSet.map((c) => c.name),
    format,
  };
}

function isGeminiBatchExecuteProbe(opts) {
  const probeUrl = String(opts?.probeUrl || '');
  if (!probeUrl.includes('batchexecute')) return false;
  return opts?.providerId === 'gemini' || opts?.secretKey === 'gemini-session';
}

function buildGeminiProbePostUrl(probeUrl) {
  const { GEMINI_QUOTA_BATCH_URL } = require('../providers/gemini');
  const base = String(probeUrl || '').includes('rt=c') ? probeUrl : GEMINI_QUOTA_BATCH_URL;
  return `${base}&_reqid=${Date.now()}`;
}

async function verifyImportedSession(opts) {
  if (!opts.probeUrl) return true;
  let body;
  if (isGeminiBatchExecuteProbe(opts)) {
    const { buildGeminiQuotaReqBody, GEMINI_POST_TIMEOUT_MS } = require('../providers/gemini');
    const { verifyGeminiPageSession } = require('./fetch-via-window');
    await verifyGeminiPageSession({ timeoutMs: GEMINI_POST_TIMEOUT_MS });
    body = await postViaWindow(
      GEMINI_ORIGIN,
      buildGeminiProbePostUrl(opts.probeUrl),
      buildGeminiQuotaReqBody(),
      { appendGoogleAtToken: true, timeoutMs: GEMINI_POST_TIMEOUT_MS },
    );
  } else {
    body = await fetchViaWindow(opts.probeUrl, {
      expectJson: opts.probeExpectJson !== false,
    });
  }
  if (isGeminiBatchExecuteProbe(opts) && typeof body === 'string') {
    const { parseGeminiBatchExecute, extractGeminiQuota, quotaHasUsage } = require('../providers/gemini');
    const inner = parseGeminiBatchExecute(body);
    const quota = extractGeminiQuota(inner);
    if (!quotaHasUsage(quota)) {
      throw new Error('Gemini session probe returned no quota data');
    }
    return true;
  }
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
  isGeminiBatchExecuteProbe,
  buildGeminiProbePostUrl,
};