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

const BG_RGB = [10, 10, 11];

function fillBackground(rgba, size) {
  for (let i = 0; i < size * size; i++) {
    const off = i * 4;
    rgba[off] = BG_RGB[0];
    rgba[off + 1] = BG_RGB[1];
    rgba[off + 2] = BG_RGB[2];
    rgba[off + 3] = 255;
  }
}

function drawTrayGauge(rgba, size, rgb) {
  const w = size;
  const h = size;
  fillBackground(rgba, size);
  const set = (x, y, r, g, b, a = 255) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const i = (iy * w + ix) * 4;
    const af = a / 255;
    if (af >= 1) {
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      return;
    }
    const ia = 1 - af;
    rgba[i] = Math.round(r * af + rgba[i] * ia);
    rgba[i + 1] = Math.round(g * af + rgba[i + 1] * ia);
    rgba[i + 2] = Math.round(b * af + rgba[i + 2] * ia);
    rgba[i + 3] = Math.round(255 * (af + rgba[i + 3] / 255 * ia));
  };

  const fillCircle = (cx, cy, radius, r, g, b, a = 255) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) set(x, y, r, g, b, a);
      }
    }
  };

  const cx = w / 2;
  const cy = h / 2;
  const ringR = size * 0.34;
  const thickness = Math.max(2, size * 0.14);

  for (let a = 0; a < 270; a++) {
    const rad0 = ((a - 90) * Math.PI) / 180;
    const rad1 = ((a - 88) * Math.PI) / 180;
    const x0 = cx + Math.cos(rad0) * ringR;
    const y0 = cy + Math.sin(rad0) * ringR;
    const x1 = cx + Math.cos(rad1) * ringR;
    const y1 = cy + Math.sin(rad1) * ringR;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, rgb[0], rgb[1], rgb[2]);
    }
  }

  fillCircle(cx, cy, Math.max(1.5, size * 0.1), rgb[0], rgb[1], rgb[2]);
}

function createTrayIconPng(level = 'green', size = 16) {
  const rgb = STATUS_RGB[level] || STATUS_RGB.green;
  const rgba = Buffer.alloc(size * size * 4, 0);
  drawTrayGauge(rgba, size, rgb);
  return encodePng(size, size, rgba);
}

module.exports = { createTrayIconPng, STATUS_RGB };