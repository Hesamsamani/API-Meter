/** @typedef {{ name: string, value: string, path?: string, domain?: string, secure?: boolean, httpOnly?: boolean, sameSite?: string, session?: boolean, expirationDate?: number }} ParsedCookie */

function mapSameSite(val) {
  const v = String(val || '').toLowerCase();
  if (v === 'lax' || v === 'strict' || v === 'no_restriction' || v === 'unspecified') return v;
  if (v === 'none') return 'no_restriction';
  return 'unspecified';
}

function normalizeCookieObject(raw) {
  if (!raw || typeof raw.name !== 'string' || raw.value == null) return null;
  const name = raw.name.trim();
  if (!name) return null;
  return {
    name,
    value: String(raw.value),
    domain: typeof raw.domain === 'string' ? raw.domain.trim() : undefined,
    path: (raw.path || '/').trim() || '/',
    secure: raw.secure !== false,
    httpOnly: raw.httpOnly === true,
    sameSite: mapSameSite(raw.sameSite),
    session: raw.session === true,
    expirationDate: raw.expirationDate,
  };
}

function parseJsonCookies(text) {
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : [data];
    return list.map(normalizeCookieObject).filter(Boolean);
  } catch {
    return [];
  }
}

function parseNetscapeCookies(text) {
  const cookies = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('#')) continue;
    const cols = row.split('\t');
    if (cols.length < 7) continue;
    const [domain, , path, secureFlag, , name, value] = cols;
    if (!name || value == null) continue;
    cookies.push({
      name: name.trim(),
      value: String(value),
      path: (path || '/').trim() || '/',
      domain: domain?.trim(),
      secure: secureFlag?.toUpperCase() === 'TRUE',
      httpOnly: false,
      sameSite: 'no_restriction',
    });
  }
  return cookies;
}

function parseSemicolonCookies(text) {
  if (!text.includes('=')) return [];
  const cookies = [];
  for (const part of text.split(';')) {
    const segment = part.trim();
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, path: '/', secure: true, sameSite: 'no_restriction' });
  }
  return cookies;
}

/**
 * Detect export format for user-facing hints.
 * @returns {'editthiscookie-json'|'netscape'|'semicolon'|'unknown'}
 */
function detectCookieExportFormat(input) {
  const text = String(input || '').trim();
  if (!text) return 'unknown';
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      const sample = Array.isArray(data) ? data[0] : data;
      if (sample && typeof sample.name === 'string' && 'domain' in sample) {
        return 'editthiscookie-json';
      }
      if (sample && typeof sample.name === 'string') return 'editthiscookie-json';
    } catch { /* ignore */ }
  }
  if (text.includes('\t') && text.includes('\n')) return 'netscape';
  if (text.includes('=') && text.includes(';')) return 'semicolon';
  return 'unknown';
}

/**
 * Parse pasted cookie text from DevTools, EditThisCookie, document.cookie, or extensions.
 * @returns {ParsedCookie[]}
 */
function parseCookieString(input) {
  const text = String(input || '').trim();
  if (!text) return [];

  const stripped = text.replace(/^cookie:\s*/i, '').trim();

  if (stripped.startsWith('[') || stripped.startsWith('{')) {
    const jsonCookies = parseJsonCookies(stripped);
    if (jsonCookies.length) return jsonCookies;
  }

  if (stripped.includes('\n') && stripped.includes('\t')) {
    const netscape = parseNetscapeCookies(stripped);
    if (netscape.length) return netscape;
  }

  return parseSemicolonCookies(stripped);
}

function providerHosts(opts) {
  const hosts = new Set();
  if (opts?.domain) {
    hosts.add(opts.domain.replace(/^\./, '').toLowerCase());
  }
  for (const extra of opts?.extraDomains || []) {
    if (typeof extra === 'string' && extra.trim()) {
      hosts.add(extra.replace(/^\./, '').toLowerCase());
    }
  }
  if (opts?.loginUrl) {
    try {
      const { hostname } = new URL(opts.loginUrl);
      hosts.add(hostname.toLowerCase());
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        hosts.add(parts.slice(-2).join('.').toLowerCase());
      }
    } catch { /* ignore */ }
  }
  return hosts;
}

function cookieDomainMatches(cookie, hosts) {
  if (!cookie.domain || !hosts.size) return true;
  const d = cookie.domain.replace(/^\./, '').toLowerCase();
  for (const h of hosts) {
    if (d === h) return true;
    if (d.endsWith(`.${h}`)) return true;
    if (h.endsWith(`.${d}`)) return true;
  }
  return false;
}

/**
 * Keep cookies relevant to the provider host (EditThisCookie exports every cookie on the page).
 * @param {ParsedCookie[]} parsed
 * @param {{ domain?: string, loginUrl?: string }} opts
 */
function filterCookiesForProvider(parsed, opts) {
  const hosts = providerHosts(opts);
  if (!hosts.size) return parsed;

  const withDomain = parsed.filter((c) => c.domain);
  if (!withDomain.length) return parsed;

  const matched = parsed.filter((c) => cookieDomainMatches(c, hosts));
  return matched.length ? matched : parsed;
}

/**
 * Build Electron cookie.set URL from parsed cookie fields.
 * @param {ParsedCookie} cookie
 */
function cookieSetUrl(cookie) {
  const host = (cookie.domain || 'localhost').replace(/^\./, '');
  const scheme = cookie.secure !== false ? 'https' : 'http';
  const path = cookie.path?.startsWith('/') ? cookie.path : `/${cookie.path || ''}`;
  return `${scheme}://${host}${path}`;
}

/**
 * Resolve session cookie from parsed list using preferred names.
 * @param {ParsedCookie[]} parsed
 * @param {string[]} preferredNames
 */
function pickSessionCookie(parsed, preferredNames = []) {
  if (!parsed.length) return null;
  for (const name of preferredNames) {
    const hit = parsed.find((c) => c.name === name && c.value);
    if (hit) return hit;
  }
  const sessionish = parsed.find((c) => {
    if (!c.value) return false;
    const n = c.name.toLowerCase();
    return n.includes('session') || n.includes('sid') || n.includes('auth') || n.includes('token');
  });
  if (sessionish) return sessionish;
  const withValue = parsed.find((c) => c.value && !c.name.startsWith('__Host-'));
  return withValue || parsed[0];
}

module.exports = {
  parseCookieString,
  parseNetscapeCookies,
  parseJsonCookies,
  detectCookieExportFormat,
  filterCookiesForProvider,
  cookieSetUrl,
  pickSessionCookie,
  providerHosts,
};