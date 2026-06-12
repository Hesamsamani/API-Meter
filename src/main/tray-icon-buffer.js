const zlib = require('zlib');

const STATUS_RGB = {
  green: [34, 197, 94],
  amber: [245, 158, 11],
  red: [239, 68, 68],
};

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

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blendPixel(rgba, width, x, y, r, g, b, a = 255) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= width) return;
  const i = (iy * width + ix) * 4;
  const af = Math.max(0, Math.min(1, a / 255));
  if (af >= 0.999) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
    return;
  }
  const dstA = rgba[i + 3] / 255;
  const outA = af + dstA * (1 - af);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * af + rgba[i] * dstA * (1 - af)) / outA);
  rgba[i + 1] = Math.round((g * af + rgba[i + 1] * dstA * (1 - af)) / outA);
  rgba[i + 2] = Math.round((b * af + rgba[i + 2] * dstA * (1 - af)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

function fillDisc(rgba, width, cx, cy, radius, r, g, b, a = 255) {
  const rOut = radius + 1;
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y++) {
    for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + 0.5) continue;
      const cover = smoothstep(radius + 0.6, radius - 0.4, dist);
      blendPixel(rgba, width, x, y, r, g, b, Math.round(a * cover));
    }
  }
}

function fillRoundedRect(rgba, width, height, x, y, w, h, radius, r, g, b, a = 255) {
  const clampRadius = Math.min(radius, w / 2, h / 2);
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      let inside = px >= x && px < x + w && py >= y && py < y + h;
      if (!inside) continue;
      const corners = [
        [x + clampRadius, y + clampRadius],
        [x + w - clampRadius, y + clampRadius],
        [x + clampRadius, y + h - clampRadius],
        [x + w - clampRadius, y + h - clampRadius],
      ];
      for (const [cx, cy] of corners) {
        if (
          (px < x + clampRadius || px >= x + w - clampRadius)
          && (py < y + clampRadius || py >= y + h - clampRadius)
        ) {
          const dx = px + 0.5 - cx;
          const dy = py + 0.5 - cy;
          if (dx * dx + dy * dy > clampRadius * clampRadius) {
            inside = false;
            break;
          }
        }
      }
      if (inside) blendPixel(rgba, width, px, py, r, g, b, a);
    }
  }
}

function angleFromTopDeg(dx, dy) {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function normalizeTopClockwise(angleDeg) {
  return ((angleDeg + 450) % 360);
}

/**
 * @param {Buffer} rgba
 * @param {number} size
 * @param {{ rgb: number[], utilization?: number, variant?: 'tray'|'app' }} opts
 */
function drawMeterIcon(rgba, size, opts) {
  const rgb = opts.rgb || STATUS_RGB.green;
  const utilization = Math.max(0, Math.min(100, Number(opts.utilization) || 0));
  const variant = opts.variant || 'tray';
  const cx = size / 2;
  const cy = size / 2;

  if (variant === 'app') {
    const radius = size * 0.19;
    fillRoundedRect(rgba, size, size, 0, 0, size, size, radius, 8, 10, 14, 255);
    const inset = size * 0.07;
    fillRoundedRect(
      rgba,
      size,
      size,
      inset,
      inset,
      size - inset * 2,
      size - inset * 2,
      radius * 0.9,
      14,
      16,
      22,
      255,
    );
    fillRoundedRect(
      rgba,
      size,
      size,
      inset + 2,
      inset + 2,
      size - (inset + 2) * 2,
      size - (inset + 2) * 2,
      radius * 0.86,
      rgb[0],
      rgb[1],
      rgb[2],
      22,
    );
  }

  const meterScale = variant === 'app' ? 0.34 : 0.38;
  const ringR = size * meterScale;
  const thickness = Math.max(2, size * (variant === 'app' ? 0.075 : 0.17));
  const fillSweep = Math.max(4, (utilization / 100) * 360);
  const box = Math.ceil(ringR + thickness + 2);

  for (let y = Math.floor(cy - box); y <= Math.ceil(cy + box); y++) {
    for (let x = Math.floor(cx - box); x <= Math.ceil(cx + box); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const ringDist = Math.abs(dist - ringR);
      if (ringDist > thickness * 0.55 + 1.2) continue;

      const cover = smoothstep(thickness * 0.58 + 0.8, thickness * 0.42 - 0.4, ringDist);
      if (cover <= 0) continue;

      const angle = normalizeTopClockwise(angleFromTopDeg(dx, dy));
      const onFill = angle <= fillSweep;

      if (onFill) {
        const glow = 0.82 + 0.18 * Math.sin((angle / 180) * Math.PI);
        blendPixel(
          rgba,
          size,
          x,
          y,
          Math.round(rgb[0] * glow),
          Math.round(rgb[1] * glow),
          Math.round(rgb[2] * glow),
          Math.round(255 * cover),
        );
      } else {
        const trackAlpha = variant === 'app' ? 70 : 52;
        blendPixel(rgba, size, x, y, 255, 255, 255, Math.round(trackAlpha * cover));
      }
    }
  }

  const hubR = Math.max(1.5, size * (variant === 'app' ? 0.055 : 0.11));
  fillDisc(rgba, size, cx, cy, hubR * 1.35, rgb[0], rgb[1], rgb[2], 220);
  fillDisc(rgba, size, cx, cy, hubR * 0.72, 248, 250, 252, 235);

  if (variant === 'app' && size >= 64) {
    const tickR = ringR + thickness * 0.35;
    for (let t = 0; t < 12; t++) {
      const a = ((t / 12) * 360 - 90) * (Math.PI / 180);
      const tx = cx + Math.cos(a) * tickR;
      const ty = cy + Math.sin(a) * tickR;
      fillDisc(rgba, size, tx, ty, Math.max(1, size * 0.008), 255, 255, 255, t % 3 === 0 ? 90 : 45);
    }
  }
}

function createTrayIconPng(level = 'green', size = 16, utilization = 0) {
  const rgb = STATUS_RGB[level] || STATUS_RGB.green;
  const rgba = Buffer.alloc(size * size * 4, 0);
  drawMeterIcon(rgba, size, { rgb, utilization, variant: 'tray' });
  return encodePng(size, size, rgba);
}

function createAppIconPng(size = 512, utilization = 38) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  drawMeterIcon(rgba, size, {
    rgb: STATUS_RGB.green,
    utilization,
    variant: 'app',
  });
  return encodePng(size, size, rgba);
}

module.exports = {
  createTrayIconPng,
  createAppIconPng,
  drawMeterIcon,
  STATUS_RGB,
};