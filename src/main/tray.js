const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { worstUtilization, thresholdColor } = require('../shared/normalize');

const PROVIDER_LABELS = {
  'claude-ai': 'Claude',
  'claude-code': 'Code',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  cursor: 'Cursor',
};

const PROVIDER_ORDER = ['claude-ai', 'claude-code', 'gemini', 'perplexity', 'grok', 'cursor'];

const STATUS_COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
};

let tray = null;
let fallbackIcon = null;

function createStatusIcon(level) {
  const color = STATUS_COLORS[level] || STATUS_COLORS.green;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#0a0a0b"/><circle cx="8" cy="8" r="5" fill="${color}"/></svg>`;
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
  return icon.isEmpty() ? fallbackIcon : icon.resize({ width: 16, height: 16 });
}

function worstStatusLevel(snapshots, alertSettings) {
  const warn = alertSettings?.warnThreshold ?? 75;
  const danger = alertSettings?.dangerThreshold ?? 90;
  let worst = 0;
  for (const snap of Object.values(snapshots || {})) {
    worst = Math.max(worst, worstUtilization(snap));
  }
  return thresholdColor(worst, warn, danger);
}

function buildTooltip(snapshots) {
  const parts = Object.values(snapshots)
    .sort((a, b) => worstUtilization(b) - worstUtilization(a))
    .slice(0, 3)
    .map((s) => `${PROVIDER_LABELS[s.providerId] || s.providerId} ${worstUtilization(s)}%`);
  return parts.length ? parts.join(' · ') : 'API-Meter';
}

function buildContextMenu(handlers) {
  const providerItems = PROVIDER_ORDER.flatMap((id) => {
    const label = PROVIDER_LABELS[id] || id;
    return [
      {
        label,
        submenu: [
          { label: 'Re-login', click: () => handlers.onProviderLogin?.(id) },
          { label: 'Disconnect', click: () => handlers.onProviderLogout?.(id) },
        ],
      },
    ];
  });

  return Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: handlers.onShowDashboard },
    { label: 'Refresh All', click: handlers.onRefresh },
    { label: 'Toggle Floating Widget', click: handlers.onToggleWidget },
    { type: 'separator' },
    { label: 'Settings', click: handlers.onSettings },
    { type: 'separator' },
    ...providerItems,
    { type: 'separator' },
    { label: 'Exit', click: handlers.onQuit },
  ]);
}

function createTray(handlers) {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    );
  }
  fallbackIcon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(fallbackIcon);
  tray.setToolTip('API-Meter');

  tray.on('click', handlers.onShowPopover);
  tray.setContextMenu(buildContextMenu(handlers));

  return {
    update(snapshots, alertSettings) {
      const level = worstStatusLevel(snapshots, alertSettings);
      tray.setImage(createStatusIcon(level));
      tray.setToolTip(buildTooltip(snapshots));
    },
    rebuildMenu() {
      tray.setContextMenu(buildContextMenu(handlers));
    },
  };
}

module.exports = { createTray, buildTooltip, worstStatusLevel };