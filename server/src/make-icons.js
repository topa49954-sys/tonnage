/* =====================================================================
   Генератор иконок приложения.
   PNG собирается вручную из zlib-потока: рисунок простой, а тянуть ради
   него графическую библиотеку в проект с нулём зависимостей незачем.
   Запуск:  node src/make-icons.js
   ===================================================================== */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'web', 'icons');

const INK = [16, 19, 25];
const CHALK = [255, 255, 255];
const PLATE = [242, 169, 0];

/* прямоугольник со скруглением, координаты в долях стороны */
const rrect = (x, y, w, h, r) => (u, v) => {
  const dx = Math.max(x - u, u - (x + w), 0);
  const dy = Math.max(y - v, v - (y + h), 0);
  if (dx === 0 && dy === 0) return true;
  if (dx > r || dy > r) return false;
  return dx * dx + dy * dy <= r * r;
};

function iconPixels(size, scale) {
  // scale < 1 — запас по краям для maskable-иконки Android
  const s = v => 0.5 + (v - 0.5) * scale;
  const bar    = rrect(s(0.150), s(0.470), 0.700 * scale, 0.060 * scale, 0.030 * scale);
  const inL    = rrect(s(0.255), s(0.330), 0.062 * scale, 0.340 * scale, 0.022 * scale);
  const inR    = rrect(s(0.683), s(0.330), 0.062 * scale, 0.340 * scale, 0.022 * scale);
  const outL   = rrect(s(0.160), s(0.395), 0.055 * scale, 0.210 * scale, 0.020 * scale);
  const outR   = rrect(s(0.785), s(0.395), 0.055 * scale, 0.210 * scale, 0.020 * scale);
  const bg     = rrect(0, 0, 1, 1, 0.22);

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const i = 1 + x * 4;
      let c = null, a = 0;

      if (scale === 1 ? bg(u, v) : true) { c = INK; a = 255; }

      if (bar(u, v) || inL(u, v) || inR(u, v)) { c = CHALK; a = 255; }
      else if (outL(u, v) || outR(u, v)) { c = PLATE; a = 255; }

      if (c) { row[i] = c[0]; row[i + 1] = c[1]; row[i + 2] = c[2]; row[i + 3] = a; }
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size, scale) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(iconPixels(size, scale), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT, { recursive: true });
const made = [];
for (const size of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, 1));
  made.push(`icon-${size}.png`);
}
writeFileSync(join(OUT, 'icon-512-maskable.png'), png(512, 0.72));
made.push('icon-512-maskable.png');
console.log('Иконки готовы:', made.join(', '), '\n→', OUT);
