import {
  renderProviderCard,
  updateProviderCard,
  snapshotFingerprint,
  PROVIDER_META,
  worstUtil,
  getVisibleOrder,
} from '../shared/provider-card.js';
import { setAlertThresholds, thresholdClass } from '../shared/alert-thresholds.js';

const root = document.getElementById('widget-root');
const body = document.getElementById('widget-body');
const dots = document.getElementById('widget-dots');
const footer = document.getElementById('widget-footer');

let snapshots = {};
let settings = { floatingWidget: {} };
let rotateIndex = 0;
let rotateTimer = null;
let activeProviders = [];
const lastFingerprints = new Map();

const SIZE_GAUGE = {
  small: { size: 52, stroke: 4 },
  medium: { size: 64, stroke: 5 },
  large: { size: 76, stroke: 6 },
};

function widgetConfig() {
  const fw = settings.floatingWidget || {};
  return {
    pinnedProviders: Array.isArray(fw.pinnedProviders) ? fw.pinnedProviders : [],
    autoRotate: fw.autoRotate === true,
    displayMode: fw.displayMode || 'single',
    size: fw.size || 'medium',
    theme: fw.theme || 'dark',
    opacity: Number.isFinite(fw.opacity) ? fw.opacity : 0.92,
  };
}

function handleRetry(providerId) {
  window.apiMeter.refreshProvider(providerId).catch((err) => {
    console.error('Refresh failed:', err);
  });
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

function applyChrome() {
  const cfg = widgetConfig();
  root.dataset.theme = cfg.theme;
  root.dataset.size = cfg.size;
  root.dataset.mode = cfg.displayMode;
  root.style.setProperty('--widget-opacity', String(cfg.opacity));
  footer.hidden = cfg.displayMode !== 'single' || activeProviders.length <= 1;
}

function renderCompactRow(snap) {
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)' };
  const hasWindows = (snap.windows?.length ?? 0) > 0;
  const util = worstUtil(snap);
  const row = document.createElement('div');
  row.className = 'widget-compact-row';
  row.dataset.providerId = snap.providerId;
  row.style.setProperty('--accent', meta.accent);
  row.innerHTML = `
    <span class="widget-compact-name">${meta.label}</span>
    <span class="widget-compact-stats">${hasWindows
      ? snap.windows.slice(0, 2).map((w) => `${w.label} ${w.utilization}%`).join(' · ')
      : (snap.error || '—')}</span>
    <span class="widget-compact-pct th-${hasWindows ? thresholdClass(util) : 'muted'}">${hasWindows ? `${util}%` : '—'}</span>
  `;
  return row;
}

function updateCompactRow(row, snap) {
  const hasWindows = (snap.windows?.length ?? 0) > 0;
  const util = worstUtil(snap);
  const stats = row.querySelector('.widget-compact-stats');
  const pct = row.querySelector('.widget-compact-pct');
  if (stats) {
    stats.textContent = hasWindows
      ? snap.windows.slice(0, 2).map((w) => `${w.label} ${w.utilization}%`).join(' · ')
      : (snap.error || '—');
  }
  if (pct) {
    pct.textContent = hasWindows ? `${util}%` : '—';
    pct.className = `widget-compact-pct th-${hasWindows ? thresholdClass(util) : 'muted'}`;
  }
}

function upsertMiniCard(container, snap) {
  const id = snap.providerId;
  const fp = snapshotFingerprint(snap);
  let card = container.querySelector(`[data-provider-id="${id}"]`);

  if (card && lastFingerprints.get(id) === fp) return card;
  lastFingerprints.set(id, fp);

  if (card) {
    updateProviderCard(card, snap, { onRetry: () => handleRetry(id) });
    return card;
  }

  card = renderProviderCard(snap, { variant: 'mini', onRetry: () => handleRetry(id) });
  card.classList.add('provider-card--settled', 'provider-card--widget');
  container.appendChild(card);
  return card;
}

