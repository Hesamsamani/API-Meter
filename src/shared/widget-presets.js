const WIDGET_SIZES = {
  small: {
    key: 'small',
    label: 'S',
    width: 200,
    height: 156,
    gridWidth: 240,
    gridRowHeight: 118,
    compactWidth: 220,
    compactRowHeight: 36,
    gaugeSize: 52,
    gaugeStroke: 4,
  },
  medium: {
    key: 'medium',
    label: 'M',
    width: 280,
    height: 208,
    gridWidth: 320,
    gridRowHeight: 132,
    compactWidth: 280,
    compactRowHeight: 40,
    gaugeSize: 64,
    gaugeStroke: 5,
  },
  large: {
    key: 'large',
    label: 'L',
    width: 380,
    height: 272,
    gridWidth: 400,
    gridRowHeight: 148,
    compactWidth: 340,
    compactRowHeight: 44,
    gaugeSize: 76,
    gaugeStroke: 6,
  },
};

const WIDGET_THEMES = {
  dark: {
    key: 'dark',
    label: 'Dark',
    vars: {
      '--widget-bg': 'rgba(10, 10, 11, 0.92)',
      '--widget-border': 'rgba(255, 255, 255, 0.08)',
      '--widget-text': '#e8e8ea',
      '--widget-muted': '#6b6b70',
      '--widget-header-bg': 'transparent',
    },
  },
  midnight: {
    key: 'midnight',
    label: 'Midnight',
    vars: {
      '--widget-bg': 'rgba(6, 10, 24, 0.94)',
      '--widget-border': 'rgba(99, 130, 255, 0.18)',
      '--widget-text': '#e2e8f8',
      '--widget-muted': '#7b8ab8',
      '--widget-header-bg': 'rgba(30, 41, 82, 0.35)',
    },
  },
  glass: {
    key: 'glass',
    label: 'Glass',
    vars: {
      '--widget-bg': 'rgba(255, 255, 255, 0.06)',
      '--widget-border': 'rgba(255, 255, 255, 0.14)',
      '--widget-text': '#f4f4f5',
      '--widget-muted': '#a1a1aa',
      '--widget-header-bg': 'rgba(255, 255, 255, 0.04)',
    },
  },
  light: {
    key: 'light',
    label: 'Light',
    vars: {
      '--widget-bg': 'rgba(248, 248, 250, 0.96)',
      '--widget-border': 'rgba(0, 0, 0, 0.08)',
      '--widget-text': '#18181b',
      '--widget-muted': '#71717a',
      '--widget-header-bg': 'rgba(0, 0, 0, 0.03)',
    },
  },
  minimal: {
    key: 'minimal',
    label: 'Minimal',
    vars: {
      '--widget-bg': 'rgba(10, 10, 11, 0.78)',
      '--widget-border': 'rgba(255, 255, 255, 0.05)',
      '--widget-text': '#e8e8ea',
      '--widget-muted': '#52525b',
      '--widget-header-bg': 'transparent',
    },
  },
};

const WIDGET_DISPLAY_MODES = {
  single: { key: 'single', label: 'Single' },
  grid: { key: 'grid', label: 'Grid' },
  compact: { key: 'compact', label: 'List' },
  orb: { key: 'orb', label: 'Orbs' },
};

const SIZE_ORDER = ['small', 'medium', 'large'];
const THEME_ORDER = ['dark', 'midnight', 'glass', 'light', 'minimal'];
const DISPLAY_MODE_ORDER = ['single', 'grid', 'compact', 'orb'];

function nextDisplayMode(current) {
  const idx = DISPLAY_MODE_ORDER.indexOf(current);
  return DISPLAY_MODE_ORDER[(idx + 1) % DISPLAY_MODE_ORDER.length] || 'single';
}

function normalizeWidgetPosition(pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  return { x: Math.round(pos.x), y: Math.round(pos.y) };
}

/**
 * Keep at least part of the widget visible on a display work area.
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 */
function clampWidgetPosition(x, y, width, height, workArea) {
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = Math.max(minX, workArea.x + workArea.width - width);
  const maxY = Math.max(minY, workArea.y + workArea.height - height);
  return {
    x: Math.round(Math.min(Math.max(x, minX), maxX)),
    y: Math.round(Math.min(Math.max(y, minY), maxY)),
  };
}

function normalizeWidgetSettings(fw = {}) {
  return {
    enabled: fw.enabled === true,
    pinnedProviders: Array.isArray(fw.pinnedProviders) ? fw.pinnedProviders : [],
    autoRotate: fw.autoRotate === true,
    displayMode: WIDGET_DISPLAY_MODES[fw.displayMode] ? fw.displayMode : 'single',
    size: WIDGET_SIZES[fw.size] ? fw.size : 'medium',
    theme: WIDGET_THEMES[fw.theme] ? fw.theme : 'dark',
    opacity: Number.isFinite(fw.opacity) ? Math.min(1, Math.max(0.5, fw.opacity)) : 0.92,
    clickThrough: fw.clickThrough === true,
    position: normalizeWidgetPosition(fw.position),
  };
}

