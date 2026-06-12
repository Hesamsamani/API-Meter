const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { createRegistry } = require('./src/providers/registry');
const { UsageStore } = require('./src/main/usage-store');
const { CollectorScheduler } = require('./src/main/scheduler');
const { getHistory, settings } = require('./src/main/store');
const { providerLogoUrl } = require('./src/main/assets');
const { createTray } = require('./src/main/tray');
const { AlertManager } = require('./src/main/alerts');
const {
  createDashboardWindow,
  createPopoverWindow,
  createFloatingWidget,
  createSettingsWindow,
  showDashboard,
  showPopover,
  showSettings,
  toggleFloatingWidget,
  applyWidgetWindowBounds,
  applyWidgetClickThrough,
} = require('./src/main/windows');
const {
  normalizeWidgetSettings,
  nextSize,
  prevSize,
  nextTheme,
  nextDisplayMode,
} = require('./src/shared/widget-presets');
const { applyLaunchAtStartup, syncLaunchAtStartup } = require('./src/main/startup');
const { applyProviderLoginFailure } = require('./src/main/login-error');

let store;
let scheduler;
let registry;
let alertManager;
let trayApi;
let dashboardWin = null;
let popoverWin = null;
let floatingWin = null;
let settingsWin = null;
let broadcastTimer = null;
/** Last provider count reported by the widget renderer for fitWindow. */
let lastWidgetProviderCount = 1;

function mergeSettingsPatch(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'floatingWidget' && value && typeof value === 'object') {
      settings.set('floatingWidget', {
        ...settings.get('floatingWidget'),
        ...value,
      });
      continue;
    }
    if (key === 'alerts' && value && typeof value === 'object') {
      settings.set('alerts', {
        ...settings.get('alerts'),
        ...value,
      });
      continue;
    }
    settings.set(key, value);
  }
}

function widgetProviderCountForBounds(count = lastWidgetProviderCount) {
  const n = Number(count);
  if (Number.isFinite(n) && n >= 0) return n;
  return lastWidgetProviderCount;
}

function flushUsageBroadcast() {
  broadcastTimer = null;
  const payload = store.getAll();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('usage:updated', payload);
    }
  }
  trayApi?.update(payload, settings.get('alerts'), settings.get('usageDisplayMode'));
  evaluateAlerts(payload);
}

/** Coalesce rapid per-provider refreshes into one UI update to prevent flicker. */
function broadcastUsage() {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(flushUsageBroadcast, 120);
}

function evaluateAlerts(snapshots) {
  const alertSettings = settings.get('alerts');
  if (!alertSettings?.enabled) return;
  for (const snap of Object.values(snapshots)) {
    for (const w of snap.windows || []) {
      alertManager.evaluate(snap.providerId, w.key, w.utilization);
    }
  }
}

function applySettingsPatch(patch) {
  mergeSettingsPatch(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup')) {
    try {
      applyLaunchAtStartup(!!patch.launchAtStartup);
    } catch (err) {
      console.error('Failed to update launch at startup:', err);
    }
  }
  if (patch.floatingWidget && floatingWin && !floatingWin.isDestroyed()) {
    const fw = settings.get('floatingWidget');
    if (Object.prototype.hasOwnProperty.call(patch.floatingWidget, 'clickThrough')) {
      applyWidgetClickThrough(floatingWin, fw.clickThrough);
    }
    if (floatingWin.isVisible()) {
      applyWidgetWindowBounds(floatingWin, fw, widgetProviderCountForBounds());
    }
  }
  alertManager.warn = settings.get('alerts.warnThreshold');
  alertManager.danger = settings.get('alerts.dangerThreshold');
  scheduler.restart();
  broadcastSettings();
}

function broadcastSettings() {
  const payload = settings.store;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:updated', payload);
    }
  }
  trayApi?.rebuildMenu?.();
  trayApi?.update(store.getAll(), settings.get('alerts'), settings.get('usageDisplayMode'));
}

function seedStore() {
  for (const adapter of registry.list()) {
    if (!store.get(adapter.id)) {
      store.setError(adapter.id, 'Awaiting data…');
    }
  }
}

function pushUsageTo(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('usage:updated', store.getAll());
}

