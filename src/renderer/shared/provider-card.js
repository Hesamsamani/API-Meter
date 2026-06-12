import { renderGauge, updateGauge } from './gauge.js';
import { isAuthErrorMessage } from './auth-errors.js';
import { thresholdClass } from './alert-thresholds.js';
import {
  displayPercent,
  worstDisplayPercent,
  formatWindowPercentShort,
} from './usage-display.js';

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

function isLoginRequired(snapshot) {
  if (!snapshot) return false;
  if (snapshot.authRequired) return true;
  if (snapshot.source === 'local' && snapshot.windows?.length) {
    if (snapshot.refreshFailed && (isAuthErrorMessage(snapshot.error || '') || isGeminiSessionError(snapshot))) {
      return true;
    }
    return false;
  }
  return isAuthErrorMessage(snapshot.error || '');
}

function isStaleSnapshot(snapshot) {
  return !!(snapshot?.error && snapshot.windows?.length);
}

function isRetryableError(snapshot) {
  return !!(snapshot?.error && !isLoginRequired(snapshot));
}

function isGeminiSessionError(snapshot) {
  const err = String(snapshot?.error || '');
  return /SNlM0e|page token missing|session expired|Re-login|gemini\.google\.com/i.test(err);
}

function statusClass(snapshot) {
  if (isLoginRequired(snapshot)) return 'error';
  if (snapshot?.error && !snapshot.windows?.length) return 'error';
  if (snapshot?.error && snapshot.windows?.length) return 'stale';
  if (snapshot?.source === 'local') return 'local';
  if (snapshot?.source === 'stale') return 'stale';
  return 'live';
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

export function getVisibleOrder(settings = {}) {
  const providers = settings.providers || {};
  return ORDER.filter((id) => providers[id]?.enabled !== false);
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
    const pct = Math.round(displayPercent(w.utilization));
    return `<span><strong>${w.label}</strong> ${pct}%${reset ? ` · ${reset}` : ''}</span>`;
  }).join('');
}

function staleErrorHtml(snapshot, { onRetry } = {}) {
  if (!snapshot?.error || !snapshot.windows?.length) return '';
  const retry = onRetry
    ? '<button class="retry-btn retry-btn--inline" type="button">Retry</button>'
    : '';
  return `<p class="card-stale-error">${snapshot.error}${retry ? ` ${retry}` : ''}</p>`;
}

function bindEmptyCardActions(el, snapshot, { onLogin, onRetry } = {}) {
  const needsLogin = isLoginRequired(snapshot);
  const hasError = isRetryableError(snapshot);

  const loginBtn = el.querySelector('.login-btn');
  if (needsLogin && onLogin && loginBtn && !loginBtn.dataset.bound) {
    loginBtn.dataset.bound = '1';
    loginBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onLogin();
    });
  }
  const retryBtn = el.querySelector('.retry-btn');
  if (hasError && onRetry && retryBtn && !retryBtn.dataset.bound) {
    retryBtn.dataset.bound = '1';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRetry();
    });
  }
}

function resolveGaugeDims(variant, gauge = {}) {
  const defaultSize = variant === 'mini' ? 64 : 88;
  const defaultStroke = variant === 'mini' ? 5 : 6;
  return {
    size: Number.isFinite(gauge.size) ? gauge.size : defaultSize,
    stroke: Number.isFinite(gauge.stroke) ? gauge.stroke : defaultStroke,
  };
}

export function renderProviderCard(snapshot, { onClick, variant = 'full', onLogin, onRetry, gauge = {} } = {}) {
  const meta = PROVIDER_META[snapshot?.providerId] || { label: snapshot?.providerId, accent: 'var(--muted)', initials: '??' };
  const el = document.createElement('article');
  el.className = `provider-card provider-card--${variant}`;
  el.style.setProperty('--accent', meta.accent);
  el.dataset.providerId = snapshot?.providerId || '';

  if (cardShowsEmpty(snapshot)) {
    el.innerHTML = buildEmptyCard(meta, snapshot, { onLogin, onRetry });
    bindEmptyCardActions(el, snapshot, { onLogin, onRetry });
    return el;
  }

  const util = worstDisplayPercent(snapshot);
  const colorUtil = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const { size: gaugeSize, stroke: gaugeStroke } = resolveGaugeDims(variant, gauge);

  const planLabel = snapshot.plan || 'Unknown';

  el.innerHTML = `
    <div class="card-header">
      ${providerLogoHtml(meta, snapshot?.providerId)}
      <div class="card-title-block">
        <span class="card-title">${meta.label}</span>
        <span class="card-plan">${planLabel}</span>
      </div>
      <div class="card-status ${statusClass(snapshot)}"></div>
    </div>
    <div class="gauge-wrap"></div>
    <div class="stats">${statsHtml(snapshot, variant)}</div>
    ${staleErrorHtml(snapshot, { onRetry })}
    <span class="badge ${badge.cls}">${badge.text}</span>
  `;

  el.querySelector('.gauge-wrap').appendChild(
    renderGauge(util, { size: gaugeSize, stroke: gaugeStroke, variant, colorUtil })
  );

  if (onClick) el.addEventListener('click', () => onClick(snapshot));
  bindStaleErrorActions(el, snapshot, { onRetry });
  return el;
}

