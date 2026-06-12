/** Browser ESM — keep in sync with src/shared/usage-display.js */
const USAGE_DISPLAY_MODES = ['used', 'remaining'];

let displayMode = 'used';

export function normalizeUsageDisplayMode(mode) {
  return USAGE_DISPLAY_MODES.includes(mode) ? mode : 'used';
}

export function setUsageDisplayMode(mode) {
  displayMode = normalizeUsageDisplayMode(mode);
}

export function getUsageDisplayMode() {
  return displayMode;
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function displayPercent(rawUsed, mode = displayMode) {
  const used = clampPercent(rawUsed);
  return normalizeUsageDisplayMode(mode) === 'remaining' ? 100 - used : used;
}

export function displayFillPercent(rawUsed, mode = displayMode) {
  return displayPercent(rawUsed, mode);
}

export function worstDisplayPercent(snapshot, mode = displayMode) {
  if (!snapshot?.windows?.length) return 0;
  return Math.max(...snapshot.windows.map((w) => displayPercent(w.utilization, mode)));
}

export function formatWindowPercent(win, mode = displayMode) {
  const pct = Math.round(displayPercent(win?.utilization, mode));
  if (normalizeUsageDisplayMode(mode) === 'remaining') {
    return `${win.label} ${pct}% left`;
  }
  return `${win.label} ${pct}%`;
}

export function formatWindowPercentShort(win, mode = displayMode) {
  const pct = Math.round(displayPercent(win?.utilization, mode));
  if (normalizeUsageDisplayMode(mode) === 'remaining') {
    return `${win.label} ${pct}% left`;
  }
  return `${win.label} ${pct}%`;
}