function registerIpc() {
  ipcMain.handle('app:ping', () => true);
  ipcMain.handle('asset:providerLogo', (_e, providerId) => providerLogoUrl(providerId));
  ipcMain.handle('usage:getAll', () => store.getAll());
  ipcMain.handle('usage:getHistory', (_e, providerId) => getHistory(providerId));
  ipcMain.handle('usage:refreshAll', async () => {
    await scheduler.refreshAll();
    return store.getAll();
  });
  ipcMain.handle('usage:refreshProvider', async (_e, id) => {
    const adapter = registry.get(id);
    if (!adapter) throw new Error(`Unknown provider: ${id}`);
    await scheduler.refreshProviderAndReschedule(adapter);
    return store.getAll();
  });
  ipcMain.handle('provider:login', async (_e, id) => {
    const adapter = registry.get(id);
    if (!adapter?.login) throw new Error(`Provider ${id} has no login flow`);
    try {
      await adapter.login();
      await scheduler.refreshProviderAndReschedule(adapter);
      broadcastUsage();
      return store.getAll();
    } catch (err) {
      const { applied, message } = applyProviderLoginFailure({
        providerId: id,
        error: err,
        store,
        onUsageBroadcast: broadcastUsage,
      });
      if (applied && Notification.isSupported()) {
        new Notification({ title: 'Login failed', body: message }).show();
      }
      throw err;
    }
  });
  ipcMain.handle('provider:logout', async (_e, id) => {
    const adapter = registry.get(id);
    if (!adapter?.logout) throw new Error(`Provider ${id} has no logout flow`);
    await adapter.logout();
    store.setError(id, 'Disconnected');
    broadcastUsage();
    return store.getAll();
  });
  ipcMain.handle('settings:get', () => settings.store);
  ipcMain.handle('settings:update', (_e, patch) => {
    applySettingsPatch(patch || {});
    return settings.store;
  });

  ipcMain.on('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });

  ipcMain.handle('app:showDashboard', () => {
    if (popoverWin && !popoverWin.isDestroyed()) popoverWin.hide();
    showDashboard(getDashboardWin);
  });

  ipcMain.handle('app:showSettings', () => {
    showSettings(getSettingsWin);
  });

  ipcMain.handle('app:toggleWidget', () => {
    floatingWin = toggleFloatingWidget({
      getWin: () => floatingWin,
      createWin: () => {
        floatingWin = createFloatingWidget(settings.get('floatingWidget'), settings);
        return floatingWin;
      },
      settings,
    });
    return settings.get('floatingWidget.enabled');
  });

  ipcMain.handle('widget:fitWindow', (e, providerCount = 1, orbSlots = 0) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    lastWidgetProviderCount = widgetProviderCountForBounds(providerCount);
    applyWidgetWindowBounds(win, settings.get('floatingWidget'), lastWidgetProviderCount, orbSlots);
    return win.getSize();
  });

  ipcMain.handle('widget:setClickThrough', (e, enabled, providerCount = lastWidgetProviderCount) => {
    const on = !!enabled;
    const count = widgetProviderCountForBounds(providerCount);
    const raw = settings.get('floatingWidget');
    const fw = normalizeWidgetSettings(raw);
    settings.set('floatingWidget', { ...raw, ...fw, clickThrough: on });
    const win = BrowserWindow.fromWebContents(e.sender)
      || (floatingWin && !floatingWin.isDestroyed() ? floatingWin : null);
    if (win) {
      applyWidgetClickThrough(win, on);
      applyWidgetWindowBounds(win, settings.get('floatingWidget'), count);
    }
    broadcastSettings();
    return on;
  });

  ipcMain.handle('widget:resize', (e, direction = 1, providerCount = 1) => {
    const raw = settings.get('floatingWidget');
    const fw = normalizeWidgetSettings(raw);
    const next = direction > 0 ? nextSize(fw.size) : prevSize(fw.size);
    if (next === fw.size) return next;
    settings.set('floatingWidget', { ...raw, ...fw, size: next });
    const win = BrowserWindow.fromWebContents(e.sender)
      || (floatingWin && !floatingWin.isDestroyed() ? floatingWin : null);
    if (win) {
      applyWidgetWindowBounds(win, settings.get('floatingWidget'), providerCount);
    }
    broadcastSettings();
    return next;
  });

  ipcMain.handle('widget:cycleTheme', (e) => {
    const raw = settings.get('floatingWidget');
    const fw = normalizeWidgetSettings(raw);
    const theme = nextTheme(fw.theme);
    if (theme === fw.theme) return theme;
    settings.set('floatingWidget', { ...raw, ...fw, theme });
    const win = BrowserWindow.fromWebContents(e.sender)
      || (floatingWin && !floatingWin.isDestroyed() ? floatingWin : null);
    if (win && win.isVisible()) {
      applyWidgetWindowBounds(win, settings.get('floatingWidget'), widgetProviderCountForBounds());
    }
    broadcastSettings();
    return theme;
  });

  ipcMain.handle('widget:cycleDisplayMode', (e, providerCount = 1) => {
    const raw = settings.get('floatingWidget');
    const fw = normalizeWidgetSettings(raw);
    const displayMode = nextDisplayMode(fw.displayMode);
    settings.set('floatingWidget', { ...raw, ...fw, displayMode });
    const win = BrowserWindow.fromWebContents(e.sender)
      || (floatingWin && !floatingWin.isDestroyed() ? floatingWin : null);
    if (win) {
      applyWidgetWindowBounds(win, settings.get('floatingWidget'), providerCount);
    }
    broadcastSettings();
    return displayMode;
  });
}

