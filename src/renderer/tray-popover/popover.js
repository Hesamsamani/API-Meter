import {
  renderSnapshotRow,
  updateSnapshotRow,
  snapshotFingerprint,
  isLoginRequired,
  ORDER,
  worstUtil,
} from '../shared/provider-card.js';

const container = document.getElementById('popover-cards');
const lastFingerprints = new Map();
const loginHandlers = new Map();

function handleLogin(providerId) {
  window.apiMeter?.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function getLoginHandler(providerId) {
  if (!loginHandlers.has(providerId)) {
    loginHandlers.set(providerId, () => handleLogin(providerId));
  }
  return loginHandlers.get(providerId);
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
  if (!row) {
    row = renderSnapshotRow(snap, { onLogin });
    return row;
  }

  updateSnapshotRow(row, snap, { onLogin });
  if (isLoginRequired(snap) && onLogin && !row.dataset.loginBound) {
    row.dataset.loginBound = '1';
    row.addEventListener('click', onLogin);
  }
  return row;
}

function renderPopover(data) {
  if (!container) return;
  const snaps = data || {};
  const sorted = ORDER
    .map((id) => snaps[id] || { providerId: id, source: 'stale', windows: [], error: 'Awaiting…' })
    .sort((a, b) => worstUtil(b) - worstUtil(a));

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

  container.replaceChildren(...ORDER.map(() => {
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

  window.apiMeter.onUsageUpdated(renderPopover);

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