function nextSize(current) {
  const idx = SIZE_ORDER.indexOf(current);
  return SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, idx + 1)] || 'medium';
}

function prevSize(current) {
  const idx = SIZE_ORDER.indexOf(current);
  return SIZE_ORDER[Math.max(0, idx - 1)] || 'medium';
}

function nextTheme(current) {
  const idx = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length] || 'dark';
}

/**
 * @param {ReturnType<typeof normalizeWidgetSettings>} fw
 * @param {number} providerCount
 */
const HEADER_HEIGHT = 35;
const BODY_PADDING = 16;
const GRID_GAP = 6;
const COMPACT_GAP = 4;
const COMPACT_ROW_HEIGHT = 29;
const EMPTY_BODY_HEIGHT = 52;
const GRID_CARD_HEIGHT = { small: 162, medium: 184, large: 200 };
const SINGLE_CARD_HEIGHT = { small: 150, medium: 172, large: 194 };
const SINGLE_FOOTER_MULTI = 30;
const SINGLE_FOOTER_SINGLE = 12;
const ORB_SIZE = { small: 52, medium: 64, large: 76 };
const ORB_LEGEND = 22;
const ORB_CLUSTER_GAP = 12;
const ORB_HEADER = 30;
const ORB_CLUSTER_PAD = 10;

function widgetWidthForMode(preset, displayMode) {
  if (displayMode === 'grid') return preset.gridWidth;
  if (displayMode === 'compact') return preset.compactWidth;
  if (displayMode === 'orb') return preset.compactWidth;
  return preset.width;
}

function widgetTopInset(fw, displayMode) {
  if (fw.clickThrough) return displayMode === 'orb' ? 8 : 0;
  if (displayMode === 'orb') return ORB_HEADER + 8;
  return HEADER_HEIGHT;
}

function computeOrbBounds(fw, providerCount) {
  const orbSize = ORB_SIZE[fw.size] || ORB_SIZE.medium;
  const count = Math.max(1, providerCount);
  const perRow = fw.size === 'small' ? 2 : fw.size === 'large' ? 4 : 3;
  const cols = Math.min(count, perRow);
  const rows = Math.ceil(count / perRow);
  const clusterWidth = orbSize + ORB_CLUSTER_PAD * 2;
  const rowHeight = orbSize + ORB_LEGEND + ORB_CLUSTER_PAD;

  return {
    width: 16 + cols * clusterWidth + Math.max(0, cols - 1) * ORB_CLUSTER_GAP,
    height: widgetTopInset(fw, 'orb') + rows * rowHeight + Math.max(0, rows - 1) * ORB_CLUSTER_GAP,
  };
}

function computeWidgetBounds(fw, providerCount = 1, orbSlots = 0) {
  const preset = WIDGET_SIZES[fw.size] || WIDGET_SIZES.medium;

  if (providerCount === 0) {
    const emptyH = widgetTopInset(fw, fw.displayMode)
      + (fw.displayMode === 'orb' ? 40 : BODY_PADDING + EMPTY_BODY_HEIGHT);
    return {
      width: widgetWidthForMode(preset, fw.displayMode),
      height: emptyH,
    };
  }

  const count = Math.max(1, providerCount);

  if (fw.displayMode === 'orb') {
    return computeOrbBounds(fw, count);
  }

  if (fw.displayMode === 'grid') {
    const cols = fw.size === 'small' ? 1 : 2;
    const rows = Math.ceil(count / cols);
    const rowHeight = GRID_CARD_HEIGHT[fw.size] || GRID_CARD_HEIGHT.medium;
    return {
      width: preset.gridWidth,
      height: widgetTopInset(fw, 'grid') + BODY_PADDING + rows * rowHeight + Math.max(0, rows - 1) * GRID_GAP,
    };
  }

  if (fw.displayMode === 'compact') {
    return {
      width: preset.compactWidth,
      height: widgetTopInset(fw, 'compact') + BODY_PADDING + count * COMPACT_ROW_HEIGHT
        + Math.max(0, count - 1) * COMPACT_GAP + 8,
    };
  }

  const cardHeight = SINGLE_CARD_HEIGHT[fw.size] || SINGLE_CARD_HEIGHT.medium;
  const footer = fw.clickThrough ? 0 : (count > 1 ? SINGLE_FOOTER_MULTI : SINGLE_FOOTER_SINGLE);
  return {
    width: preset.width,
    height: widgetTopInset(fw, 'single') + BODY_PADDING + cardHeight + footer,
  };
}

module.exports = {
  WIDGET_SIZES,
  WIDGET_THEMES,
  WIDGET_DISPLAY_MODES,
  SIZE_ORDER,
  THEME_ORDER,
  normalizeWidgetSettings,
  nextSize,
  prevSize,
  nextTheme,
  nextDisplayMode,
  DISPLAY_MODE_ORDER,
  computeWidgetBounds,
  clampWidgetPosition,
  normalizeWidgetPosition,
};