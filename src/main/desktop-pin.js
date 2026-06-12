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
      IsWindowVisible: lib.func('IsWindowVisible', 'bool', ['void *']),
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
  // Legacy + Win10/11 spawn variants — harmless if one is ignored by the shell.
  user32.SendMessageTimeoutW(asHwnd(progman), WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, resultPtr);
  user32.SendMessageTimeoutW(asHwnd(progman), WM_SPAWN_WORKER, 0xd, 1, SMTO_NORMAL, 1000, resultPtr);
}

function findDesktopWorkerW() {
  const user32 = loadApi();
  if (!user32) return null;

  const progman = user32.FindWindowW('Progman', null);
  if (!progman) return null;

  spawnDesktopWorker(user32, progman);

  // Win11: WorkerW is often a child of Progman (not a top-level sibling).
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

  // Never parent to Progman — that hides the widget behind SHELLDLL_DefView icons.
  if (!workerW || workerW === progman || !user32.IsWindow(asHwnd(workerW))) return null;
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

function restoreWidgetPlacement(user32, hwnd, workerW, bounds) {
  const { x, y } = screenPointToWorkerClient(user32, workerW, bounds.x, bounds.y);
  user32.ShowWindow(asHwnd(hwnd), SW_SHOW);
  user32.SetWindowPos(
    asHwnd(hwnd),
    asHwnd(HWND_TOP),
    x,
    y,
    bounds.width,
    bounds.height,
    SWP_SHOWWINDOW | SWP_NOACTIVATE,
  );
}

/**
 * Parent the widget HWND to the desktop WorkerW layer.
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function pinWidgetToDesktop(win) {
  try {
    const user32 = loadApi();
    if (!user32 || !win || win.isDestroyed()) return false;

    const hwnd = hwndFromWindow(win);
    if (!hwnd) return false;

    const workerW = findDesktopWorkerW();
    if (!workerW) return false;

    const bounds = win.getBounds();
    user32.SetParent(asHwnd(hwnd), asHwnd(workerW));
    restoreWidgetPlacement(user32, hwnd, workerW, bounds);
    win.setAlwaysOnTop(false);
    // Electron may still reconcile bounds after reparenting.
    win.setBounds(bounds);
    return user32.IsWindowVisible(asHwnd(hwnd));
  } catch (err) {
    console.error('desktop-pin: failed to pin widget', err);
    return false;
  }
}

/**
 * Detach widget from WorkerW and restore as a top-level window.
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function unpinWidgetFromDesktop(win) {
  try {
    const user32 = loadApi();
    if (!user32 || !win || win.isDestroyed()) return false;
    const hwnd = hwndFromWindow(win);
    if (!hwnd) return false;
    user32.SetParent(asHwnd(hwnd), null);
    const bounds = win.getBounds();
    user32.ShowWindow(asHwnd(hwnd), SW_SHOW);
    user32.SetWindowPos(
      asHwnd(hwnd),
      asHwnd(HWND_TOP),
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_SHOWWINDOW | SWP_NOACTIVATE,
    );
    win.setBounds(bounds);
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
  findDesktopWorkerW,
};