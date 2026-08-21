// Assembly compositor for the block-asset pipeline.
//
// Delivered block paintings live in art-prototype/blocks/ as block-NN.png
// (any resolution — they're resized to the block's true bbox; aspect must
// match the kit's canvas within 2%). Each is clipped by its kit stencil and
// placed at its kit position on the untouched base, so roads can't move.
//
//   node art-prototype/block-compose.mjs add <blockNum> [imageFile]
//     File a delivered painting: copies imageFile (default: the newest
//     "ChatGPT Image*" in Downloads) to art-prototype/blocks/block-NN.png,
//     then recomposites. Warns if the aspect ratio is off.
//
//   node art-prototype/block-compose.mjs
//     Recomposite everything in art-prototype/blocks/ onto the base →
//       art-prototype/out/board-painted.png        full painted board
//       art-prototype/out/board-painted-crop-NN.png  2× judging crop of the
//                                                    newest/last block added
//
// Kit files (stencil + place.json) must exist for every filed block — run
// block-kit.mjs first. Base: art-prototype/out/reference.png.

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

const OUT = 'art-prototype/out';
const BLOCKS_DIR = 'art-prototype/blocks';
const KIT = (nn) => ({
  stencil: `art-prototype/kits/block-${nn}/block-${nn}-canvas.png`,
  place: `${OUT}/reference-block-${nn}-place.json`,
});
mkdirSync(BLOCKS_DIR, { recursive: true });

const [, , mode, ...rest] = process.argv;
let judgeBlock = null; // crop this one for review at the end
// held to the end of the run: a warning printed before a wall of progress
// output is a warning nobody reads
const warnings = [];

if (mode === 'add') {
  const num = Number(rest[0]);
  if (!num) {
    console.error('usage: node art-prototype/block-compose.mjs add <blockNum> [imageFile]');
    process.exit(1);
  }
  let src = rest[1];
  if (!src) {
    const dl = join(homedir(), 'Downloads');
    const cands = readdirSync(dl)
      .filter((f) => /^ChatGPT Image.*\.png$/i.test(f))
      .map((f) => ({ f, t: statTime(join(dl, f)) }))
      .sort((a, b) => b.t - a.t);
    if (!cands.length) {
      console.error(`no "ChatGPT Image*.png" found in ${dl} — pass the file path explicitly`);
      process.exit(1);
    }
    src = join(dl, cands[0].f);
    console.log(`using newest download: ${cands[0].f}`);
  }
  const nn = String(num).padStart(2, '0');
  const kit = KIT(nn);
  if (!existsSync(kit.place)) {
    console.error(`no kit for block ${num} — run: node art-prototype/block-kit.mjs <board.json> ${num}`);
    process.exit(1);
  }
  const meta = await sharp(src).metadata();
  copyFileSync(src, `${BLOCKS_DIR}/block-${nn}.png`);
  console.log(`filed ${BLOCKS_DIR}/block-${nn}.png (${meta.width}×${meta.height})`);
  judgeBlock = nn;
} else if (mode) {
  console.error('usage: node art-prototype/block-compose.mjs [add <blockNum> [imageFile]]');
  process.exit(1);
}

function statTime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// --- composite every filed block --------------------------------------------
const filed = readdirSync(BLOCKS_DIR)
  .map((f) => /^block-(\d\d)\.png$/.exec(f))
  .filter(Boolean)
  .map((m) => m[1])
  .sort();
if (!filed.length) {
  console.log('nothing filed in art-prototype/blocks/ yet');
  process.exit(0);
}
/**
 * Grow the delivered art outward into any stencil area it left bare.
 *
 * Image models hand back a rounded "card" with a margin rather than a shape
 * filled corner to corner, which would leave a strip of bare base map between
 * the art and the road — the exact moat the stencil was widened to remove. So
 * push the outermost painted pixels outward, one ring per pass, until the
 * stencil is covered. It only ever repeats colour already at the edge (grass,
 * sidewalk, hedge), so it reads as the art continuing to the kerb.
 */
