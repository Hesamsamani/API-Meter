/**
 * Fetches content from a URL using a hidden BrowserWindow with a Chrome User-Agent.
 */
const { BrowserWindow } = require('electron');
const { CHROME_UA } = require('../shared/ua');
const {
  extractGeminiPageTokens,
  GEMINI_PAGE_SOURCE_COLLECTOR,
} = require('../shared/gemini-page-tokens');
const { PARTITION } = require('./provider-session');

const BLOCKED_SIGNATURES = [
  { pattern: 'Just a moment', error: 'CloudflareBlocked' },
  { pattern: 'Enable JavaScript and cookies to continue', error: 'CloudflareChallenge' },
];

const BENIGN_FAIL_CODES = new Set([-3, -27]);

function parseResponseBody(bodyText) {
  const trimmed = String(bodyText || '').trim();
  if (!trimmed) throw new Error('InvalidJSON: empty response');

  try {
    return JSON.parse(trimmed);
  } catch {
    for (const sig of BLOCKED_SIGNATURES) {
      if (trimmed.includes(sig.pattern)) {
        throw new Error(`${sig.error}: ${trimmed.substring(0, 200)}`);
      }
    }
    if (/<html/i.test(trimmed)) {
      throw new Error(`UnexpectedHTML: ${trimmed.substring(0, 200)}`);
    }
    throw new Error('InvalidJSON: ' + trimmed.substring(0, 200));
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
    return false;
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
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || BENIGN_FAIL_CODES.has(errorCode)) return;
      finish(reject, new Error(`LoadFailed: ${errorCode} ${errorDescription}`));
    });

    win.loadURL(url);
  });
}

/**
 * Load originUrl in a hidden window, then POST from page context (cookies included).
 * @param {string} originUrl
 * @param {string} postUrl
 * @param {string} body - application/x-www-form-urlencoded body
 * @param {{ timeoutMs?: number, partition?: string, appendGoogleAtToken?: boolean }} [options]
 */
function geminiLoadCandidates(originUrl) {
  const base = originUrl.replace(/\/?$/, '');
  return [...new Set([`${base}/`, `${base}/app`, originUrl])];
}

async function collectGeminiPageSource(win) {
  if (!win || win.isDestroyed()) return '';
  return win.webContents.executeJavaScript(GEMINI_PAGE_SOURCE_COLLECTOR);
}

async function waitForGeminiTokens(win, { timeoutMs = 15000, pollMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = { at: null, sid: null, bl: null };
  while (Date.now() < deadline) {
    if (win.isDestroyed()) break;
    const html = await collectGeminiPageSource(win);
    last = extractGeminiPageTokens(html);
    if (last.at) return last;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return last;
}

function postViaWindow(
  originUrl,
  postUrl,
  body,
  { timeoutMs = 30000, partition = PARTITION, appendGoogleAtToken = false } = {},
) {
  return new Promise((resolve, reject) => {
    const win = createFetchWindow({ partition });
    let settled = false;
    let posting = false;
    let loadIndex = 0;
    const loadUrls = appendGoogleAtToken ? geminiLoadCandidates(originUrl) : [originUrl];

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!win.isDestroyed()) win.close();
      fn(value);
    };

    const timeout = setTimeout(() => finish(reject, new Error('Request timeout')), timeoutMs);

    const runPost = async () => {
      if (posting || settled || win.isDestroyed() || win.webContents.isLoading()) return;
      const currentUrl = win.webContents.getURL();
      if (!urlLooksReady(currentUrl, originUrl)) return;

      posting = true;
      try {
        let tokens = { at: null, sid: null, bl: null };
        if (appendGoogleAtToken) {
          tokens = await waitForGeminiTokens(win, { timeoutMs: Math.min(15000, timeoutMs - 2000) });
          if (!tokens.at && loadIndex < loadUrls.length - 1) {
            posting = false;
            loadIndex += 1;
            win.loadURL(loadUrls[loadIndex]);
            return;
          }
        }

        if (appendGoogleAtToken && !tokens.at) {
          finish(reject, new Error('Gemini page token missing (SNlM0e) — open gemini.google.com while signed in'));
          return;
        }

        const responseText = await win.webContents.executeJavaScript(
          `(async () => {
            let postBody = ${JSON.stringify(body)};
            let requestUrl = ${JSON.stringify(postUrl)};
            if (${appendGoogleAtToken}) {
              const tokens = ${JSON.stringify(tokens)};
              if (tokens.at && !postBody.includes('at=')) {
                postBody += '&at=' + encodeURIComponent(tokens.at);
              }
              const url = new URL(requestUrl);
              if (tokens.sid && !url.searchParams.has('f.sid')) url.searchParams.set('f.sid', tokens.sid);
              if (tokens.bl && !url.searchParams.has('bl')) url.searchParams.set('bl', tokens.bl);
              if (!url.searchParams.has('hl')) url.searchParams.set('hl', 'en');
              requestUrl = url.toString();
            }
            const resp = await fetch(requestUrl, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
              body: postBody,
            });
            const text = await resp.text();
            if (!resp.ok) {
              throw new Error('HTTP ' + resp.status + ': ' + text.substring(0, 200));
            }
            return text;
          })()`,
        );
        if (!String(responseText || '').trim()) {
          finish(reject, new Error('Empty response'));
          return;
        }
        finish(resolve, String(responseText));
      } catch (err) {
        finish(reject, err);
      }
    };

    win.webContents.on('did-stop-loading', () => { runPost().catch((err) => finish(reject, err)); });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || BENIGN_FAIL_CODES.has(errorCode)) return;
      finish(reject, new Error(`LoadFailed: ${errorCode} ${errorDescription}`));
    });

    win.loadURL(loadUrls[loadIndex]);
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

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || BENIGN_FAIL_CODES.has(errorCode)) return;
      finish(reject, new Error(`LoadFailed at URL ${currentIndex}: ${errorCode} ${errorDescription}`));
    });

    loadNext();
  });
}

module.exports = {
  fetchViaWindow,
  postViaWindow,
  fetchMultipleViaWindow,
  parseResponseBody,
  createFetchWindow,
  collectGeminiPageSource,
  waitForGeminiTokens,
  geminiLoadCandidates,
};