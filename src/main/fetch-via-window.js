/**
 * Fetches content from a URL using a hidden BrowserWindow with a Chrome User-Agent.
 */
const { BrowserWindow } = require('electron');
const { CHROME_UA } = require('../shared/ua');
const { PARTITION, getProviderSession } = require('./provider-session');

const BLOCKED_SIGNATURES = [
  { pattern: 'Just a moment', error: 'CloudflareBlocked' },
  { pattern: 'Enable JavaScript and cookies to continue', error: 'CloudflareChallenge' },
  { pattern: '<html', error: 'UnexpectedHTML' },
];

function parseResponseBody(bodyText) {
  for (const sig of BLOCKED_SIGNATURES) {
    if (bodyText.includes(sig.pattern)) {
      throw new Error(`${sig.error}: ${bodyText.substring(0, 200)}`);
    }
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error('InvalidJSON: ' + bodyText.substring(0, 200));
  }
}

function createFetchWindow({ partition = PARTITION } = {}) {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);
  return win;
}

function urlLooksReady(currentUrl, targetUrl) {
  if (!currentUrl || currentUrl === 'about:blank') return false;
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    return current.hostname === target.hostname;
  } catch {
    return true;
  }
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, expectJson?: boolean, partition?: string }} [options]
 */
function fetchViaWindow(url, { timeoutMs = 30000, expectJson = true, partition = PARTITION } = {}) {
  return new Promise((resolve, reject) => {
    const win = createFetchWindow({ partition });
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!win.isDestroyed()) win.close();
      fn(value);
    };

    const timeout = setTimeout(() => finish(reject, new Error('Request timeout')), timeoutMs);

    const handleStop = async () => {
      try {
        if (win.isDestroyed() || win.webContents.isLoading()) return;
        const currentUrl = win.webContents.getURL();
        if (!urlLooksReady(currentUrl, url)) return;

        const bodyText = await win.webContents.executeJavaScript(
          'document.body?.innerText || document.body?.textContent || ""',
        );
        if (!String(bodyText || '').trim()) return;

        if (expectJson) {
          finish(resolve, parseResponseBody(bodyText));
        } else {
          finish(resolve, String(bodyText));
        }
      } catch (err) {
        finish(reject, err);
      }
    };

    win.webContents.on('did-stop-loading', handleStop);
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      finish(reject, new Error(`LoadFailed: ${errorCode} ${errorDescription}`));
    });

    win.loadURL(url);
  });
}

function fetchMultipleViaWindow(urls, { timeoutMs = 10000, expectJson = true, partition = PARTITION } = {}) {
  return new Promise((resolve, reject) => {
    const win = createFetchWindow({ partition });
    const results = [];
    let currentIndex = 0;
    let currentTimeout = null;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (currentTimeout) clearTimeout(currentTimeout);
      if (!win.isDestroyed()) win.close();
      fn(value);
    };

    function loadNext() {
      if (currentIndex >= urls.length) {
        finish(resolve, results);
        return;
      }

      if (currentTimeout) clearTimeout(currentTimeout);
      currentTimeout = setTimeout(() => {
        finish(reject, new Error(`Request timeout for URL ${currentIndex}: ${urls[currentIndex]}`));
      }, timeoutMs);

      win.loadURL(urls[currentIndex]);
    }

    win.webContents.on('did-stop-loading', async () => {
      try {
        if (win.isDestroyed() || win.webContents.isLoading()) return;
        const currentUrl = win.webContents.getURL();
        if (!urlLooksReady(currentUrl, urls[currentIndex])) return;

        const bodyText = await win.webContents.executeJavaScript(
          'document.body?.innerText || document.body?.textContent || ""',
        );
        if (!String(bodyText || '').trim()) return;

        const data = expectJson ? parseResponseBody(bodyText) : String(bodyText);
        results.push(data);
        currentIndex += 1;
        if (currentTimeout) {
          clearTimeout(currentTimeout);
          currentTimeout = null;
        }
        loadNext();
      } catch (err) {
        finish(reject, err);
      }
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      finish(reject, new Error(`LoadFailed at URL ${currentIndex}: ${errorCode} ${errorDescription}`));
    });

    loadNext();
  });
}

module.exports = {
  fetchViaWindow,
  fetchMultipleViaWindow,
  parseResponseBody,
  createFetchWindow,
  getProviderSession,
};