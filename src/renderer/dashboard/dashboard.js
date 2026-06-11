import {
  renderProviderCard,
  renderSkeletonCard,
  updateProviderCard,
  snapshotFingerprint,
  ORDER,
  PROVIDER_META,
  formatCountdown,
  isLoginRequired,
  worstUtil,
} from '../shared/provider-card.js';

const grid = document.getElementById('provider-grid');
const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailBody = document.getElementById('detail-body');
const statusLine = document.getElementById('status-line');
const btnRefresh = document.getElementById('btn-refresh');
const btnAutoRefresh = document.getElementById('btn-auto-refresh');
const btnSettings = document.getElementById('btn-settings');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const btnDetailClose = document.getElementById('detail-close');

let snapshots = {};
let selectedId = null;
let chart = null;
let unsubscribe = null;
let unsubscribeSettings = null;
let appSettings = { autoRefreshEnabled: true };
let gridReady = false;
const lastFingerprints = new Map();

function showSkeletons() {
  grid.replaceChildren(...ORDER.map(() => renderSkeletonCard()));
}

function thresholdFill(util) {
  if (util >= 90) return 'red';
  if (util >= 75) return 'amber';
  return 'green';
}

function handleLogin(providerId) {
  window.apiMeter.loginProvider(providerId).catch((err) => {
    console.error('Login failed:', err);
  });
}

function handleLogout(providerId) {
  window.apiMeter.logoutProvider(providerId).catch((err) => {
    console.error('Disconnect failed:', err);
  });
}

function syncAutoRefreshButton() {
  if (!btnAutoRefresh) return;
  const on = appSettings.autoRefreshEnabled !== false;
  btnAutoRefresh.classList.toggle('active', on);
  btnAutoRefresh.setAttribute('aria-pressed', String(on));
  btnAutoRefresh.title = on ? 'Auto-refresh on' : 'Auto-refresh off';
}

function bindLoginButton(card, providerId) {
  const loginBtn = card.querySelector('.login-btn');
  if (!loginBtn || loginBtn.dataset.bound) return;
  loginBtn.dataset.bound = '1';
  loginBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleLogin(providerId);
  });
}

function upsertCard(id, snap, { animate = false } = {}) {
  const fingerprint = snapshotFingerprint(snap);
  if (lastFingerprints.get(id) === fingerprint) {
    return grid.querySelector(`[data-provider-id="${id}"]`);
  }
  lastFingerprints.set(id, fingerprint);

  let card = grid.querySelector(`[data-provider-id="${id}"]`);
  if (!card) {
    card = renderProviderCard(snap, {
      onClick: (s) => openDetail(s.providerId),
      onLogin: () => handleLogin(id),
    });
    if (!animate) card.classList.add('provider-card--settled');
    grid.appendChild(card);
    bindLoginButton(card, id);
    return card;
  }

  updateProviderCard(card, snap, {
    onClick: (s) => openDetail(s.providerId),
    onLogin: () => handleLogin(id),
  });
  bindLoginButton(card, id);
  return card;
}

function renderGrid(data) {
  snapshots = data || {};

  if (!gridReady) {
    grid.replaceChildren();
    ORDER.forEach((id, i) => {
      const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [], fetchedAt: null, error: 'Awaiting data…' };
      const card = upsertCard(id, snap, { animate: true });
      card.style.animationDelay = `${0.05 * (i + 1)}s`;
    });
    gridReady = true;
  } else {
    ORDER.forEach((id) => {
      const snap = snapshots[id] || { providerId: id, source: 'stale', windows: [], fetchedAt: null, error: 'Awaiting data…' };
      upsertCard(id, snap);
    });
  }

  updateStatusLine();
  if (selectedId && snapshots[selectedId]) refreshDetail(snapshots[selectedId]);
}

function updateStatusLine() {
  const snaps = Object.values(snapshots);
  const live = snaps.filter((s) => s.source === 'live').length;
  const stale = snaps.filter((s) => s.source === 'stale').length;
  const worst = snaps.reduce((max, s) => Math.max(max, worstUtil(s)), 0);
  statusLine.textContent = `${live} live · ${stale} stale · peak ${worst}%`;
}

function openDetail(providerId) {
  selectedId = providerId;
  detailPanel.classList.add('open');
  refreshDetail(snapshots[providerId] || { providerId, windows: [], source: 'stale' });
}

function closeDetail() {
  selectedId = null;
  detailPanel.classList.remove('open');
  if (chart) { chart.destroy(); chart = null; }
}

let lastDetailFingerprint = '';

