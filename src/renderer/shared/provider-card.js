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

function isLoginRequired(snapshot) {
  if (!snapshot) return false;
  const msg = (snapshot.error || '').toLowerCase();
  return msg.includes('login') || msg.includes('auth') || msg.includes('session') || msg.includes('credential');
}

function sourceBadge(snapshot) {
  if (snapshot.error && !snapshot.windows?.length) return { text: 'ERROR', cls: 'error' };
  if (snapshot.source === 'local') return { text: 'LOCAL', cls: 'local' };
  if (snapshot.source === 'stale') return { text: 'STALE', cls: 'stale' };
  return { text: 'LIVE', cls: 'live' };
}

export function renderProviderCard(snapshot, { onClick, variant = 'full', onLogin } = {}) {
  const meta = PROVIDER_META[snapshot?.providerId] || { label: snapshot?.providerId, accent: 'var(--muted)', initials: '??' };
  const el = document.createElement('article');
  el.className = `provider-card provider-card--${variant}`;
  el.style.setProperty('--accent', meta.accent);
  el.dataset.providerId = snapshot?.providerId || '';

  if (!snapshot || (isLoginRequired(snapshot) && !snapshot.windows?.length)) {
    el.innerHTML = buildEmptyCard(meta, snapshot, onLogin);
    return el;
  }

  const primary = snapshot.windows[0];
  const util = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const gaugeSize = variant === 'mini' ? 64 : 88;
  const gaugeStroke = variant === 'mini' ? 5 : 6;

  el.innerHTML = `
    <div class="card-header">
      <div class="provider-logo${meta.label === 'Grok' ? ' provider-logo--grok' : ''}">${meta.initials}</div>
      <span class="card-title">${meta.label}</span>
      <div class="card-status ${snapshot.source}"></div>
    </div>
    <div class="gauge-wrap"></div>
    <div class="stats">
      ${snapshot.windows.slice(0, variant === 'mini' ? 2 : 3).map((w) => {
        const reset = formatCountdown(w.resetsAt);
        return `<span><strong>${w.label}</strong> ${w.utilization}%${reset ? ` · ${reset}` : ''}</span>`;
      }).join('')}
    </div>
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
      <div class="provider-logo">${meta.initials}</div>
      <span class="card-title">${meta.label}</span>
      <div class="card-status stale"></div>
    </div>
    <div class="card-empty">
      <p>${needsLogin ? 'Login required' : snapshot?.error || 'Awaiting data…'}</p>
      ${needsLogin && onLogin ? '<button class="login-btn" type="button">Connect</button>' : ''}
    </div>
    <span class="badge error">${needsLogin ? 'LOGIN' : 'EMPTY'}</span>
  `;
}

export function updateProviderCard(el, snapshot, { onLogin } = {}) {
  const fresh = renderProviderCard(snapshot, { variant: el.classList.contains('provider-card--mini') ? 'mini' : 'full', onLogin });
  const gaugeWrap = el.querySelector('.gauge-wrap');
  const newGauge = fresh.querySelector('.gauge-wrap .gauge');
  if (gaugeWrap && newGauge) {
    gaugeWrap.replaceChildren(newGauge);
    const stats = fresh.querySelector('.stats');
    const badge = fresh.querySelector('.badge');
    const status = fresh.querySelector('.card-status');
    if (stats) el.querySelector('.stats')?.replaceWith(stats);
    if (badge) el.querySelector('.badge')?.replaceWith(badge);
    if (status) el.querySelector('.card-status')?.replaceWith(status);
    return el;
  }
  el.replaceWith(fresh);
  return fresh;
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

export { PROVIDER_META, ORDER, worstUtil, formatCountdown, isLoginRequired };