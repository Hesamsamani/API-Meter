import {
  renderProviderCard,
  renderSkeletonCard,
  ORDER,
  worstUtil,
} from '../shared/provider-card.js';

const container = document.getElementById('popover-cards');

function renderPopover(data) {
  const snaps = data || {};
  const sorted = ORDER
    .map((id) => snaps[id] || { providerId: id, source: 'stale', windows: [], error: 'Awaiting…' })
    .sort((a, b) => worstUtil(b) - worstUtil(a));

  container.replaceChildren();
  sorted.forEach((snap) => {
    const card = renderProviderCard(snap, { variant: 'mini' });
    container.appendChild(card);
  });
}

async function init() {
  container.replaceChildren(...ORDER.slice(0, 3).map(() => renderSkeletonCard()));

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