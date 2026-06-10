const { BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { setSecret } = require('./store');
const { getPreloadPath } = require('./assets');
const { readBrowserCookie, diagnoseBrowserCookie } = require('./browser-cookies');
const { openChromiumUrl } = require('./open-chromium');
const {
  getProviderSession,
  findSessionCookies,
  cookieUrlsFor,
  setCookies,
  flushCookies,
  syncElectronCookiesToPartition,
} = require('./provider-session');
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
    width: 420,
    height: 400,
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
      description: `Sign in using the in-app browser window or Chrome/Edge. API-Meter reads the ${cookieHint} automatically.`,
      status: 'Waiting for sign-in…',
      mode: 'waiting',
      cookieNameHint: cookieHint,
    });
  });

  return win;
}

function createLoginBrowserWindow(opts) {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
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
  return win;
}

function isSessionActive(session) {
  return !session.cancelled && !session.completed;
}

async function persistCapturedCookies(opts, hits) {
  const list = Array.isArray(hits) ? hits : [hits];
  const primary = list.find((h) => h?.value) || list[0];
  if (!primary?.value) return null;

  setSecret(opts.secretKey, primary.value);
  if (primary.name) setSecret(`${opts.secretKey}-cookie-name`, primary.name);

  const ses = getProviderSession();
  const names = opts.cookieNames || [opts.cookieName];
  for (const hit of list) {
    if (!hit?.value || !hit.name) continue;
    await setCookies(ses, [{
      url: opts.loginUrl,
      name: hit.name,
      value: hit.value,
      domain: hit.domain || opts.domain,
      path: hit.path || '/',
      secure: true,
      sameSite: 'no_restriction',
    }]);
  }

  // Also sync any related session cookies already in the in-app jar
  await syncElectronCookiesToPartition({
    loginUrl: opts.loginUrl,
    domain: opts.domain,
    cookieNames: names,
  });
  await flushCookies(ses);
  return primary;
}

async function tryCaptureCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const hit = readBrowserCookie({
    cookieNames: names,
    domain: opts.domain,
    preferredBrowser: opts.preferredBrowser,
  });
  if (!hit?.value) return null;
  await persistCapturedCookies(opts, [hit]);
  return hit;
}

async function tryCaptureElectronCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const ses = getProviderSession();
  const hits = await findSessionCookies(ses, {
    urls: cookieUrlsFor(opts),
    domain: opts.domain,
    names,
  });
  if (!hits.length) return null;

  const primary = hits.find((c) => names.includes(c.name)) || hits[0];
  const captured = { ...primary, browser: 'in-app' };
  await persistCapturedCookies(opts, hits);
  return captured;
}

function cookieFailureMessage(opts) {
  const diag = diagnoseBrowserCookie({
    cookieNames: opts.cookieNames || [opts.cookieName],
    domain: opts.domain,
    preferredBrowser: opts.preferredBrowser,
  });
  switch (diag.reason) {
    case 'unsupported_platform':
      return 'Use the in-app sign-in window or paste the session token below.';
    case 'db_locked':
      return 'Browser cookies are locked. Use the in-app sign-in window or paste the token manually.';
    case 'v20_encrypted':
      return 'Chrome encrypted cookies cannot be read from disk. Sign in using the in-app window or paste the token below.';
    case 'not_found':
      return 'No session yet. Finish sign-in in the in-app window or Chrome/Edge, then click Check browser.';
    default:
      return 'No session found yet. Finish sign-in, then click Check browser.';
  }
}

async function completeLogin(session, hit) {
  if (!isSessionActive(session)) return;
  session.completed = true;
  sendPrompt('auth-prompt:status', { status: `Connected via ${hit.browser} (${hit.name})`, mode: 'ok' });
  session.resolve?.(hit.value);
  scheduleClosePrompt(session);
}

