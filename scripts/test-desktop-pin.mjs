import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)');
  const EnumWindows = lib.func('EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr']);
  const FindWindowExW = lib.func('FindWindowExW', 'void *', ['void *', 'void *', 'str16', 'str16']);
  const GetClassNameW = lib.func('GetClassNameW', 'int', ['void *', 'str16', 'int']);
  const SetParent = lib.func('SetParent', 'intptr', ['void *', 'void *']);
  const GetParent = lib.func('GetParent', 'intptr', ['void *']);
  const IsChild = lib.func('IsChild', 'bool', ['void *', 'void *']);
  const as = (v) => koffi.as(v, 'void *');

  const workers = [];
  const cb = koffi.register((hwnd) => {
    const cls = Buffer.alloc(256);
    GetClassNameW(as(hwnd), cls, 128);
    const name = cls.toString('utf16le').replace(/\0+$/, '');
    if (name === 'WorkerW') workers.push(hwnd);
    return true;
  }, koffi.pointer(EnumWindowsProc));
  EnumWindows(cb, 0);
  koffi.unregister(cb);

  const win = new BrowserWindow({ width: 200, height: 150, show: true, frame: false, transparent: true, skipTaskbar: true });
  await new Promise((r) => setTimeout(r, 1200));
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  for (const workerW of workers) {
    SetParent(as(hwnd), null);
    const oldParent = SetParent(as(hwnd), as(workerW));
    const parent = GetParent(as(hwnd));
    const isChild = IsChild(as(workerW), as(hwnd));
    const hasDefView = FindWindowExW(as(workerW), null, 'SHELLDLL_DefView', null);
    console.log({
      workerW: BigInt(workerW).toString(16),
      hasDefView: !!hasDefView,
      oldParent: oldParent ? BigInt(oldParent).toString(16) : String(oldParent),
      parent: parent ? BigInt(parent).toString(16) : String(parent),
      isChild,
    });
  }

  win.close();
  app.quit();
});