import {
  renderSnapshotRow,
  renderSkeletonCard,
  ORDER,
  worstUtil,
} from '../shared/provider-card.js';

const container = document.getElementById('popover-cards');

function handleLogin(providerId) {
  window.apiMeter.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function renderPopover(data) {
  const snaps = data || {};
  const sorted = ORDER
    .map((id) => snaps[id] || { providerId: id, source: 'stale', windows: [], error: 'Awaiting…' })
    .sort((a, b) => worstUtil(b) - worstUtil(a));

  container.replaceChildren();
  sorted.forEach((snap) => {
    const row = renderSnapshotRow(snap, {
      onLogin: () => handleLogin(snap.providerId),
    });
    container.appendChild(row);
  });
}

async function init() {
  container.replaceChildren(...ORDER.map(() => {
    const sk = document.createElement('div');
    sk.className = 'snapshot-row snapshot-row--skeleton';
    sk.innerHTML = '<div class="skeleton skeleton-line" style="width:100%;height:52px"></div>';
    return sk;
  }));

  try {
    const data = await window.apiMeter.getUsage();
    renderPopover(data);
  } catch {
    container.innerHTML = '<p style="padding:12px;color:var(--muted);font-size:11px">Failed to load usage</p>';
  }

  window.apiMeter.onUsageUpdated(renderPopover);

  document.getElementById('btn-open-dashboard')?.addEventListener('click', () => {
    window.apiMeter.showDashboard();
  });
}

init();