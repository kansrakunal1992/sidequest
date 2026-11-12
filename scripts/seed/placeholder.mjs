// Plain placeholder portraits (a soft gradient with a simple head-and-shoulders shape) as PNG files, made with no libraries.
// They are obviously not real photos. They exist so the whole photo pipeline can be tested before real images are ready.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** key decides the colours, so the same profile always gets the same picture. */
export function placeholderPng(key, w = 360, h = 450) {
  const d = crypto.createHash('sha256').update(key).digest();
  const hue = (n) => [60 + (d[n] % 140), 60 + (d[n + 1] % 140), 70 + (d[n + 2] % 150)];
  const top = hue(0), bottom = hue(3), skin = mix([205, 160, 130], hue(6), 0.15), cloth = mix(hue(9), [40, 40, 60], 0.35);
  const cx = w / 2, headY = h * 0.38, headR = w * 0.17, shY = h * 0.78;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3); raw[row] = 0;
    for (let x = 0; x < w; x++) {
      let c = mix(top, bottom, y / h);
      const inHead = ((x - cx) / headR) ** 2 + ((y - headY) / (headR * 1.25)) ** 2 <= 1;
      const inShoulders = ((x - cx) / (w * 0.42)) ** 2 + ((y - shY) / (h * 0.3)) ** 2 <= 1;
      const inNeck = Math.abs(x - cx) < headR * 0.38 && y > headY && y < headY + headR * 1.7;
      if (inShoulders) c = cloth; if (inNeck) c = skin; if (inHead) c = skin;
      const o = row + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
