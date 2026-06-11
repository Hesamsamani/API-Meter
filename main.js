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
} = require('./src/main/windows');

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

function flushUsageBroadcast() {
  broadcastTimer = null;
  const payload = store.getAll();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('usage:updated', payload);
    }
  }
  trayApi?.update(payload, settings.get('alerts'));
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
  for (const [key, value] of Object.entries(patch)) {
    settings.set(key, value);
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
  ipcMain.handle('provider:login', async (_e, id) => {
    const adapter = registry.get(id);
    if (!adapter?.login) throw new Error(`Provider ${id} has no login flow`);
    try {
      await adapter.login();
      await scheduler.refreshProviderAndReschedule(adapter);
      broadcastUsage();
      return store.getAll();
    } catch (err) {
      const message = err.message || String(err);
      if (!/cancel/i.test(message) && Notification.isSupported()) {
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
        floatingWin = createFloatingWidget();
        return floatingWin;
      },
      settings,
    });
    return settings.get('floatingWidget.enabled');
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
          floatingWin = createFloatingWidget();
          return floatingWin;
        },
        settings,
      });
    },
    onSettings: () => showSettings(getSettingsWin),
    onProviderLogin: async (id) => {
      const adapter = registry.get(id);
      if (!adapter?.login) return;
      try {
        await adapter.login();
        await scheduler.refreshProviderAndReschedule(adapter);
        broadcastUsage();
      } catch (err) {
        if (Notification.isSupported()) {
          new Notification({ title: 'Login failed', body: err.message || String(err) }).show();
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
    floatingWin = createFloatingWidget();
    floatingWin.show();
  }
});

app.on('window-all-closed', () => {
  /* Tray-only — keep running */
});

app.on('activate', () => {
  showDashboard(getDashboardWin);
});