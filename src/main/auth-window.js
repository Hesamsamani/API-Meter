const { BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const { setSecret } = require('./store');
const { getPreloadPath } = require('./assets');
const { readBrowserCookie } = require('./browser-cookies');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let activePrompt = null;

function sendPrompt(channel, payload) {
  if (!activePrompt?.win || activePrompt.win.isDestroyed()) return;
  activePrompt.win.webContents.send(channel, payload);
}

function closePrompt() {
  if (!activePrompt) return;
  const { win, ipcIds } = activePrompt;
  for (const id of ipcIds) ipcMain.removeHandler(id);
  activePrompt = null;
  if (win && !win.isDestroyed()) win.close();
}

function createAuthPromptWindow(opts) {
  const win = new BrowserWindow({
    width: 420,
    height: 360,
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

  win.loadFile(path.join(__dirname, '../renderer/auth-prompt/index.html'));
  win.once('ready-to-show', () => {
    win.show();
    sendPrompt('auth-prompt:init', {
      title: opts.title,
      description: `Opened ${opts.loginUrl} in your default browser. Finish sign-in there — API-Meter reads the session from Chrome or Edge automatically.`,
      status: 'Waiting for browser sign-in…',
      mode: 'waiting',
    });
  });

  return win;
}

function tryCaptureCookie(opts) {
  const names = opts.cookieNames || [opts.cookieName];
  const hit = readBrowserCookie({ cookieNames: names, domain: opts.domain });
  if (!hit?.value) return null;
  setSecret(opts.secretKey, hit.value);
  if (hit.name) setSecret(`${opts.secretKey}-cookie-name`, hit.name);
  return hit;
}

function registerPromptHandlers(session) {
  const handlers = {
    'auth-prompt:cancel': () => {
      session.cancelled = true;
      session.reject?.(new Error('Login cancelled'));
      closePrompt();
    },
    'auth-prompt:retry': () => {
      const hit = tryCaptureCookie(session.opts);
      if (hit) {
        session.completed = true;
        sendPrompt('auth-prompt:status', { status: `Connected via ${hit.browser} (${hit.name})`, mode: 'ok' });
        session.resolve?.(hit.value);
        setTimeout(closePrompt, 600);
      } else {
        sendPrompt('auth-prompt:status', {
          status: 'No session found yet. Finish sign-in in your browser, then click Check browser.',
          mode: 'waiting',
        });
      }
    },
    'auth-prompt:submit': (_e, value) => {
      const token = String(value || '').trim();
      if (!token) {
        sendPrompt('auth-prompt:status', { status: 'Paste a session token first.', mode: 'error' });
        return;
      }
      setSecret(session.opts.secretKey, token);
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

/**
 * Opens the system default browser for login, then reads session cookies from Chrome/Edge.
 * @param {{ loginUrl: string, domain: string, cookieName?: string, cookieNames?: string[], secretKey: string, title: string }} opts
 */
function openAuthWindow(opts) {
  return new Promise((resolve, reject) => {
    closePrompt();

    const session = {
      opts,
      resolve,
      reject,
      cancelled: false,
      completed: false,
      timer: null,
    };

    const win = createAuthPromptWindow(opts);
    const ipcIds = registerPromptHandlers(session);
    activePrompt = { win, ipcIds, session };

    shell.openExternal(opts.loginUrl).catch((err) => {
      session.reject(err);
      closePrompt();
    });

    if (Notification.isSupported()) {
      new Notification({
        title: opts.title,
        body: 'Complete sign-in in your default browser. API-Meter will detect the session automatically.',
      }).show();
    }

    const poll = () => {
      if (session.cancelled) return;
      const hit = tryCaptureCookie(opts);
      if (hit) {
        clearInterval(session.timer);
        session.completed = true;
        sendPrompt('auth-prompt:status', { status: `Connected via ${hit.browser} (${hit.name})`, mode: 'ok' });
        session.resolve(hit.value);
        setTimeout(closePrompt, 600);
      }
    };

    session.timer = setInterval(poll, 2000);
    poll();

    win.on('closed', () => {
      clearInterval(session.timer);
      if (!session.completed && !session.cancelled && activePrompt?.session === session) {
        session.reject(new Error('Login window closed'));
      }
      activePrompt = null;
    });

    setTimeout(() => {
      if (session.cancelled || activePrompt?.session !== session) return;
      sendPrompt('auth-prompt:status', {
        status: 'Still waiting… If auto-detect fails, paste the session token below (DevTools → Application → Cookies).',
        mode: 'waiting',
      });
    }, 20000);
  });
}

module.exports = { openAuthWindow, CHROME_UA, readBrowserCookie, tryCaptureCookie };