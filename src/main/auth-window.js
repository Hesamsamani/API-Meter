const { BrowserWindow, ipcMain, Notification, clipboard } = require('electron');
const path = require('path');
const { setSecret } = require('./store');
const { getPreloadPath } = require('./assets');
const {
  getProviderSession,
  findSessionCookies,
  cookieUrlsFor,
  setCookies,
  flushCookies,
} = require('./provider-session');
const {
  looksLikeCookiePaste,
  importCookiesFromPaste,
  verifyImportedSession,
  formatImportSummary,
} = require('./cookie-import');
const { CHROME_UA } = require('../shared/ua');
const { openChromiumUrl } = require('./open-chromium');
const { readBrowserCookie, diagnoseBrowserCookie } = require('./browser-cookies');

let activePrompt = null;
const loginQueues = new Map();

function sendPrompt(channel, payload) {
  if (!activePrompt?.win || activePrompt.win.isDestroyed()) return;
  activePrompt.win.webContents.send(channel, payload);
}

function cleanupSession(session) {
  if (!session || session.cleaned) return;
  session.cleaned = true;
  if (session.timer) clearInterval(session.timer);
  if (session.loginWin && !session.loginWin.isDestroyed()) session.loginWin.close();
  for (const id of session.ipcIds || []) {
    try { ipcMain.removeHandler(id); } catch { /* ignore */ }
  }
  if (activePrompt?.session === session) activePrompt = null;
}

function scheduleClosePrompt(session) {
  setTimeout(() => {
    if (activePrompt?.session === session) closePrompt();
  }, 600);
}

function closePrompt() {
  if (!activePrompt) return;
  const { win, session } = activePrompt;
  cleanupSession(session);
  if (win && !win.isDestroyed()) win.close();
}

function minimizeAuthPrompt() {
  const win = activePrompt?.win;
  if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
    win.minimize();
  }
}

