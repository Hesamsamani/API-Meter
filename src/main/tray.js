const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { worstUtilization } = require('../shared/normalize');

const PROVIDER_LABELS = {
  'claude-ai': 'Claude',
  'claude-code': 'Code',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  cursor: 'Cursor',
};

let tray = null;

function buildTooltip(snapshots) {
  const parts = Object.values(snapshots)
    .sort((a, b) => worstUtilization(b) - worstUtilization(a))
    .slice(0, 3)
    .map((s) => `${PROVIDER_LABELS[s.providerId] || s.providerId} ${worstUtilization(s)}%`);
  return parts.length ? parts.join(' · ') : 'API-Meter';
}

function createTray({ onShowDashboard, onRefresh, onToggleWidget, onQuit, onShowPopover }) {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    );
  }
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('API-Meter');

  tray.on('click', onShowPopover);

  const menu = Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: onShowDashboard },
    { label: 'Refresh All', click: onRefresh },
    { label: 'Toggle Floating Widget', click: onToggleWidget },
    { type: 'separator' },
    { label: 'Exit', click: onQuit },
  ]);
  tray.setContextMenu(menu);

  return {
    update(snapshots) {
      tray.setToolTip(buildTooltip(snapshots));
    },
  };
}

module.exports = { createTray, buildTooltip };