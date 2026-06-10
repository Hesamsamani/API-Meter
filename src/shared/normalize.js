function clampPercent(value) {
  const n = typeof value === 'number' && value <= 1 ? value * 100 : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function worstUtilization(snapshot) {
  if (!snapshot?.windows?.length) return 0;
  return Math.max(...snapshot.windows.map((w) => w.utilization || 0));
}

function formatResetCountdown(resetsAt) {
  if (!resetsAt) return '—';
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function thresholdColor(utilization, warn = 75, danger = 90) {
  if (utilization >= danger) return 'red';
  if (utilization >= warn) return 'amber';
  return 'green';
}

module.exports = { clampPercent, worstUtilization, formatResetCountdown, thresholdColor };