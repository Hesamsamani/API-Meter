const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createRegistry } = require('./src/providers/registry');
const { UsageStore } = require('./src/main/usage-store');
const { CollectorScheduler } = require('./src/main/scheduler');

let store;
let scheduler;

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'src/renderer/dashboard/index.html'));
  return win;
}

app.whenReady().then(() => {
  store = new UsageStore();
  scheduler = new CollectorScheduler({
    registry: createRegistry(),
    store,
    onUpdate: () => { /* IPC broadcast added in Task 8 */ },
  });
  scheduler.start();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});