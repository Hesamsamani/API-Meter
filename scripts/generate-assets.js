#!/usr/bin/env node
/**
 * Generates provider logos, tray icon, and app icon as PNGs (no external deps).
 * Run: node scripts/generate-assets.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PROVIDERS_DIR = path.join(ROOT, 'assets', 'providers');

const COLORS = {
  bg: [20, 20, 22, 255],
  'claude-ai': [217, 119, 87, 255],
  'claude-code': [204, 120, 92, 255],
  gemini: [66, 133, 244, 255],
  perplexity: [32, 184, 205, 255],
  grok: [255, 255, 255, 255],
  cursor: [124, 58, 237, 255],
  green: [34, 197, 94, 255],
};

// ── PNG encoder ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const off = y * stride;
    raw[off] = 0;
    rgba.copy(raw, off + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePng(filePath, width, height, draw) {
  const rgba = Buffer.alloc(width * height * 4);
  const ctx = createCtx(rgba, width, height);
  draw(ctx);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePng(width, height, rgba));
}

// ── Drawing primitives ───────────────────────────────────────
function createCtx(rgba, w, h) {
  const set = (x, y, c) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const i = (iy * w + ix) * 4;
    const a = c[3] / 255;
    if (a >= 1) {
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
      return;
    }
    const ia = 1 - a;
    rgba[i] = Math.round(c[0] * a + rgba[i] * ia);
    rgba[i + 1] = Math.round(c[1] * a + rgba[i + 1] * ia);
    rgba[i + 2] = Math.round(c[2] * a + rgba[i + 2] * ia);
    rgba[i + 3] = Math.round(255 * (a + rgba[i + 3] / 255 * ia));
  };

  const fill = (c) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, c);
  };

  const fillCircle = (cx, cy, r, c) => {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) set(x, y, c);
      }
    }
  };

  const fillRing = (cx, cy, rOuter, rInner, c) => {
    const ro2 = rOuter * rOuter;
    const ri2 = rInner * rInner;
    for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++) {
      for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= ro2 && d2 >= ri2) set(x, y, c);
      }
    }
  };

  const fillRect = (x0, y0, x1, y1, c) => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) set(x, y, c);
    }
  };

  const line = (x0, y0, x1, y1, thickness, c) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      fillCircle(x, y, thickness / 2, c);
    }
  };

  const fillPoly = (pts, c) => {
    let minY = h, maxY = 0;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length; i += 2) {
        if (i + 1 < xs.length) fillRect(xs[i], y, xs[i + 1], y, c);
      }
    }
  };

  return { w, h, set, fill, fillCircle, fillRing, fillRect, line, fillPoly };
}

function providerBadge(ctx, accent) {
  const { w, h } = ctx;
  const cx = w / 2;
  const cy = h / 2;
  ctx.fill(COLORS.bg);
  ctx.fillCircle(cx, cy, w * 0.46, [...COLORS.bg.slice(0, 3), 255]);
  ctx.fillRing(cx, cy, w * 0.46, w * 0.40, [...accent.slice(0, 3), 200]);
  ctx.fillRing(cx, cy, w * 0.40, w * 0.36, [...accent.slice(0, 3), 60]);
}

// ── Provider marks ───────────────────────────────────────────
const DRAW = {
  'claude-ai': (ctx) => {
    providerBadge(ctx, COLORS['claude-ai']);
    const c = COLORS['claude-ai'];
    const cx = ctx.w / 2;
    const cy = ctx.h / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      ctx.line(cx, cy, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 3.5, c);
    }
    ctx.fillCircle(cx, cy, 4, c);
  },
  'claude-code': (ctx) => {
    providerBadge(ctx, COLORS['claude-code']);
    const c = COLORS['claude-code'];
    const cx = ctx.w / 2;
    const cy = ctx.h / 2;
    ctx.line(cx - 10, cy - 12, cx - 2, cy, 3.5, c);
    ctx.line(cx - 2, cy, cx - 10, cy + 12, 3.5, c);
    ctx.line(cx + 10, cy - 12, cx + 2, cy, 3.5, c);
    ctx.line(cx + 2, cy, cx + 10, cy + 12, 3.5, c);
  },
  gemini: (ctx) => {
    providerBadge(ctx, COLORS.gemini);
    const c = COLORS.gemini;
    const cx = ctx.w / 2;
    const cy = ctx.h / 2;
    const d = 11;
    ctx.fillPoly([[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]], c);
    ctx.fillPoly([[cx - 6, cy - d + 4], [cx + d - 4, cy - 6], [cx + 6, cy + d - 4], [cx - d + 4, cy + 6]], [...c.slice(0, 3), 180]);
  },
  perplexity: (ctx) => {
    providerBadge(ctx, COLORS.perplexity);
    const c = COLORS.perplexity;
    const cx = ctx.w / 2;
    const cy = ctx.h / 2;
    ctx.fillRing(cx, cy, 13, 10, c);
    ctx.fillCircle(cx, cy, 3, c);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.line(cx, cy, cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 2.5, c);
    }
  },
  grok: (ctx) => {
    providerBadge(ctx, COLORS.grok);
    const c = COLORS.grok;
    const cx = ctx.w / 2;
    const cy = ctx.h / 2;
    ctx.line(cx - 10, cy - 10, cx + 10, cy + 10, 3.5, c);
    ctx.line(cx + 10, cy - 10, cx - 10, cy + 10, 3.5, c);
  },
  cursor: (ctx) => {
    providerBadge(ctx, COLORS.cursor);
    const c = COLORS.cursor;
    ctx.fillPoly([[18, 14], [18, 46], [30, 36], [38, 50], [44, 47], [36, 33], [50, 30]], c);
  },
};

function drawTrayIcon(ctx) {
  const { w, h } = ctx;
  ctx.fill(COLORS.bg);
  const cx = w / 2;
  const cy = h / 2 + 1;
  const r = 5.5;
  for (let a = 0; a < 270; a++) {
    const rad0 = ((a - 90) * Math.PI) / 180;
    const rad1 = ((a - 89) * Math.PI) / 180;
    const col = a < 200 ? COLORS.green : [...COLORS.green.slice(0, 3), 120];
    ctx.line(
      cx + Math.cos(rad0) * r, cy + Math.sin(rad0) * r,
      cx + Math.cos(rad1) * r, cy + Math.sin(rad1) * r,
      1.8, col
    );
  }
  ctx.fillCircle(cx, cy, 1.5, COLORS.green);
  ctx.set(2, 2, [...COLORS.green.slice(0, 3), 180]);
}

function drawAppIcon(ctx) {
  const { w, h } = ctx;
  ctx.fill([10, 10, 11, 255]);
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.32;
  ctx.fillRing(cx, cy, r + 8, r + 4, [...COLORS.green.slice(0, 3), 80]);
  for (let a = 0; a < 270; a++) {
    const rad0 = ((a - 90) * Math.PI) / 180;
    const rad1 = ((a - 88) * Math.PI) / 180;
    const col = a < 200 ? COLORS.green : [...COLORS.green.slice(0, 3), 100];
    ctx.line(
      cx + Math.cos(rad0) * r, cy + Math.sin(rad0) * r,
      cx + Math.cos(rad1) * r, cy + Math.sin(rad1) * r,
      w * 0.04, col
    );
  }
  ctx.fillCircle(cx, cy, w * 0.06, COLORS.green);
  ctx.fillRect(cx - w * 0.22, cy + r + 14, cx + w * 0.22, cy + r + 18, [...COLORS.green.slice(0, 3), 60]);
  ctx.fillRect(cx - w * 0.04, cy + r + 10, cx + w * 0.04, cy + r + 22, COLORS.green);
}

// ── Main ─────────────────────────────────────────────────────
for (const id of Object.keys(DRAW)) {
  const out = path.join(PROVIDERS_DIR, `${id}.png`);
  writePng(out, 64, 64, DRAW[id]);
  console.log('wrote', out);
}

writePng(path.join(ROOT, 'assets', 'tray-icon.png'), 16, 16, drawTrayIcon);
console.log('wrote assets/tray-icon.png');

writePng(path.join(ROOT, 'assets', 'icon.png'), 256, 256, drawAppIcon);
console.log('wrote assets/icon.png');