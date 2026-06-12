import {
  renderProviderCard,
  updateProviderCard,
  snapshotFingerprint,
  PROVIDER_META,
  worstUtil,
  getVisibleOrder,
  isLoginRequired,
} from '../shared/provider-card.js';
import {
  renderOrbCluster,
  updateOrbCluster,
  orbFingerprint,
} from '../shared/widget-orb.js';
import { setAlertThresholds, thresholdClass } from '../shared/alert-thresholds.js';

const root = document.getElementById('widget-root');
const body = document.getElementById('widget-body');
const dots = document.getElementById('widget-dots');
const footer = document.getElementById('widget-footer');
const ctxMenu = document.getElementById('widget-ctx');
const ctxClickThrough = document.getElementById('ctx-click-through');

let snapshots = {};
let settings = { floatingWidget: {} };
let activeProviderId = null;
let rotateTimer = null;
let activeProviders = [];
let lastChromeKey = '';
let lastRotateKey = '';
let lastFitKey = '';
const lastFingerprints = new Map();

const SIZE_GAUGE = {
  small: { size: 52, stroke: 4 },
  medium: { size: 64, stroke: 5 },
  large: { size: 76, stroke: 6 },
};

const DISPLAY_MODES = ['single', 'grid', 'compact', 'orb'];
const MODE_LABELS = {
  single: 'Single',
  grid: 'Grid',
  compact: 'List',
  orb: 'Orbs',
};
const MODE_ICONS = {
  single: '◉',
  grid: '⊞',
  compact: '≡',
  orb: '◎',
};

function widgetConfig() {
  const fw = settings.floatingWidget || {};
  const size = ['small', 'medium', 'large'].includes(fw.size) ? fw.size : 'medium';
  const theme = fw.theme || 'dark';
  const displayMode = DISPLAY_MODES.includes(fw.displayMode) ? fw.displayMode : 'single';
  return {
    pinnedProviders: Array.isArray(fw.pinnedProviders) ? fw.pinnedProviders : [],
    autoRotate: fw.autoRotate === true,
    displayMode,
    size,
    theme,
    opacity: Number.isFinite(fw.opacity) ? fw.opacity : 0.92,
    enabled: fw.enabled === true,
    clickThrough: fw.clickThrough === true,
  };
}

function placeholderSnap(id) {
  return snapshots[id] || {
    providerId: id,
    source: 'stale',
    windows: [],
    error: 'Awaiting data…',
  };
}

