const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

const CHROMIUM_LAUNCHERS = [
  {
    id: 'chrome',
    paths: [
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
  {
    id: 'edge',
    paths: [
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  },
  {
    id: 'brave',
    paths: [
      path.join(process.env.PROGRAMFILES || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
  },
];

function findChromiumExecutable() {
  for (const browser of CHROMIUM_LAUNCHERS) {
    for (const candidate of browser.paths) {
      if (candidate && fs.existsSync(candidate)) {
        return { id: browser.id, path: candidate };
      }
    }
  }
  return null;
}

/**
 * Open URL in Chrome/Edge/Brave when installed so cookie auto-detect can read the same browser.
 */
async function openChromiumUrl(url) {
  const launcher = findChromiumExecutable();
  if (!launcher) {
    await shell.openExternal(url);
    return { browser: 'default' };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(launcher.path, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', reject);
    child.unref();
    resolve({ browser: launcher.id });
  });
}

module.exports = { openChromiumUrl, findChromiumExecutable, CHROMIUM_LAUNCHERS };