// Assembly compositor for the block-asset pipeline.
//
// EVERY delivered painting is kept. A block accumulates versions in its own
// folder and one of them is chosen; nothing is ever overwritten, so a version
// you liked three attempts ago is still there to go back to.
//
//   art-prototype/blocks/block-NN/
//     v1.png v2.png v3.png    every painting ever delivered for this block
//     selected                which one the board is built from
//
// Each chosen version is clipped by its kit stencil and placed at its kit
// position on the untouched base, so the roads can never move.
//
//   block-compose.mjs                    rebuild the board from the chosen
//                                        versions → out/board-painted.png
//   block-compose.mjs add <N> [file]     file a new version (default: the
//                                        newest "ChatGPT Image*" in
//                                        Downloads), choose it, rebuild
//   block-compose.mjs use <N> <v>        choose a different version, rebuild
//   block-compose.mjs versions [N]       list what exists, chosen one marked
//   block-compose.mjs compare <N>        contact sheet of every version of
//                                        that block, composited in place and
//                                        cropped, side by side with labels →
//                                        out/block-NN-versions.png
//
// Kit files (stencil + place.json) must exist for every block — run
// block-kit.mjs first. Base: art-prototype/out/reference.png.

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, statSync, rmSync } from 'fs';
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

// --- version store ----------------------------------------------------------
const dirOf = (nn) => `${BLOCKS_DIR}/block-${nn}`;
/** '21' -> '21', '21a' -> '21a'; sliver blocks are painted in two halves. */
const blockId = (s) => {
  const m = /^(\d+)([ab])?$/.exec(String(s).trim());
  return m ? String(Number(m[1])).padStart(2, '0') + (m[2] ?? '') : String(s);
};
const statTime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
/** Versions of a block, oldest first: ['v1','v2',...]. */
function versionsOf(nn) {
  if (!existsSync(dirOf(nn))) return [];
  return readdirSync(dirOf(nn))
    .map((f) => /^v(\d+)\.png$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
    .map((n) => `v${n}`);
}
/** The version the board is built from — the newest unless one was chosen. */
function selectedOf(nn) {
  const all = versionsOf(nn);
  if (!all.length) return null;
  const f = `${dirOf(nn)}/selected`;
  if (existsSync(f)) {
    const want = readFileSync(f, 'utf8').trim();
    if (all.includes(want)) return want;
  }
  return all[all.length - 1];
}
const select = (nn, v) => writeFileSync(`${dirOf(nn)}/selected`, `${v}\n`);
const artPath = (nn) => `${dirOf(nn)}/${selectedOf(nn)}.png`;

// One-time migration from the old flat layout, where each block was a single
// file and a new delivery overwrote the last one.
for (const f of readdirSync(BLOCKS_DIR)) {
  const m = /^block-(\d\d)\.png$/.exec(f);
  if (!m) continue;
  const nn = m[1];
  mkdirSync(dirOf(nn), { recursive: true });
  const next = versionsOf(nn).length + 1;
  copyFileSync(`${BLOCKS_DIR}/${f}`, `${dirOf(nn)}/v${next}.png`);
  rmSync(`${BLOCKS_DIR}/${f}`);
  select(nn, `v${next}`);
  console.log(`migrated block ${nn} → ${dirOf(nn)}/v${next}.png`);
}

const known = () =>
  readdirSync(BLOCKS_DIR)
    .map((f) => /^block-(\d\d[ab]?)$/.exec(f)) // sliver blocks come in halves: 21a, 21b
    .filter(Boolean)
    .map((m) => m[1])
    .filter((nn) => versionsOf(nn).length)
    .sort();

const usage = `usage:
  block-compose.mjs                  rebuild the board from the chosen versions
  block-compose.mjs add <N> [file]   file a new version and choose it
  block-compose.mjs use <N> <v>      choose a version (e.g. use 13 v2)
  block-compose.mjs versions [N]     list versions, chosen one marked
  block-compose.mjs compare <N>      contact sheet of every version, in place`;

if (mode === 'versions') {
  const list = rest[0] ? [blockId(rest[0])] : known();
  for (const nn of list) {
    const sel = selectedOf(nn);
    console.log(
      `block ${nn}: ${versionsOf(nn).map((v) => (v === sel ? `[${v}]` : ` ${v} `)).join(' ')}` +
        `${versionsOf(nn).length > 1 ? '   ([chosen])' : ''}`,
    );
  }
  process.exit(0);
}

if (mode === 'use') {
  const nn = blockId(rest[0]);
  const v = rest[1];
  if (!rest[0] || !v) { console.error(usage); process.exit(1); }
  if (!versionsOf(nn).includes(v)) {
    console.error(`block ${nn} has no ${v} — it has ${versionsOf(nn).join(', ') || 'nothing'}`);
    process.exit(1);
  }
  select(nn, v);
  console.log(`block ${nn}: now using ${v}`);
  judgeBlock = nn;
} else if (mode === 'add') {
  if (!rest[0]) { console.error(usage); process.exit(1); }
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
  const nn = blockId(rest[0]);
  if (!existsSync(KIT(nn).place)) {
    console.error(`no kit for block ${rest[0]} — run: node art-prototype/block-kit.mjs <board.json> ${rest[0]}`);
    process.exit(1);
  }
  mkdirSync(dirOf(nn), { recursive: true });
  const v = `v${versionsOf(nn).length + 1}`;
  const meta = await sharp(src).metadata();
  // Blocks have distinctive canvas ratios, so a delivery that fits some other
  // block far better than this one is almost certainly being filed against the
  // wrong number — easy to do when several downloads land minutes apart.
  {
    const ratio = meta.width / meta.height;
    const fitOf = (b) => {
      const p = JSON.parse(readFileSync(KIT(b).place, 'utf8'));
      return Math.abs(ratio / (p.workCanvas[0] / p.workCanvas[1]) - 1);
    };
    const mine = fitOf(nn);
    let best = nn, bestFit = mine;
    for (const f of readdirSync(OUT)) {
      const m2 = /^reference-block-(\d\d)-place\.json$/.exec(f);
      if (!m2) continue;
      const fit = fitOf(m2[1]);
      if (fit < bestFit) { bestFit = fit; best = m2[1]; }
    }
    if (best !== nn && mine > 0.08) {
      warnings.push(
        `block ${nn}: this image is ${(mine * 100).toFixed(0)}% off block ${nn}'s canvas but only ` +
          `${(bestFit * 100).toFixed(0)}% off block ${Number(best)}'s — is it actually block ${Number(best)}? ` +
          `Filed as block ${nn} ${v}; delete ${dirOf(nn)}/${v}.png if that was a mistake.`,
      );
    }
  }
  copyFileSync(src, `${dirOf(nn)}/${v}.png`);
  select(nn, v);
  console.log(`filed block ${nn} ${v} (${meta.width}×${meta.height}) — ${versionsOf(nn).length} version(s) kept`);
  judgeBlock = nn;
} else if (mode === 'compare') {
  await compareVersions(blockId(rest[0]));
  process.exit(0);
} else if (mode) {
  console.error(usage);
  process.exit(1);
}

// --- composite every filed block --------------------------------------------
const filed = known();
if (!filed.length) {
  console.log('nothing filed in art-prototype/blocks/ yet');
  process.exit(0);
}
/**
 * Contact sheet: every version of one block, each composited onto the real map
 * in its real place and cropped the same way, side by side and labelled — so
 * versions are judged where they will actually live rather than as loose
 * pictures. The chosen one is marked.
 */
async function compareVersions(nn) {
  const all = versionsOf(nn);
  if (!all.length) { console.error(`block ${nn} has no versions yet`); return; }
  const kit = KIT(nn);
  const place = JSON.parse(readFileSync(kit.place, 'utf8'));
  const mask = await sharp(kit.stencil).resize(place.w, place.h, { kernel: 'nearest' }).png().toBuffer();
  const sel = selectedOf(nn);
  const M = 40;
  const cx1 = Math.max(0, place.x - M), cy1 = Math.max(0, place.y - M);
  const cw = Math.min(place.base[0], place.x + place.w + M) - cx1;
  const ch = Math.min(place.base[1], place.y + place.h + M) - cy1;
  const SCALE = ch > 420 ? 1 : 2; // keep tall blocks readable without a huge sheet
  const panels = [];
  for (const v of all) {
    const art = await sharp(`${dirOf(nn)}/${v}.png`).resize(place.w, place.h).png().toBuffer();
    // how much of the block this version actually painted — a low number is
    // why one panel has a clean kerb and another a smeared fringe
    const aRaw = await sharp(art).ensureAlpha().raw().toBuffer();
    const mRaw = await sharp(mask).ensureAlpha().raw().toBuffer();
    let need = 0, have = 0;
    for (let i = 0; i < place.w * place.h; i++) {
      if (mRaw[i * 4 + 3] < 128) continue;
      need++;
      if (aRaw[i * 4 + 3] >= 128) have++;
    }
    const covered = ((100 * have) / need).toFixed(0);
    const bled = await bleedToStencil(art, mask, place.w, place.h, `${nn} ${v}`, true);
    const clipped = await sharp(bled).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const board = await sharp(`${OUT}/reference.png`).composite([{ input: clipped, left: place.x, top: place.y }]).png().toBuffer();
    const crop = await sharp(board).extract({ left: cx1, top: cy1, width: cw, height: ch }).resize(cw * SCALE).png().toBuffer();
    const m = await sharp(crop).metadata();
    const chosen = v === sel;
    const label = `${v}   ${covered}% painted${chosen ? '   ← chosen' : ''}`;
    panels.push(
      await sharp(crop)
        .extend({ top: 36, bottom: 6, left: 6, right: 6, background: chosen ? '#16a34a' : '#1f2937' })
        .composite([
          {
            input: Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width + 12}" height="36">` +
                `<text x="10" y="26" font-size="24" font-family="Arial" font-weight="bold" fill="#ffffff">${label}</text></svg>`,
            ),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer(),
    );
  }
  const pm = await sharp(panels[0]).metadata();
  const gap = 12;
  const out = `${OUT}/block-${nn}-versions.png`;
  await sharp({
    create: { width: pm.width * panels.length + gap * (panels.length - 1), height: pm.height, channels: 4, background: '#0f172a' },
  })
    .composite(panels.map((p, i) => ({ input: p, left: i * (pm.width + gap), top: 0 })))
    .png()
    .toFile(out);
  console.log(`block ${nn}: ${all.length} version(s), chosen ${sel} → ${out}`);
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
/**
 * Some deliveries come back with an opaque WHITE background behind a rounded
 * block shape instead of transparency. The stencil then faithfully keeps that
 * white, and it lands on the board as bright wedges in the block's corners —
 * and the bleed can't help, because as far as it can tell the pixel is
 * painted. So: flood in from the border over near-white pixels only, and
 * knock them back to transparent for the bleed to fill properly.
 */
function dropWhiteBackground(art, w, h) {
  const nearWhite = (i) => {
    const r = art[i * 4], g = art[i * 4 + 1], b = art[i * 4 + 2];
    // bright AND essentially colourless — the cream sidewalk (216,199,143) has a
    // strong yellow cast and is never caught by this
    return art[i * 4 + 3] >= 128 && r >= 238 && g >= 238 && b >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 9;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  let dropped = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !nearWhite(p)) continue;
    seen[p] = 1;
    art[p * 4 + 3] = 0;
    dropped++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return dropped;
}

async function bleedToStencil(artPng, maskPng, w, h, nn, quiet = false) {
  const art = await sharp(artPng).ensureAlpha().raw().toBuffer();
  const whited = dropWhiteBackground(art, w, h);
  if (whited && !quiet) console.log(`  block ${nn}: dropped ${whited}px of white background the delivery painted behind the block`);
  // How much of the block the delivery actually covered, measured BEFORE the
  // deliberate trim below — this is the quality signal worth watching, and
  // folding our own trim into it would make every block look worse than it is.
  const maskPre = await sharp(maskPng).ensureAlpha().raw().toBuffer();
  let asDelivered = 0, stencilPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (maskPre[i * 4 + 3] < 128) continue;
    stencilPx++;
    if (art[i * 4 + 3] < 128) asDelivered++;
  }
  // Shave the outermost ring of the delivery and let the bleed rebuild it from
  // the colour just inside. The very edge of a delivered painting is where the
  // junk lives — anti-aliased halos, a leftover pale fringe, the last of a
  // white background — and regrowing it costs nothing visually.
  {
    const TRIM = 2;
    let edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (art[i * 4 + 3] < 128) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { edge[i] = 1; continue; }
        if (art[(i - 1) * 4 + 3] < 128 || art[(i + 1) * 4 + 3] < 128 ||
            art[(i - w) * 4 + 3] < 128 || art[(i + w) * 4 + 3] < 128) edge[i] = 1;
      }
    for (let pass = 0; pass < TRIM; pass++) {
      const next = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (edge[i]) art[i * 4 + 3] = 0;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (art[i * 4 + 3] < 128) continue;
          if (art[(i - 1) * 4 + 3] < 128 || art[(i + 1) * 4 + 3] < 128 ||
              art[(i - w) * 4 + 3] < 128 || art[(i + w) * 4 + 3] < 128) next[i] = 1;
        }
      edge = next;
    }
  }
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
  // one ring per pass, so a deep gap on a big block needs as many passes as it
  // is pixels deep — a fixed 40 left block 4 with a bare strip
  const maxPasses = Math.max(40, Math.ceil(Math.max(w, h) / 2));
  for (let pass = 0; pass < maxPasses && bare; pass++) {
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
  if (!quiet)
    console.log(
      `  block ${nn}: delivery covered ${(100 - (100 * asDelivered) / stencilPx).toFixed(1)}% of the block` +
        `${bare ? `, ${bare}px still bare after bleeding` : ``}`,
    );
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
  const src = await sharp(artPath(nn)).metadata();
  const want = place.workCanvas[0] / place.workCanvas[1];
  const got = src.width / src.height;
  const off = Math.abs(got / want - 1);
  const flipped = got > 1 !== want > 1;
  const shape = (r) => `${r.toFixed(2)}:1 ${r > 1 ? 'landscape' : 'portrait'}`;
  // Image models rarely hit an arbitrary ratio exactly, and a couple of percent
  // of stretch is invisible — only shout when the art would actually deform.
  if (flipped || off > 0.08) {
    warnings.push(
      `block ${nn}: delivered ${src.width}×${src.height} (${shape(got)}) but the kit asked for ` +
        `${place.workCanvas.join('×')} (${shape(want)}) — fitting it squashes every building by ~${Math.round(off * 100)}%.` +
        `${flipped ? ' The ORIENTATION is flipped, which no amount of scaling fixes.' : ''} Regenerate rather than accept.`,
    );
  } else if (off > 0.02) {
    console.log(`  block ${nn}: aspect off by ${(off * 100).toFixed(1)}% — harmless, art fitted as delivered`);
  }
  const art = await sharp(artPath(nn)).resize(place.w, place.h).png().toBuffer();
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
