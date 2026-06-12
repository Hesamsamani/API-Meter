const USAGE_DISPLAY_MODES = ['used', 'remaining'];

function normalizeUsageDisplayMode(mode) {
  return USAGE_DISPLAY_MODES.includes(mode) ? mode : 'used';
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Raw provider utilization is always % consumed (0 = empty, 100 = full). */
function displayPercent(rawUsed, mode = 'used') {
  const used = clampPercent(rawUsed);
  return normalizeUsageDisplayMode(mode) === 'remaining' ? 100 - used : used;
}

function displayFillPercent(rawUsed, mode = 'used') {
  return displayPercent(rawUsed, mode);
}

function worstDisplayPercent(snapshot, mode = 'used') {
  if (!snapshot?.windows?.length) return 0;
  return Math.max(...snapshot.windows.map((w) => displayPercent(w.utilization, mode)));
}

function formatWindowPercent(win, mode = 'used') {
  const pct = Math.round(displayPercent(win?.utilization, mode));
  if (normalizeUsageDisplayMode(mode) === 'remaining') {
    return `${win.label} ${pct}% left`;
  }
  return `${win.label} ${pct}%`;
}

function formatWindowPercentShort(win, mode = 'used') {
  const pct = Math.round(displayPercent(win?.utilization, mode));
  return `${win.label} ${pct}%`;
}

module.exports = {
  USAGE_DISPLAY_MODES,
  normalizeUsageDisplayMode,
  displayPercent,
  displayFillPercent,
  worstDisplayPercent,
  formatWindowPercent,
  formatWindowPercentShort,
};