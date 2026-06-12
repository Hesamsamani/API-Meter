const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { getPreloadPath } = require('./assets');
const { pinWidgetToDesktop, unpinWidgetFromDesktop, isWidgetPinnedToDesktop } = require('./desktop-pin');
const {
  normalizeWidgetSettings,
  computeWidgetBounds,
  clampWidgetPosition,
} = require('../shared/widget-presets');

function preloadPath() {
  return getPreloadPath();
}

function createDashboardWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/dashboard/index.html'));
  return win;
}

function createPopoverWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/tray-popover/index.html'));

  let hideTimer = null;
  win.on('blur', () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFocused()) win.hide();
    }, 180);
  });
  win.on('focus', () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  win.on('show', () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
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
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/settings/index.html'));
  return win;
}

function workAreaForBounds(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function readWidgetSettings(settingsStore, fallback = {}) {
  return settingsStore
    ? normalizeWidgetSettings(settingsStore.get('floatingWidget'))
    : normalizeWidgetSettings(fallback);
}

function applyWidgetWindowBounds(win, fwSettings, providerCount = 1, orbSlots = 0) {
  if (!win || win.isDestroyed()) return;
  const fw = normalizeWidgetSettings(fwSettings);
  const { width, height } = computeWidgetBounds(fw, providerCount, orbSlots);
  const bounds = win.getBounds();
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  const area = workAreaForBounds({
    x: bounds.x,
    y: bounds.y,
    width: nextWidth,
    height: nextHeight,
  });
  const { x, y } = clampWidgetPosition(bounds.x, bounds.y, nextWidth, nextHeight, area);
  win.setBounds({ x, y, width: nextWidth, height: nextHeight });
  if (win.isVisible()) {
    applyWidgetLayerOrder(win, fw.layerOrder);
  }
}

function saveWidgetPosition(win, settingsStore) {
  if (!win || win.isDestroyed() || !settingsStore) return;
  const { x, y } = win.getBounds();
  settingsStore.set('floatingWidget', {
    ...settingsStore.get('floatingWidget'),
    position: { x, y },
  });
}

function applyWidgetPosition(win, fwSettings) {
  if (!win || win.isDestroyed()) return;
  const fw = normalizeWidgetSettings(fwSettings);
  const { width, height } = win.getBounds();
  if (fw.position) {
    const area = workAreaForBounds({ ...fw.position, width, height });
    const { x, y } = clampWidgetPosition(fw.position.x, fw.position.y, width, height, area);
    win.setPosition(x, y);
    return;
  }
  positionNearTray(win);
}

function attachWidgetPositionPersistence(win, settingsStore) {
  if (!win || win.isDestroyed() || !settingsStore) return;
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveWidgetPosition(win, settingsStore);
    }, 200);
  };
  win.on('moved', scheduleSave);
  win.on('hide', () => saveWidgetPosition(win, settingsStore));
}

/**
 * @returns {{ ok: boolean, effective: string, fallback?: boolean }}
 */
function applyWidgetLayerOrder(win, layerOrder = 'always-on-top') {
  if (!win || win.isDestroyed()) {
    return { ok: false, effective: layerOrder };
  }
  if (!win.isVisible()) {
    return { ok: true, effective: layerOrder, deferred: true };
  }

  const fw = normalizeWidgetSettings({ layerOrder });
  const shouldShow = win.isVisible();

  if (fw.layerOrder === 'desktop') {
    if (pinWidgetToDesktop(win, { shouldShow })) {
      return { ok: true, effective: 'desktop' };
    }
    unpinWidgetFromDesktop(win, { shouldShow });
    win.setAlwaysOnTop(true, 'screen-saver');
    return { ok: false, effective: 'always-on-top', fallback: true };
  }

  if (isWidgetPinnedToDesktop(win)) {
    unpinWidgetFromDesktop(win, { shouldShow });
  }
  if (fw.layerOrder === 'always-on-top') {
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(false);
  }
  return { ok: true, effective: fw.layerOrder };
}

function applyWidgetClickThrough(win, enabled, layerOrder = 'always-on-top') {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!!enabled, { forward: true });
  if (win.isVisible()) {
    applyWidgetLayerOrder(win, layerOrder);
  }
}

function prepareWidgetForShow(win, settingsStore, initialFw = {}) {
  const fw = readWidgetSettings(settingsStore, initialFw);
  applyWidgetPosition(win, fw);
  win.setIgnoreMouseEvents(!!fw.clickThrough, { forward: true });
  applyWidgetLayerOrder(win, fw.layerOrder);
}

function createFloatingWidget(fwSettings = {}, settingsStore = null, { autoShow = false } = {}) {
  const fw = normalizeWidgetSettings(fwSettings);
  const { width, height } = computeWidgetBounds(fw, 1);
  const win = new BrowserWindow({
    width: Math.round(width),
    height: Math.round(height),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/floating-widget/index.html'));

  win.once('ready-to-show', () => {
    prepareWidgetForShow(win, settingsStore, fw);
    const current = readWidgetSettings(settingsStore, fw);
    if (autoShow || current.enabled) {
      win.show();
    }
  });

  win.on('show', () => {
    const current = readWidgetSettings(settingsStore, fw);
    applyWidgetLayerOrder(win, current.layerOrder);
  });

  attachWidgetPositionPersistence(win, settingsStore);
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

function showPopover(getOrCreate, { onShow } = {}) {
  let win = getOrCreate();
  if (win.isDestroyed()) win = getOrCreate(true);
  positionNearTray(win);

  const notify = () => onShow?.(win);
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', notify);
  } else {
    notify();
  }

  win.show();
  win.focus();
  return win;
}

function revealFloatingWidget(win, settingsStore) {
  const fw = readWidgetSettings(settingsStore);
  const reveal = () => {
    prepareWidgetForShow(win, settingsStore, fw);
    win.show();
  };
  if (win.webContents.isLoading()) {
    win.once('ready-to-show', reveal);
  } else if (!win.isVisible()) {
    reveal();
  } else {
    prepareWidgetForShow(win, settingsStore, fw);
  }
}

function toggleFloatingWidget({ getWin, createWin, settings, providerCount = 1 }) {
  let win = getWin();
  if (!win || win.isDestroyed()) win = createWin();
  if (win.isVisible()) {
    win.hide();
    settings.set('floatingWidget.enabled', false);
  } else {
    const fw = normalizeWidgetSettings(settings.get('floatingWidget'));
    revealFloatingWidget(win, settings);
    settings.set('floatingWidget.enabled', true);
  }
  return win;
}

function resolveFloatingWidgetWindow(sender, floatingWin) {
  return BrowserWindow.fromWebContents(sender)
    || (floatingWin && !floatingWin.isDestroyed() ? floatingWin : null);
}

module.exports = {
  createDashboardWindow,
  createPopoverWindow,
  createSettingsWindow,
  createFloatingWidget,
  showDashboard,
  showPopover,
  showSettings,
  toggleFloatingWidget,
  revealFloatingWidget,
  applyWidgetWindowBounds,
  applyWidgetClickThrough,
  applyWidgetLayerOrder,
  applyWidgetPosition,
  attachWidgetPositionPersistence,
  saveWidgetPosition,
  positionNearTray,
  resolveFloatingWidgetWindow,
};