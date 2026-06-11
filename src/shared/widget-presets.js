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
};

const SIZE_ORDER = ['small', 'medium', 'large'];
const THEME_ORDER = ['dark', 'midnight', 'glass', 'light', 'minimal'];

function normalizeWidgetSettings(fw = {}) {
  return {
    enabled: fw.enabled === true,
    pinnedProviders: Array.isArray(fw.pinnedProviders) ? fw.pinnedProviders : [],
    autoRotate: fw.autoRotate === true,
    displayMode: WIDGET_DISPLAY_MODES[fw.displayMode] ? fw.displayMode : 'single',
    size: WIDGET_SIZES[fw.size] ? fw.size : 'medium',
    theme: WIDGET_THEMES[fw.theme] ? fw.theme : 'dark',
    opacity: Number.isFinite(fw.opacity) ? Math.min(1, Math.max(0.5, fw.opacity)) : 0.92,
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
function computeWidgetBounds(fw, providerCount = 1) {
  const preset = WIDGET_SIZES[fw.size] || WIDGET_SIZES.medium;
  const count = Math.max(1, providerCount);
  const header = 34;
  const footer = fw.displayMode === 'single' ? 28 : 12;
  const padding = 16;

  if (fw.displayMode === 'grid') {
    const cols = fw.size === 'small' ? 1 : 2;
    const rows = Math.ceil(count / cols);
    return {
      width: preset.gridWidth,
      height: header + padding + rows * preset.gridRowHeight + footer,
    };
  }

  if (fw.displayMode === 'compact') {
    return {
      width: preset.compactWidth,
      height: header + padding + count * preset.compactRowHeight + footer,
    };
  }

  return { width: preset.width, height: preset.height };
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
  computeWidgetBounds,
};