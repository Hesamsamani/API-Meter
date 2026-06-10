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

/**
 * @param {import('electron').Session} ses
 * @param {{ url: string, names?: string[] }} opts
 */
async function findSessionCookie(ses, { url, names = [] }) {
  const cookies = await ses.cookies.get({ url });
  if (!names.length) return cookies[0] || null;
  for (const name of names) {
    const hit = cookies.find((c) => c.name === name);
    if (hit?.value) return hit;
  }
  return null;
}

module.exports = {
  PARTITION,
  getProviderSession,
  setCookie,
  setCookies,
  flushCookies,
  findSessionCookie,
};