function renderSingleMode() {
  const cfg = widgetConfig();
  if (cfg.autoRotate) {
    rotateIndex = rotateIndex % activeProviders.length;
  } else {
    rotateIndex = Math.min(rotateIndex, Math.max(0, activeProviders.length - 1));
  }

  const id = activeProviders[rotateIndex];
  const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [] };
  const fp = snapshotFingerprint(snap);

  body.className = 'widget-body widget-body--single';
  let card = body.querySelector(`[data-provider-id="${id}"]`);

  if (card && lastFingerprints.get(id) === fp) {
    /* unchanged */
  } else if (card) {
    updateProviderCard(card, snap, { onRetry: () => handleRetry(id) });
    lastFingerprints.set(id, fp);
  } else {
    body.replaceChildren();
    card = renderProviderCard(snap, { variant: 'mini', onRetry: () => handleRetry(id) });
    card.classList.add('provider-card--settled', 'provider-card--widget');
    lastFingerprints.set(id, fp);
    body.appendChild(card);
  }

  dots.replaceChildren(...activeProviders.map((pid, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `widget-dot${i === rotateIndex ? ' active' : ''}`;
    dot.title = PROVIDER_META[pid]?.label || pid;
    dot.addEventListener('click', () => {
      rotateIndex = i;
      renderWidget();
    });
    return dot;
  }));
}

function renderGridMode() {
  body.className = 'widget-body widget-body--grid';
  const grid = document.createElement('div');
  grid.className = 'widget-grid';

  activeProviders.forEach((id) => {
    const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [] };
    const existing = body.querySelector(`[data-provider-id="${id}"]`);
    const fp = snapshotFingerprint(snap);
    if (existing && lastFingerprints.get(id) === fp) {
      grid.appendChild(existing);
      return;
    }
    if (existing) {
      updateProviderCard(existing, snap, { onRetry: () => handleRetry(id) });
      lastFingerprints.set(id, fp);
      existing.classList.add('provider-card--settled', 'provider-card--widget');
      grid.appendChild(existing);
      return;
    }
    upsertMiniCard(grid, snap);
  });

  body.replaceChildren(grid);
  dots.replaceChildren();
}

function renderCompactMode() {
  body.className = 'widget-body widget-body--compact';
  const list = document.createElement('div');
  list.className = 'widget-compact-list';

  activeProviders.forEach((id) => {
    const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [] };
    const fp = snapshotFingerprint(snap);
    let row = body.querySelector(`[data-provider-id="${id}"]`);
    if (row && lastFingerprints.get(id) === fp) {
      list.appendChild(row);
      return;
    }
    lastFingerprints.set(id, fp);
    if (row) {
      updateCompactRow(row, snap);
    } else {
      row = renderCompactRow(snap);
    }
    list.appendChild(row);
  });

  body.replaceChildren(list);
  dots.replaceChildren();
}

function renderWidget() {
  activeProviders = getActiveProviders();
  applyChrome();

  if (!activeProviders.length) {
    body.className = 'widget-body';
    body.innerHTML = '<p class="widget-empty">No provider data — pin providers in Settings</p>';
    dots.replaceChildren();
    window.apiMeter.fitWidgetWindow?.(0);
    return;
  }

  const cfg = widgetConfig();
  if (cfg.displayMode === 'grid') renderGridMode();
  else if (cfg.displayMode === 'compact') renderCompactMode();
  else renderSingleMode();

  window.apiMeter.fitWidgetWindow?.(activeProviders.length);
}

function startRotate() {
  clearInterval(rotateTimer);
  const cfg = widgetConfig();
  if (cfg.displayMode === 'single' && cfg.autoRotate && activeProviders.length > 1) {
    rotateTimer = setInterval(() => {
      rotateIndex = (rotateIndex + 1) % activeProviders.length;
      renderWidget();
    }, 10000);
  }
}

function onUsageUpdate(data) {
  snapshots = data || {};
  renderWidget();
  startRotate();
}

function onSettingsUpdate(data) {
  settings = data || settings;
  setAlertThresholds(settings.alerts);
  renderWidget();
  startRotate();
}

function stepProvider(delta) {
  if (activeProviders.length < 2) return;
  rotateIndex = (rotateIndex + delta + activeProviders.length) % activeProviders.length;
  renderWidget();
}

async function init() {
  document.getElementById('widget-close')?.addEventListener('click', () => {
    window.apiMeter.toggleFloatingWidget();
  });

  document.getElementById('widget-smaller')?.addEventListener('click', async () => {
    await window.apiMeter.resizeWidget?.(-1);
  });

  document.getElementById('widget-larger')?.addEventListener('click', async () => {
    await window.apiMeter.resizeWidget?.(1);
  });

  document.getElementById('widget-theme')?.addEventListener('click', async () => {
    await window.apiMeter.cycleWidgetTheme?.();
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
  startRotate();
}

init();