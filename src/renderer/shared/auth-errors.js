/** Browser ESM copy — keep patterns in sync with src/shared/auth-errors.js */
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
  /setting cookie/i,
  /org not found/i,
];

export function isAuthErrorMessage(message) {
  if (!message) return false;
  const text = String(message);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(text));
}

export { AUTH_ERROR_PATTERNS };