function registerPromptHandlers(session) {
  const handlers = {
    'auth-prompt:cancel': () => {
      session.cancelled = true;
      session.reject?.(new Error('Login cancelled'));
      closePrompt();
    },
    'auth-prompt:retry': async () => {
      let hit = await tryCaptureElectronCookie(session.opts);
      if (!isSessionActive(session)) return;
      if (!hit) hit = await tryCaptureCookie(session.opts);
      if (!isSessionActive(session)) return;
      if (hit) {
        await completeLogin(session, hit);
      } else {
        sendPrompt('auth-prompt:status', {
          status: cookieFailureMessage(session.opts),
          mode: 'waiting',
        });
      }
    },
    'auth-prompt:submit': async (_e, payload) => {
      const token = String((typeof payload === 'object' ? payload?.value : payload) || '').trim();
      const cookieName = typeof payload === 'object'
        ? String(payload?.cookieName || '').trim()
        : '';
      if (!token) {
        sendPrompt('auth-prompt:status', { status: 'Paste a session token first.', mode: 'error' });
        return;
      }
      const defaultName = (session.opts.cookieNames || [session.opts.cookieName]).filter(Boolean)[0];
      const resolvedName = cookieName || defaultName;
      await persistCapturedCookies(session.opts, { value: token, name: resolvedName, browser: 'manual' });
      if (!isSessionActive(session)) return;
      session.completed = true;
      sendPrompt('auth-prompt:status', { status: 'Session saved manually.', mode: 'ok' });
      session.resolve?.(token);
      scheduleClosePrompt(session);
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
    };

    const win = createAuthPromptWindow(opts);
    session.ipcIds = registerPromptHandlers(session);
    activePrompt = { win, session };

    session.loginWin = createLoginBrowserWindow(opts);

    openChromiumUrl(opts.loginUrl).then(({ browser }) => {
      session.opts.preferredBrowser = browser === 'default' ? undefined : browser;
      if (session.cancelled || session.completed) return;
      sendPrompt('auth-prompt:status', {
        status: `Opened ${browser === 'default' ? 'default browser' : browser}. Sign in there or in the in-app window.`,
        mode: 'waiting',
      });
      const diag = diagnoseBrowserCookie({
        cookieNames: opts.cookieNames || [opts.cookieName],
        domain: opts.domain,
        preferredBrowser: session.opts.preferredBrowser,
      });
      if (diag.reason === 'v20_encrypted') {
        sendPrompt('auth-prompt:status', {
          status: 'Chrome encrypted cookies detected — use the in-app sign-in window (recommended).',
          mode: 'waiting',
        });
      }
    }).catch((err) => {
      session.reject(err);
      closePrompt();
    });

    if (Notification.isSupported()) {
      new Notification({
        title: opts.title,
        body: 'Sign in using the in-app browser window or Chrome/Edge.',
      }).show();
    }

    const poll = async () => {
      if (!isSessionActive(session) || session.polling) return;
      session.polling = true;
      try {
        let hit = await tryCaptureElectronCookie(opts);
        if (!isSessionActive(session)) return;
        if (!hit) hit = await tryCaptureCookie(opts);
        if (!isSessionActive(session)) return;
        if (hit) await completeLogin(session, hit);
      } finally {
        session.polling = false;
      }
    };

    session.timer = setInterval(() => { poll().catch(() => {}); }, 2000);
    poll().catch(() => {});

    win.on('closed', () => {
      if (!session.completed && !session.cancelled) {
        session.reject?.(new Error('Login window closed'));
      }
      cleanupSession(session);
    });

    setTimeout(() => {
      if (session.cancelled || session.completed || activePrompt?.session !== session) return;
      sendPrompt('auth-prompt:status', {
        status: cookieFailureMessage(opts),
        mode: 'waiting',
      });
    }, 20000);
  });
}

function openAuthWindow(opts) {
  const key = opts.secretKey || opts.domain || 'default';
  const prev = loginQueues.get(key) || Promise.resolve();
  const run = prev.then(() => openAuthWindowInner(opts));
  loginQueues.set(key, run.catch(() => {}));
  return run;
}

module.exports = { openAuthWindow, tryCaptureCookie };