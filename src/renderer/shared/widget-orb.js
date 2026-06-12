import { PROVIDER_META, isLoginRequired, isRetryableError } from './provider-card.js';
import { thresholdClass } from './alert-thresholds.js';
import {
  displayFillPercent,
  displayPercent,
  formatWindowPercent,
  getUsageDisplayMode,
} from './usage-display.js';

const ORB_SIZE = { small: 52, medium: 64, large: 76 };

function providerLogoSrc(providerId) {
  if (!providerId) return '';
  return new URL(`../assets/providers/${providerId}.png`, window.location.href).href;
}

function orbWindows(snap) {
  if (snap?.windows?.length) return snap.windows.slice(0, 3);
  return [];
}

function orbFingerprint(snap) {
  const needsLogin = isLoginRequired(snap);
  const wins = orbWindows(snap);
  const mode = getUsageDisplayMode();
  if (!wins.length) return `${snap?.providerId}|${needsLogin}|${snap?.error || ''}|${mode}|empty`;
  return `${snap?.providerId}|${needsLogin}|${snap?.error || ''}|${mode}|${wins.map((w) => `${w.label}:${w.utilization}`).join(',')}`;
}

function logoHtml(meta, providerId, size) {
  const logoSize = Math.round(size * 0.38);
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

function ringLayer({ cx, radius, stroke, fillPercent, utilization, gradId, layer }) {
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (fillPercent / 100) * circumference;
  const colorClass = thresholdClass(utilization);
  return `
    <circle class="widget-orb__ring-bg widget-orb__ring-bg--${layer}" cx="${cx}" cy="${cx}" r="${radius}" stroke-width="${stroke}" />
    <circle
      class="widget-orb__ring-fg widget-orb__ring-fg--${layer} stroke-${colorClass}"
      cx="${cx}" cy="${cx}" r="${radius}"
      stroke="url(#${gradId}-${layer})"
      stroke-width="${stroke}"
      stroke-dasharray="${circumference}"
      stroke-dashoffset="${circumference}"
      data-target-offset="${offset}"
      data-layer="${layer}"
    />`;
}

function concentricSvg(windows, size, accent, needsLogin) {
  const stroke = Math.max(3, Math.round(size * 0.055));
  const gap = stroke + 3;
  const outerR = (size - stroke) / 2 - 2;
  const innerR = Math.max(outerR - stroke - gap, stroke + 6);
  const gradId = `orb-${Math.random().toString(36).slice(2, 9)}`;
  const inner = windows[0];
  const outer = windows[1];
  const innerFill = needsLogin ? 0 : displayFillPercent(inner?.utilization);
  const outerFill = needsLogin ? 0 : displayFillPercent((outer || inner)?.utilization);
  const innerUtil = inner?.utilization ?? 0;
  const outerUtil = (outer || inner)?.utilization ?? 0;

  const cx = size / 2;
  let rings = '';
  if (windows.length >= 2) {
    rings += ringLayer({
      cx,
      radius: outerR,
      stroke,
      fillPercent: outerFill,
      utilization: outerUtil,
      accent,
      gradId,
      layer: 'outer',
    });
    rings += ringLayer({
      cx,
      radius: innerR,
      stroke,
      fillPercent: innerFill,
      utilization: innerUtil,
      accent,
      gradId,
      layer: 'inner',
    });
  } else if (windows.length === 1) {
    rings += ringLayer({
      cx,
      radius: outerR,
      stroke,
      fillPercent: innerFill,
      utilization: innerUtil,
      accent,
      gradId,
      layer: 'single',
    });
  } else {
    rings += `<circle class="widget-orb__ring-bg" cx="${cx}" cy="${cx}" r="${outerR}" stroke-width="${stroke}" />`;
  }

  return `
    <svg class="widget-orb__svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}-outer" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${accent};stop-opacity:0.9" />
          <stop offset="100%" style="stop-color:${accent};stop-opacity:0.35" />
        </linearGradient>
        <linearGradient id="${gradId}-inner" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${accent};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${accent};stop-opacity:0.5" />
        </linearGradient>
        <linearGradient id="${gradId}-single" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${accent};stop-opacity:0.95" />
          <stop offset="100%" style="stop-color:${accent};stop-opacity:0.45" />
        </linearGradient>
        <filter id="${gradId}-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#${gradId}-glow)">${rings}</g>
    </svg>`;
}

function legendHtml(windows, needsLogin) {
  if (!windows.length) {
    return '<div class="widget-orb__legends"><span class="widget-orb__legend widget-orb__legend--muted">—</span></div>';
  }
  if (needsLogin) {
    return '<div class="widget-orb__legends"><span class="widget-orb__legend widget-orb__legend--danger">Login</span></div>';
  }

  const items = windows.slice(0, 3).map((win, i) => {
    const pct = Math.round(displayPercent(win.utilization));
    const layer = windows.length >= 2 ? (i === 0 ? 'inner' : i === 1 ? 'outer' : 'extra') : 'single';
    const colorClass = thresholdClass(win.utilization ?? 0);
    const suffix = getUsageDisplayMode() === 'remaining' ? ' left' : '';
    return `<span class="widget-orb__legend widget-orb__legend--${layer} th-${colorClass}">
      <span class="widget-orb__legend-dot"></span>${win.label} <b>${pct}%${suffix}</b>
    </span>`;
  });

  return `<div class="widget-orb__legends">${items.join('')}</div>`;
}

function animateRings(root) {
  requestAnimationFrame(() => {
    root.querySelectorAll('.widget-orb__ring-fg').forEach((ring) => {
      ring.style.strokeDashoffset = ring.dataset.targetOffset;
    });
  });
}

function updateConcentricOrb(orbEl, snap, sizeKey) {
  const size = ORB_SIZE[sizeKey] || ORB_SIZE.medium;
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)', initials: '??' };
  const windows = orbWindows(snap);
  const needsLogin = isLoginRequired(snap);

  if (needsLogin !== orbEl.classList.contains('widget-orb--login')) {
    return renderConcentricOrb(snap, { sizeKey });
  }

  const currentSize = Number(orbEl.style.getPropertyValue('--orb-size')?.replace('px', ''));
  if (currentSize !== size) {
    return renderConcentricOrb(snap, { sizeKey });
  }

  const svgWrap = orbEl.querySelector('.widget-orb__svg-wrap');
  const legends = orbEl.querySelector('.widget-orb__legends');
  if (svgWrap) svgWrap.innerHTML = concentricSvg(windows, size, meta.accent, needsLogin);
  if (legends) legends.outerHTML = legendHtml(windows, needsLogin);

  if (needsLogin) {
    orbEl.title = snap.error || 'Click to connect';
    return orbEl;
  }

  const parts = windows.slice(0, 3).map((w) => formatWindowPercent(w));
  orbEl.title = `${meta.label}: ${parts.join(' · ')}`;
  animateRings(orbEl);
  return orbEl;
}

