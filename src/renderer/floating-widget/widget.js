import { renderProviderCard, ORDER, worstUtil } from '../shared/provider-card.js';

const body = document.getElementById('widget-body');
const dots = document.getElementById('widget-dots');

let snapshots = {};
let settings = { floatingWidget: { pinnedProviders: [], autoRotate: false } };
let rotateIndex = 0;
let rotateTimer = null;
let activeProviders = [];

function getActiveProviders() {
  const pinned = settings.floatingWidget?.pinnedProviders || [];
  if (pinned.length) return pinned.filter((id) => ORDER.includes(id));
  return ORDER.filter((id) => snapshots[id]?.windows?.length);
}

function renderWidget() {
  activeProviders = getActiveProviders();
  if (!activeProviders.length) {
    body.innerHTML = '<p style="color:var(--muted);font-size:10px;text-align:center;padding:20px 8px">No provider data</p>';
    dots.replaceChildren();
    return;
  }

  if (settings.floatingWidget?.autoRotate) {
    rotateIndex = rotateIndex % activeProviders.length;
  } else {
    rotateIndex = 0;
  }

  const id = activeProviders[rotateIndex];
  const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [] };
  body.replaceChildren(renderProviderCard(snap, { variant: 'mini' }));

  if (settings.floatingWidget?.autoRotate && activeProviders.length > 1) {
    dots.replaceChildren(...activeProviders.map((pid, i) => {
      const dot = document.createElement('span');
      dot.className = `widget-dot${i === rotateIndex ? ' active' : ''}`;
      return dot;
    }));
  } else {
    dots.replaceChildren();
  }
}

function startRotate() {
  clearInterval(rotateTimer);
  if (settings.floatingWidget?.autoRotate && activeProviders.length > 1) {
    rotateTimer = setInterval(() => {
      rotateIndex = (rotateIndex + 1) % activeProviders.length;
      renderWidget();
    }, 10000);
  }
}

function onUpdate(data) {
  snapshots = data || {};
  renderWidget();
  startRotate();
}

async function init() {
  document.getElementById('widget-close')?.addEventListener('click', () => {
    window.apiMeter.toggleFloatingWidget();
  });

  try {
    settings = await window.apiMeter.getSettings();
    snapshots = await window.apiMeter.getUsage();
  } catch { /* ignore */ }

  renderWidget();
  startRotate();
  window.apiMeter.onUsageUpdated(onUpdate);
}

init();