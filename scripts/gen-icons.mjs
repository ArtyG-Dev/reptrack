/* Generates the PWA icons as PNGs with no image library — just zlib and a
 * hand-rolled PNG chunk writer. Run: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SS = 4;                                   // supersampling factor for smooth edges

const BG = [0x0f, 0x11, 0x15, 255];
const FG = [0x5c, 0xb4, 0xff, 255];

/* ---------- PNG writing ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- drawing ---------- */

function canvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return {
    size,
    buf,
    set(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  };
}

function fillRoundRect(c, x0, y0, w, h, radius, colour) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const r = Math.min(radius, w / 2, h / 2);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      const dx = x < x0 + r ? x0 + r - x : x > x1 - r - 1 ? x - (x1 - r - 1) : 0;
      const dy = y < y0 + r ? y0 + r - y : y > y1 - r - 1 ? y - (y1 - r - 1) : 0;
      if (dx * dx + dy * dy <= r * r) c.set(x, y, colour);
    }
  }
}

function downsample(c, factor) {
  const outSize = c.size / factor;
  const out = Buffer.alloc(outSize * outSize * 4);
  for (let y = 0; y < outSize; y += 1) {
    for (let x = 0; x < outSize; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * c.size + (x * factor + sx)) * 4;
          r += c.buf[i]; g += c.buf[i + 1]; b += c.buf[i + 2]; a += c.buf[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * outSize + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Barbell glyph on a rounded (or full-bleed) background. */
function drawIcon(size, { maskable = false } = {}) {
  const S = size * SS;
  const c = canvas(S);

  if (maskable) fillRoundRect(c, 0, 0, S, S, 0, BG);
  else fillRoundRect(c, 0, 0, S, S, S * 0.22, BG);

  const scale = maskable ? 0.62 : 0.82;          // maskable keeps inside the safe zone
  const cx = S / 2;
  const cy = S / 2;
  const w = S * scale;

  const barH = w * 0.11;
  fillRoundRect(c, cx - w * 0.34, cy - barH / 2, w * 0.68, barH, barH / 2, FG);

  const innerW = w * 0.085;
  const innerH = w * 0.46;
  for (const dir of [-1, 1]) {
    fillRoundRect(c, cx + dir * w * 0.34 - (dir > 0 ? 0 : innerW), cy - innerH / 2, innerW, innerH, innerW * 0.3, FG);
  }

  const outerW = w * 0.07;
  const outerH = w * 0.30;
  for (const dir of [-1, 1]) {
    const x = cx + dir * w * 0.455 - (dir > 0 ? 0 : outerW);
    fillRoundRect(c, x, cy - outerH / 2, outerW, outerH, outerW * 0.3, FG);
  }

  return encodePNG(size, size, downsample(c, SS));
}

const outDir = join(ROOT, 'icons');
mkdirSync(outDir, { recursive: true });

const outputs = [
  ['icon-192.png', drawIcon(192)],
  ['icon-512.png', drawIcon(512)],
  ['icon-maskable-512.png', drawIcon(512, { maskable: true })]
];

for (const [name, data] of outputs) {
  writeFileSync(join(outDir, name), data);
  console.log(`wrote icons/${name} (${data.length} bytes)`);
}
