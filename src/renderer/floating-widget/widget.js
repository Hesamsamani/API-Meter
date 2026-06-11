import {
  renderProviderCard,
  updateProviderCard,
  snapshotFingerprint,
  PROVIDER_META,
  worstUtil,
  getVisibleOrder,
  isLoginRequired,
} from '../shared/provider-card.js';
import { setAlertThresholds, thresholdClass } from '../shared/alert-thresholds.js';

const root = document.getElementById('widget-root');
const body = document.getElementById('widget-body');
const dots = document.getElementById('widget-dots');
const footer = document.getElementById('widget-footer');

let snapshots = {};
let settings = { floatingWidget: {} };
let activeProviderId = null;
let rotateTimer = null;
let activeProviders = [];
let lastChromeKey = '';
let lastRotateKey = '';
let lastFitCount = -1;
const lastFingerprints = new Map();

const SIZE_GAUGE = {
  small: { size: 52, stroke: 4 },
  medium: { size: 64, stroke: 5 },
  large: { size: 76, stroke: 6 },
};

function widgetConfig() {
  const fw = settings.floatingWidget || {};
  const size = ['small', 'medium', 'large'].includes(fw.size) ? fw.size : 'medium';
  const theme = fw.theme || 'dark';
  const displayMode = ['single', 'grid', 'compact'].includes(fw.displayMode) ? fw.displayMode : 'single';
  return {
    pinnedProviders: Array.isArray(fw.pinnedProviders) ? fw.pinnedProviders : [],
    autoRotate: fw.autoRotate === true,
    displayMode,
    size,
    theme,
    opacity: Number.isFinite(fw.opacity) ? fw.opacity : 0.92,
    enabled: fw.enabled === true,
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
  const chromeKey = `${cfg.size}|${cfg.displayMode}|${cfg.theme}|${cfg.opacity}`;
  const changed = chromeKey !== lastChromeKey;
  lastChromeKey = chromeKey;
  root.dataset.theme = cfg.theme;
  root.dataset.size = cfg.size;
  root.dataset.mode = cfg.displayMode;
  root.style.setProperty('--widget-opacity', String(cfg.opacity));
  footer.hidden = cfg.displayMode !== 'single' || activeProviders.length <= 1;
  return changed;
}

async function fitWindowIfNeeded(count) {
  if (count === lastFitCount) return;
  lastFitCount = count;
  try {
    await window.apiMeter.fitWidgetWindow(count);
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
    lastFitCount = -1;
    body.replaceChildren();
  }

  if (!activeProviders.length) {
    body.className = 'widget-body widget-body--empty';
    body.innerHTML = `<p class="widget-empty">${emptyStateMessage()}</p>`;
    dots.replaceChildren();
    activeProviderId = null;
    lastFingerprints.clear();
    fitWindowIfNeeded(0);
    startRotate();
    return;
  }

  const cfg = widgetConfig();
  if (cfg.displayMode === 'grid') renderGridMode();
  else if (cfg.displayMode === 'compact') renderCompactMode();
  else renderSingleMode();

  fitWindowIfNeeded(activeProviders.length);
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
      fitWindowIfNeeded(activeProviders.length);
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

async function applyResize(direction) {
  try {
    const nextSize = await window.apiMeter.resizeWidget(direction, providerCountForResize());
    if (nextSize && settings.floatingWidget) {
      settings = {
        ...settings,
        floatingWidget: { ...settings.floatingWidget, size: nextSize },
      };
      lastChromeKey = '';
      renderWidget();
    }
  } catch (err) {
    console.error('Resize failed:', err);
  }
}

async function init() {
  document.getElementById('widget-close')?.addEventListener('click', () => {
    window.apiMeter.toggleFloatingWidget();
  });

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