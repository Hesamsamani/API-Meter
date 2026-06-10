const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { createRegistry } = require('./src/providers/registry');
const { UsageStore } = require('./src/main/usage-store');
const { CollectorScheduler } = require('./src/main/scheduler');
const { getHistory, settings } = require('./src/main/store');
const { createTray } = require('./src/main/tray');
const { AlertManager } = require('./src/main/alerts');
const {
  createDashboardWindow,
  createPopoverWindow,
  createFloatingWidget,
  showDashboard,
  showPopover,
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

function broadcastUsage() {
  const payload = store.getAll();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('usage:updated', payload);
    }
  }
  trayApi?.update(payload);
  evaluateAlerts(payload);
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

function registerIpc() {
  ipcMain.handle('usage:getAll', () => store.getAll());
  ipcMain.handle('usage:getHistory', (_e, providerId) => getHistory(providerId));
  ipcMain.handle('usage:refreshAll', async () => {
    await scheduler.refreshAll();
    return store.getAll();
  });
  ipcMain.handle('provider:login', async (_e, id) => {
    const adapter = registry.get(id);
    if (!adapter?.login) throw new Error(`Provider ${id} has no login flow`);
    await adapter.login();
    await scheduler.refreshProvider(adapter);
    return store.getAll();
  });
  ipcMain.handle('settings:get', () => settings.store);

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

  scheduler = new CollectorScheduler({
    registry,
    store,
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
    onQuit: () => app.quit(),
    onShowPopover: () => showPopover(getPopoverWin),
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