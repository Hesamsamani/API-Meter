const { BrowserWindow, ipcMain, Notification, clipboard } = require('electron');
const path = require('path');
const { setSecret } = require('./store');
const { getPreloadPath } = require('./assets');
const {
  getProviderSession,
  findSessionCookies,
  findAllDomainCookies,
  cookieUrlsFor,
  setCookies,
  flushCookies,
  syncElectronCookiesToPartition,
} = require('./provider-session');
const {
  looksLikeCookiePaste,
  importCookiesFromPaste,
  verifyImportedSession,
  formatImportSummary,
} = require('./cookie-import');
const { CHROME_UA } = require('../shared/ua');

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

function createAuthPromptWindow(opts) {
  const win = new BrowserWindow({
    width: 440,
    height: 540,
    show: false,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
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
    sendPrompt('auth-prompt:init', {
      title: opts.title,
      description: 'Sign in with the in-app browser, or paste cookies copied from your browser.',
      status: 'Waiting for in-app sign-in…',
      mode: 'waiting',
      cookieNameHint: cookieHint,
      loginUrl: opts.loginUrl,
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

async function persistCapturedCookies(opts, hits) {
  const list = Array.isArray(hits) ? hits : [hits];
  const names = opts.cookieNames || [opts.cookieName].filter(Boolean);
  const primary = pickPrimaryCookie(list, names);
  if (!primary?.value) return null;

  setSecret(opts.secretKey, primary.value);
  if (primary.name) setSecret(`${opts.secretKey}-cookie-name`, primary.name);

  const ses = getProviderSession();
  for (const hit of list) {
    if (!hit?.value || !hit.name) continue;
    const host = (hit.domain || opts.domain || '').replace(/^\./, '') || 'localhost';
    const scheme = hit.secure !== false ? 'https' : 'http';
    await setCookies(ses, [{
      url: hit.domain ? `${scheme}://${host}${hit.path || '/'}` : (opts.loginUrl || `${scheme}://${host}/`),
      name: hit.name,
      value: hit.value,
      domain: hit.domain || opts.domain,
      path: hit.path || '/',
      secure: hit.secure !== false,
      httpOnly: hit.httpOnly === true,
      sameSite: 'no_restriction',
    }]);
  }

  await syncElectronCookiesToPartition({
    loginUrl: opts.loginUrl,
    domain: opts.domain,
    cookieNames: names,
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

  const allDomain = opts.domain
    ? await findAllDomainCookies(ses, opts.domain)
    : [];
  const merged = new Map();
  for (const c of [...allDomain, ...sessionHits]) {
    if (c?.value && c.name) merged.set(c.name, c);
  }
  const hits = [...merged.values()];

  const primary = pickPrimaryCookie(hits, names);
  if (!primary?.value) return null;

  const captured = { ...primary, browser: 'in-app' };
  await persistCapturedCookies(opts, hits);
  return captured;
}

function waitingMessage() {
  return 'Finish sign-in in the API-Meter browser window. Session is detected automatically.';
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
      session.tab = tab === 'paste' ? 'paste' : 'browser';
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
      } else {
        openLoginBrowser(session);
        sendPrompt('auth-prompt:status', { status: waitingMessage(), mode: 'waiting' });
      }
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
        await completeLogin(session, hit);
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
      tab: 'browser',
    };

    const win = createAuthPromptWindow(opts);
    session.ipcIds = registerPromptHandlers(session);
    activePrompt = { win, session };

    openLoginBrowser(session);

    if (Notification.isSupported()) {
      new Notification({
        title: opts.title,
        body: 'Sign in using the API-Meter browser window, or paste cookies.',
      }).show();
    }

    const poll = async () => {
      if (!isSessionActive(session) || session.polling || session.tab !== 'browser') return;
      session.polling = true;
      try {
        const hit = await tryCaptureInAppCookie(opts);
        if (!isSessionActive(session)) return;
        if (hit) await completeLogin(session, hit);
      } finally {
        session.polling = false;
      }
    };

    session.timer = setInterval(() => { poll().catch(() => {}); }, 1500);
    poll().catch(() => {});

    win.on('closed', () => {
      if (activePrompt?.session === session) activePrompt = null;
    });

    setTimeout(() => {
      if (session.cancelled || session.completed || activePrompt?.session !== session) return;
      if (session.tab === 'browser') {
        sendPrompt('auth-prompt:status', { status: waitingMessage(), mode: 'waiting' });
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