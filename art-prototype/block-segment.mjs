// Block segmentation — carve the board into its road-enclosed city blocks.
//
// The blocks are the internal faces of the street graph, so they're computed,
// not eyeballed: half-edge face tracing over the board's edges (using the real
// traced street geometry), outer face discarded. Output:
//
//   <outBase>-blocks.png   numbered block diagram over the base map — the
//                          segmentation Steven approves before any art is made
//   <outBase>-blocks.json  per block: interior polygon (canvas px), pixel
//                          bounding box, grid cells, contained landmarks, and
//                          a coarse content inventory from the baked scene
//
//   node art-prototype/block-segment.mjs <board.json> [outBase]
//     (default outBase: art-prototype/out/reference — matches the other tools)
//
// Frame math mirrors reference-render.mjs / BoardCanvas BACKDROP_FIT.island.

import { readFileSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const ISLAND_BLOB = { x0: 0.085, x1: 0.943, y0: 0.154, y1: 0.91 };
const SHORE_M = 60;
const CELL_M = 120;
const INSET_M = 19; // street centerline → block interior (casing 13 + sidewalk 6)

const [, , boardPath, outBase = 'art-prototype/out/reference'] = process.argv;
if (!boardPath) {
  console.error('usage: node art-prototype/block-segment.mjs <board.json> [outBase]');
  process.exit(1);
}
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
let scene = null;
try {
  scene = JSON.parse(readFileSync('public/art/scene.json', 'utf8'));
} catch {
  /* content inventory sections just stay empty */
}

// --- frame ------------------------------------------------------------------
const lats = board.boundary.map((p) => p.lat);
const lngs = board.boundary.map((p) => p.lng);
const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
const kx = Math.cos((midLat * Math.PI) / 180) * 111320;
const ky = 111320;
const bWm = (Math.max(...lngs) - Math.min(...lngs)) * kx;
const bHm = (Math.max(...lats) - Math.min(...lats)) * ky;
const FW = (bWm + 2 * SHORE_M) / (ISLAND_BLOB.x1 - ISLAND_BLOB.x0);
const FH = (bHm + 2 * SHORE_M) / (ISLAND_BLOB.y1 - ISLAND_BLOB.y0);
const padL = FW * ISLAND_BLOB.x0 + SHORE_M;
const padT = FH * ISLAND_BLOB.y0 + SHORE_M;
const minLng = Math.min(...lngs) - padL / kx;
const maxLat = Math.max(...lats) + padT / ky;
const W = FW, H = FH;
const X = (p) => (p.lng - minLng) * kx;
const Y = (p) => (maxLat - p.lat) * ky;

// --- planar face tracing ----------------------------------------------------
const byId = new Map(board.squares.map((s) => [s.id, s]));
// Directed half-edges with real street geometry.
const halves = new Map(); // key "edgeId:dir" -> { from, to, pts:[[x,y]..], key, rev }
for (const e of board.edges ?? []) {
  const A = byId.get(e.from), B = byId.get(e.to);
  if (!A || !B) continue;
  const path = (e.path?.length ? e.path : [A, B]).map((p) => [X(p), Y(p)]);
  halves.set(`${e.id}:f`, { from: e.from, to: e.to, pts: path, key: `${e.id}:f`, rev: `${e.id}:r` });
  halves.set(`${e.id}:r`, { from: e.to, to: e.from, pts: [...path].reverse(), key: `${e.id}:r`, rev: `${e.id}:f` });
}
// Outgoing half-edges per node, each with its departure angle.
const out = new Map();
for (const h of halves.values()) {
  const [x0, y0] = h.pts[0];
  const [x1, y1] = h.pts[Math.min(1, h.pts.length - 1)];
  h.ang = Math.atan2(y1 - y0, x1 - x0);
  if (!out.has(h.from)) out.set(h.from, []);
  out.get(h.from).push(h);
}
for (const list of out.values()) list.sort((a, b) => a.ang - b.ang);
// Next half-edge around a face: at h.to, take the smallest CCW turn from the
// reversed arrival direction (classic left-hand face walk).
function nextHalf(h) {
  const rev = halves.get(h.rev);
  const cands = out.get(h.to) ?? [];
  if (cands.length === 1) return cands[0]; // dead end → U-turn
  let best = null, bestDelta = Infinity;
  for (const c of cands) {
    if (c.key === h.rev) continue;
    let d = c.ang - rev.ang;
    while (d <= 0) d += Math.PI * 2;
    while (d > Math.PI * 2) d -= Math.PI * 2;
    if (d < bestDelta) { bestDelta = d; best = c; }
  }
  return best ?? rev;
}
const seen = new Set();
const faces = [];
for (const h0 of halves.values()) {
  if (seen.has(h0.key)) continue;
  const ring = [];
  let h = h0, guard = 0;
  do {
    seen.add(h.key);
    ring.push(...h.pts.slice(0, -1));
    h = nextHalf(h);
  } while (h && h.key !== h0.key && ++guard < 500);
  if (!h || guard >= 500) continue;
  // signed area (y down: CW in screen = positive here)
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  faces.push({ ring, area: a / 2 });
}
// Interior faces: one orientation; the outer face is the lone opposite-signed
// giant. Keep the majority sign, drop anything tiny (degenerate slivers).
const sign = Math.sign(faces.reduce((s, f) => s + Math.sign(f.area), 0)) || 1;
const blocksRaw = faces
  .filter((f) => Math.sign(f.area) === sign && Math.abs(f.area) > 1500)
  .sort((a, b) => {
    const ca = centroid(a.ring), cb = centroid(b.ring);
    return ca[1] - cb[1] || ca[0] - cb[0]; // number them top-to-bottom, then left-to-right
  });
function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cr = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cr;
    cx += (ring[j][0] + ring[i][0]) * cr;
    cy += (ring[j][1] + ring[i][1]) * cr;
  }
  a /= 2;
  return a ? [cx / (6 * a), cy / (6 * a)] : ring[0];
}
// Drop near-collinear vertices (traced street curves add dozens) so the
// bisector offset only works with real corners.
function simplifyRing(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const o = ring[(i - 1 + n) % n], p = ring[i], q = ring[(i + 1) % n];
    const v1 = norm([p[0] - o[0], p[1] - o[1]]);
    const v2 = norm([q[0] - p[0], q[1] - p[1]]);
    const turn = Math.abs(v1[0] * v2[1] - v1[1] * v2[0]); // |sin(angle)|
    if (turn > 0.15) out.push(p);
  }
  return out.length >= 3 ? out : ring;
}
// Inward inset along corner bisectors. The inward side is determined
// empirically per face (offset a test point both ways, keep the one that
// lands inside) — no winding bookkeeping to get backwards.
function inset(ringRaw, m) {
  const ring = simplifyRing(ringRaw);
  const n = ring.length;
  // pick the direction empirically on the longest segment
  let li = 0, ll = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > ll) { ll = l; li = i; }
  }
  const p0 = ring[li], q0 = ring[(li + 1) % n];
  const sv = norm([q0[0] - p0[0], q0[1] - p0[1]]);
  const mx = (p0[0] + q0[0]) / 2, my = (p0[1] + q0[1]) / 2;
  const dir = pointIn(ringRaw, mx + sv[1] * 6, my - sv[0] * 6) ? 1 : -1;
  const outR = [];
  for (let i = 0; i < n; i++) {
    const o = ring[(i - 1 + n) % n], p = ring[i], q = ring[(i + 1) % n];
    const v1 = norm([p[0] - o[0], p[1] - o[1]]);
    const v2 = norm([q[0] - p[0], q[1] - p[1]]);
    const n1 = [dir * v1[1], -dir * v1[0]];
    const n2 = [dir * v2[1], -dir * v2[0]];
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by);
    if (bl < 0.05) { bx = n1[0]; by = n1[1]; } // hairpin: fall back to one normal
    const [ux, uy] = norm([bx, by]);
    // miter length so both edges shift by m; clamped to keep corners sane
    const cosHalf = Math.max(0.45, Math.hypot(n1[0] + n2[0], n1[1] + n2[1]) / 2);
    const d = Math.min(m / cosHalf, m * 2.2);
    outR.push([p[0] + ux * d, p[1] + uy * d]);
  }
  return outR;
}
const norm = ([x, y]) => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
function pointIn(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- per-block content (landmarks + coarse inventory) -----------------------
const HERO_NAME = { 'st-hedwig': "ST. HEDWIG'S", hero_wolskis: "WOLSKI'S", gloriosos: "GLORIOSO'S" };
const landmarks = (scene?.standing ?? [])
  .filter((e) => e.t === 'img' || e.label)
  .map((e) => ({
    name: e.t === 'img' ? HERO_NAME[Object.keys(HERO_NAME).find((k) => (e.href || '').includes(k))] ?? 'HERO' : e.label,
    x: X(e),
    y: Y(e),
  }));
const CAT = [
  [/polish_flat|bungalow|duplex|bldg\.res|house/, 'houses'],
  [/apartment/, 'apartments'],
  [/storefront|mixed_use|com\.row|corner_tavern|bldg\.com/, 'commercial'],
  [/church|school/, 'civic'],
  [/tree_/, 'trees'],
  [/basketball|tennis|baseball|playground/, 'recreation'],
];
const colName = (c) => String.fromCharCode(65 + c);
const cellOf = (x, y) => `${colName(Math.max(0, Math.min(Math.ceil(W / CELL_M) - 1, Math.floor(x / CELL_M))))}${Math.max(1, Math.floor(y / CELL_M) + 1)}`;

const { width: pxW, height: pxH } = await sharp('art-prototype/out/reference.png').metadata();
const PXx = (v) => Math.round((v * pxW) / W);
const PXy = (v) => Math.round((v * pxH) / H);

const blocks = blocksRaw.map((f, i) => {
  const poly = inset(f.ring, INSET_M);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [cx, cy] = centroid(f.ring);
  const inv = {};
  for (const e of scene?.standing ?? []) {
    if (e.t === 'img' || e.label) continue;
    const x = X(e), y = Y(e);
    if (!pointIn(f.ring, x, y)) continue;
    const cat = CAT.find(([re]) => re.test(e.ref || ''));
    if (cat) inv[cat[1]] = (inv[cat[1]] ?? 0) + 1;
  }
  const lms = landmarks.filter((L) => pointIn(f.ring, L.x, L.y)).map((L) => L.name);
  const cells = [...new Set(f.ring.filter((_, k) => k % 3 === 0).map(([x, y]) => cellOf(x, y)))].sort();
  return {
    id: `block_${String(i + 1).padStart(2, '0')}`,
    bboxPx: { x1: PXx(Math.min(...xs)), y1: PXy(Math.min(...ys)), x2: PXx(Math.max(...xs)), y2: PXy(Math.max(...ys)) },
    polygonPx: poly.map(([x, y]) => [PXx(x), PXy(y)]),
    centroidPx: [PXx(cx), PXy(cy)],
    cells,
    landmarks: lms,
    inventory: inv,
    areaM2: Math.round(Math.abs(f.area)),
  };
});

// --- numbered diagram over the base map -------------------------------------
const HUES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
let o = '';
blocksRaw.forEach((f, i) => {
  const poly = inset(f.ring, INSET_M);
  const pts = poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [cx, cy] = centroid(f.ring);
  const col = HUES[i % HUES.length];
  o += `<polygon points="${pts}" fill="${col}" opacity="0.32" stroke="${col}" stroke-width="3"/>`;
  o += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="21" fill="#ffffff" opacity="0.95" stroke="#111827" stroke-width="2.5"/>`;
  o += `<text x="${cx.toFixed(1)}" y="${(cy + 7).toFixed(1)}" font-size="20" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#111827">${i + 1}</text>`;
});
const basePng = await sharp('art-prototype/out/reference.png').png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${pxW}" height="${pxH}">${o}</svg>`;
await sharp(basePng).composite([{ input: Buffer.from(svg) }]).toFile(`${outBase}-blocks.png`);

writeFileSync(`${outBase}-blocks.json`, JSON.stringify({ canvas: { width: pxW, height: pxH }, blocks }, null, 1));
console.log(`traced ${blocks.length} blocks → ${outBase}-blocks.png + ${outBase}-blocks.json`);
console.log(blocks.map((b) => `${b.id}: cells ${b.cells.join(',')}${b.landmarks.length ? ' · ' + b.landmarks.join(', ') : ''}`).join('\n'));
