import {
  renderSnapshotRow,
  updateSnapshotRow,
  snapshotFingerprint,
  getVisibleOrder,
  worstUtil,
} from '../shared/provider-card.js';
import { setAlertThresholds } from '../shared/alert-thresholds.js';
import { setUsageDisplayMode, worstDisplayPercent } from '../shared/usage-display.js';

const container = document.getElementById('popover-cards');
const lastFingerprints = new Map();
const loginHandlers = new Map();
const retryHandlers = new Map();
let appSettings = {};
let lastUsage = {};

function handleLogin(providerId) {
  window.apiMeter?.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function handleRetry(providerId) {
  window.apiMeter?.refreshProvider(providerId).catch((err) => {
    console.error('Refresh failed:', err);
  });
}

function getLoginHandler(providerId) {
  if (!loginHandlers.has(providerId)) {
    loginHandlers.set(providerId, () => handleLogin(providerId));
  }
  return loginHandlers.get(providerId);
}

function getRetryHandler(providerId) {
  if (!retryHandlers.has(providerId)) {
    retryHandlers.set(providerId, () => handleRetry(providerId));
  }
  return retryHandlers.get(providerId);
}

function upsertRow(snap) {
  const id = snap.providerId;
  const fingerprint = snapshotFingerprint(snap);
  let row = container.querySelector(`[data-provider-id="${id}"]`);

  if (row && lastFingerprints.get(id) === fingerprint) {
    return row;
  }
  lastFingerprints.set(id, fingerprint);

  const onLogin = getLoginHandler(id);
  const onRetry = getRetryHandler(id);
  if (!row) {
    row = renderSnapshotRow(snap, { onLogin, onRetry });
    return row;
  }

  updateSnapshotRow(row, snap, { onLogin, onRetry });
  return row;
}

function renderPopover(data) {
  if (!container) return;
  lastUsage = data || {};
  const snaps = lastUsage;
  const sorted = getVisibleOrder(appSettings)
    .map((id) => snaps[id] || { providerId: id, source: 'stale', windows: [], error: 'Awaiting…' })
    .sort((a, b) => worstDisplayPercent(b) - worstDisplayPercent(a));

  const fragment = document.createDocumentFragment();
  sorted.forEach((snap) => {
    try {
      fragment.appendChild(upsertRow(snap));
    } catch (err) {
      console.error('Row render failed:', snap.providerId, err);
    }
  });
  container.replaceChildren(fragment);
}

async function waitForBridge(maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (window.apiMeter?.getUsage && window.apiMeter?.onUsageUpdated) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function init() {
  if (!container) return;

  container.replaceChildren(...getVisibleOrder(appSettings).map(() => {
    const sk = document.createElement('div');
    sk.className = 'snapshot-row snapshot-row--skeleton';
    sk.innerHTML = '<div class="skeleton skeleton-line" style="width:100%;height:52px"></div>';
    return sk;
  }));

  const ready = await waitForBridge();
  if (!ready) {
    container.innerHTML = '<p style="padding:12px;color:var(--muted);font-size:11px">API bridge not ready. Restart the app.</p>';
    return;
  }

  try {
    appSettings = await window.apiMeter.getSettings();
    setAlertThresholds(appSettings.alerts);
    setUsageDisplayMode(appSettings.usageDisplayMode);
  } catch { /* ignore */ }

  window.apiMeter.onUsageUpdated(renderPopover);
  window.apiMeter.onSettingsUpdated?.((data) => {
    const prevMode = appSettings.usageDisplayMode;
    appSettings = data || appSettings;
    setAlertThresholds(appSettings.alerts);
    setUsageDisplayMode(appSettings.usageDisplayMode);
    if (prevMode !== appSettings.usageDisplayMode) {
      lastFingerprints.clear();
    }
    renderPopover(lastUsage);
  });

  try {
    const data = await window.apiMeter.getUsage();
    renderPopover(data);
  } catch (err) {
    console.error('getUsage failed:', err);
    renderPopover({});
  }

  document.getElementById('btn-open-dashboard')?.addEventListener('click', () => {
    window.apiMeter?.showDashboard();
  });
}

init();