async function refreshDetail(snapshot) {
  const fp = snapshotFingerprint(snapshot);
  const meta = PROVIDER_META[snapshot.providerId] || { label: snapshot.providerId };
  detailTitle.textContent = meta.label;

  const windows = snapshot.windows || [];
  const fetched = snapshot.fetchedAt
    ? new Date(snapshot.fetchedAt).toLocaleString()
    : '—';

  if (lastDetailFingerprint === fp && document.getElementById('detail-bars')) {
    return;
  }
  lastDetailFingerprint = fp;

  detailBody.innerHTML = `
      <div class="detail-meta">
        Source: <strong>${(snapshot.source || 'unknown').toUpperCase()}</strong><br>
        Plan: ${snapshot.plan || '—'}<br>
        Fetched: ${fetched}
        ${snapshot.error ? `<br><span style="color:var(--red)">${snapshot.error}</span>` : ''}
      </div>
      <div id="detail-bars">
        ${windows.length ? windows.map((w) => `
          <div class="progress-row">
            <div class="progress-label">
              <span>${w.label}</span>
              <span class="pct th-${thresholdFill(w.utilization)}">${w.utilization}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${thresholdFill(w.utilization)}" style="width:${w.utilization}%"></div>
            </div>
            ${w.resetsAt ? `<div class="reset-time">Resets in ${formatCountdown(w.resetsAt)}</div>` : ''}
          </div>
        `).join('') : '<p style="color:var(--muted);font-size:11px">No quota windows available</p>'}
      </div>
      <div class="chart-wrap"><canvas id="history-chart"></canvas></div>
      <div class="detail-actions">
        ${isLoginRequired(snapshot) || snapshot.error ? `<button type="button" id="detail-login">Re-login</button>` : ''}
        ${!isLoginRequired(snapshot) && snapshot.windows?.length ? `<button type="button" id="detail-disconnect" class="danger">Disconnect</button>` : ''}
        <button type="button" id="detail-refresh">Refresh</button>
      </div>
    `;

    document.getElementById('detail-refresh')?.addEventListener('click', () => {
      window.apiMeter.refreshAll();
    });
    document.getElementById('detail-login')?.addEventListener('click', () => {
      handleLogin(snapshot.providerId);
    });
    document.getElementById('detail-disconnect')?.addEventListener('click', () => {
      handleLogout(snapshot.providerId);
    });

  await renderHistoryChart(snapshot.providerId);
}

async function renderHistoryChart(providerId) {
  const history = await window.apiMeter.getHistory(providerId);
  const canvas = document.getElementById('history-chart');
  if (!canvas || !history?.length) return;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = history.filter((e) => e.timestamp > cutoff);
  if (!filtered.length) return;

  const windowKeys = [...new Set(filtered.flatMap((e) => Object.keys(e.windows || {})))];
  const labels = filtered.map((e) => {
    const d = new Date(e.timestamp);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const colors = ['#22c55e', '#f59e0b', '#4285f4', '#d97757', '#7c3aed'];
  const datasets = windowKeys.map((key, i) => ({
    label: key.replace(/_/g, ' ').toUpperCase(),
    data: filtered.map((e) => e.windows?.[key] ?? null),
    borderColor: colors[i % colors.length],
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    tension: 0.3,
    pointRadius: 0,
    spanGaps: true,
  }));

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#6b6b70', font: { family: 'DM Mono', size: 9 }, boxWidth: 12 },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6b6b70', font: { family: 'DM Mono', size: 8 }, maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { color: '#6b6b70', font: { family: 'DM Mono', size: 9 }, stepSize: 25 },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

async function init() {
  showSkeletons();
  btnMinimize?.addEventListener('click', () => window.apiMeter.minimizeWindow());
  btnClose?.addEventListener('click', () => window.apiMeter.closeWindow());
  btnDetailClose?.addEventListener('click', closeDetail);
  btnSettings?.addEventListener('click', () => window.apiMeter.openSettings());
  btnAutoRefresh?.addEventListener('click', async () => {
    const next = appSettings.autoRefreshEnabled === false;
    appSettings = await window.apiMeter.updateSettings({ autoRefreshEnabled: next });
    syncAutoRefreshButton();
  });
  btnRefresh?.addEventListener('click', async () => {
    btnRefresh.classList.add('spinning');
    try { await window.apiMeter.refreshAll(); } finally {
      setTimeout(() => btnRefresh.classList.remove('spinning'), 600);
    }
  });

  try {
    appSettings = await window.apiMeter.getSettings();
    syncAutoRefreshButton();
    const data = await window.apiMeter.getUsage();
    renderGrid(data);
  } catch (err) {
    statusLine.textContent = `Error: ${err.message}`;
  }

  unsubscribe = window.apiMeter.onUsageUpdated((data) => renderGrid(data));
  unsubscribeSettings = window.apiMeter.onSettingsUpdated((data) => {
    appSettings = data;
    syncAutoRefreshButton();
  });
}

init();