function handleLogin(providerId) {
  window.apiMeter.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function handleRetry(providerId) {
  window.apiMeter.refreshProvider(providerId).catch((err) => {
    console.error('Refresh failed:', err);
  });
}

function gaugeOptions() {
  return SIZE_GAUGE[widgetConfig().size] || SIZE_GAUGE.medium;
}

function cardHandlers(id) {
  return {
    onLogin: () => handleLogin(id),
    onRetry: () => handleRetry(id),
    gauge: gaugeOptions(),
  };
}

function orbHandlers(id) {
  return {
    sizeKey: widgetConfig().size,
    onLogin: () => handleLogin(id),
    onRetry: () => handleRetry(id),
  };
}

function getActiveProviders() {
  const cfg = widgetConfig();
  const visible = getVisibleOrder(settings);
  if (cfg.pinnedProviders.length) {
    return cfg.pinnedProviders.filter((id) => visible.includes(id));
  }
  return visible.filter((id) => {
    const snap = snapshots[id];
    return snap?.windows?.length || snap?.error;
  });
}

function resolveActiveProviderId() {
  if (activeProviderId && activeProviders.includes(activeProviderId)) {
    return activeProviderId;
  }
  activeProviderId = activeProviders[0] || null;
  return activeProviderId;
}

function emptyStateMessage() {
  const cfg = widgetConfig();
  const visible = getVisibleOrder(settings);
  if (cfg.pinnedProviders.length) {
    const disabledPins = cfg.pinnedProviders.filter((id) => !visible.includes(id));
    if (disabledPins.length === cfg.pinnedProviders.length) {
      return 'Pinned providers are disabled — enable them in Settings';
    }
    return 'Waiting for usage data from pinned providers';
  }
  return 'Pin providers in Settings or wait for usage data';
}

function applyChrome() {
  const cfg = widgetConfig();
  const chromeKey = `${cfg.size}|${cfg.displayMode}|${cfg.theme}|${cfg.opacity}|${cfg.clickThrough}`;
  const changed = chromeKey !== lastChromeKey;
  lastChromeKey = chromeKey;
  root.dataset.theme = cfg.theme;
  root.dataset.size = cfg.size;
  root.dataset.mode = cfg.displayMode;
  root.classList.toggle('widget--click-through', cfg.clickThrough);
  root.style.setProperty('--widget-opacity', String(cfg.opacity));
  footer.hidden = cfg.clickThrough || cfg.displayMode !== 'single' || activeProviders.length <= 1;

  const header = root.querySelector('.widget-header');
  if (header) header.hidden = cfg.clickThrough;

  if (ctxClickThrough) {
    ctxClickThrough.textContent = cfg.clickThrough ? 'Disable click-through' : 'Enable click-through';
  }

  const ctxLayout = document.getElementById('ctx-layout');
  const ctxSettings = document.getElementById('ctx-settings');
  const ctxClose = document.getElementById('ctx-close');
  if (ctxLayout) ctxLayout.hidden = cfg.clickThrough;
  if (ctxClose) ctxClose.hidden = cfg.clickThrough;
  if (ctxSettings) ctxSettings.hidden = false;
  const layoutBtn = document.getElementById('widget-layout');
  if (layoutBtn) {
    layoutBtn.textContent = MODE_ICONS[cfg.displayMode] || '◎';
    layoutBtn.title = `Layout: ${MODE_LABELS[cfg.displayMode] || cfg.displayMode} (click to cycle)`;
  }
  return changed;
}

async function fitWindowIfNeeded() {
  const cfg = widgetConfig();
  const count = activeProviders.length || 0;
  const fitKey = `${cfg.displayMode}|${cfg.size}|${count}|${cfg.clickThrough}`;
  if (fitKey === lastFitKey) return;
  lastFitKey = fitKey;
  try {
    await window.apiMeter.fitWidgetWindow(count, count);
  } catch (err) {
    console.error('fitWidgetWindow failed:', err);
  }
}

function upsertWidgetCard(container, id, snap) {
  const fp = snapshotFingerprint(snap);
  const handlers = { variant: 'mini', ...cardHandlers(id) };
  let card = container.querySelector(`[data-provider-id="${id}"]`);

  if (card && lastFingerprints.get(id) === fp) {
    return card;
  }
  lastFingerprints.set(id, fp);

  if (!card) {
    card = renderProviderCard(snap, handlers);
    card.classList.add('provider-card--settled', 'provider-card--widget');
    container.appendChild(card);
    return card;
  }

  updateProviderCard(card, snap, handlers);
  return card;
}

function renderCompactRow(snap) {
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)' };
  const hasWindows = (snap.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snap);
  const hasRetryableError = snap?.error && !hasWindows && !needsLogin;
  const util = worstUtil(snap);
  const row = document.createElement('div');
  row.className = 'widget-compact-row';
  if (needsLogin || hasRetryableError) row.classList.add('widget-compact-row--actionable');
  row.dataset.providerId = snap.providerId;
  row.style.setProperty('--accent', meta.accent);
  row.innerHTML = `
    <span class="widget-compact-name">${meta.label}</span>
    <span class="widget-compact-stats">${hasWindows
      ? snap.windows.slice(0, 2).map((w) => `${w.label} ${w.utilization}%`).join(' · ')
      : (needsLogin ? (snap.error || 'Login required') : (snap.error || '—'))}</span>
    <span class="widget-compact-pct th-${hasWindows ? thresholdClass(util) : 'muted'}">${hasWindows ? `${util}%` : '—'}</span>
  `;
  if (needsLogin) {
    row.title = 'Click to connect';
    row.addEventListener('click', () => handleLogin(snap.providerId));
  } else if (hasRetryableError) {
    row.title = 'Click to retry';
    row.addEventListener('click', () => handleRetry(snap.providerId));
  }
  return row;
}

function renderOrbMode() {
  body.className = 'widget-body widget-body--orb';
  let deck = body.querySelector('.widget-orb-deck');
  if (!deck) {
    body.replaceChildren();
    deck = document.createElement('div');
    deck.className = 'widget-orb-deck';
    body.appendChild(deck);
  }

  const seen = new Set();
  activeProviders.forEach((id) => {
    seen.add(id);
    const snap = placeholderSnap(id);
    const fp = orbFingerprint(snap);
    let cluster = deck.querySelector(`[data-provider-id="${id}"]`);
    if (cluster && cluster.dataset.fingerprint === fp) return;
    const handlers = orbHandlers(id);
    if (cluster) {
      cluster = updateOrbCluster(cluster, snap, handlers);
    } else {
      const fresh = renderOrbCluster(snap, handlers);
      fresh.dataset.fingerprint = fp;
      deck.appendChild(fresh);
    }
    lastFingerprints.set(id, fp);
  });

  deck.querySelectorAll('[data-provider-id]').forEach((cluster) => {
    if (!seen.has(cluster.dataset.providerId)) {
      lastFingerprints.delete(cluster.dataset.providerId);
      cluster.remove();
    }
  });

  dots.replaceChildren();
}

