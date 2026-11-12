// Placeholder pictures and image assignment:  node --test scripts/seed/images.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { placeholderPng } from './placeholder.mjs';
import { assignImages, readPools } from './images.mjs';

test('placeholder pictures are valid PNG files of the right size, and the same key always gives the same picture', () => {
  const png = placeholderPng('abc/seed-1.jpg');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.equal(png.readUInt32BE(16), 360); assert.equal(png.readUInt32BE(20), 450);
  const idatAt = png.indexOf('IDAT'); const len = png.readUInt32BE(idatAt - 4);
  const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len)); assert.equal(raw.length, 450 * (1 + 360 * 3), 'decompresses to exactly height x (1 + width x 3) bytes');
  assert.ok(png.subarray(-12).includes('IEND'));
  assert.ok(placeholderPng('abc/seed-1.jpg').equals(png)); assert.ok(!placeholderPng('other').equals(png));
  assert.ok(png.length < 40_000, `small enough to keep storage tiny (${png.length} bytes)`);
});

test('images are matched to gender pools and reused only when a pool runs out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgs-'));
  for (const [sub, n] of [['women', 3], ['men', 2]]) { fs.mkdirSync(path.join(dir, sub)); for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, sub, `${i}.jpg`), 'x'); }
  fs.writeFileSync(path.join(dir, 'men', 'notes.txt'), 'not an image');
  const pools = readPools(dir);
  assert.equal(pools.woman.length, 3); assert.equal(pools.man.length, 2, 'non-image files are ignored'); assert.equal(pools.non_binary.length, 5, 'a pool with no folder falls back to everything');
  const mf = [{ name: 'A', gender: 'woman', photos: ['a/1.jpg', 'a/2.jpg'] }, { name: 'B', gender: 'man', photos: ['b/1.jpg'] }, { name: 'C', gender: 'woman', photos: ['c/1.jpg', 'c/2.jpg'] }, { name: 'D', gender: 'man', photos: ['d/1.jpg', 'd/2.jpg'] }];
  const { plan, reused } = assignImages(mf, pools);
  assert.equal(plan.length, 7); assert.ok(plan.filter((p) => p.dest.startsWith('a/') || p.dest.startsWith('c/')).every((p) => p.src.includes(`${path.sep}women${path.sep}`)));
  assert.ok(plan.filter((p) => p.dest.startsWith('b/') || p.dest.startsWith('d/')).every((p) => p.src.includes(`${path.sep}men${path.sep}`)));
  assert.equal(reused, 2, '4 women photos from 3 pictures reuses 1; 3 men photos from 2 pictures reuses 1');
  assert.ok(plan.every((p) => p.contentType === 'image/jpeg'));
  assert.throws(() => assignImages(mf, { woman: [], man: [], non_binary: [] }), /No pictures found/);
});
