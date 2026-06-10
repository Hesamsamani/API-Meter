const { BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { setSecret } = require('./store');
const { getPreloadPath } = require('./assets');
const { readBrowserCookie, diagnoseBrowserCookie } = require('./browser-cookies');
const { openChromiumUrl } = require('./open-chromium');
const { getProviderSession, findSessionCookie, flushCookies } = require('./provider-session');
const { CHROME_UA } = require('../shared/ua');

let activePrompt = null;
let loginQueue = Promise.resolve();

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

async function persistCapturedCookie(opts, hit) {
  setSecret(opts.secretKey, hit.value);
  if (hit.name) setSecret(`${opts.secretKey}-cookie-name`, hit.name);
  const { getProviderSession, setCookies, flushCookies } = require('./provider-session');
  const ses = getProviderSession();
  const cookieName = hit.name || (opts.cookieNames || [opts.cookieName]).filter(Boolean)[0];
  if (!cookieName) return;
  await setCookies(ses, [{
    url: opts.loginUrl,
    name: cookieName,
    value: hit.value,
    domain: opts.domain,
    path: '/',
    secure: true,
    sameSite: 'no_restriction',
  }]);
  await flushCookies(ses);
}

async function tryCaptureCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const hit = readBrowserCookie({ cookieNames: names, domain: opts.domain });
  if (!hit?.value) return null;
  await persistCapturedCookie(opts, hit);
  return hit;
}

async function tryCaptureElectronCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const ses = getProviderSession();
  const hit = await findSessionCookie(ses, { url: opts.loginUrl, names });
  if (!hit?.value) return null;
  const captured = { value: hit.value, name: hit.name, browser: 'in-app' };
  await persistCapturedCookie(opts, captured);
  return captured;
}

function cookieFailureMessage(opts) {
  const diag = diagnoseBrowserCookie({
    cookieNames: opts.cookieNames || [opts.cookieName],
    domain: opts.domain,
  });
  switch (diag.reason) {
    case 'unsupported_platform':
      return 'Use the in-app sign-in window or paste the session token below.';
    case 'db_locked':
      return 'Browser cookies are locked. Use the in-app sign-in window or paste the token manually.';
    case 'v20_encrypted':
      return 'Chrome app-bound cookies cannot be read from disk. Use the in-app sign-in window or paste the token below.';
    case 'not_found':
      return 'No session yet. Finish sign-in in the in-app window or Chrome/Edge, then click Check browser.';
    default:
      return 'No session found yet. Finish sign-in, then click Check browser.';
  }
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
      if (!hit) hit = await tryCaptureCookie(session.opts);
      if (hit) {
        session.completed = true;
        sendPrompt('auth-prompt:status', { status: `Connected via ${hit.browser} (${hit.name})`, mode: 'ok' });
        session.resolve?.(hit.value);
        setTimeout(closePrompt, 600);
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
      await persistCapturedCookie(session.opts, { value: token, name: resolvedName, browser: 'manual' });
      session.completed = true;
      sendPrompt('auth-prompt:status', { status: 'Session saved manually.', mode: 'ok' });
      session.resolve?.(token);
      setTimeout(closePrompt, 600);
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
      if (session.cancelled || session.completed) return;
      sendPrompt('auth-prompt:status', {
        status: `Opened ${browser === 'default' ? 'default browser' : browser}. Sign in there or in the in-app window.`,
        mode: 'waiting',
      });
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
      if (session.cancelled || session.completed) return;
      let hit = await tryCaptureElectronCookie(opts);
      if (!hit) hit = await tryCaptureCookie(opts);
      if (hit) {
        session.completed = true;
        sendPrompt('auth-prompt:status', { status: `Connected via ${hit.browser} (${hit.name})`, mode: 'ok' });
        session.resolve(hit.value);
        setTimeout(closePrompt, 600);
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
  const run = loginQueue.then(() => openAuthWindowInner(opts));
  loginQueue = run.catch(() => {});
  return run;
}

module.exports = { openAuthWindow, tryCaptureCookie };