function createAuthPromptWindow(opts) {
  const external = !!opts.externalBrowser;
  const win = new BrowserWindow({
    width: external ? 420 : 440,
    height: 580,
    show: false,
    resizable: true,
    minWidth: 380,
    minHeight: 480,
    frame: false,
    alwaysOnTop: !external,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const cookieHint = (opts.cookieNames || [opts.cookieName]).filter(Boolean).join(', ') || 'session cookie';
  win.loadFile(path.join(__dirname, '../renderer/auth-prompt/index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (external) win.setAlwaysOnTop(false);
    sendPrompt('auth-prompt:init', {
      title: opts.title,
      description: external
        ? 'Google blocks in-app sign-in. Use Chrome or Edge, then import cookies.'
        : 'Sign in with the in-app browser, or paste cookies copied from your browser.',
      status: external
        ? 'Chrome will open — this window minimizes so you can sign in. Restore it from the taskbar when done.'
        : 'Waiting for in-app sign-in…',
      mode: 'waiting',
      cookieNameHint: cookieHint,
      loginUrl: opts.loginUrl,
      authMode: external ? 'external' : 'embedded',
      defaultTab: external ? 'external' : 'browser',
    });
  });

  return win;
}

function createLoginBrowserWindow(opts) {
  const win = new BrowserWindow({
    width: 560,
    height: 780,
    show: true,
    title: opts.title,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: 'persist:api-meter',
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return;
    const url = win.webContents.getURL();
    const title = win.webContents.getTitle();
    const blocked = /accounts\.google\.com/i.test(url)
      && /couldn'?t sign you in|not be secure/i.test(title);
    if (blocked) {
      sendPrompt('auth-prompt:status', {
        status: 'Google blocked in-app sign-in. Switch to Chrome sign-in or paste cookies.',
        mode: 'error',
      });
      sendPrompt('auth-prompt:google-blocked', {});
    }
  });
  win.loadURL(opts.loginUrl);
  win.focus();
  return win;
}

function isSessionActive(session) {
  return !session.cancelled && !session.completed;
}

function openLoginBrowser(session) {
  if (session.loginWin && !session.loginWin.isDestroyed()) return session.loginWin;
  session.loginWin = createLoginBrowserWindow(session.opts);
  session.loginWin.on('closed', () => {
    session.loginWin = null;
    if (!session.completed && !session.cancelled && session.tab === 'browser') {
      session.reject?.(new Error('Login window closed'));
      cleanupSession(session);
      if (activePrompt?.win && !activePrompt.win.isDestroyed()) activePrompt.win.close();
    }
  });
  return session.loginWin;
}

function closeLoginBrowser(session) {
  if (session.loginWin && !session.loginWin.isDestroyed()) {
    session.loginWin.removeAllListeners('closed');
    session.loginWin.close();
  }
  session.loginWin = null;
}

function pickPrimaryCookie(hits, names) {
  for (const name of names) {
    const hit = hits.find((h) => h?.name === name && h?.value);
    if (hit) return hit;
  }
  return hits.find((h) => h?.value) || hits[0] || null;
}

function cookiesToPersist(hits, opts) {
  const names = opts.cookieNames || [opts.cookieName].filter(Boolean);
  const list = Array.isArray(hits) ? hits : [hits];
  if (!names.length) return list.filter((h) => h?.name && h?.value);

  const named = list.filter((h) => h?.name && h?.value && names.includes(h.name));
  return named.length ? named : list.filter((h) => h?.name && h?.value);
}

async function persistCapturedCookies(opts, hits) {
  const names = opts.cookieNames || [opts.cookieName].filter(Boolean);
  const list = cookiesToPersist(hits, opts);
  const primary = pickPrimaryCookie(list, names);
  if (!primary?.value) return null;

  setSecret(opts.secretKey, primary.value);
  if (primary.name) setSecret(`${opts.secretKey}-cookie-name`, primary.name);

  const ses = getProviderSession();
  const toSet = list.map((hit) => ({
    name: hit.name,
    value: hit.value,
    domain: hit.domain || opts.domain,
    path: hit.path || '/',
    secure: hit.secure !== false,
    httpOnly: hit.httpOnly === true,
    sameSite: hit.sameSite || 'lax',
    expirationDate: hit.expirationDate,
  }));

  await setCookies(ses, toSet, {
    loginUrl: opts.loginUrl,
    domain: opts.domain,
    requiredNames: [primary.name],
  });
  await flushCookies(ses);
  return primary;
}

async function tryCaptureInAppCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const ses = getProviderSession();
  const sessionHits = await findSessionCookies(ses, {
    urls: cookieUrlsFor(opts),
    domain: opts.domain,
    names,
  });
  if (!sessionHits.length) return null;

  const hits = sessionHits;
  const primary = pickPrimaryCookie(hits, names);
  if (!primary?.value) return null;

  const captured = { ...primary, browser: 'in-app' };
  await persistCapturedCookies(opts, hits);
  return captured;
}

function waitingMessage(external = false) {
  return external
    ? 'Sign in in Chrome or Edge, then restore this window from the taskbar and click Import from browser.'
    : 'Finish sign-in in the API-Meter browser window. Session is detected automatically.';
}

function browserImportFailureMessage(diag) {
  switch (diag?.reason) {
    case 'db_locked':
      return 'Chrome cookie database is locked — close Chrome completely, or use Paste cookies instead.';
    case 'v20_encrypted':
      return 'Chrome uses newer cookie encryption — export with EditThisCookie and use Paste cookies.';
    case 'not_found':
      return 'No session cookie found yet — finish sign-in in Chrome, then try again.';
    default:
      return 'Could not read cookies from Chrome/Edge — try Paste cookies instead.';
  }
}

async function tryImportFromSystemBrowser(session, { quiet = false } = {}) {
  const hit = readBrowserCookie({
    ...session.opts,
    cookieNames: session.opts.cookieNames || [session.opts.cookieName],
    preferredBrowser: session.preferredBrowser,
  });
  if (!hit?.value) {
    if (!quiet) {
      const diag = diagnoseBrowserCookie({
        ...session.opts,
        cookieNames: session.opts.cookieNames || [session.opts.cookieName],
        preferredBrowser: session.preferredBrowser,
      });
      sendPrompt('auth-prompt:status', {
        status: browserImportFailureMessage(diag),
        mode: 'error',
      });
    }
    return null;
  }
  await persistCapturedCookies(session.opts, {
    name: hit.name,
    value: hit.value,
    domain: session.opts.domain,
    browser: hit.browser,
  });
  return hit;
}

async function openExternalLogin(session) {
  const result = await openChromiumUrl(session.opts.loginUrl);
  session.preferredBrowser = result.browser === 'default' ? null : result.browser;
  const label = result.browser === 'default' ? 'your default browser' : result.browser;
  sendPrompt('auth-prompt:status', {
    status: `Opened ${label}. Sign in there, then restore API-Meter from the taskbar and click Import from browser.`,
    mode: 'waiting',
  });
  setTimeout(() => minimizeAuthPrompt(), 400);
  return result;
}

async function completeLoginWithVerification(session, hit, extra = {}) {
  if (!isSessionActive(session)) return;
  if (session.opts.probeUrl) {
    sendPrompt('auth-prompt:status', { status: 'Verifying session…', mode: 'waiting' });
    try {
      await verifyImportedSession(session.opts);
    } catch (err) {
      const { setSecret } = require('./store');
      setSecret(session.opts.secretKey, '');
      setSecret(`${session.opts.secretKey}-cookie-name`, '');
      sendPrompt('auth-prompt:status', {
        status: `Verification failed: ${err.message || err}`,
        mode: 'error',
      });
      return;
    }
  }
  await completeLogin(session, hit, extra);
}

async function completeLogin(session, hit, extra = {}) {
  if (!isSessionActive(session)) return;
  session.completed = true;
  const label = extra.summary
    ? `Connected — ${extra.summary}`
    : extra.imported
      ? `Connected — ${extra.imported} cookie${extra.imported === 1 ? '' : 's'} imported (${hit.name})`
      : `Connected (${hit.name})`;
  sendPrompt('auth-prompt:status', { status: label, mode: 'ok' });
  session.resolve?.(hit.value);
  scheduleClosePrompt(session);
}

async function handleCookiePaste(session, raw) {
  sendPrompt('auth-prompt:status', { status: 'Importing cookies…', mode: 'waiting' });
  const result = await importCookiesFromPaste(session.opts, raw);
  if (!isSessionActive(session)) return;

  if (session.opts.probeUrl) {
    sendPrompt('auth-prompt:status', { status: 'Verifying session…', mode: 'waiting' });
    try {
      await verifyImportedSession(session.opts);
    } catch (err) {
      setSecret(session.opts.secretKey, '');
      setSecret(`${session.opts.secretKey}-cookie-name`, '');
      sendPrompt('auth-prompt:status', {
        status: `Cookies imported but verification failed: ${err.message || err}`,
        mode: 'error',
      });
      return;
    }
  }

  await completeLogin(session, result.primary, { summary: formatImportSummary(result) });
}

async function handleManualToken(session, token, cookieName) {
  const defaultName = (session.opts.cookieNames || [session.opts.cookieName]).filter(Boolean)[0];
  const resolvedName = cookieName || defaultName;
  await persistCapturedCookies(session.opts, { value: token, name: resolvedName, browser: 'manual' });
  if (!isSessionActive(session)) return;

  if (session.opts.probeUrl) {
    sendPrompt('auth-prompt:status', { status: 'Verifying session…', mode: 'waiting' });
    try {
      await verifyImportedSession(session.opts);
    } catch (err) {
      setSecret(session.opts.secretKey, '');
      setSecret(`${session.opts.secretKey}-cookie-name`, '');
      sendPrompt('auth-prompt:status', {
        status: `Verification failed: ${err.message || err}`,
        mode: 'error',
      });
      return;
    }
  }

  session.completed = true;
  sendPrompt('auth-prompt:status', { status: 'Session saved manually.', mode: 'ok' });
  session.resolve?.(token);
  scheduleClosePrompt(session);
}

function registerPromptHandlers(session) {
  const handlers = {
    'auth-prompt:cancel': () => {
      session.cancelled = true;
      session.reject?.(new Error('Login cancelled'));
      closePrompt();
    },
    'auth-prompt:set-tab': (_e, tab) => {
      if (tab === 'paste') session.tab = 'paste';
      else if (tab === 'external') session.tab = 'external';
      else session.tab = 'browser';

      if (session.tab === 'paste') {
        closeLoginBrowser(session);
        const clip = clipboard.readText();
        const hasExport = looksLikeCookiePaste(clip);
        sendPrompt('auth-prompt:status', {
          status: hasExport
            ? 'EditThisCookie export detected in clipboard — review and click Import.'
            : 'Export cookies in EditThisCookie, then paste or Read clipboard.',
          mode: 'waiting',
        });
        if (hasExport) {
          sendPrompt('auth-prompt:clipboard', { text: clip, detected: true });
        }
      } else if (session.tab === 'external') {
        closeLoginBrowser(session);
        sendPrompt('auth-prompt:status', { status: waitingMessage(true), mode: 'waiting' });
      } else {
        openLoginBrowser(session);
        sendPrompt('auth-prompt:status', { status: waitingMessage(false), mode: 'waiting' });
      }
    },
    'auth-prompt:open-external': async () => {
      session.tab = 'external';
      if (activePrompt?.win && !activePrompt.win.isDestroyed()) {
        activePrompt.win.restore();
        activePrompt.win.show();
      }
      await openExternalLogin(session);
    },
    'auth-prompt:minimize': () => {
      minimizeAuthPrompt();
    },
    'auth-prompt:import-browser': async () => {
      sendPrompt('auth-prompt:status', { status: 'Reading cookies from Chrome/Edge…', mode: 'waiting' });
      const hit = await tryImportFromSystemBrowser(session);
      if (!isSessionActive(session) || !hit) return;
      await completeLoginWithVerification(session, hit);
    },
    'auth-prompt:read-clipboard': () => {
      const text = clipboard.readText();
      return {
        text,
        detected: looksLikeCookiePaste(text),
      };
    },
    'auth-prompt:retry': async () => {
      const hit = await tryCaptureInAppCookie(session.opts);
      if (!isSessionActive(session)) return;
      if (hit) {
        await completeLoginWithVerification(session, hit);
      } else {
        sendPrompt('auth-prompt:status', { status: waitingMessage(), mode: 'waiting' });
      }
    },
    'auth-prompt:submit': async (_e, payload) => {
      const raw = String((typeof payload === 'object' ? payload?.value : payload) || '').trim();
      const cookieName = typeof payload === 'object'
        ? String(payload?.cookieName || '').trim()
        : '';
      const mode = typeof payload === 'object' ? payload?.mode : '';

      if (!raw) {
        sendPrompt('auth-prompt:status', { status: 'Paste cookies or a session token first.', mode: 'error' });
        return;
      }

      try {
        if (mode === 'paste' || looksLikeCookiePaste(raw)) {
          await handleCookiePaste(session, raw);
          return;
        }
        await handleManualToken(session, raw, cookieName);
      } catch (err) {
        if (!isSessionActive(session)) return;
        sendPrompt('auth-prompt:status', {
          status: err.message || String(err),
          mode: 'error',
        });
      }
    },
  };

  const ipcIds = [];
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
    ipcIds.push(channel);
  }
  return ipcIds;
}

