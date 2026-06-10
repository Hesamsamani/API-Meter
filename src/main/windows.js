const { BrowserWindow, screen } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, '../../preload.js');

function createDashboardWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/dashboard/index.html'));
  win.on('closed', () => { win._apiMeterRef = null; });
  return win;
}

function createPopoverWindow() {
  const win = new BrowserWindow({
    width: 340,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/tray-popover/index.html'));
  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide();
  });
  return win;
}

function createSettingsWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 620,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#0a0a0b',
    parent: undefined,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/settings/index.html'));
  return win;
}

function createFloatingWidget() {
  const win = new BrowserWindow({
    width: 280,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/floating-widget/index.html'));
  return win;
}

function positionNearTray(win) {
  const { width, height } = win.getBounds();
  const display = screen.getPrimaryDisplay();
  const { x, y, width: sw, height: sh } = display.workArea;
  win.setPosition(x + sw - width - 12, y + sh - height - 48);
}

function showDashboard(getOrCreate) {
  let win = getOrCreate();
  if (win.isDestroyed()) win = getOrCreate(true);
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function showSettings(getOrCreate) {
  let win = getOrCreate();
  if (win.isDestroyed()) win = getOrCreate(true);
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function showPopover(getOrCreate) {
  let win = getOrCreate();
  if (win.isDestroyed()) win = getOrCreate(true);
  positionNearTray(win);
  win.show();
  win.focus();
  return win;
}

function toggleFloatingWidget({ getWin, createWin, settings, onEnabledChange }) {
  let win = getWin();
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
    settings.set('floatingWidget.enabled', false);
    onEnabledChange?.(false);
    return null;
  }
  if (!win || win.isDestroyed()) win = createWin();
  settings.set('floatingWidget.enabled', true);
  onEnabledChange?.(true);
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  win.setPosition(Math.floor(sw / 2 - 140), 80);
  win.show();
  return win;
}

module.exports = {
  createDashboardWindow,
  createPopoverWindow,
  createFloatingWidget,
  createSettingsWindow,
  showDashboard,
  showPopover,
  showSettings,
  toggleFloatingWidget,
};