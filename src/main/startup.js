const { app } = require('electron');

/**
 * Apply Windows/macOS login-item registration for tray autorun.
 * @param {boolean} enabled
 */
function applyLaunchAtStartup(enabled) {
  if (!app.isPackaged) {
    console.warn('[startup] Launch at startup only applies to packaged builds');
    return { openAtLogin: false, packaged: false };
  }

  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    openAsHidden: !!enabled,
    path: process.execPath,
    args: [],
  });

  return { ...app.getLoginItemSettings(), packaged: true };
}

function isLaunchAtStartupEnabled() {
  if (!app.isPackaged) return false;
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return false;
  }
}

/** Align OS login item with saved preference (e.g. after upgrade or manual registry edit). */
function syncLaunchAtStartup(settingsStore) {
  const desired = settingsStore.get('launchAtStartup', false);
  if (!app.isPackaged) return desired;
  applyLaunchAtStartup(desired);
  return desired;
}

module.exports = {
  applyLaunchAtStartup,
  isLaunchAtStartupEnabled,
  syncLaunchAtStartup,
};