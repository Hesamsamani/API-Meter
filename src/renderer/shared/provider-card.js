import { renderGauge, updateGauge } from './gauge.js';

const PROVIDER_META = {
  'claude-ai': { label: 'Claude', accent: 'var(--claude-ai)', initials: 'CL' },
  'claude-code': { label: 'Code', accent: 'var(--claude-code)', initials: 'CC' },
  gemini: { label: 'Gemini', accent: 'var(--gemini)', initials: 'GM' },
  perplexity: { label: 'Perplexity', accent: 'var(--perplexity)', initials: 'PX' },
  grok: { label: 'Grok', accent: 'var(--grok)', initials: 'GK' },
  cursor: { label: 'Cursor', accent: 'var(--cursor)', initials: 'CR' },
};

const ORDER = ['claude-ai', 'claude-code', 'gemini', 'perplexity', 'grok', 'cursor'];

function providerLogoSrc(providerId) {
  if (!providerId) return '';
  return new URL(`../assets/providers/${providerId}.png`, window.location.href).href;
}

function providerLogoHtml(meta, providerId) {
  const grokClass = meta.label === 'Grok' ? ' provider-logo--grok' : '';
  const src = providerLogoSrc(providerId);
  return `
    <div class="provider-logo${grokClass}">
      ${src ? `<img class="provider-logo-img" src="${src}" alt="${meta.label}" width="28" height="28" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ''}
      <span class="provider-logo-fallback"${src ? ' hidden' : ''}>${meta.initials}</span>
    </div>`;
}

function worstUtil(snapshot) {
  if (!snapshot?.windows?.length) return 0;
  return Math.max(...snapshot.windows.map((w) => w.utilization || 0));
}

function formatCountdown(resetsAt) {
  if (!resetsAt) return null;
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

const AUTH_HINTS = [
  /login/i, /auth/i, /session/i, /credential/i, /cloudflare/i,
  /unauthorized/i, /\b401\b/, /\b403\b/, /not logged/i, /expired/i,
  /disconnected/i, /org not found/i, /invalidjson/i,
];

function isLoginRequired(snapshot) {
  if (!snapshot) return false;
  if (snapshot.authRequired) return true;
  const msg = snapshot.error || '';
  return AUTH_HINTS.some((re) => re.test(msg));
}

function sourceBadge(snapshot) {
  if (isLoginRequired(snapshot)) return { text: 'LOGIN', cls: 'error' };
  if (snapshot.error && !snapshot.windows?.length) return { text: 'ERROR', cls: 'error' };
  if (snapshot.error && snapshot.windows?.length) return { text: 'STALE', cls: 'stale' };
  if (snapshot.source === 'local') return { text: 'LOCAL', cls: 'local' };
  if (snapshot.source === 'stale') return { text: 'STALE', cls: 'stale' };
  return { text: 'LIVE', cls: 'live' };
}

function cardShowsEmpty(snapshot) {
  return !snapshot
    || (isLoginRequired(snapshot) && !snapshot.windows?.length)
    || (!snapshot.windows?.length && snapshot.error);
}

export function snapshotFingerprint(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify({
    source: snapshot.source,
    plan: snapshot.plan,
    error: snapshot.error,
    authRequired: snapshot.authRequired,
    windows: (snapshot.windows || []).map((w) => ({
      key: w.key,
      label: w.label,
      utilization: w.utilization,
      resetsAt: w.resetsAt,
    })),
  });
}

function statsHtml(snapshot, variant) {
  const limit = variant === 'mini' ? 2 : 3;
  return snapshot.windows.slice(0, limit).map((w) => {
    const reset = formatCountdown(w.resetsAt);
    return `<span><strong>${w.label}</strong> ${w.utilization}%${reset ? ` · ${reset}` : ''}</span>`;
  }).join('');
}

export function renderProviderCard(snapshot, { onClick, variant = 'full', onLogin } = {}) {
  const meta = PROVIDER_META[snapshot?.providerId] || { label: snapshot?.providerId, accent: 'var(--muted)', initials: '??' };
  const el = document.createElement('article');
  el.className = `provider-card provider-card--${variant}`;
  el.style.setProperty('--accent', meta.accent);
  el.dataset.providerId = snapshot?.providerId || '';

  if (cardShowsEmpty(snapshot)) {
    el.innerHTML = buildEmptyCard(meta, snapshot, onLogin);
    if (isLoginRequired(snapshot) && onLogin) {
      el.querySelector('.login-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onLogin();
      });
    }
    return el;
  }

  const primary = snapshot.windows[0];
  const util = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const gaugeSize = variant === 'mini' ? 64 : 88;
  const gaugeStroke = variant === 'mini' ? 5 : 6;

  const planLabel = snapshot.plan || 'Unknown';

  el.innerHTML = `
    <div class="card-header">
      ${providerLogoHtml(meta, snapshot?.providerId)}
      <div class="card-title-block">
        <span class="card-title">${meta.label}</span>
        <span class="card-plan">${planLabel}</span>
      </div>
      <div class="card-status ${snapshot.source}"></div>
    </div>
    <div class="gauge-wrap"></div>
    <div class="stats">${statsHtml(snapshot, variant)}</div>
    <span class="badge ${badge.cls}">${badge.text}</span>
  `;

  el.querySelector('.gauge-wrap').appendChild(
    renderGauge(primary?.utilization ?? util, { size: gaugeSize, stroke: gaugeStroke, variant })
  );

  if (onClick) el.addEventListener('click', () => onClick(snapshot));
  return el;
}

function buildEmptyCard(meta, snapshot, onLogin) {
  const needsLogin = isLoginRequired(snapshot);
  return `
    <div class="card-header">
      ${providerLogoHtml(meta, snapshot?.providerId)}
      <div class="card-title-block">
        <span class="card-title">${meta.label}</span>
        <span class="card-plan">${snapshot?.plan || '—'}</span>
      </div>
      <div class="card-status stale"></div>
    </div>
    <div class="card-empty">
      <p>${needsLogin ? 'Login required' : snapshot?.error || 'Awaiting data…'}</p>
      ${needsLogin && onLogin ? '<button class="login-btn" type="button">Connect</button>' : ''}
    </div>
    <span class="badge error">${needsLogin ? 'LOGIN' : 'EMPTY'}</span>
  `;
}

function replaceProviderCard(el, snapshot, { onClick, variant, onLogin } = {}) {
  const fresh = renderProviderCard(snapshot, { onClick, variant, onLogin });
  fresh.classList.add('provider-card--settled');
  el.replaceWith(fresh);
  return fresh;
}

export function updateProviderCard(el, snapshot, { onClick, onLogin } = {}) {
  const variant = el.classList.contains('provider-card--mini') ? 'mini' : 'full';
  const wasEmpty = !!el.querySelector('.card-empty');
  const nowEmpty = cardShowsEmpty(snapshot);

  if (wasEmpty !== nowEmpty) {
    return replaceProviderCard(el, snapshot, { onClick, variant, onLogin });
  }

  if (nowEmpty) {
    const msg = el.querySelector('.card-empty p');
    const needsLogin = isLoginRequired(snapshot);
    if (msg) msg.textContent = needsLogin ? 'Login required' : (snapshot?.error || 'Awaiting data…');
    const badge = el.querySelector('.badge');
    if (badge) {
      badge.textContent = needsLogin ? 'LOGIN' : 'EMPTY';
      badge.className = 'badge error';
    }
    return el;
  }

  const primary = snapshot.windows[0];
  const util = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const gaugeEl = el.querySelector('.gauge');

  if (gaugeEl) {
    updateGauge(gaugeEl, primary?.utilization ?? util);
  }

  const stats = el.querySelector('.stats');
  if (stats) stats.innerHTML = statsHtml(snapshot, variant);

  const badgeEl = el.querySelector('.badge');
  if (badgeEl) {
    badgeEl.textContent = badge.text;
    badgeEl.className = `badge ${badge.cls}`;
  }

  const status = el.querySelector('.card-status');
  if (status) status.className = `card-status ${snapshot.source}`;

  const plan = el.querySelector('.card-plan');
  if (plan) plan.textContent = snapshot.plan || 'Unknown';

  return el;
}

function thresholdClass(util) {
  if (util >= 90) return 'red';
  if (util >= 75) return 'amber';
  return 'green';
}

/** Compact horizontal row for tray popover — shows usage % and window stats */
export function renderSnapshotRow(snapshot, { onLogin } = {}) {
  const meta = PROVIDER_META[snapshot?.providerId] || { label: snapshot?.providerId, accent: 'var(--muted)', initials: '??' };
  const el = document.createElement('article');
  el.className = 'snapshot-row';
  el.style.setProperty('--accent', meta.accent);
  el.dataset.providerId = snapshot?.providerId || '';

  const hasWindows = (snapshot?.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snapshot);
  const util = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const colorClass = hasWindows ? thresholdClass(util) : 'muted';

  const statLine = hasWindows
    ? snapshot.windows.slice(0, 2).map((w) => {
        const reset = formatCountdown(w.resetsAt);
        return `${w.label} ${w.utilization}%${reset ? ` · ${reset}` : ''}`;
      }).join(' · ')
    : (needsLogin ? 'Login required — click to connect' : (snapshot?.error || 'Awaiting data…'));

  el.innerHTML = `
    <div class="snapshot-accent"></div>
    ${providerLogoHtml(meta, snapshot?.providerId)}
    <div class="snapshot-info">
      <span class="snapshot-name">${meta.label}</span>
      <span class="snapshot-plan">${snapshot?.plan || '—'}</span>
      <span class="snapshot-stats">${statLine}</span>
    </div>
    <div class="snapshot-util">
      <span class="snapshot-pct th-${colorClass}">${hasWindows ? `${util}%` : '—'}</span>
      <span class="snapshot-badge badge ${badge.cls}">${badge.text}</span>
    </div>
    <div class="card-status ${snapshot?.source || 'stale'}"></div>
  `;

  if (needsLogin && onLogin) {
    el.classList.add('snapshot-row--clickable');
    el.title = snapshot?.error || 'Click to reconnect';
    el.addEventListener('click', onLogin);
  }

  return el;
}

export function updateSnapshotRow(el, snapshot, { onLogin } = {}) {
  const hasWindows = (snapshot?.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snapshot);
  const util = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const colorClass = hasWindows ? thresholdClass(util) : 'muted';

  const statLine = hasWindows
    ? snapshot.windows.slice(0, 2).map((w) => {
        const reset = formatCountdown(w.resetsAt);
        return `${w.label} ${w.utilization}%${reset ? ` · ${reset}` : ''}`;
      }).join(' · ')
    : (needsLogin ? 'Login required — click to connect' : (snapshot?.error || 'Awaiting data…'));

  const plan = el.querySelector('.snapshot-plan');
  const stats = el.querySelector('.snapshot-stats');
  const pct = el.querySelector('.snapshot-pct');
  const badgeEl = el.querySelector('.snapshot-badge');
  const status = el.querySelector('.card-status');

  if (plan) plan.textContent = snapshot?.plan || '—';
  if (stats) stats.textContent = statLine;
  if (pct) {
    pct.textContent = hasWindows ? `${util}%` : '—';
    pct.className = `snapshot-pct th-${colorClass}`;
  }
  if (badgeEl) {
    badgeEl.textContent = badge.text;
    badgeEl.className = `snapshot-badge badge ${badge.cls}`;
  }
  if (status) status.className = `card-status ${snapshot?.source || 'stale'}`;

  el.classList.toggle('snapshot-row--clickable', needsLogin && !!onLogin);
  el.title = needsLogin && onLogin ? (snapshot?.error || 'Click to reconnect') : '';

  return el;
}

export function renderSkeletonCard() {
  const el = document.createElement('div');
  el.className = 'skeleton-card';
  el.innerHTML = `
    <div class="skeleton skeleton-line" style="width:40%;margin:0 auto 16px"></div>
    <div class="skeleton skeleton-circle"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line" style="width:45%"></div>
  `;
  return el;
}

export { PROVIDER_META, ORDER, worstUtil, formatCountdown, isLoginRequired, cardShowsEmpty };