function renderSingleMode() {
  const id = resolveActiveProviderId();
  if (!id) return;

  const snap = placeholderSnap(id);
  body.className = 'widget-body widget-body--single';

  const existing = body.querySelector('.provider-card--widget');
  if (!existing || existing.dataset.providerId !== id) {
    body.replaceChildren();
    upsertWidgetCard(body, id, snap);
  } else {
    upsertWidgetCard(body, id, snap);
  }

  const rotateIndex = activeProviders.indexOf(id);
  dots.replaceChildren(...activeProviders.map((pid, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `widget-dot${i === rotateIndex ? ' active' : ''}`;
    dot.title = PROVIDER_META[pid]?.label || pid;
    dot.addEventListener('click', () => {
      activeProviderId = pid;
      renderWidget();
    });
    return dot;
  }));
}

function renderGridMode() {
  body.className = 'widget-body widget-body--grid';
  let grid = body.querySelector('.widget-grid');
  if (!grid) {
    body.replaceChildren();
    grid = document.createElement('div');
    grid.className = 'widget-grid';
    body.appendChild(grid);
  }

  const seen = new Set();
  activeProviders.forEach((id) => {
    seen.add(id);
    upsertWidgetCard(grid, id, placeholderSnap(id));
  });

  grid.querySelectorAll('[data-provider-id]').forEach((card) => {
    if (!seen.has(card.dataset.providerId)) {
      lastFingerprints.delete(card.dataset.providerId);
      card.remove();
    }
  });

  dots.replaceChildren();
}

function renderCompactMode() {
  body.className = 'widget-body widget-body--compact';
  let list = body.querySelector('.widget-compact-list');
  if (!list) {
    body.replaceChildren();
    list = document.createElement('div');
    list.className = 'widget-compact-list';
    body.appendChild(list);
  }

  const seen = new Set();
  activeProviders.forEach((id) => {
    seen.add(id);
    const snap = placeholderSnap(id);
    const fp = snapshotFingerprint(snap);
    let row = list.querySelector(`[data-provider-id="${id}"]`);
    if (row && lastFingerprints.get(id) === fp) return;
    lastFingerprints.set(id, fp);
    if (row) {
      row.replaceWith(renderCompactRow(snap));
    } else {
      list.appendChild(renderCompactRow(snap));
    }
  });

  list.querySelectorAll('[data-provider-id]').forEach((row) => {
    if (!seen.has(row.dataset.providerId)) {
      lastFingerprints.delete(row.dataset.providerId);
      row.remove();
    }
  });

  dots.replaceChildren();
}

function renderWidget() {
  activeProviders = getActiveProviders();
  const chromeChanged = applyChrome();
  if (chromeChanged) {
    lastFingerprints.clear();
    lastFitKey = '';
    body.replaceChildren();
  }

  if (!activeProviders.length) {
    body.className = widgetConfig().displayMode === 'orb'
      ? 'widget-body widget-body--orb widget-body--empty'
      : 'widget-body widget-body--empty';
    body.innerHTML = `<p class="widget-empty">${emptyStateMessage()}</p>`;
    dots.replaceChildren();
    activeProviderId = null;
    lastFingerprints.clear();
    fitWindowIfNeeded();
    startRotate();
    return;
  }

  const cfg = widgetConfig();
  if (cfg.displayMode === 'orb') renderOrbMode();
  else if (cfg.displayMode === 'grid') renderGridMode();
  else if (cfg.displayMode === 'compact') renderCompactMode();
  else renderSingleMode();

  fitWindowIfNeeded();
  startRotate();
}