function bindStaleErrorActions(el, snapshot, { onRetry } = {}) {
  const hasStaleError = snapshot?.error && snapshot.windows?.length;
  const retryBtn = el.querySelector('.retry-btn--inline');
  if (hasStaleError && onRetry && retryBtn && !retryBtn.dataset.bound) {
    retryBtn.dataset.bound = '1';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRetry();
    });
  }
}

function buildEmptyCard(meta, snapshot, { onLogin, onRetry } = {}) {
  const needsLogin = isLoginRequired(snapshot);
  const hasError = isRetryableError(snapshot);
  let emptyContent = '<p>Awaiting data…</p>';

  if (needsLogin) {
    const primary = snapshot?.error || 'Login required';
    emptyContent = `
      <p>${primary}</p>
      <p class="error-hint">Connect to sign in</p>
      ${onLogin ? '<button class="login-btn" type="button">Connect</button>' : ''}
    `;
  } else if (hasError) {
    emptyContent = `
      <p>${snapshot.error}</p>
      ${onRetry ? '<button class="retry-btn" type="button">Retry</button>' : ''}
    `;
  }

  return `
    <div class="card-header">
      ${providerLogoHtml(meta, snapshot?.providerId)}
      <div class="card-title-block">
        <span class="card-title">${meta.label}</span>
        <span class="card-plan">${snapshot?.plan || '—'}</span>
      </div>
      <div class="card-status ${statusClass(snapshot)}"></div>
    </div>
    <div class="card-empty">
      ${emptyContent}
    </div>
    <span class="badge error">${needsLogin ? 'LOGIN' : hasError ? 'ERROR' : 'EMPTY'}</span>
  `;
}

function replaceProviderCard(el, snapshot, { onClick, variant, onLogin, onRetry, gauge } = {}) {
  const fresh = renderProviderCard(snapshot, { onClick, variant, onLogin, onRetry, gauge });
  fresh.classList.add('provider-card--settled');
  el.replaceWith(fresh);
  return fresh;
}

export function updateProviderCard(el, snapshot, { onClick, onLogin, onRetry, gauge = {} } = {}) {
  const variant = el.classList.contains('provider-card--mini') ? 'mini' : 'full';
  const wasEmpty = !!el.querySelector('.card-empty');
  const nowEmpty = cardShowsEmpty(snapshot);
  const { size: gaugeSize, stroke: gaugeStroke } = resolveGaugeDims(variant, gauge);

  if (wasEmpty !== nowEmpty) {
    return replaceProviderCard(el, snapshot, { onClick, variant, onLogin, onRetry, gauge });
  }

  if (nowEmpty) {
    const needsLogin = isLoginRequired(snapshot);
    const hasError = isRetryableError(snapshot);
    const wantsLoginBtn = needsLogin && !!onLogin;
    const wantsRetryBtn = hasError && !!onRetry;
    const hadLoginBtn = !!el.querySelector('.login-btn');
    const hadRetryBtn = !!el.querySelector('.retry-btn');

    const status = el.querySelector('.card-status');
    if (status) status.className = `card-status ${statusClass(snapshot)}`;

    if (hadLoginBtn !== wantsLoginBtn || hadRetryBtn !== wantsRetryBtn) {
      return replaceProviderCard(el, snapshot, { onClick, variant, onLogin, onRetry, gauge });
    }

    const empty = el.querySelector('.card-empty');
    if (empty) {
      if (needsLogin) {
        const primary = snapshot?.error || 'Login required';
        empty.innerHTML = `
          <p>${primary}</p>
          <p class="error-hint">Connect to sign in</p>
          ${wantsLoginBtn ? '<button class="login-btn" type="button">Connect</button>' : ''}
        `;
      } else if (hasError) {
        empty.innerHTML = `
          <p>${snapshot.error}</p>
          ${wantsRetryBtn ? '<button class="retry-btn" type="button">Retry</button>' : ''}
        `;
      } else {
        empty.innerHTML = '<p>Awaiting data…</p>';
      }
      bindEmptyCardActions(el, snapshot, { onLogin, onRetry });
    }

    const badge = el.querySelector('.badge');
    if (badge) {
      badge.textContent = needsLogin ? 'LOGIN' : hasError ? 'ERROR' : 'EMPTY';
      badge.className = 'badge error';
    }
    return el;
  }

  const util = worstDisplayPercent(snapshot);
  const colorUtil = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const gaugeEl = el.querySelector('.gauge');
  const gaugeWrap = el.querySelector('.gauge-wrap');

  if (gaugeEl) {
    const svg = gaugeEl.querySelector('svg');
    const currentSize = Number(svg?.getAttribute('width'));
    const currentStroke = Number(gaugeEl.querySelector('.gauge-ring-fg')?.getAttribute('stroke-width'));
    if ((currentSize !== gaugeSize || currentStroke !== gaugeStroke) && gaugeWrap) {
      gaugeWrap.replaceChildren(
        renderGauge(util, { size: gaugeSize, stroke: gaugeStroke, variant, colorUtil }),
      );
    } else {
      updateGauge(gaugeEl, util, colorUtil);
    }
  }

  const stats = el.querySelector('.stats');
  if (stats) stats.innerHTML = statsHtml(snapshot, variant);

  let staleError = el.querySelector('.card-stale-error');
  const staleMarkup = staleErrorHtml(snapshot, { onRetry });
  if (staleMarkup) {
    if (staleError) {
      staleError.outerHTML = staleMarkup;
    } else if (stats) {
      stats.insertAdjacentHTML('afterend', staleMarkup);
    }
    bindStaleErrorActions(el, snapshot, { onRetry });
  } else if (staleError) {
    staleError.remove();
  }

  const badgeEl = el.querySelector('.badge');
  if (badgeEl) {
    badgeEl.textContent = badge.text;
    badgeEl.className = `badge ${badge.cls}`;
  }

  const status = el.querySelector('.card-status');
  if (status) status.className = `card-status ${statusClass(snapshot)}`;

  const plan = el.querySelector('.card-plan');
  if (plan) plan.textContent = snapshot.plan || 'Unknown';

  return el;
}

