import { PROVIDER_META, isLoginRequired } from './provider-card.js';
import { thresholdClass } from './alert-thresholds.js';

const ORB_SIZE = { small: 34, medium: 42, large: 50 };

function providerLogoSrc(providerId) {
  if (!providerId) return '';
  return new URL(`../assets/providers/${providerId}.png`, window.location.href).href;
}

function remainingPercent(utilization = 0) {
  return Math.max(0, Math.min(100, 100 - (utilization || 0)));
}

function orbWindows(snap) {
  if (snap?.windows?.length) return snap.windows.slice(0, 3);
  return [{ key: 'pending', label: '—', utilization: 0 }];
}

function orbFingerprint(snap) {
  const needsLogin = isLoginRequired(snap);
  const wins = orbWindows(snap);
  return `${snap?.providerId}|${needsLogin}|${snap?.error || ''}|${wins.map((w) => `${w.label}:${w.utilization}`).join(',')}`;
}

function logoHtml(meta, providerId, size) {
  const logoSize = Math.round(size * 0.46);
  const grokClass = meta.label === 'Grok' ? ' widget-orb__logo--grok' : '';
  const src = providerLogoSrc(providerId);
  return `
    <div class="widget-orb__logo${grokClass}" style="width:${logoSize}px;height:${logoSize}px">
      ${src
        ? `<img src="${src}" alt="" width="${logoSize}" height="${logoSize}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
        : ''}
      <span class="widget-orb__logo-fallback"${src ? ' hidden' : ''}>${meta.initials}</span>
    </div>`;
}

function ringSvg(remaining, utilization, size, accent) {
  const stroke = Math.max(2, Math.round(size * 0.07));
  const radius = (size - stroke * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (remaining / 100) * circumference;
  const colorClass = thresholdClass(utilization);
  const gradId = `orb-grad-${Math.random().toString(36).slice(2, 9)}`;

  return `
    <svg class="widget-orb__svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${accent};stop-opacity:0.95" />
          <stop offset="100%" style="stop-color:${accent};stop-opacity:0.45" />
        </linearGradient>
        <filter id="${gradId}-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle class="widget-orb__ring-bg" cx="${cx}" cy="${cy}" r="${radius}" stroke-width="${stroke}" />
      <circle
        class="widget-orb__ring-fg stroke-${colorClass}"
        cx="${cx}" cy="${cy}" r="${radius}"
        stroke="url(#${gradId})"
        stroke-width="${stroke}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference}"
        data-target-offset="${offset}"
        filter="url(#${gradId}-glow)"
      />
    </svg>`;
}

function updateOrbElement(orbEl, window, snap, meta, size) {
  const util = window?.utilization ?? 0;
  const remaining = remainingPercent(util);
  const accent = meta.accent || 'var(--widget-muted)';
  const colorClass = thresholdClass(util);

  orbEl.style.setProperty('--orb-accent', accent);
  orbEl.dataset.windowKey = window?.key || 'pending';

  const ring = orbEl.querySelector('.widget-orb__ring-fg');
  if (ring) {
    const circumference = parseFloat(ring.getAttribute('stroke-dasharray'));
    const offset = circumference - (remaining / 100) * circumference;
    ring.style.strokeDashoffset = offset;
    ring.className = `widget-orb__ring-fg stroke-${colorClass}`;
    ring.dataset.targetOffset = String(offset);
  }

  const remainEl = orbEl.querySelector('.widget-orb__remain');
  if (remainEl) {
    remainEl.textContent = `${Math.round(remaining)}`;
    remainEl.className = `widget-orb__remain th-${colorClass}`;
  }

  const labelEl = orbEl.querySelector('.widget-orb__label');
  if (labelEl) labelEl.textContent = window?.label || '—';

  const title = isLoginRequired(snap)
    ? (snap.error || 'Login required')
    : `${meta.label} ${window?.label || ''}: ${Math.round(remaining)}% remaining`;
  orbEl.title = title;
}

export function renderUsageOrb(window, snap, { sizeKey = 'medium' } = {}) {
  const size = ORB_SIZE[sizeKey] || ORB_SIZE.medium;
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)', initials: '??' };
  const util = window?.utilization ?? 0;
  const remaining = remainingPercent(util);
  const accent = meta.accent || 'var(--widget-muted)';
  const colorClass = thresholdClass(util);
  const needsLogin = isLoginRequired(snap);

  const el = document.createElement('div');
  el.className = 'widget-orb';
  el.style.setProperty('--orb-size', `${size}px`);
  el.style.setProperty('--orb-accent', accent);
  el.dataset.providerId = snap.providerId;
  el.dataset.windowKey = window?.key || 'pending';

  if (needsLogin) {
    el.classList.add('widget-orb--login');
    el.innerHTML = `
      ${ringSvg(0, 100, size, accent)}
      <div class="widget-orb__core">
        ${logoHtml(meta, snap.providerId, size)}
        <span class="widget-orb__remain th-danger">!</span>
      </div>
      <span class="widget-orb__label">${window?.label || '—'}</span>
    `;
    el.title = snap.error || 'Click to connect';
    return el;
  }

  el.innerHTML = `
    ${ringSvg(remaining, util, size, accent)}
    <div class="widget-orb__core">
      ${logoHtml(meta, snap.providerId, size)}
      <span class="widget-orb__remain th-${colorClass}">${Math.round(remaining)}</span>
    </div>
    <span class="widget-orb__label">${window?.label || '—'}</span>
  `;

  requestAnimationFrame(() => {
    const ring = el.querySelector('.widget-orb__ring-fg');
    if (ring) ring.style.strokeDashoffset = ring.dataset.targetOffset;
  });

  el.title = `${meta.label} ${window?.label || ''}: ${Math.round(remaining)}% remaining`;
  return el;
}

export function updateUsageOrb(orbEl, window, snap, { sizeKey = 'medium' } = {}) {
  const size = ORB_SIZE[sizeKey] || ORB_SIZE.medium;
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)', initials: '??' };
  const needsLogin = isLoginRequired(snap);

  if (needsLogin !== orbEl.classList.contains('widget-orb--login')) {
    return renderUsageOrb(window, snap, { sizeKey });
  }

  if (needsLogin) {
    const labelEl = orbEl.querySelector('.widget-orb__label');
    if (labelEl) labelEl.textContent = window?.label || '—';
    orbEl.title = snap.error || 'Click to connect';
    return orbEl;
  }

  const currentSize = Number(orbEl.style.getPropertyValue('--orb-size')?.replace('px', ''));
  if (currentSize !== size) {
    return renderUsageOrb(window, snap, { sizeKey });
  }

  updateOrbElement(orbEl, window, snap, meta, size);
  return orbEl;
}

export function renderOrbCluster(snap, { sizeKey = 'medium', onLogin, onRetry } = {}) {
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)', initials: '??' };
  const hasWindows = (snap.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snap);
  const hasRetryableError = snap?.error && !hasWindows && !needsLogin;

  const cluster = document.createElement('div');
  cluster.className = 'widget-orb-cluster';
  cluster.dataset.providerId = snap.providerId;
  cluster.style.setProperty('--cluster-accent', meta.accent);

  const orbsWrap = document.createElement('div');
  orbsWrap.className = 'widget-orb-cluster__orbs';

  orbWindows(snap).forEach((win) => {
    orbsWrap.appendChild(renderUsageOrb(win, snap, { sizeKey }));
  });

  cluster.appendChild(orbsWrap);

  if (needsLogin && onLogin) {
    cluster.classList.add('widget-orb-cluster--actionable');
    cluster.title = 'Click to connect';
    cluster.addEventListener('click', onLogin);
  } else if (hasRetryableError && onRetry) {
    cluster.classList.add('widget-orb-cluster--actionable');
    cluster.title = 'Click to retry';
    cluster.addEventListener('click', onRetry);
  }

  return cluster;
}

export function updateOrbCluster(cluster, snap, handlers = {}) {
  const fp = orbFingerprint(snap);
  if (cluster.dataset.fingerprint === fp) return cluster;
  cluster.dataset.fingerprint = fp;

  const fresh = renderOrbCluster(snap, handlers);
  fresh.dataset.fingerprint = fp;
  cluster.replaceWith(fresh);
  return fresh;
}

export function countOrbSlots(providers, snapshots, placeholder) {
  return providers.reduce((sum, id) => {
    const snap = snapshots[id] || placeholder(id);
    return sum + orbWindows(snap).length;
  }, 0);
}

export { ORB_SIZE, orbFingerprint, orbWindows, remainingPercent };