async function bleedToStencil(artPng, maskPng, w, h, nn) {
  const art = await sharp(artPng).ensureAlpha().raw().toBuffer();
  const mask = await sharp(maskPng).ensureAlpha().raw().toBuffer();
  const inStencil = (i) => mask[i * 4 + 3] >= 128;
  const painted = new Uint8Array(w * h);
  let bare = 0;
  for (let i = 0; i < w * h; i++) {
    painted[i] = art[i * 4 + 3] >= 128 ? 1 : 0;
    if (inStencil(i) && !painted[i]) bare++;
  }
  if (!bare) return artPng;
  const before = bare;
  for (let pass = 0; pass < 40 && bare; pass++) {
    const snapshot = painted.slice(); // sample last pass only, so growth stays even
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (painted[i] || !inStencil(i)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!snapshot[q]) continue;
          art[i * 4] = art[q * 4];
          art[i * 4 + 1] = art[q * 4 + 1];
          art[i * 4 + 2] = art[q * 4 + 2];
          art[i * 4 + 3] = 255;
          painted[i] = 1;
          bare--;
          break;
        }
      }
    }
  }
  const pct = ((before / (w * h)) * 100).toFixed(1);
  console.log(`  block ${nn}: art left ${before}px (${pct}% of bbox) of the stencil bare — bled to fill${bare ? `, ${bare}px still bare` : ''}`);
  return sharp(art, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

const layers = [];
for (const nn of filed) {
  const kit = KIT(nn);
  if (!existsSync(kit.place) || !existsSync(kit.stencil)) {
    console.error(`skipping block ${nn}: kit files missing (run block-kit.mjs ${Number(nn)})`);
    continue;
  }
  const place = JSON.parse(readFileSync(kit.place, 'utf8'));
  // re-checked on every run, not just on `add` — a block delivered in the
  // wrong shape stays wrong, and silence would let it ship
  const src = await sharp(`${BLOCKS_DIR}/block-${nn}.png`).metadata();
  const want = place.workCanvas[0] / place.workCanvas[1];
  const got = src.width / src.height;
  if (Math.abs(got / want - 1) > 0.02) {
    const shape = (r) => `${r.toFixed(2)}:1 ${r > 1 ? 'landscape' : 'portrait'}`;
    warnings.push(
      `block ${nn}: delivered ${src.width}×${src.height} (${shape(got)}) but the kit asked for ` +
        `${place.workCanvas.join('×')} (${shape(want)}) — fitting it squashes every building by ~${Math.round(Math.abs(got / want - 1) * 100)}%.` +
        `${got > 1 !== want > 1 ? ' The ORIENTATION is flipped, which no amount of scaling fixes.' : ''} Regenerate rather than accept.`,
    );
  }
  const art = await sharp(`${BLOCKS_DIR}/block-${nn}.png`).resize(place.w, place.h).png().toBuffer();
  const mask = await sharp(kit.stencil).resize(place.w, place.h, { kernel: 'nearest' }).png().toBuffer();
  const bled = await bleedToStencil(art, mask, place.w, place.h, nn);
  const clipped = await sharp(bled).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  layers.push({ input: clipped, left: place.x, top: place.y });
}
const painted = await sharp(`${OUT}/reference.png`).composite(layers).png().toBuffer();
writeFileSync(`${OUT}/board-painted.png`, painted);
console.log(`composited ${layers.length} block(s) → ${OUT}/board-painted.png`);

// 2× judging crop of the block just added (or the last filed one)
const nn = judgeBlock ?? filed[filed.length - 1];
const place = JSON.parse(readFileSync(KIT(nn).place, 'utf8'));
const M = 90;
const cx1 = Math.max(0, place.x - M), cy1 = Math.max(0, place.y - M);
const cw = Math.min(place.base[0], place.x + place.w + M) - cx1;
const chh = Math.min(place.base[1], place.y + place.h + M) - cy1;
const crop = await sharp(painted).extract({ left: cx1, top: cy1, width: cw, height: chh }).png().toBuffer();
await sharp(crop).resize(cw * 2).png().toFile(`${OUT}/board-painted-crop-${nn}.png`);
console.log(`judging crop → ${OUT}/board-painted-crop-${nn}.png`);

if (warnings.length) {
  console.error(`\n${'='.repeat(70)}\n⚠  WRONG CANVAS SHAPE — DO NOT SHIP THIS BLOCK\n${'='.repeat(70)}`);
  for (const w of warnings) console.error(`   ${w}`);
  console.error('');
}
