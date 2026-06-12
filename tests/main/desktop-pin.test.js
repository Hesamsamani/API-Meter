import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pinSrc = readFileSync(path.join(root, 'src/main/desktop-pin.js'), 'utf8');
const windowsSrc = readFileSync(path.join(root, 'src/main/windows.js'), 'utf8');

test('desktop-pin uses WorkerW spawn and SetParent', () => {
  assert.match(pinSrc, /WM_SPAWN_WORKER/);
  assert.match(pinSrc, /SHELLDLL_DefView/);
  assert.match(pinSrc, /SetParent/);
  assert.match(pinSrc, /pinWidgetToDesktop/);
  assert.match(pinSrc, /koffi\.as\(hwnd, 'void \*'\)/);
  assert.match(pinSrc, /readBigUInt64LE/);
  assert.match(pinSrc, /FindWindowExW\(asHwnd\(progman\), null, 'WorkerW'/);
  assert.match(pinSrc, /Never parent to Progman/);
  assert.match(pinSrc, /SetWindowPos/);
  assert.match(pinSrc, /ShowWindow/);
  assert.match(pinSrc, /ScreenToClient/);
});

test('floating widget is pinned on show and click-through changes', () => {
  assert.match(windowsSrc, /pinWidgetToDesktop/);
  assert.match(windowsSrc, /applyWidgetDesktopLayer/);
  assert.match(windowsSrc, /win\.on\('show', \(\) => applyWidgetDesktopLayer/);
  assert.doesNotMatch(windowsSrc, /setAlwaysOnTop\(true\)/);
});