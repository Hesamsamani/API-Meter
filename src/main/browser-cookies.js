const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const CHROMIUM_BROWSERS = [
  { id: 'chrome', dir: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data') },
  { id: 'edge', dir: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', dir: path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data') },
];

function dpapiUnprotect(buffer) {
  if (process.platform !== 'win32') return null;
  const b64 = buffer.toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${b64}')`,
    '$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($plain)',
  ].join('; ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
    return Buffer.from(out, 'base64');
  } catch {
    return null;
  }
}

function getChromiumKey(localStatePath) {
  if (!fs.existsSync(localStatePath)) return null;
  const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  const encryptedKeyB64 = localState?.os_crypt?.encrypted_key;
  if (!encryptedKeyB64) return null;
  const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
  if (encryptedKey.slice(0, 5).toString() !== 'DPAPI') return null;
  return dpapiUnprotect(encryptedKey.slice(5));
}

function decryptChromiumCookie(encryptedValue, key) {
  if (!encryptedValue || encryptedValue.length === 0) return null;
  if (typeof encryptedValue === 'string') return encryptedValue || null;

  const prefix = encryptedValue.slice(0, 3).toString('utf8');
  if ((prefix === 'v10' || prefix === 'v11') && key) {
    try {
      const iv = encryptedValue.slice(3, 15);
      const payload = encryptedValue.slice(15, -16);
      const tag = encryptedValue.slice(-16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
  if (prefix === 'v20') return null;
  const plain = dpapiUnprotect(encryptedValue);
  return plain ? plain.toString('utf8') : null;
}

function listProfiles(userDataDir) {
  if (!userDataDir || !fs.existsSync(userDataDir)) return [];
  const profiles = [];
  const localState = path.join(userDataDir, 'Local State');
  if (fs.existsSync(path.join(userDataDir, 'Default', 'Network', 'Cookies'))) {
    profiles.push({ name: 'Default', cookiesPath: path.join(userDataDir, 'Default', 'Network', 'Cookies'), localStatePath: localState });
  }
  for (const entry of fs.readdirSync(userDataDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('Profile ')) continue;
    const cookiesPath = path.join(userDataDir, entry.name, 'Network', 'Cookies');
    if (fs.existsSync(cookiesPath)) {
      profiles.push({ name: entry.name, cookiesPath, localStatePath: localState });
    }
  }
  return profiles;
}

function hostSuffix(domain) {
  return domain.replace(/^\./, '');
}

function readCookieFromDb(cookiesPath, localStatePath, { cookieNames, domain }) {
  const tmpDb = path.join(os.tmpdir(), `api-meter-cookies-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  try {
    fs.copyFileSync(cookiesPath, tmpDb);
  } catch {
    return null;
  }

  let db;
  try {
    db = new Database(tmpDb, { readonly: true, fileMustExist: true });
    const names = Array.isArray(cookieNames) ? cookieNames : [cookieNames];
    const suffix = hostSuffix(domain);
    const namePlaceholders = names.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT name, value, encrypted_value, host_key
       FROM cookies
       WHERE name IN (${namePlaceholders})
         AND (host_key = ? OR host_key = ? OR host_key LIKE '%' || ?)
       ORDER BY last_access_utc DESC`
    ).all(...names, domain, suffix, suffix);

    const key = getChromiumKey(localStatePath);
    for (const row of rows) {
      if (row.value) return { value: row.value, name: row.name, host: row.host_key };
      const decrypted = decryptChromiumCookie(row.encrypted_value, key);
      if (decrypted) return { value: decrypted, name: row.name, host: row.host_key };
    }
    return null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  }
}

/**
 * Read a session cookie from installed Chromium browsers (Chrome, Edge, Brave).
 * @param {{ cookieNames: string|string[], domain: string }} opts
 */
function readBrowserCookie(opts) {
  const cookieNames = opts.cookieNames || opts.cookieName;
  for (const browser of CHROMIUM_BROWSERS) {
    for (const profile of listProfiles(browser.dir)) {
      const hit = readCookieFromDb(profile.cookiesPath, profile.localStatePath, {
        cookieNames,
        domain: opts.domain,
      });
      if (hit?.value) {
        return { ...hit, browser: browser.id, profile: profile.name };
      }
    }
  }
  return null;
}

module.exports = {
  readBrowserCookie,
  listProfiles,
  decryptChromiumCookie,
  getChromiumKey,
  hostSuffix,
  CHROMIUM_BROWSERS,
};