function startRotate() {
  const cfg = widgetConfig();
  if (!cfg.enabled) {
    clearInterval(rotateTimer);
    rotateTimer = null;
    lastRotateKey = '';
    return;
  }

  const key = `${cfg.displayMode}|${cfg.autoRotate}|${activeProviders.join(',')}`;
  if (key === lastRotateKey && rotateTimer) return;
  lastRotateKey = key;
  clearInterval(rotateTimer);
  rotateTimer = null;

  if (cfg.displayMode === 'single' && cfg.autoRotate && activeProviders.length > 1) {
    rotateTimer = setInterval(() => {
      const idx = activeProviders.indexOf(resolveActiveProviderId());
      const next = activeProviders[(idx + 1) % activeProviders.length];
      activeProviderId = next;
      renderSingleMode();
      fitWindowIfNeeded();
    }, 10000);
  }
}

function onUsageUpdate(data) {
  snapshots = data || {};
  renderWidget();
}

function onSettingsUpdate(data) {
  settings = data || settings;
  setAlertThresholds(settings.alerts);
  if (!settings.floatingWidget?.enabled) {
    clearInterval(rotateTimer);
    rotateTimer = null;
    lastRotateKey = '';
  }
  renderWidget();
}

function stepProvider(delta) {
  if (activeProviders.length < 2) return;
  const idx = activeProviders.indexOf(resolveActiveProviderId());
  const next = (idx + delta + activeProviders.length) % activeProviders.length;
  activeProviderId = activeProviders[next];
  renderWidget();
}

function providerCountForResize() {
  return activeProviders.length || 0;
}

async function cycleLayout() {
  try {
    const next = await window.apiMeter.cycleWidgetDisplayMode(providerCountForResize());
    if (next && settings.floatingWidget) {
      settings = {
        ...settings,
        floatingWidget: { ...settings.floatingWidget, displayMode: next },
      };
      lastChromeKey = '';
      lastFitKey = '';
      renderWidget();
    }
  } catch (err) {
    console.error('Layout cycle failed:', err);
  }
}

async function applyResize(direction) {
  try {
    const nextSize = await window.apiMeter.resizeWidget(direction, providerCountForResize());
    if (nextSize && settings.floatingWidget) {
      settings = {
        ...settings,
        floatingWidget: { ...settings.floatingWidget, size: nextSize },
      };
      lastChromeKey = '';
      lastFitKey = '';
      renderWidget();
    }
  } catch (err) {
    console.error('Resize failed:', err);
  }
}

function hideContextMenu() {
  if (ctxMenu) ctxMenu.hidden = true;
}

function showContextMenu(x, y) {
  if (!ctxMenu) return;
  ctxMenu.hidden = false;
  const rect = ctxMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  ctxMenu.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  ctxMenu.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
}

async function toggleClickThrough() {
  const next = !widgetConfig().clickThrough;
  try {
    await window.apiMeter.setWidgetClickThrough(next, providerCountForResize());
  } catch (err) {
    console.error('Click-through toggle failed:', err);
  }
  hideContextMenu();
}

function bindContextMenu() {
  root?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (!ctxMenu?.hidden && !ctxMenu.contains(e.target)) hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  ctxClickThrough?.addEventListener('click', toggleClickThrough);
  document.getElementById('ctx-layout')?.addEventListener('click', () => {
    hideContextMenu();
    cycleLayout();
  });
  document.getElementById('ctx-settings')?.addEventListener('click', () => {
    hideContextMenu();
    window.apiMeter.openSettings();
  });
  document.getElementById('ctx-close')?.addEventListener('click', () => {
    hideContextMenu();
    window.apiMeter.toggleFloatingWidget();
  });
}

async function init() {
  document.getElementById('widget-close')?.addEventListener('click', () => {
    window.apiMeter.toggleFloatingWidget();
  });

  document.getElementById('widget-layout')?.addEventListener('click', () => cycleLayout());

  document.getElementById('widget-smaller')?.addEventListener('click', () => applyResize(-1));
  document.getElementById('widget-larger')?.addEventListener('click', () => applyResize(1));

  document.getElementById('widget-theme')?.addEventListener('click', async () => {
    try {
      await window.apiMeter.cycleWidgetTheme();
    } catch (err) {
      console.error('Theme cycle failed:', err);
    }
  });

  document.getElementById('widget-prev')?.addEventListener('click', () => stepProvider(-1));
  document.getElementById('widget-next')?.addEventListener('click', () => stepProvider(1));

  bindContextMenu();

  try {
    settings = await window.apiMeter.getSettings();
    setAlertThresholds(settings.alerts);
    snapshots = await window.apiMeter.getUsage();
  } catch { /* ignore */ }

  window.apiMeter.onUsageUpdated(onUsageUpdate);
  window.apiMeter.onSettingsUpdated(onSettingsUpdate);

  renderWidget();
}

init();