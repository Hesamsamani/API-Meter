/**
 * Pin Electron BrowserWindow to the Windows desktop (WorkerW) layer so Win+D /
 * "Show desktop" does not hide the floating widget (Rainmeter-style).
 */
const { platform } = require('process');

const WM_SPAWN_WORKER = 0x052c;
const SMTO_NORMAL = 0;

let koffi = null;
let lib = null;
let api = null;
let EnumWindowsProc = null;

function loadApi() {
  if (api) return api;
  if (platform !== 'win32') return null;
  try {
    koffi = require('koffi');
    lib = koffi.load('user32.dll');
    EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)');

    api = {
      FindWindowW: lib.func('FindWindowW', 'void *', ['str16', 'str16']),
      FindWindowExW: lib.func('FindWindowExW', 'void *', ['void *', 'void *', 'str16', 'str16']),
      SendMessageTimeoutW: lib.func(
        'SendMessageTimeoutW',
        'uintptr',
        ['void *', 'uint', 'uintptr', 'intptr', 'uint', 'uint', 'void *'],
      ),
      SetParent: lib.func('SetParent', 'void *', ['void *', 'void *']),
      IsWindow: lib.func('IsWindow', 'bool', ['void *']),
      EnumWindows: lib.func('EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr']),
      decodeHwnd: (buf) => koffi.decode(buf, 'void *', 0),
    };
    return api;
  } catch (err) {
    console.error('desktop-pin: user32 unavailable', err);
    return null;
  }
}

function isDesktopPinSupported() {
  return !!loadApi();
}

function findDesktopWorkerW(user32) {
  const progman = user32.FindWindowW('Progman', null);
  if (!progman) return null;

  const resultPtr = koffi.alloc('uintptr', 1);
  user32.SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, resultPtr);

  let workerW = null;
  const callback = koffi.register((hwnd) => {
    const shellView = user32.FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null);
    if (shellView) workerW = hwnd;
    return true;
  }, koffi.pointer(EnumWindowsProc));

  user32.EnumWindows(callback, 0);
  koffi.unregister(callback);

  return workerW || progman;
}

function hwndFromWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const handle = win.getNativeWindowHandle();
  if (!handle || handle.length < 4) return null;
  const user32 = loadApi();
  if (!user32) return null;
  return user32.decodeHwnd(handle);
}

/**
 * Parent the widget HWND to the desktop WorkerW layer.
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function pinWidgetToDesktop(win) {
  const user32 = loadApi();
  if (!user32 || !win || win.isDestroyed()) return false;

  const hwnd = hwndFromWindow(win);
  if (!hwnd) return false;

  const workerW = findDesktopWorkerW(user32);
  if (!workerW || !user32.IsWindow(workerW)) return false;

  const bounds = win.getBounds();
  user32.SetParent(hwnd, workerW);
  win.setAlwaysOnTop(false);
  // Reparenting can reset placement; restore the on-screen coordinates.
  win.setBounds(bounds);
  return true;
}

module.exports = {
  isDesktopPinSupported,
  pinWidgetToDesktop,
};