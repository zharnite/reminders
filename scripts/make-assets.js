'use strict';

// Generates assets/tray.png, assets/icon.png and assets/chime.wav with no dependencies.
// Run: npm run assets

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

// ---------- PNG ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Green circle with a white water drop. Coordinates normalized to [-1, 1].
function shade(x, y) {
  const r = Math.hypot(x, y);
  if (r > 0.96) return null;
  const inDropCircle = Math.hypot(x, y - 0.18) <= 0.4;
  let inDropTip = false;
  // Straight sides tangent to the circle: tip at y=-0.62, 30° half-angle, meets circle at y=-0.02.
  if (y >= -0.62 && y <= -0.02) {
    inDropTip = Math.abs(x) <= Math.tan(Math.PI / 6) * (y + 0.62);
  }
  if (inDropCircle || inDropTip) return [255, 255, 255];
  const t = (y + 1) / 2; // vertical gradient
  return [Math.round(36 - 10 * t), Math.round(170 - 30 * t), Math.round(120 - 20 * t)];
}

function drawIcon(size) {
  const SS = 4; // supersampling
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = shade(x, y);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, buf);
}

fs.writeFileSync(path.join(OUT, 'tray.png'), drawIcon(32));
fs.writeFileSync(path.join(OUT, 'icon.png'), drawIcon(256));

// ---------- Chime (soft two-note bell, ~1.3s) ----------
const RATE = 44100;
const DUR = 1.3;
const N = Math.round(RATE * DUR);
const samples = new Float32Array(N);
function note(freq, start, decay, gain) {
  const s0 = Math.round(start * RATE);
  for (let i = s0; i < N; i++) {
    const t = (i - s0) / RATE;
    const attack = Math.min(1, t / 0.012);
    const env = attack * Math.exp(-t / decay);
    samples[i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(2 * Math.PI * freq * 2 * t));
  }
}
note(659.25, 0, 0.35, 0.28); // E5
note(987.77, 0.16, 0.45, 0.22); // B5
const wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + N * 2, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) {
  const fadeOut = Math.min(1, (N - i) / (RATE * 0.05));
  const v = Math.max(-1, Math.min(1, samples[i] * fadeOut));
  wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
fs.writeFileSync(path.join(OUT, 'chime.wav'), wav);

console.log('Wrote assets/tray.png, assets/icon.png, assets/chime.wav');
