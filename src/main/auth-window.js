const { BrowserWindow, session } = require('electron');
const { setSecret } = require('./store');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Opens a login window and resolves when session cookie is captured.
 * @param {{ loginUrl: string, domain: string, cookieName: string, secretKey: string, title: string }} opts
 */
function openAuthWindow(opts) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480,
      height: 720,
      title: opts.title,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.webContents.setUserAgent(CHROME_UA);

    const poll = setInterval(async () => {
      const cookies = await session.defaultSession.cookies.get({ url: opts.loginUrl });
      const hit = cookies.find((c) => c.name === opts.cookieName);
      if (hit?.value) {
        clearInterval(poll);
        setSecret(opts.secretKey, hit.value);
        win.close();
        resolve(hit.value);
      }
    }, 1000);

    win.on('closed', () => {
      clearInterval(poll);
      reject(new Error('Login window closed'));
    });

    win.loadURL(opts.loginUrl);
  });
}

module.exports = { openAuthWindow, CHROME_UA };