export function renderConcentricOrb(snap, { sizeKey = 'medium' } = {}) {
  const size = ORB_SIZE[sizeKey] || ORB_SIZE.medium;
  const meta = PROVIDER_META[snap.providerId] || { label: snap.providerId, accent: 'var(--muted)', initials: '??' };
  const windows = orbWindows(snap);
  const needsLogin = isLoginRequired(snap);
  const dual = windows.length >= 2;

  const el = document.createElement('div');
  el.className = `widget-orb${dual ? ' widget-orb--dual' : ''}${needsLogin ? ' widget-orb--login' : ''}`;
  el.style.setProperty('--orb-size', `${size}px`);
  el.style.setProperty('--orb-accent', meta.accent);
  el.dataset.providerId = snap.providerId;

  el.innerHTML = `
    <div class="widget-orb__svg-wrap">${concentricSvg(windows, size, meta.accent, needsLogin)}</div>
    <div class="widget-orb__core">
      ${needsLogin
        ? '<span class="widget-orb__login-mark">!</span>'
        : logoHtml(meta, snap.providerId, size)}
    </div>
    ${legendHtml(windows, needsLogin)}
  `;

  if (!needsLogin && windows.length) {
    const parts = windows.slice(0, 3).map((w) => formatWindowPercent(w));
    el.title = `${meta.label}: ${parts.join(' · ')}`;
  } else if (needsLogin) {
    el.title = snap.error || 'Click to connect';
  }

  animateRings(el);
  return el;
}

export function renderOrbCluster(snap, { sizeKey = 'medium', onLogin, onRetry } = {}) {
  const hasWindows = (snap.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snap);
  const hasRetryableError = isRetryableError(snap);

  const cluster = document.createElement('div');
  cluster.className = 'widget-orb-cluster';
  cluster.dataset.providerId = snap.providerId;

  cluster.appendChild(renderConcentricOrb(snap, { sizeKey }));

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

  const orb = cluster.querySelector('.widget-orb');
  const sizeKey = handlers.sizeKey || 'medium';
  if (!orb) {
    const fresh = renderOrbCluster(snap, handlers);
    fresh.dataset.fingerprint = fp;
    cluster.replaceWith(fresh);
    return fresh;
  }

  const updated = updateConcentricOrb(orb, snap, sizeKey);
  if (updated !== orb) {
    const fresh = renderOrbCluster(snap, handlers);
    fresh.dataset.fingerprint = fp;
    cluster.replaceWith(fresh);
    return fresh;
  }

  cluster.dataset.fingerprint = fp;
  return cluster;
}

/** One concentric orb per provider (not per window). */
export function countOrbSlots(providers, snapshots, placeholder) {
  return Math.max(1, providers.length);
}

export { ORB_SIZE, orbFingerprint, orbWindows };