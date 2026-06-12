/**
 * Pin Electron BrowserWindow to the Windows desktop (WorkerW) layer so Win+D /
 * "Show desktop" does not hide the floating widget (Rainmeter-style).
 */
const { platform } = require('process');

const WM_SPAWN_WORKER = 0x052c;
const SMTO_NORMAL = 0;
const HWND_TOP = 0n;
const SW_SHOW = 5;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOACTIVATE = 0x0010;

let koffi = null;
let lib = null;
let api = null;
let EnumWindowsProc = null;
let cachedWorkerW = null;

/** Cast a BigInt HWND to the void * type koffi expects at FFI boundaries. */
function asHwnd(hwnd) {
  if (hwnd == null || hwnd === 0n) return null;
  return koffi.as(hwnd, 'void *');
}

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
      ShowWindow: lib.func('ShowWindow', 'bool', ['void *', 'int']),
      SetWindowPos: lib.func('SetWindowPos', 'bool', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint']),
      ScreenToClient: lib.func('ScreenToClient', 'bool', ['void *', 'void *']),
      GetParent: lib.func('GetParent', 'void *', ['void *']),
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

function spawnDesktopWorker(user32, progman) {
  const resultPtr = koffi.alloc('uintptr', 1);
  user32.SendMessageTimeoutW(asHwnd(progman), WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, resultPtr);
  user32.SendMessageTimeoutW(asHwnd(progman), WM_SPAWN_WORKER, 0xd, 1, SMTO_NORMAL, 1000, resultPtr);
}

function findDesktopWorkerW() {
  const user32 = loadApi();
  if (!user32) return null;

  if (cachedWorkerW && user32.IsWindow(asHwnd(cachedWorkerW))) {
    return cachedWorkerW;
  }

  const progman = user32.FindWindowW('Progman', null);
  if (!progman) return null;

  spawnDesktopWorker(user32, progman);

  let workerW = user32.FindWindowExW(asHwnd(progman), null, 'WorkerW', null);

  if (!workerW) {
    let sibling = null;
    const callback = koffi.register((hwnd) => {
      const shellView = user32.FindWindowExW(asHwnd(hwnd), null, 'SHELLDLL_DefView', null);
      if (!shellView) return true;
      const next = user32.FindWindowExW(null, asHwnd(hwnd), 'WorkerW', null);
      if (next) sibling = next;
      return true;
    }, koffi.pointer(EnumWindowsProc));

    user32.EnumWindows(callback, 0);
    koffi.unregister(callback);
    workerW = sibling;
  }

  if (!workerW) {
    workerW = user32.FindWindowW('WorkerW', null);
  }

  // Never parent to Progman — only the child WorkerW hosts the desktop layer.
  if (!workerW || workerW === progman || !user32.IsWindow(asHwnd(workerW))) return null;
  cachedWorkerW = workerW;
  return workerW;
}

function readHwndFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  const ptr = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  return ptr === 0n ? null : ptr;
}

function hwndFromWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const handle = win.getNativeWindowHandle();
  return readHwndFromBuffer(handle);
}

function isWidgetPinnedToDesktop(win) {
  const user32 = loadApi();
  if (!user32 || !win || win.isDestroyed()) return false;
  const hwnd = hwndFromWindow(win);
  if (!hwnd) return false;
  const workerW = findDesktopWorkerW();
  if (!workerW) return false;
  const parent = user32.GetParent(asHwnd(hwnd));
  return parent === workerW;
}

function screenPointToWorkerClient(user32, workerW, screenX, screenY) {
  const point = koffi.alloc('int32', 2);
  koffi.encode(point, 'int32', screenX, 0);
  koffi.encode(point, 'int32', screenY, 4);
  user32.ScreenToClient(asHwnd(workerW), point);
  return {
    x: koffi.decode(point, 'int32', 0),
    y: koffi.decode(point, 'int32', 4),
  };
}

function restoreWidgetPlacement(user32, hwnd, workerW, bounds, { shouldShow = true } = {}) {
  const { x, y } = screenPointToWorkerClient(user32, workerW, bounds.x, bounds.y);
  if (shouldShow) {
    user32.ShowWindow(asHwnd(hwnd), SW_SHOW);
  }
  user32.SetWindowPos(
    asHwnd(hwnd),
    asHwnd(HWND_TOP),
    x,
    y,
    bounds.width,
    bounds.height,
    (shouldShow ? SWP_SHOWWINDOW : 0) | SWP_NOACTIVATE,
  );
}

/**
 * Parent the widget HWND to the desktop WorkerW layer.
 * @param {import('electron').BrowserWindow} win
 * @param {{ shouldShow?: boolean }} [options]
 * @returns {boolean}
 */
function pinWidgetToDesktop(win, { shouldShow = true } = {}) {
  try {
    const user32 = loadApi();
    if (!user32 || !win || win.isDestroyed()) return false;

    const hwnd = hwndFromWindow(win);
    if (!hwnd || !user32.IsWindow(asHwnd(hwnd))) return false;

    const workerW = findDesktopWorkerW();
    if (!workerW) return false;

    const bounds = win.getBounds();
    user32.SetParent(asHwnd(hwnd), asHwnd(workerW));
    restoreWidgetPlacement(user32, hwnd, workerW, bounds, { shouldShow });
    win.setAlwaysOnTop(false);
    return user32.IsWindow(asHwnd(hwnd));
  } catch (err) {
    console.error('desktop-pin: failed to pin widget', err);
    return false;
  }
}

/**
 * Detach widget from WorkerW and restore as a top-level window.
 * @param {import('electron').BrowserWindow} win
 * @param {{ shouldShow?: boolean }} [options]
 * @returns {boolean}
 */
function unpinWidgetFromDesktop(win, { shouldShow = true } = {}) {
  try {
    if (!isWidgetPinnedToDesktop(win)) return true;
    const user32 = loadApi();
    if (!user32 || !win || win.isDestroyed()) return false;
    const hwnd = hwndFromWindow(win);
    if (!hwnd) return false;
    user32.SetParent(asHwnd(hwnd), null);
    const bounds = win.getBounds();
    if (shouldShow) {
      user32.ShowWindow(asHwnd(hwnd), SW_SHOW);
    }
    user32.SetWindowPos(
      asHwnd(hwnd),
      asHwnd(HWND_TOP),
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      (shouldShow ? SWP_SHOWWINDOW : 0) | SWP_NOACTIVATE,
    );
    return true;
  } catch (err) {
    console.error('desktop-pin: failed to unpin widget', err);
    return false;
  }
}

module.exports = {
  isDesktopPinSupported,
  pinWidgetToDesktop,
  unpinWidgetFromDesktop,
  isWidgetPinnedToDesktop,
  findDesktopWorkerW,
};