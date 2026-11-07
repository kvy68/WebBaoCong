#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rCorner = size * 0.22;
  const pad = size * 0.04;
  const half = size / 2 - pad - rCorner;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Signed distance to rounded rect
      const dx = Math.max(Math.abs(x - cx) - half, 0);
      const dy = Math.max(Math.abs(y - cy) - half, 0);
      const dist = Math.hypot(dx, dy) - rCorner;

      if (dist > 0.8) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      const alpha = dist > -0.8 ? Math.round(255 * (0.8 - dist) / 1.6) : 255;

      // Deep Indigo -> Royal Violet gradient background
      const t = (x + y) / (size * 2);
      let r = Math.round(30 + (1 - t) * 69);   // #6366f1 -> #1e1b4b
      let g = Math.round(27 + (1 - t) * 75);
      let b = Math.round(115 + (1 - t) * 126);

      // Subtle inner border glow
      if (dist > -size * 0.03) {
        r = Math.min(255, r + 35);
        g = Math.min(255, g + 35);
        b = Math.min(255, b + 45);
      }

      // Normalized coords [-1, 1]
      const nx = (x - cx) / (size * 0.5);
      const ny = (y - cy) / (size * 0.5);

      // Shield shape in the center
      // Top of shield: ny = -0.52 to 0.05, width = 0.46
      // Bottom of shield tapers to a point at (0, 0.56)
      let inShield = false;
      let shieldEdge = false;
      if (ny >= -0.50 && ny <= 0.55) {
        // Top curve dip
        const topLine = -0.46 + 0.07 * Math.abs(nx / 0.46);
        if (ny >= topLine) {
          let maxW;
          if (ny < 0.0) {
            maxW = 0.46;
          } else {
            const p = ny / 0.55;
            maxW = 0.46 * (1 - p * p * 0.96);
          }
          const ax = Math.abs(nx);
          if (ax <= maxW) {
            inShield = true;
            if (ax > maxW - 0.055 || ny < topLine + 0.055) {
              shieldEdge = true;
            }
          }
        }
      }

      if (inShield) {
        if (shieldEdge) {
          // Gold/Amber rim on shield
          r = 251;
          g = 191;
          b = 36;
        } else if (nx < 0) {
          // Left half of shield: crisp white/ice
          r = 248;
          g = 250;
          b = 252;
        } else {
          // Right half of shield: soft lavender-white for 3D depth
          r = 224;
          g = 231;
          b = 255;
        }

        // Inner checkmark / gear keyhole in Indigo inside the shield
        // Draw a bold "T" crossbar & pillar in the shield center
        const inTopBar = ny >= -0.22 && ny <= -0.10 && Math.abs(nx) <= 0.22;
        const inPillar = ny >= -0.22 && ny <= 0.28 && Math.abs(nx) <= 0.065;
        if (inTopBar || inPillar) {
          r = 67;
          g = 56;
          b = 202;
        }
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = alpha;
    }
  }
  return encodePNG(size, size, buf);
}

const baseDir = path.join(__dirname, 'res');
const targets = [
  ['drawable-mdpi', 48],
  ['drawable-hdpi', 72],
  ['drawable-xhdpi', 96],
  ['drawable-xxhdpi', 144],
  ['drawable-xxxhdpi', 192],
];

for (const [folder, size] of targets) {
  const dir = path.join(baseDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const png = drawIcon(size);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png);
}
console.log('Generated launcher icons successfully.');
