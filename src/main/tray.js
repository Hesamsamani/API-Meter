const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { worstUtilization, thresholdColor } = require('../shared/normalize');
const { createTrayIconPng } = require('./tray-icon-buffer');

const PROVIDER_LABELS = {
  'claude-ai': 'Claude',
  'claude-code': 'Code',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  cursor: 'Cursor',
};

const PROVIDER_ORDER = ['claude-ai', 'claude-code', 'gemini', 'perplexity', 'grok', 'cursor'];

let tray = null;
const iconCache = new Map();

function assetsDir() {
  return path.join(app.getAppPath(), 'assets');
}

function loadIconFromFile(level) {
  const names = [
    `tray-icon-${level}.png`,
    level === 'green' ? 'tray-icon.png' : null,
  ].filter(Boolean);

  for (const name of names) {
    const filePath = path.join(assetsDir(), name);
    const hiDpiPath = filePath.replace('.png', '@2x.png');
    if (!fs.existsSync(filePath)) continue;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) continue;
    if (fs.existsSync(hiDpiPath)) {
      const hi = nativeImage.createFromPath(hiDpiPath);
      if (!hi.isEmpty()) {
        image.addRepresentation({
          scaleFactor: 2,
          width: hi.getSize().width,
          height: hi.getSize().height,
          buffer: hi.toPNG(),
        });
      }
    }
    return image;
  }
  return null;
}

function loadIconFromBuffer(level) {
  if (iconCache.has(level)) return iconCache.get(level);

  const sizes = [16, 32];
  const primary = nativeImage.createFromBuffer(createTrayIconPng(level, sizes[0]));
  const secondary = nativeImage.createFromBuffer(createTrayIconPng(level, sizes[1]));
  if (!primary.isEmpty() && !secondary.isEmpty()) {
    primary.addRepresentation({
      scaleFactor: 2,
      width: sizes[1],
      height: sizes[1],
      buffer: secondary.toPNG(),
    });
  }

  iconCache.set(level, primary);
  return primary;
}

function createStatusIcon(level) {
  const fromFile = loadIconFromFile(level);
  if (fromFile && !fromFile.isEmpty()) {
    return fromFile;
  }
  const fromBuffer = loadIconFromBuffer(level);
  return fromBuffer.isEmpty() ? loadIconFromBuffer('green') : fromBuffer;
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
          {
            label: 'Re-login',
            click: () => {
              Promise.resolve(handlers.onProviderLogin?.(id)).catch((err) => {
                console.error(`Re-login failed for ${id}:`, err);
              });
            },
          },
          {
            label: 'Disconnect',
            click: () => {
              Promise.resolve(handlers.onProviderLogout?.(id)).catch((err) => {
                console.error(`Disconnect failed for ${id}:`, err);
              });
            },
          },
        ],
      },
    ];
  });

  const launchAtStartup = handlers.getLaunchAtStartup?.() === true;

  return Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: handlers.onShowDashboard },
    { label: 'Refresh All', click: handlers.onRefresh },
    { label: 'Toggle Floating Widget', click: handlers.onToggleWidget },
    { type: 'separator' },
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: launchAtStartup,
      click: (item) => {
        handlers.onLaunchAtStartupToggle?.(item.checked);
      },
    },
    { label: 'Settings', click: handlers.onSettings },
    { type: 'separator' },
    ...providerItems,
    { type: 'separator' },
    { label: 'Exit', click: handlers.onQuit },
  ]);
}

function createTray(handlers) {
  const icon = createStatusIcon('green');
  tray = new Tray(icon);
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

module.exports = { createTray, buildTooltip, worstStatusLevel, createStatusIcon };