import { thresholdClass } from '../../../shared/alert-thresholds.js';

export function renderGauge(utilization = 0, { size = 88, stroke = 6, variant = 'full' } = {}) {
  const clamped = Math.max(0, Math.min(100, utilization));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const colorClass = thresholdClass(clamped);

  const wrap = document.createElement('div');
  wrap.className = `gauge gauge--${variant}`;

  const cx = size / 2;
  const cy = size / 2;

  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="gauge-ring-bg" cx="${cx}" cy="${cy}" r="${radius}" stroke-width="${stroke}" />
      <circle
        class="gauge-ring-fg stroke-${colorClass}"
        cx="${cx}" cy="${cy}" r="${radius}"
        stroke-width="${stroke}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference}"
        data-target-offset="${offset}"
      />
    </svg>
    <div class="gauge-value th-${colorClass}">
      ${Math.round(clamped)}<span class="unit">%</span>
    </div>
  `;

  requestAnimationFrame(() => {
    const ring = wrap.querySelector('.gauge-ring-fg');
    if (ring) ring.style.strokeDashoffset = ring.dataset.targetOffset;
  });

  return wrap;
}

export function updateGauge(gaugeEl, utilization) {
  const clamped = Math.max(0, Math.min(100, utilization));
  const ring = gaugeEl.querySelector('.gauge-ring-fg');
  const valueEl = gaugeEl.querySelector('.gauge-value');
  if (!ring || !valueEl) return;

  const circumference = parseFloat(ring.getAttribute('stroke-dasharray'));
  const offset = circumference - (clamped / 100) * circumference;
  const colorClass = thresholdClass(clamped);

  ring.style.strokeDashoffset = offset;
  ring.className = `gauge-ring-fg stroke-${colorClass}`;
  valueEl.className = `gauge-value th-${colorClass}`;
  valueEl.innerHTML = `${Math.round(clamped)}<span class="unit">%</span>`;
}