/** Compact horizontal row for tray popover — shows usage % and window stats */
export function renderSnapshotRow(snapshot, { onLogin, onRetry } = {}) {
  const meta = PROVIDER_META[snapshot?.providerId] || { label: snapshot?.providerId, accent: 'var(--muted)', initials: '??' };
  const el = document.createElement('article');
  el.className = 'snapshot-row';
  el.style.setProperty('--accent', meta.accent);
  el.dataset.providerId = snapshot?.providerId || '';

  const hasWindows = (snapshot?.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snapshot);
  const hasRetryableError = isRetryableError(snapshot);
  const util = worstDisplayPercent(snapshot);
  const colorUtil = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const colorClass = hasWindows ? thresholdClass(colorUtil) : 'muted';

  const statLine = hasWindows
    ? [
        snapshot.windows.slice(0, 2).map((w) => {
          const reset = formatCountdown(w.resetsAt);
          return `${formatWindowPercentShort(w)}${reset ? ` · ${reset}` : ''}`;
        }).join(' · '),
        snapshot.error || '',
      ].filter(Boolean).join(' · ')
    : (needsLogin
      ? (snapshot?.error || 'Login required — click to connect')
      : (snapshot?.error || 'Awaiting data…'));

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
    <div class="card-status ${statusClass(snapshot)}"></div>
  `;

  if (needsLogin && onLogin) {
    el.classList.add('snapshot-row--clickable');
    el.title = snapshot?.error || 'Click to reconnect';
    el.addEventListener('click', onLogin);
  } else if (hasRetryableError && onRetry) {
    el.classList.add('snapshot-row--clickable');
    el.title = snapshot?.error || 'Click to retry';
    el.addEventListener('click', onRetry);
  }

  return el;
}

export function updateSnapshotRow(el, snapshot, { onLogin, onRetry } = {}) {
  const hasWindows = (snapshot?.windows?.length ?? 0) > 0;
  const needsLogin = isLoginRequired(snapshot);
  const hasRetryableError = isRetryableError(snapshot);
  const util = worstDisplayPercent(snapshot);
  const colorUtil = worstUtil(snapshot);
  const badge = sourceBadge(snapshot);
  const colorClass = hasWindows ? thresholdClass(colorUtil) : 'muted';

  const statLine = hasWindows
    ? [
        snapshot.windows.slice(0, 2).map((w) => {
          const reset = formatCountdown(w.resetsAt);
          return `${formatWindowPercentShort(w)}${reset ? ` · ${reset}` : ''}`;
        }).join(' · '),
        snapshot.error || '',
      ].filter(Boolean).join(' · ')
    : (needsLogin
      ? (snapshot?.error || 'Login required — click to connect')
      : (snapshot?.error || 'Awaiting data…'));

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
  if (status) status.className = `card-status ${statusClass(snapshot)}`;

  const clickable = (needsLogin && onLogin) || (hasRetryableError && onRetry);
  el.classList.toggle('snapshot-row--clickable', clickable);
  if (clickable) {
    el.title = needsLogin ? (snapshot?.error || 'Click to reconnect') : (snapshot?.error || 'Click to retry');
    el.onclick = needsLogin ? onLogin : onRetry;
  } else {
    el.title = '';
    el.onclick = null;
  }

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

export {
  PROVIDER_META,
  ORDER,
  worstUtil,
  formatCountdown,
  isLoginRequired,
  isStaleSnapshot,
  isRetryableError,
  isGeminiSessionError,
  sourceBadge,
  cardShowsEmpty,
  statusClass,
};