function getDashboardWin(recreate = false) {
  if (recreate || !dashboardWin || dashboardWin.isDestroyed()) {
    dashboardWin = createDashboardWindow();
  }
  return dashboardWin;
}

function getPopoverWin(recreate = false) {
  if (recreate || !popoverWin || popoverWin.isDestroyed()) {
    popoverWin = createPopoverWindow();
  }
  return popoverWin;
}

function getSettingsWin(recreate = false) {
  if (recreate || !settingsWin || settingsWin.isDestroyed()) {
    settingsWin = createSettingsWindow();
  }
  return settingsWin;
}

app.whenReady().then(() => {
  syncLaunchAtStartup(settings);

  registry = createRegistry();
  store = new UsageStore();
  alertManager = new AlertManager({
    warn: settings.get('alerts.warnThreshold'),
    danger: settings.get('alerts.dangerThreshold'),
    notify: (msg) => {
      if (Notification.isSupported()) {
        new Notification({ title: 'API-Meter Alert', body: msg }).show();
      }
    },
  });

  registerIpc();
  seedStore();

  scheduler = new CollectorScheduler({
    registry,
    store,
    settings,
    onUpdate: broadcastUsage,
  });
  scheduler.start();

  trayApi = createTray({
    onShowDashboard: () => showDashboard(getDashboardWin),
    onRefresh: () => scheduler.refreshAll(),
    onToggleWidget: () => {
      floatingWin = toggleFloatingWidget({
        getWin: () => floatingWin,
        createWin: () => {
          floatingWin = createFloatingWidget(settings.get('floatingWidget'), settings);
          return floatingWin;
        },
        settings,
      });
      broadcastSettings();
    },
    onSettings: () => showSettings(getSettingsWin),
    getLaunchAtStartup: () => settings.get('launchAtStartup', false),
    onLaunchAtStartupToggle: (enabled) => {
      applySettingsPatch({ launchAtStartup: !!enabled });
    },
    onProviderLogin: async (id) => {
      const adapter = registry.get(id);
      if (!adapter?.login) return;
      try {
        await adapter.login();
        await scheduler.refreshProviderAndReschedule(adapter);
        broadcastUsage();
      } catch (err) {
        const { applied, message } = applyProviderLoginFailure({
          providerId: id,
          error: err,
          store,
          onUsageBroadcast: broadcastUsage,
        });
        if (applied && Notification.isSupported()) {
          new Notification({ title: 'Login failed', body: message }).show();
        }
        throw err;
      }
    },
    onProviderLogout: async (id) => {
      const adapter = registry.get(id);
      if (!adapter?.logout) return;
      try {
        await adapter.logout();
        store.setError(id, 'Disconnected');
        broadcastUsage();
      } catch (err) {
        if (Notification.isSupported()) {
          new Notification({ title: 'Disconnect failed', body: err.message || String(err) }).show();
        }
      }
    },
    onQuit: () => app.quit(),
    onShowPopover: () => showPopover(getPopoverWin, {
      onShow: (win) => pushUsageTo(win),
    }),
  });

  if (settings.get('floatingWidget.enabled')) {
    floatingWin = createFloatingWidget(settings.get('floatingWidget'), settings);
    floatingWin.show();
  }
});

app.on('window-all-closed', () => {
  /* Tray-only — keep running */
});

app.on('activate', () => {
  showDashboard(getDashboardWin);
});