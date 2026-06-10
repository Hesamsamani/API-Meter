import {
  renderSnapshotRow,
  ORDER,
  worstUtil,
} from '../shared/provider-card.js';

const container = document.getElementById('popover-cards');

function handleLogin(providerId) {
  window.apiMeter?.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function renderPopover(data) {
  if (!container) return;
  const snaps = data || {};
  const sorted = ORDER
    .map((id) => snaps[id] || { providerId: id, source: 'stale', windows: [], error: 'Awaiting…' })
    .sort((a, b) => worstUtil(b) - worstUtil(a));

  container.replaceChildren();
  sorted.forEach((snap) => {
    try {
      const row = renderSnapshotRow(snap, {
        onLogin: () => handleLogin(snap.providerId),
      });
      container.appendChild(row);
    } catch (err) {
      console.error('Row render failed:', snap.providerId, err);
    }
  });
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