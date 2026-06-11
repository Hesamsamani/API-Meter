/**
 * Parse pasted cookie text from DevTools, document.cookie, or extensions.
 * @returns {{ name: string, value: string, path?: string }[]}
 */
function parseCookieString(input) {
  const text = String(input || '').trim();
  if (!text) return [];

  const stripped = text.replace(/^cookie:\s*/i, '').trim();

  if (stripped.startsWith('[')) {
    try {
      const arr = JSON.parse(stripped);
      if (Array.isArray(arr)) {
        return arr
          .filter((c) => c && typeof c.name === 'string' && c.value != null)
          .map((c) => ({
            name: c.name.trim(),
            value: String(c.value),
            path: c.path || '/',
          }));
      }
    } catch { /* fall through */ }
  }

  if (stripped.includes('\n') && stripped.includes('\t')) {
    return parseNetscapeCookies(stripped);
  }

  if (!stripped.includes('=')) {
    return [];
  }

  const cookies = [];
  for (const part of stripped.split(';')) {
    const segment = part.trim();
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, path: '/' });
  }
  return cookies;
}

function parseNetscapeCookies(text) {
  const cookies = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('#')) continue;
    const cols = row.split('\t');
    if (cols.length < 7) continue;
    const [domain, , path, , , name, value] = cols;
    if (!name || value == null) continue;
    cookies.push({
      name: name.trim(),
      value: String(value),
      path: (path || '/').trim() || '/',
      domain: domain?.trim(),
    });
  }
  return cookies;
}

/**
 * Resolve session cookie from parsed list using preferred names.
 * @param {{ name: string, value: string }[]} parsed
 * @param {string[]} preferredNames
 */
function pickSessionCookie(parsed, preferredNames = []) {
  if (!parsed.length) return null;
  for (const name of preferredNames) {
    const hit = parsed.find((c) => c.name === name && c.value);
    if (hit) return hit;
  }
  const withValue = parsed.find((c) => c.value && !c.name.startsWith('__Host-'));
  return withValue || parsed[0];
}

module.exports = { parseCookieString, parseNetscapeCookies, pickSessionCookie };