function openAuthWindowInner(opts) {
  return new Promise((resolve, reject) => {
    closePrompt();

    const external = !!opts.externalBrowser;
    const session = {
      opts,
      resolve,
      reject,
      cancelled: false,
      completed: false,
      polling: false,
      timer: null,
      ipcIds: [],
      cleaned: false,
      loginWin: null,
      tab: external ? 'external' : 'browser',
      preferredBrowser: null,
    };

    const win = createAuthPromptWindow(opts);
    session.ipcIds = registerPromptHandlers(session);
    activePrompt = { win, session };

    if (external) {
      openExternalLogin(session).catch((err) => {
        sendPrompt('auth-prompt:status', {
          status: `Could not open browser: ${err.message || err}`,
          mode: 'error',
        });
      });
    } else {
      openLoginBrowser(session);
    }

    if (Notification.isSupported()) {
      new Notification({
        title: opts.title,
        body: external
          ? 'Sign in using Chrome or Edge, then import cookies in API-Meter.'
          : 'Sign in using the API-Meter browser window, or paste cookies.',
      }).show();
    }

    const poll = async () => {
      if (!isSessionActive(session) || session.polling) return;
      if (session.tab === 'browser') {
        session.polling = true;
        try {
          const hit = await tryCaptureInAppCookie(opts);
          if (!isSessionActive(session)) return;
          if (hit) await completeLoginWithVerification(session, hit);
        } finally {
          session.polling = false;
        }
        return;
      }
    };

    if (!external) {
      session.timer = setInterval(() => { poll().catch(() => {}); }, 1500);
      poll().catch(() => {});
    }

    win.on('closed', () => {
      if (activePrompt?.session === session) activePrompt = null;
    });

    setTimeout(() => {
      if (session.cancelled || session.completed || activePrompt?.session !== session) return;
      if (session.tab === 'browser') {
        sendPrompt('auth-prompt:status', { status: waitingMessage(false), mode: 'waiting' });
      } else if (session.tab === 'external') {
        sendPrompt('auth-prompt:status', { status: waitingMessage(true), mode: 'waiting' });
      }
    }, 15000);
  });
}

/**
 * Opens an in-app browser for login and reads session cookies from the Electron session jar.
 */
function openAuthWindow(opts) {
  const key = opts.secretKey || opts.domain || 'default';
  const prev = loginQueues.get(key) || Promise.resolve();
  const run = prev.then(() => openAuthWindowInner(opts));
  loginQueues.set(key, run.catch(() => {}));
  return run;
}

module.exports = { openAuthWindow };