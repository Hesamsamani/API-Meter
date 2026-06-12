/**
 * Capture README screenshots by serving renderer pages with a mock apiMeter bridge.
 * Run: node scripts/capture-readme-screenshots.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

function futureHours(h) {
  return new Date(Date.now() + h * 3600000).toISOString();
}

const MOCK_SNAPSHOTS = {
  'claude-ai': {
    providerId: 'claude-ai',
    source: 'live',
    plan: 'Pro',
    windows: [
      { key: 'five_hour', label: '5H', utilization: 42, resetsAt: futureHours(2.5) },
      { key: 'seven_day', label: '7D', utilization: 18, resetsAt: futureHours(48) },
    ],
    fetchedAt: new Date().toISOString(),
  },
  'claude-code': {
    providerId: 'claude-code',
    source: 'live',
    plan: 'Max',
    windows: [
      { key: 'five_hour', label: '5H', utilization: 10, resetsAt: futureHours(4) },
      { key: 'seven_day', label: '7D', utilization: 44, resetsAt: futureHours(72) },
    ],
    fetchedAt: new Date().toISOString(),
  },
  gemini: {
    providerId: 'gemini',
    source: 'live',
    plan: 'Advanced',
    windows: [
      { key: 'day', label: 'DAY', utilization: 67, resetsAt: futureHours(8) },
    ],
    fetchedAt: new Date().toISOString(),
  },
  perplexity: {
    providerId: 'perplexity',
    source: 'live',
    plan: 'Pro',
    windows: [
      { key: 'day', label: 'DAY', utilization: 23, resetsAt: futureHours(14) },
    ],
    fetchedAt: new Date().toISOString(),
  },
  grok: {
    providerId: 'grok',
    source: 'live',
    plan: 'Premium',
    windows: [
      { key: 'two_hour', label: '2H', utilization: 85, resetsAt: futureHours(0.75) },
    ],
    fetchedAt: new Date().toISOString(),
  },
  cursor: {
    providerId: 'cursor',
    source: 'live',
    plan: 'Pro',
    windows: [
      { key: 'total', label: 'TOTAL', utilization: 46, resetsAt: futureHours(120) },
    ],
    fetchedAt: new Date().toISOString(),
  },
};

const MOCK_HISTORY = Array.from({ length: 24 }, (_, i) => {
  const ts = Date.now() - (23 - i) * 3 * 3600000;
  return {
    timestamp: ts,
    windows: {
      five_hour: 20 + Math.round(15 * Math.sin(i / 3)),
      seven_day: 10 + Math.round(8 * Math.cos(i / 4)),
    },
  };
});

const BASE_SETTINGS = {
  launchAtStartup: true,
  refreshIntervalMinutes: 5,
  autoRefreshEnabled: true,
  alerts: { enabled: true, warnThreshold: 70, dangerThreshold: 90 },
  providers: {
    'claude-ai': { enabled: true },
    'claude-code': { enabled: true },
    gemini: { enabled: true },
    perplexity: { enabled: true },
    grok: { enabled: true },
    cursor: { enabled: true },
  },
  floatingWidget: {
    enabled: true,
    size: 'medium',
    theme: 'dark',
    displayMode: 'single',
    opacity: 0.92,
    autoRotate: false,
    clickThrough: false,
    pinnedProviders: ['claude-ai', 'claude-code', 'gemini', 'perplexity', 'grok', 'cursor'],
  },
};

function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.normalize(path.join(ROOT, urlPath.replace(/^\//, '')));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mime(filePath) });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function injectMock(page, settings) {
  await page.addInitScript(({ snapshots, history, settings: initial }) => {
    let settingsState = structuredClone(initial);
    const noop = () => () => {};
    window.apiMeter = {
      getUsage: async () => structuredClone(snapshots),
      getSettings: async () => structuredClone(settingsState),
      updateSettings: async (patch) => {
        settingsState = { ...settingsState, ...patch };
        if (patch.floatingWidget) {
          settingsState.floatingWidget = { ...settingsState.floatingWidget, ...patch.floatingWidget };
        }
        return structuredClone(settingsState);
      },
      getHistory: async () => structuredClone(history),
      refreshAll: async () => structuredClone(snapshots),
      refreshProvider: async () => ({}),
      loginProvider: async () => ({}),
      logoutProvider: async () => ({}),
      openSettings: async () => ({}),
      minimizeWindow: () => {},
      closeWindow: () => {},
      showDashboard: async () => ({}),
      toggleFloatingWidget: async () => ({}),
      fitWidgetWindow: async () => ({}),
      resizeWidget: async () => ({}),
      cycleWidgetTheme: async () => ({}),
      cycleWidgetDisplayMode: async () => ({}),
      setWidgetClickThrough: async () => ({}),
      onUsageUpdated: noop,
      onSettingsUpdated: noop,
    };
  }, {
    snapshots: MOCK_SNAPSHOTS,
    history: MOCK_HISTORY,
    settings,
  });
}

async function capture(page, url, outfile, { viewport, waitFor, clip, settings = BASE_SETTINGS } = {}) {
  await page.setViewportSize(viewport || { width: 1280, height: 800 });
  await injectMock(page, structuredClone(settings));

  await page.goto(url, { waitUntil: 'networkidle' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: outfile, clip });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });

  try {
    await capture(page, `${base}/src/renderer/dashboard/index.html`, path.join(OUT, 'dashboard.png'), {
      viewport: { width: 1280, height: 820 },
      waitFor: '.provider-card',
    });

    await capture(page, `${base}/src/renderer/dashboard/index.html`, path.join(OUT, 'dashboard-detail.png'), {
      viewport: { width: 1280, height: 820 },
      waitFor: '.provider-card',
    });
    await page.click('[data-provider-id="claude-ai"]');
    await page.waitForSelector('#detail-panel.open', { timeout: 5000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'dashboard-detail.png') });

    await capture(page, `${base}/src/renderer/settings/index.html`, path.join(OUT, 'settings.png'), {
      viewport: { width: 520, height: 900 },
      waitFor: '.settings-body',
    });

    const widgetSettings = structuredClone(BASE_SETTINGS);
    widgetSettings.floatingWidget.displayMode = 'single';
    await capture(page, `${base}/src/renderer/floating-widget/index.html`, path.join(OUT, 'widget-single.png'), {
      viewport: { width: 340, height: 280 },
      waitFor: '.widget-body .provider-card',
      settings: widgetSettings,
    });

    const orbSettings = structuredClone(BASE_SETTINGS);
    orbSettings.floatingWidget.displayMode = 'orb';
    orbSettings.floatingWidget.size = 'medium';
    await capture(page, `${base}/src/renderer/floating-widget/index.html`, path.join(OUT, 'widget-orb.png'), {
      viewport: { width: 420, height: 200 },
      waitFor: '.widget-orb',
      settings: orbSettings,
    });

    const clickThroughSettings = structuredClone(BASE_SETTINGS);
    clickThroughSettings.floatingWidget.displayMode = 'orb';
    clickThroughSettings.floatingWidget.clickThrough = true;
    await capture(page, `${base}/src/renderer/floating-widget/index.html`, path.join(OUT, 'widget-click-through.png'), {
      viewport: { width: 420, height: 160 },
      waitFor: '.widget-orb',
      settings: clickThroughSettings,
    });

    await capture(page, `${base}/src/renderer/tray-popover/index.html`, path.join(OUT, 'tray-popover.png'), {
      viewport: { width: 360, height: 520 },
      waitFor: '.snapshot-row',
    });

    for (const name of ['icon.png', 'tray-icon-green.png', 'tray-icon-amber.png', 'tray-icon-red.png']) {
      fs.copyFileSync(path.join(ROOT, 'assets', name), path.join(OUT, name));
    }

    const trayStrip = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a1c';
      ctx.fillRect(0, 0, 320, 80);
      const labels = ['12%', '48%', '82%'];
      const files = ['tray-icon-green.png', 'tray-icon-amber.png', 'tray-icon-red.png'];
      for (let i = 0; i < 3; i++) {
        const img = new Image();
        img.src = `/assets/${files[i]}`;
        await new Promise((r) => { img.onload = r; img.onerror = r; });
        const x = 24 + i * 100;
        ctx.drawImage(img, x, 16, 48, 48);
        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px Consolas, monospace';
        ctx.fillText(labels[i], x + 8, 74);
      }
      return canvas.toDataURL('image/png');
    });
    const stripData = trayStrip.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT, 'tray-icons-strip.png'), Buffer.from(stripData, 'base64'));

    console.log(`Screenshots saved to ${OUT}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});