const AUTH_ERROR_PATTERNS = [
  /login/i,
  /auth/i,
  /session/i,
  /credential/i,
  /cloudflare/i,
  /unauthorized/i,
  /\b401\b/,
  /\b403\b/,
  /not logged/i,
  /expired/i,
  /disconnected/i,
  /org not found/i,
  /invalidjson/i,
  /rate limit/i,
  /\b429\b/,
];

function isAuthErrorMessage(message) {
  if (!message) return false;
  const text = String(message);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(text));
}

module.exports = { AUTH_ERROR_PATTERNS, isAuthErrorMessage };