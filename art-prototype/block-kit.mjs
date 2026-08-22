// Per-block production kit for the block-asset pipeline.
//
// For one road-bounded block (numbering identical to block-segment.mjs) emit
// everything ChatGPT needs to illustrate that block as a drop-in transparent
// asset, plus what our compositor needs to place it.
//
// The files to HAND TO CHATGPT land together in their own folder,
// art-prototype/kits/block-NN/ — drag the whole folder into a FRESH chat (the
// brief is written to stand alone, so a retry never inherits a failed attempt):
//
//   block-NN-brief.md      the art brief — self-contained: what the project is,
//                          what is attached, exact canvas size and orientation,
//                          the points of interest with positions and sizes,
//                          fabric guidance from the baked scene, don'ts, and a
//                          closing checklist
//   block-NN-canvas.png    the stencil at WORK_SCALE× the block's exact pixel
//                          bbox — white = the block we keep, rest is cut away
//   block-NN-context.png   crop of the base map around the block, paintable
//                          area washed red, streets labelled. Orientation only
//   block-NN-layout.png    (landmark blocks) the block outline with each point
//                          of interest boxed and numbered where it belongs
//   block-NN-style-...png  a landmark-free housing swatch: brushwork to match
//   block-NN-<slug>-...png (some landmarks) our approved painting of that
//                          building, for identity — not for its camera
//
// Plus, for our tooling only:
//   <outBase>-block-NN-place.json   bbox + position, read by block-compose.mjs
//
//   node art-prototype/block-kit.mjs <board.json> <blockNumber> [outBase]
//     (default outBase: art-prototype/out/reference — matches the other tools)
//
// Needs art-prototype/out/streets-named.json (named OSM ways w/ geometry) for
// street names; regenerate with the Overpass query in the error hint below.
// Frame math mirrors reference-render.mjs / block-segment.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import sharp from 'sharp';

const ISLAND_BLOB = { x0: 0.085, x1: 0.943, y0: 0.154, y1: 0.91 };
const SHORE_M = 60;
const WORK_SCALE = 4; // ChatGPT paints at 4×; compositor downscales to exact bbox
const CTX_MARGIN = 110; // px of surroundings shown in the context crop

const argv = process.argv.slice(2);
const half = argv.find((a) => a === 'a' || a === 'b') ?? null; // sliver blocks are painted in halves
const [boardPath, blockNumArg, outBase = 'art-prototype/out/reference'] = argv.filter((a) => a !== 'a' && a !== 'b');
if (!boardPath || !blockNumArg) {
  console.error('usage: node art-prototype/block-kit.mjs <board.json> <blockNumber> [a|b] [outBase]');
  process.exit(1);
}
const blockNum = Number(blockNumArg);
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const scene = JSON.parse(readFileSync('public/art/scene.json', 'utf8'));
const osm = JSON.parse(readFileSync('data/osm_raw.json', 'utf8'));
const STREETS_PATH = 'art-prototype/out/streets-named.json';
if (!existsSync(STREETS_PATH)) {
  console.error(
    `missing ${STREETS_PATH} — fetch once with Overpass:\n` +
      `  [out:json];way["highway"]["name"](43.0505,-87.9045,43.0575,-87.8935);out geom;\n` +
      `and save as [{name, highway, geometry:[[lat,lon]..]}, ..]`
  );
  process.exit(1);
}
const namedWays = JSON.parse(readFileSync(STREETS_PATH, 'utf8'));

// --- frame (identical to block-segment.mjs) ---------------------------------
const lats = board.boundary.map((p) => p.lat);
const lngs = board.boundary.map((p) => p.lng);
const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
const kx = Math.cos((midLat * Math.PI) / 180) * 111320;
const ky = 111320;
const bWm = (Math.max(...lngs) - Math.min(...lngs)) * kx;
const bHm = (Math.max(...lats) - Math.min(...lats)) * ky;
const W = (bWm + 2 * SHORE_M) / (ISLAND_BLOB.x1 - ISLAND_BLOB.x0);
const H = (bHm + 2 * SHORE_M) / (ISLAND_BLOB.y1 - ISLAND_BLOB.y0);
const padL = W * ISLAND_BLOB.x0 + SHORE_M;
const padT = H * ISLAND_BLOB.y0 + SHORE_M;
const minLng = Math.min(...lngs) - padL / kx;
const maxLat = Math.max(...lats) + padT / ky;
const X = (p) => (p.lng - minLng) * kx;
const Y = (p) => (maxLat - p.lat) * ky;

// --- face tracing (identical to block-segment.mjs) --------------------------
const byId = new Map(board.squares.map((s) => [s.id, s]));
const halves = new Map();
for (const e of board.edges ?? []) {
  const A = byId.get(e.from), B = byId.get(e.to);
  if (!A || !B) continue;
  const path = (e.path?.length ? e.path : [A, B]).map((p) => [X(p), Y(p)]);
  halves.set(`${e.id}:f`, { from: e.from, to: e.to, pts: path, key: `${e.id}:f`, rev: `${e.id}:r` });
  halves.set(`${e.id}:r`, { from: e.to, to: e.from, pts: [...path].reverse(), key: `${e.id}:r`, rev: `${e.id}:f` });
}
const out = new Map();
for (const h of halves.values()) {
  const [x0, y0] = h.pts[0];
  const [x1, y1] = h.pts[Math.min(1, h.pts.length - 1)];
  h.ang = Math.atan2(y1 - y0, x1 - x0);
  if (!out.has(h.from)) out.set(h.from, []);
  out.get(h.from).push(h);
}
for (const list of out.values()) list.sort((a, b) => a.ang - b.ang);
function nextHalf(h) {
  const rev = halves.get(h.rev);
  const cands = out.get(h.to) ?? [];
  if (cands.length === 1) return cands[0];
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
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  faces.push({ ring, area: a / 2 });
}
const sign = Math.sign(faces.reduce((s, f) => s + Math.sign(f.area), 0)) || 1;
const blocksRaw = faces
  .filter((f) => Math.sign(f.area) === sign && Math.abs(f.area) > 1500)
  .sort((a, b) => {
    const ca = centroid(a.ring), cb = centroid(b.ring);
    return ca[1] - cb[1] || ca[0] - cb[0];
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
function pointIn(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- the chosen block -------------------------------------------------------
if (blockNum < 1 || blockNum > blocksRaw.length) {
  console.error(`block ${blockNum} out of range 1..${blocksRaw.length}`);
  process.exit(1);
}
const face = blocksRaw[blockNum - 1];
const [ccx, ccy] = centroid(face.ring);
const base = await sharp('art-prototype/out/reference.png').raw().toBuffer({ resolveWithObject: true });
const pxW = base.info.width, pxH = base.info.height, nCh = base.info.channels;
const mPerBasePx = W / pxW;
const PXx = (v) => (v * pxW) / W;
const PXy = (v) => (v * pxH) / H;

// The paintable region is the block interior AS RENDERED — everything between
// the surrounding sidewalks — so trace it straight off the base map: flood
// fill from the block centroid over interior (green) pixels. Streets, sidewalk
// bands, casings and spot markers all fail the green test and act as barriers.
const isInterior = (x, y) => {
  const i = (y * pxW + x) * nCh;
  const r = base.data[i], g = base.data[i + 1], b = base.data[i + 2];
  return g > r - 4 && g - b > 35;
};
const maskBits = new Uint8Array(pxW * pxH);
{
  // Seed from a GRID of points across the whole ring, not just the centroid.
  // A single seed silently traced a fragment when a rendered feature split the
  // block's green into separate regions — block 1's stencil covered 38% of the
  // block, its brief placed Fink's at canvas px (1537, 0) on an 804-wide
  // canvas, and the delivery filled the fragment with one pub and a car park.
  // Every green region whose seed lies inside the ring belongs to the block.
  const stack = [];
  const step = Math.max(4, Math.round(8 / mPerBasePx));
  const rxs = face.ring.map((q) => q[0]), rys = face.ring.map((q) => q[1]);
  const gx1 = Math.max(0, Math.floor(PXx(Math.min(...rxs)))), gx2 = Math.min(pxW - 1, Math.ceil(PXx(Math.max(...rxs))));
  const gy1 = Math.max(0, Math.floor(PXy(Math.min(...rys)))), gy2 = Math.min(pxH - 1, Math.ceil(PXy(Math.max(...rys))));
  for (let y = gy1; y <= gy2; y += step)
    for (let x = gx1; x <= gx2; x += step) {
      if (maskBits[y * pxW + x] || !isInterior(x, y)) continue;
      if (!pointIn(face.ring, (x * W) / pxW, (y * H) / pxH)) continue;
      maskBits[y * pxW + x] = 1;
      stack.push(y * pxW + x);
    }
  if (!stack.length) {
    console.error('no block-interior green found inside this block\'s ring — cannot trace it');
    process.exit(1);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % pxW, y = (p / pxW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= pxW || ny >= pxH) continue;
      const q = ny * pxW + nx;
      if (!maskBits[q] && isInterior(nx, ny)) { maskBits[q] = 1; stack.push(q); }
    }
  }
  // Grow across the sidewalk band so the art borders the street itself — no
  // moat between road and block art. Expand into sidewalk-toned pixels, stop
  // at the road (sand + spots are bright, g > 205) and at the dark casing
  // stroke (r < 190), which stays visible as the street's own outline.
  const growable = (x, y) => {
    const i = (y * pxW + x) * nCh;
    const r = base.data[i], g = base.data[i + 1];
    return r >= 190 && g <= 205;
  };
  let frontier = [];
  for (let p = 0; p < maskBits.length; p++) if (maskBits[p]) frontier.push(p);
  for (let it = 0; it < 40 && frontier.length; it++) {
    const next = [];
    for (const p of frontier) {
      const x = p % pxW, y = (p / pxW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= pxW || ny >= pxH) continue;
        const q = ny * pxW + nx;
        if (!maskBits[q] && growable(nx, ny)) { maskBits[q] = 1; next.push(q); }
      }
    }
    frontier = next;
  }
  // Close pinholes: anti-aliased pixels that fail both color tests leave tiny
  // transparent specks. Flood the OUTSIDE from the image border across
  // non-mask pixels; whatever non-mask remains is enclosed → part of the art.
  const outside = new Uint8Array(pxW * pxH);
  const ostack = [];
  for (let x = 0; x < pxW; x++) { ostack.push(x, (pxH - 1) * pxW + x); }
  for (let y = 0; y < pxH; y++) { ostack.push(y * pxW, y * pxW + pxW - 1); }
  for (const p of ostack) if (!maskBits[p]) outside[p] = 1;
  while (ostack.length) {
    const p = ostack.pop();
    if (!outside[p]) continue;
    const x = p % pxW, y = (p / pxW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= pxW || ny >= pxH) continue;
      const q = ny * pxW + nx;
      if (!outside[q] && !maskBits[q]) { outside[q] = 1; ostack.push(q); }
    }
  }
  for (let p = 0; p < maskBits.length; p++) if (!maskBits[p] && !outside[p]) maskBits[p] = 1;
}

// A "block" in the street graph can turn out to be two or more real blocks with
// a road between them — block 1 is a wedge and a rectangle either side of North
// Marshall, and tracing them as one asked for a canvas whose middle is a street.
// Split the traced area into its separate pieces so each is painted on its own.
const pieces = [];
{
  const seen = new Uint8Array(pxW * pxH);
  for (let p = 0; p < maskBits.length; p++) {
    if (!maskBits[p] || seen[p]) continue;
    const cells = [p];
    seen[p] = 1;
    const stack = [p];
    while (stack.length) {
      const q = stack.pop();
      const x = q % pxW, y = (q / pxW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= pxW || ny >= pxH) continue;
        const r = ny * pxW + nx;
        if (maskBits[r] && !seen[r]) { seen[r] = 1; cells.push(r); stack.push(r); }
      }
    }
    if (cells.length > 400) pieces.push(cells); // ignore specks
  }
  // left-to-right, then top-to-bottom, so the letters are stable between runs
  pieces.sort((A, B) => {
    const ax = A.reduce((s, i) => s + (i % pxW), 0) / A.length, bx = B.reduce((s, i) => s + (i % pxW), 0) / B.length;
    const ay = A.reduce((s, i) => s + ((i / pxW) | 0), 0) / A.length, by = B.reduce((s, i) => s + ((i / pxW) | 0), 0) / B.length;
    return ax - bx || ay - by;
  });
}
const SPLIT_PIECES = pieces.length > 1;
if (SPLIT_PIECES) {
  if (!half) {
    console.error(
      `block ${blockNum} is really ${pieces.length} separate blocks with a road between them — ` +
        `generate them individually: ${pieces.map((_, i) => `${blockNum}${'ab'[i] ?? i}`).join(', ')}`,
    );
    process.exit(1);
  }
  const keep = pieces['ab'.indexOf(half)];
  if (!keep) {
    console.error(`block ${blockNum} has no piece "${half}" — it has ${pieces.length}`);
    process.exit(1);
  }
  const only = new Uint8Array(pxW * pxH);
  for (const i of keep) only[i] = 1;
  maskBits.set(only);
}
let bx1 = pxW, by1 = pxH, bx2 = 0, by2 = 0, maskArea = 0;
for (let y = 0; y < pxH; y++)
  for (let x = 0; x < pxW; x++)
    if (maskBits[y * pxW + x]) {
      maskArea++;
      if (x < bx1) bx1 = x;
      if (x > bx2) bx2 = x;
      if (y < by1) by1 = y;
      if (y > by2) by2 = y;
    }
bx2++; by2++; // exclusive

// Some blocks are slivers — three of them are around 0.32:1, and an image
// model will not go past about 1:2, so it hands back 0.60 and everything gets
// squashed by 80-90% on the way in. Those blocks are painted in two halves
// instead, split across the long axis, each half a shape a model can actually
// produce. Pass `a` or `b` as the third argument.
if (half && !SPLIT_PIECES) {
  const tall = by2 - by1 >= bx2 - bx1;
  if (tall) {
    const mid = Math.round((by1 + by2) / 2);
    if (half === 'a') by2 = mid; else by1 = mid;
  } else {
    const mid = Math.round((bx1 + bx2) / 2);
    if (half === 'a') bx2 = mid; else bx1 = mid;
  }
}
const bw = bx2 - bx1, bh = by2 - by1;
const inMask = (px, py) => {
  const xi = Math.round(px), yi = Math.round(py);
  return xi >= 0 && yi >= 0 && xi < pxW && yi < pxH && maskBits[yi * pxW + xi] === 1;
};
// on this block — and, when painting a half, in this half of it
const inThisPiece = (lat, lng) => {
  const px = PXx(X({ lng })), py = PXy(Y({ lat }));
  return pointIn(face.ring, X({ lng }), Y({ lat })) && px >= bx1 && px < bx2 && py >= by1 && py < by2;
};
const mPerPx = W / pxW; // base-canvas meters per pixel
const mPerWorkPx = mPerPx / WORK_SCALE;
const nn = String(blockNum).padStart(2, '0');
const id = `block-${nn}${half ?? ''}`;
// the three shareable files live together, ready to drag into a chat
const kitDir = `art-prototype/kits/${id}`;
mkdirSync(kitDir, { recursive: true });
// Stale extras (a renamed landmark leaves its old reference image behind, and
// it would be handed to ChatGPT next to the current one) are swept at the END
// of the run, once we know what we actually wrote. Deleting up front raced the
// rewrite of the same filename and intermittently killed the run on Windows.
const written = new Set(['brief.md', 'canvas.png', 'context.png']);
const share = (suffix) => { written.add(suffix); return `${kitDir}/${id}-${suffix}`; };
// local work-canvas coords (WORK_SCALE× the bbox, origin at bbox top-left)
const LX = (v) => (PXx(v) - bx1) * WORK_SCALE;
const LY = (v) => (PXy(v) - by1) * WORK_SCALE;

// --- bounding streets by compass --------------------------------------------
// Sample the raw ring (street centerlines) every ~25 m, match each sample to
// the nearest named OSM way, then place each street on a compass side by the
// direction of its matched samples from the block centroid.
const waySegs = [];
for (const w of namedWays) {
  const pts = w.geometry.map(([la, lo]) => [X({ lng: lo }), Y({ lat: la })]);
  for (let i = 0; i + 1 < pts.length; i++) waySegs.push({ name: w.name, a: pts[i], b: pts[i + 1] });
}
function segDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}
const streetHits = new Map(); // name -> [angle..]
const ringPts = face.ring;
for (let i = 0; i < ringPts.length; i++) {
  const p = ringPts[i], q = ringPts[(i + 1) % ringPts.length];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  for (let d = 0; d <= len; d += 25) {
    const t = len ? d / len : 0;
    const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    let best = null, bd = 25; // within 25 m of a named centerline
    for (const seg of waySegs) {
      const dist = segDist(s, seg.a, seg.b);
      if (dist < bd) { bd = dist; best = seg.name; }
    }
    if (best) {
      if (!streetHits.has(best)) streetHits.set(best, []);
      streetHits.get(best).push(Math.atan2(s[1] - ccy, s[0] - ccx));
    }
  }
}
const COMPASS = (ang) => {
  const deg = ((ang * 180) / Math.PI + 360) % 360; // 0=east, 90=south (y down)
  if (deg >= 315 || deg < 45) return 'East';
  if (deg < 135) return 'South';
  if (deg < 225) return 'West';
  return 'North';
};
const sides = { North: [], East: [], South: [], West: [] };
for (const [name, angs] of streetHits) {
  if (angs.length < 2) continue; // brushed a corner, not a real side
  const mx = angs.reduce((s, a) => s + Math.cos(a), 0), my = angs.reduce((s, a) => s + Math.sin(a), 0);
  sides[COMPASS(Math.atan2(my, mx))].push(name);
}

// --- contents ---------------------------------------------------------------
const SPECIES = {
  fab_tree_linden_1: 'linden', fab_tree_maple_1: 'maple', fab_tree_honeylocust_1: 'honeylocust',
  fab_tree_elm_mature_1: 'mature elm (landmark size)', fab_tree_oak_1: 'oak', fab_tree_flowering_1: 'flowering ornamental',
};
const FABRIC = [
  [/fab_polish_flat|res\.polish_flat/, 'Polish flat'],
  [/fab_bungalow|res\.bungalow/, 'bungalow'],
  [/fab_duplex|res\.duplex/, 'duplex'],
  [/res\.house|res\.rowhouse/, 'house'],
  [/res\.garage/, 'detached garage (alley side)'],
  [/res\.shed/, 'shed'],
  [/apartment/, 'apartment building'],
  [/corner_tavern/, 'corner tavern'],
  [/storefront/, 'storefront'],
  [/mixed_use/, 'mixed-use commercial (shops below, flat above)'],
  [/com\.row/, 'storefront row'],
  [/civ\.church/, 'church'],
  [/civ\.school/, 'school'],
  [/furniture\.hydrant/, 'fire hydrant'],
  [/furniture\.bench/, 'bench'],
  [/furniture\.bus_stop/, 'bus stop'],
  [/furniture\.bike_rack/, 'bike rack'],
  [/furniture\.trash_can/, 'trash can'],
  [/furniture\.flagpole/, 'flagpole'],
  [/furniture\.picnic_table/, 'picnic table'],
  [/vehicle\.parked_car/, 'parked car'],
  [/tree_conifer/, 'conifer (yard)'],
];
const friendly = (ref) => {
  if (SPECIES[ref]) return `${SPECIES[ref]} tree`;
  const hit = FABRIC.find(([re]) => re.test(ref));
  return hit ? hit[1] : ref;
};
const inBlock = (e) => pointIn(face.ring, X(e), Y(e));
const entries = scene.standing.filter(inBlock);
const fabric = {};
for (const e of entries) {
  if (e.t === 'img' || e.label) continue;
  const f = friendly(e.ref);
  fabric[f] = (fabric[f] ?? 0) + 1;
}
const propCounts = {};
for (const p of scene.props ?? []) {
  const pt = p.pts[Math.floor(p.pts.length / 2)];
  if (pointIn(face.ring, X({ lng: pt[1] }), Y({ lat: pt[0] }))) propCounts[p.k] = (propCounts[p.k] ?? 0) + 1;
}
// named real-world places on the block, straight from OSM
const namedPois = [];
for (const grp of ['pois', 'leisure']) {
  for (const e of osm[grp]?.elements ?? []) {
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    if (la == null || !e.tags?.name) continue;
    // test against the traced interior, not the street-centerline ring — nodes
    // sitting on the surrounding streets/sidewalks are not part of the art
    if (inMask(PXx(X({ lng: lo })), PXy(Y({ lat: la }))) && inThisPiece(la, lo)) {
      namedPois.push({
        name: e.tags.name,
        what: e.tags.amenity ?? e.tags.shop ?? e.tags.building ?? e.tags.leisure ?? '',
        px: [Math.round(LX(X({ lng: lo }))), Math.round(LY(Y({ lat: la })))],
      });
    }
  }
}

// --- landmark prominence ----------------------------------------------------
// A landmark painted at its real size disappears into the fabric — which is
// exactly what happened on the block 11 pilot. So the brief asks for it
// OVERSIZED: the true OSM footprint (measured below) times a factor, with a
// cleared halo around it and every neighbour deliberately quieter. One focal
// point per block.
const HERO_EVICT_M = { "ST. HEDWIG'S": 30, "GLORIOSO'S": 24, "WOLSKI'S": 20 };
const DEFAULT_EVICT_M = 18;
// What makes each landmark stand tall — phrased in ITS OWN vocabulary. A
// generic list mentioning a "spire" was enough to grow a church on the tavern
// block, three times over: the word is the instruction, and negations ("not a
// church") plant it just as firmly. Never name a building type a block hasn't
// got.
const VERTICAL_CUE = {
  "ST. HEDWIG'S": 'its tower and spire, the tallest thing for blocks around',
  "GLORIOSO'S": 'the tall flat parapet of the old theatre, standing above its neighbours',
  "WOLSKI'S": 'a steep front gable and a brick chimney, riding above the houses beside it',
};
const DEFAULT_CUE =
  'a bolder, taller roofline than anything beside it — a raised corner, a deep sign band, a chimney';

/** Real footprint of the building at a point: the smallest oriented box that
 * contains its OSM polygon, in metres. Falls back to the nearest building
 * centroid within 30 m (POI nodes often sit just off their outline). */
function footprintAt(lat, lng) {
  const px = X({ lng }), py = Y({ lat });
  let best = null, bestD = Infinity;
  for (const w of osm.buildings?.elements ?? []) {
    if (!w.geometry?.length) continue;
    const ring = w.geometry.map((g) => [X({ lng: g.lon }), Y({ lat: g.lat })]);
    if (pointIn(ring, px, py)) { best = ring; bestD = 0; break; }
    let cx = 0, cy = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; }
    const d = Math.hypot(cx / ring.length - px, cy / ring.length - py);
    if (d < bestD) { bestD = d; best = ring; }
  }
  if (!best || bestD > 30) return null;
  let min = null;
  for (let deg = 0; deg < 90; deg += 5) {
    const t = (deg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
    const xs = best.map((p) => p[0] * cs + p[1] * sn);
    const ys = best.map((p) => -p[0] * sn + p[1] * cs);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (!min || w * h < min.w * min.h) min = { w, h };
  }
  // long side first — that is the dimension the brief quotes as "wide"
  return { wM: Math.max(min.w, min.h), hM: Math.min(min.w, min.h) };
}

/**
 * Nudge a landmark's anchor until its exaggerated footprint fits inside the
 * block. Real anchors sit at the entrance, often metres from a kerb, and a
 * building painted 1.8× at that exact spot hangs over the street edge and gets
 * sliced off by the stencil — which is what happened to the tavern on the
 * narrow corner of block 13. Returns the nearest anchor that fits, in base px.
 */
function fitAnchor(px, py, boxW, boxH, maxR = 14) {
  const halfW = boxW / 2, halfH = boxH / 2;
  const fits = (x, y) => {
    for (let sx = -1; sx <= 1; sx++) {
      for (let sy = -1; sy <= 1; sy++) {
        if (!inMask(x + sx * halfW * 0.85, y + sy * halfH * 0.85)) return false;
      }
    }
    return true;
  };
  if (fits(px, py)) return { x: px, y: py, moved: 0 };
  // deliberately a short leash (~8 m): these are corner businesses, and a
  // landmark shuffled to the middle of the block is a worse lie than a
  // landmark painted a size smaller. Shrinking is tried first by the caller.
  for (let r = 2; r <= maxR; r += 2) {
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      const x = px + Math.cos(t) * r, y = py + Math.sin(t) * r;
      if (fits(x, y)) return { x, y, moved: r };
    }
  }
  return { x: px, y: py, moved: -1 }; // block genuinely too tight — brief says so
}

/**
 * How big to paint a point of interest, in work-canvas px, plus its halo.
 * Sizes come from the reviewed POI table rather than from whatever polygon the
 * map happened to attach to a node — those matches went wrong often enough
 * (Jamo's once measured 9 × 3 m, a shed) to be worth stating by hand.
 */
function prominence(poi, poiCount) {
  const [trueW, trueH] = poi.sizeM;
  const toPx = (m) => Math.round(m / mPerWorkPx);
  const blockWm = bw * mPerPx;
  // A park is already the size it is: painted at life size, not exaggerated.
  if (poi.kind === 'park') {
    return {
      trueW, trueH,
      factor: '1.0',
      pxW: toPx(trueW), pxH: toPx(trueH),
      haloPx: 0, evictM: 0,
      pctBlock: Math.round((trueW / blockWm) * 100),
    };
  }
  const big = trueW >= 35; // church, market, brewery: already commanding
  const base = big ? 1.4 : 1.8; // small corner buildings need the bigger push
  const cap = big ? 1.6 : 2.2; // past this a building stops looking like itself
  // A lone landmark spanning less than a third of its block won't read as the
  // focal point, so push it there — but never past the cap: Wolski's is a
  // little wood cottage, and blown up 3× it reads as a different building.
  const floorFactor = poiCount === 1 ? (blockWm * 0.32) / trueW : 0;
  const scale = Math.min(cap, Math.max(base, floorFactor));
  return {
    trueW, trueH,
    factor: scale.toFixed(1),
    pxW: toPx(trueW * scale),
    pxH: toPx(trueH * scale),
    haloPx: toPx(poi.evict),
    evictM: poi.evict,
    pctBlock: Math.round(((trueW * scale) / blockWm) * 100),
  };
}

// --- landmark identity notes (the "POI descriptions") -----------------------
// Keyed by hero/label name; blocks whose landmarks aren't written up yet get a
// TODO line in the brief. Full source: art-prototype/HERO_PACKETS.md +
// art-prototype/grounding/.
// THE POINTS OF INTEREST — the definitive set, chosen by Steven, reviewed
// against the map in art-prototype/POI_LIST.md (edit the descriptions there
// and mirror them here). These are the places players walk to, so they are the
// only buildings that get exaggerated size, a cleared halo and a box on the
// layout plan. Every other named business is described as an ordinary building
// in the "Other named places" list.
//
//   name    what the sign says, and what the brief calls it
//   at      [lat, lng] of the real thing
//   kind    'building' | 'park' | 'house' — drives sizing and wording
//   sizeM   [long, short] painted footprint in metres, before exaggeration;
//           for a park, the area it should occupy
//   evict   metres of clear ground around it
//   cue     how it stands tall, in ITS OWN vocabulary (never name a building
//           type a block hasn't got — a stray "spire" grew a church once)
//   desc    the identity paragraph, straight from POI_LIST.md
//   ref     optional approved painting shipped as an identity reference
const POINTS_OF_INTEREST = [
  {
    name: "St Hedwig's",
    short: "the cream-brick church with the green spire",
    at: [43.053174, -87.897631],
    kind: 'building',
    sizeM: [48, 26],
    evict: 30,
    cue: 'its tower and spire, the tallest thing for blocks around',
    ref: 'art-prototype/heroes/st-hedwig-v2.png',
    desc: `**Saint Hedwig Catholic Church** (1888, Henry Messmer) — the visual crest of Brady Street.
   - **Cream city brick** body (pale, warm, buttery yellow-cream — NOT red brick), stone trim, round-arched Romanesque windows.
   - One tall central tower carrying a **copper-patina-green spire**, with a slightly bulbous Eastern-European swell where spire meets tower. It is the tallest thing on the whole board.
   - **Long axis east–west**: tower and main doors at the WEST end facing Humboldt, the tall gabled nave running back EAST.
   - Palette: cream body, patina-green spire, brown-grey slate roof, pale stone trim, dark wood doors, blue-purple stained glass.`,
  },
  {
    name: "Glorioso's Italian Market",
    short: "the old theatre turned Italian market",
    at: [43.052838, -87.899352],
    kind: 'building',
    sizeM: [40, 30],
    evict: 24,
    cue: 'the tall flat parapet of the old theatre, standing above its neighbours',
    ref: 'art-prototype/heroes/gloriosos-v1.png',
    desc: `**Glorioso's Italian Market**, in the former **Astor Theatre** (1913, architect Myers E. Becongia) — an old movie house turned Italian grocery, and the biggest commercial mass on Brady Street. Wide, low theatre massing with a tall flat parapet, clearly bigger and flatter-topped than its neighbours. Light **stucco** body, a long run of storefront glass along Brady, a bold horizontal **GLORIOSO'S** sign band (readable text allowed), and Italian tricolour — green, white, red — in the awnings.`,
  },
  {
    name: "Wolski's Tavern",
    short: "the little wooden corner tavern",
    at: [43.055231, -87.896601],
    kind: 'building',
    sizeM: [18, 13],
    evict: 20,
    cue: 'a steep front gable and a brick chimney, riding above the houses beside it',
    ref: 'art-prototype/heroes/wolskis-v2.png',
    desc: `**Wolski's Tavern** (a bar since 1908 in an 1895 house) — a house that became a tavern, and the most beloved dive in the neighbourhood. Front-gabled two-storey **wood** building, light clapboard siding, dark roof, domestic proportions — small and wooden where everything near it is brick. A painted **WOLSKI'S** signboard band across the first floor (readable text allowed), warm amber windows, a couple of sidewalk picnic tables. Its charm is its modesty: characterful, not grand.`,
  },
  {
    name: 'Pulaski Street Playfield',
    short: "the park with the softball diamond",
    at: [43.05541, -87.8961],
    kind: 'park',
    sizeM: [150, 75],
    evict: 0,
    cue: 'the openness itself — no building interrupts it',
    desc: `**Pulaski Street Playfield**, the neighbourhood's green lung and a game challenge site — the one block on the board where the eye rests. Laid out west to east:
   - a colourful **playground** at the north-west corner, play structures on pale sand, paths curling through
   - a **hard court** immediately east of it: deep red/maroon surface with white painted lines, the brightest colour on the block
   - a broad **open green lawn** through the middle
   - **Pulaski Softball Field** at the east end: a big tan skinned infield with its diamond and backstop, grass outfield around it
   - mature shade trees along the edges, benches, a picnic table
   Openness is the point — **no buildings inside the park**, and the green should read as generous and public from right across the board.`,
  },
  {
    name: "Fink's",
    short: "the small single-storey corner bar",
    at: [43.056064, -87.898304],
    kind: 'building',
    sizeM: [18, 7],
    evict: 18,
    cue: 'a bold painted gable front standing up over the sidewalk',
    desc: `**Fink's** — a small **single-storey front-gabled** corner bar, long and narrow, sitting right up on the sidewalk. The building dates to 1894 and has been six other taverns since (Listwan's, Al Hauke's, Baldy's, Mama Roux, the Red Room). Modest and neighbourly rather than grand: a painted **FINK'S** sign board across the gable front (readable text allowed), warm lit windows, a door on the corner.`,
  },
  {
    name: 'Red Lion Pub',
    short: "the long two-storey brick pub",
    at: [43.055323, -87.90096],
    kind: 'building',
    sizeM: [43, 11],
    evict: 20,
    cue: 'a long flat brick roofline, wider than anything else on the block',
    desc: `**The Red Lion Pub on Tannery Row** — a long two-storey **brick** commercial block from 1890, by far the widest building here at 43 m, shopfront below and apartments above. It was the **Gettleman Brewery** in 1911 and still looks it: nineteenth-century brewery-era masonry, flat roofline, regular window rhythm, stone sills. A British pub at street level — dark painted shopfront, a hanging **RED LION** sign (readable text allowed), warm windows, a few pavement tables.`,
  },
  {
    name: 'Eagle Park Brewing',
    short: "the low brick garage turned taproom",
    at: [43.05429, -87.9015],
    kind: 'building',
    sizeM: [30, 20],
    evict: 20,
    cue: 'a shaped parapet over wide garage bays, low and broad',
    desc: `**Eagle Park Brewing Company** — a 1920s tannery garage turned brewery taproom (it was the **Gallun Tanneries Garage**). Low, wide, **single-storey brick** industrial building with Mediterranean Revival touches: a shaped parapet, arched openings, tile accents. Big **garage-door bays** along the front, opened up with glass. An outdoor patio with picnic benches and string lights. Industrial bones, friendly use.`,
  },
  {
    name: 'The Hi Hat',
    short: "the corner bar in two adjoining buildings",
    at: [43.053146, -87.895206],
    kind: 'building',
    sizeM: [22, 25],
    evict: 18,
    cue: 'a two-storey brick corner beside a low flat-roofed garage — tall and squat together',
    desc: `**The Hi Hat** — one bar living in **two adjoining buildings**, and the contrast between them is the whole picture. On the corner, the **Hi Hat Lounge**: two storeys of **cream city brick**, apartment windows above, a dark painted bar front below. Attached to it, the **Hi Hat Garage**: a low **single-storey concrete** garage from 1922 (once Zawatski Garage) that kept every bit of the garage about it — wide door openings glazed and thrown open to the street, flat roofline, plain parapet. A **HI HAT** sign band (readable text allowed), sidewalk tables under awnings, warm light spilling from both. Paint them together as one venue.`,
  },
  {
    name: 'Hosed on Brady',
    short: "the false-front brick corner tavern",
    at: [43.052678, -87.897001],
    kind: 'building',
    sizeM: [18, 10],
    evict: 18,
    cue: 'a flat raised false front squaring off the roof, taller than the building behind it',
    desc: `**Hosed on Brady** — a two-storey **brick** corner tavern whose signature is its **boomtown false front**: a flat, raised parapet squaring off the roof and making the building look taller than it really is. Corner entrance, warm lit windows, a painted sign band (readable text allowed). A century of beer-hall history in a small footprint — Ziegler Brewing in 1938, Schlitz's Krueger's in 1954, Franklin Place until 2009.`,
  },
  {
    name: 'Y-Not II',
    short: "the corner dive bar under three storeys of apartments",
    at: [43.049499, -87.90309],
    kind: 'building',
    sizeM: [24, 21],
    evict: 20,
    cue: 'three storeys of brick with a low tiled roof, rising over its corner',
    desc: `**Y-Not II** — a dark, beloved corner dive, open since 1968, on the ground floor of a handsome **three-storey Spanish Colonial brick apartment building**: the tall one on its corner, low-pitched tile-look roof, arched detailing and balconies above. The bar takes the corner at street level — painted shopfront, neon in the window, a small **Y-NOT II** sign (readable text allowed). Tall building, small bar.`,
  },
  {
    name: '811 East Pleasant — the party house',
    short: "the cream-brick house dressed for a party",
    at: [43.050374, -87.901729],
    kind: 'house',
    sizeM: [16, 10],
    evict: 14,
    cue: 'a steep decorated gable over pale brick, brighter and better kept than its neighbours',
    desc: `**811 East Pleasant Street — this is the house the whole party is at**, so it has to be findable at a glance. An 1888 Queen Anne **cream city brick** two-flat (architect James Douglas) — pale, warm, buttery yellow-cream masonry where its neighbours are painted timber, and **the brick is what makes it recognisable**. Two storeys over a raised basement, front steps up to the entrance, tall narrow Victorian windows with stone sills, a steep roof with decorative gable trim. Make it feel warm and lived-in and celebrated: lit windows, flowers, something festive at the door.`,
  },
  {
    name: '1680 North Cass — the blue house',
    short: "the one clearly blue house",
    at: [43.052534, -87.901812],
    kind: 'house',
    sizeM: [17, 8],
    evict: 14,
    cue: 'a decorated gable end and porch roof standing a little above the houses beside it',
    desc: `**1680 North Cass Street — the blue house.** An 1890 Queen Anne two-flat, narrow and deep on its lot in the classic Milwaukee proportion. **Painted blue** siding — the blue is what identifies it, and it should be the one clearly blue house on its block. A front porch with steps up, tall narrow windows, a pitched roof with a modest decorative gable. Homely and friendly.`,
  },
  // Nomad World Pub is the finish line but sits outside the board boundary —
  // deferred by agreement until we decide where on the east edge it perches.
];

// which of them land on this block
const onThisBlock = POINTS_OF_INTEREST.filter((p) => inThisPiece(p.at[0], p.at[1]));

// --- output 1: stencil canvas ----------------------------------------------
const cw = bw * WORK_SCALE, ch = bh * WORK_SCALE;
// "the top-right corner", "the middle of the left edge" — image models place
// things by words far more reliably than by pixel coordinates
function plainPosition(x, y) {
  const col = x < cw / 3 ? 0 : x < (2 * cw) / 3 ? 1 : 2;
  const row = y < ch / 3 ? 0 : y < (2 * ch) / 3 ? 1 : 2;
  return [
    ['the top-left corner', 'the middle of the top edge', 'the top-right corner'],
    ['the middle of the left edge', 'the centre', 'the middle of the right edge'],
    ['the bottom-left corner', 'the middle of the bottom edge', 'the bottom-right corner'],
  ][row][col];
}
const maskRaw = Buffer.alloc(bw * bh * 4);
for (let y = 0; y < bh; y++)
  for (let x = 0; x < bw; x++)
    if (maskBits[(by1 + y) * pxW + bx1 + x]) maskRaw.writeUInt32LE(0xffffffff, (y * bw + x) * 4);
await sharp(maskRaw, { raw: { width: bw, height: bh, channels: 4 } })
  .resize(cw, ch, { kernel: 'nearest' })
  .png()
  .toFile(share('canvas.png'));

// --- output 2: context crop -------------------------------------------------
const cx1 = Math.max(0, bx1 - CTX_MARGIN), cy1 = Math.max(0, by1 - CTX_MARGIN);
const cx2 = Math.min(pxW, bx2 + CTX_MARGIN), cy2 = Math.min(pxH, by2 + CTX_MARGIN);
// the traced interior shown as a translucent red wash, plus its bbox dashed
const tint = Buffer.alloc(bw * bh * 4);
for (let y = 0; y < bh; y++)
  for (let x = 0; x < bw; x++)
    if (maskBits[(by1 + y) * pxW + bx1 + x]) tint.writeUInt32LE(0x5a0000dc, (y * bw + x) * 4); // RGBA dc0000 @ 0x5a
const tintPng = await sharp(tint, { raw: { width: bw, height: bh, channels: 4 } }).png().toBuffer();
let anno = `<rect x="${bx1 - cx1}" y="${by1 - cy1}" width="${bw}" height="${bh}" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="10 6"/>`;
for (const poi of onThisBlock) {
  const at = { lat: poi.at[0], lng: poi.at[1] };
  const hx = PXx(X(at)) - cx1, hy = PXy(Y(at)) - cy1;
  anno += `<circle cx="${hx}" cy="${hy}" r="7" fill="#dc2626"/><text x="${hx + 11}" y="${hy + 5}" font-size="17" font-family="Arial" font-weight="bold" fill="#dc2626" stroke="#fff" stroke-width="3.5" paint-order="stroke">${poi.name.replace(/&/g, '&amp;')}</text>`;
}
// street names along each side of the block, just outside the outline
const bcx = (bx1 + bx2) / 2 - cx1, bcy = (by1 + by2) / 2 - cy1;
const LABEL_POS = {
  North: [bcx, by1 - cy1 - 14, 0],
  South: [bcx, by2 - cy1 + 26, 0],
  West: [bx1 - cx1 - 14, bcy, -90],
  East: [bx2 - cx1 + 14, bcy, 90],
};
for (const [dir, names] of Object.entries(sides)) {
  if (!names.length) continue;
  const [lx, ly, rot] = LABEL_POS[dir];
  anno += `<text x="${lx}" y="${ly}" font-size="15" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#6b4f2a"${
    rot ? ` transform="rotate(${rot} ${lx} ${ly})"` : ''
  }>${names.join(' / ').toUpperCase()}</text>`;
}
const ctx = await sharp('art-prototype/out/reference.png')
  .extract({ left: cx1, top: cy1, width: cx2 - cx1, height: cy2 - cy1 })
  .png()
  .toBuffer();
// sharp runs composite AFTER resize, so annotate at 1:1 in a first pass and
// upscale in a second — one pipeline would draw the overlay at half scale
const annotated = await sharp(ctx)
  .composite([
    { input: tintPng, left: bx1 - cx1, top: by1 - cy1 },
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cx2 - cx1}" height="${cy2 - cy1}">${anno}</svg>`), left: 0, top: 0 },
  ])
  .png()
  .toBuffer();
await sharp(annotated).resize((cx2 - cx1) * 2).png().toFile(share('context.png'));

// --- output 3: the brief ----------------------------------------------------
const sideLine = (dir) => (sides[dir].length ? sides[dir].join(' / ') : '(no named street — board edge or alley)');
const poiCount = onThisBlock.length;
const hardPois = [];
/**
 * Place a landmark: nudge the anchor inward so the exaggerated building fits
 * inside the block, and if the block is simply too tight for it (a tavern on a
 * narrow wedge corner), walk the exaggeration back until it does fit. Better to
 * quote a size that works than to hand over one that must be sliced.
 */
/** A park isn't a building: it keeps its real extent and never gets nudged. */
function placePark(at, size) {
  const lx = Math.max(0, Math.min(cw, Math.round((PXx(X(at)) - bx1) * WORK_SCALE)));
  const ly = Math.max(0, Math.min(ch, Math.round((PXy(Y(at)) - by1) * WORK_SCALE)));
  return {
    px: [lx, ly],
    moved: 0,
    size,
    tight: false,
  };
}
function placeLandmark(e, size) {
  // clamped to the canvas on BOTH ends — an unclamped anchor once printed
  // "canvas px (1537, 0)" on an 804-wide canvas and the landmark simply
  // never got painted
  const toLocal = (v, origin, max) => Math.max(0, Math.min(max, Math.round((v - origin) * WORK_SCALE)));
  const MIN_FACTOR = 1.2; // still visibly bigger than life — the whole point
  const scaleTo = (shrink) =>
    shrink === 1
      ? size
      : {
          ...size,
          pxW: Math.round(size.pxW * shrink),
          pxH: Math.round(size.pxH * shrink),
          factor: (Number(size.factor) * shrink).toFixed(1),
          pctBlock: Math.round(size.pctBlock * shrink),
        };
  let last = 1;
  for (const shrink of [1, 0.9, 0.8, 0.7, 0.6]) {
    if (Number(size.factor) * shrink < MIN_FACTOR) break; // never shrink it below life-size-plus
    last = shrink;
    const fit = fitAnchor(PXx(X(e)), PXy(Y(e)), (size.pxW * shrink) / WORK_SCALE, (size.pxH * shrink) / WORK_SCALE);
    if (fit.moved >= 0) {
      return { px: [toLocal(fit.x, bx1, cw), toLocal(fit.y, by1, ch)], moved: fit.moved, size: scaleTo(shrink), tight: shrink < 1 };
    }
  }
  // genuinely tight corner: keep it exaggerated at the floor, keep it where it
  // belongs, and let the brief tell the painter to fit it to the space
  const fit = fitAnchor(PXx(X(e)), PXy(Y(e)), 0, 0);
  return { px: [toLocal(fit.x, bx1, cw), toLocal(fit.y, by1, ch)], moved: -1, size: scaleTo(last), tight: true };
}
for (const poi of onThisBlock) {
  const at = { lat: poi.at[0], lng: poi.at[1] };
  const size0 = prominence(poi, poiCount);
  const placed = poi.kind === 'park' ? placePark(at, size0) : placeLandmark(at, size0);
  hardPois.push({ name: poi.name, short: poi.short, kind: poi.kind, cue: poi.cue, note: poi.desc, ref: poi.ref, ...placed });
}
// Holding one style across 31 separate chats needs a picture, not adjectives.
// But a whole approved block as the sample gets COPIED — block 13 came back as
// a near-replica of block 11, church and all — so the sample is a close crop of
// plain housing with no landmark in it, and the brief hammers "how, not what".
// Recut from an accepted block with:
//   sharp(art).extract({ a landmark-free band }).resize(680) → style-reference.png
const STYLE_REF = 'art-prototype/style-reference.png';
const STYLE_REF_FROM_BLOCK = 11; // the block the sample was cut from
const shipStyleRef = existsSync(STYLE_REF) && blockNum !== STYLE_REF_FROM_BLOCK;
if (shipStyleRef) await sharp(STYLE_REF).png().toFile(share('style-reference.png'));

// ship the approved landmark painting alongside the brief, downscaled — it is
// an identity reference, not an asset to trace
for (const p of hardPois) {
  if (!p.ref || !existsSync(p.ref)) { p.ref = null; continue; }
  // drop apostrophes before slugging, so ST. HEDWIG'S → st-hedwigs not st-hedwig-s
  p.slug = p.name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await sharp(p.ref).resize(700, null, { withoutEnlargement: true }).png().toFile(share(`${p.slug}-reference.png`));
}
const fabricLines = Object.entries(fabric)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `- ${v} × ${k}`)
  .join('\n');
const propLines = Object.entries(propCounts)
  .map(([k, v]) => `- ${v} × ${k.replace(/_/g, ' ')}`)
  .join('\n');
// A landmark already has its own section above; listing it again here as a
// plain "named place" reads like a second, ordinary building.
// match on name AND position: "Hedwig House Apartments" shares a word with
// St. Hedwig's but is a different building 40 m up the block, and belongs here
const distinctive = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/s$/, '')) // hedwigs → hedwig
    .filter((w) => w.length >= 4 && !['saint', 'tavern', 'lounge', 'street', 'house'].includes(w));
const SAME_PLACE_M = 25;
const otherPois = namedPois.filter((p) => {
  const words = distinctive(p.name);
  return !hardPois.some((h) => {
    const shares = distinctive(h.name).some((w) => words.includes(w));
    const near = Math.hypot(p.px[0] - h.px[0], p.px[1] - h.px[1]) * mPerWorkPx <= SAME_PLACE_M;
    return shares && near;
  });
});
// only rendered when there are any — the empty case gets its own sentence
// --- output 4: the site plan ------------------------------------------------
// Two problems, one picture. Text kept losing to pictures — the style swatch
// showed ordinary houses, so the tavern block came back as ordinary houses
// however loudly the words asked for bars. And blocks painted in separate
// chats drifted badly out of scale with each other: block 4 came back at
// roughly double block 11's, its houses 30-40 m wide against a real 8-17 m,
// because a chat fills its canvas attractively rather than counting metres.
//
// So the plan carries the REAL OSM BUILDING FOOTPRINTS at true size, every
// block, plus a scale bar — the painter is shown how big a house is here
// rather than told. Landmarks sit on top as red boxes at their exaggerated
// size, which also makes the contrast between "landmark" and "ordinary"
// visible at a glance.
{
  // real building outlines on this block, in work-canvas coordinates
  const footprints = [];
  for (const w of osm.buildings?.elements ?? []) {
    if (!w.geometry?.length) continue;
    // test against the block's own polygon, not the grown stencil — the
    // stencil reaches across the sidewalk and catches the far kerb's buildings
    const wx = w.geometry.reduce((s, g) => s + X({ lng: g.lon }), 0) / w.geometry.length;
    const wy = w.geometry.reduce((s, g) => s + Y({ lat: g.lat }), 0) / w.geometry.length;
    if (!pointIn(face.ring, wx, wy)) continue;
    footprints.push(w.geometry.map((g) => [LX(X({ lng: g.lon })), LY(Y({ lat: g.lat }))]));
  }
  const shape = Buffer.alloc(bw * bh * 4);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if (maskBits[(by1 + y) * pxW + bx1 + x]) shape.writeUInt32LE(0xffe8eef0, (y * bw + x) * 4); // pale block
  // Footprints are painted into the block's own silhouette rather than drawn
  // as free-floating shapes: some real buildings straddle a block boundary
  // (block 8 has one 46 x 61 m, taller than the whole canvas), and only the
  // part standing on this block should be shown.
  const fillPoly = (pts, colorLE) => {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(bh - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xsAt = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > y !== yj > y) xsAt.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
      xsAt.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xsAt.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xsAt[k])); x <= Math.min(bw - 1, Math.floor(xsAt[k + 1])); x++) {
          if (maskBits[(by1 + y) * pxW + bx1 + x]) shape.writeUInt32LE(colorLE, (y * bw + x) * 4);
        }
      }
    }
  };
  const GREY = 0xffb8a394, EDGE = 0xff6b5a4a;
  for (const pts of footprints) fillPoly(pts.map(([x, y]) => [x / WORK_SCALE, y / WORK_SCALE]), GREY);
  // outline pass, so a terrace of adjoining buildings doesn't read as one mass
  const isGrey = (x, y) => x >= 0 && y >= 0 && x < bw && y < bh && shape.readUInt32LE((y * bw + x) * 4) === GREY;
  const edges = [];
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if (isGrey(x, y) && !(isGrey(x - 1, y) && isGrey(x + 1, y) && isGrey(x, y - 1) && isGrey(x, y + 1))) edges.push(y * bw + x);
  for (const i of edges) shape.writeUInt32LE(EDGE, i * 4);
  const boxes = hardPois.map((p) => {
    const [x, y] = p.px;
    // keep the drawn box on the canvas — an anchor near a corner otherwise
    // pushes half the rectangle off the edge and reads as a smaller building
    const w = Math.min(p.size.pxW, cw), h = Math.min(p.size.pxH, ch);
    return {
      x: Math.max(0, Math.min(cw - w, x - w / 2)),
      y: Math.max(0, Math.min(ch - h, y - h / 2)),
      w,
      h,
      cx: x,
      cy: y,
    };
  });
  // A park is an area, not a box: fill it clipped to the block's real outline
  // and punched out around the buildings, so the plan can't read as "put a
  // giant rectangular thing here, on top of the tavern".
  const buildingBoxes = boxes.filter((_, i) => hardPois[i].kind !== 'park');
  for (let i = 0; i < hardPois.length; i++) {
    if (hardPois[i].kind !== 'park') continue;
    const b = boxes[i];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (!maskBits[(by1 + y) * pxW + bx1 + x]) continue;
        const wx = (x + 0.5) * WORK_SCALE, wy = (y + 0.5) * WORK_SCALE;
        if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) continue;
        const onBuilding = buildingBoxes.some(
          (o) => wx > o.x - 18 && wx < o.x + o.w + 18 && wy > o.y - 18 && wy < o.y + o.h + 18,
        );
        if (!onBuilding) shape.writeUInt32LE(0x8874c67a, (y * bw + x) * 4); // green wash, park
      }
    }
  }
  const shapePng = await sharp(shape, { raw: { width: bw, height: bh, channels: 4 } })
    .resize(cw, ch, { kernel: 'nearest' })
    .png()
    .toBuffer();
  let plan = '';
  boxes.forEach((b, i) => {
    if (hardPois[i].kind === 'park') {
      // already painted as an area; just number it at its centre
      plan +=
        `<circle cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" r="26" fill="#166534"/>` +
        `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 11}" font-size="32" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>`;
      return;
    }
    plan +=
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#dc2626" fill-opacity="0.28" stroke="#b91c1c" stroke-width="5"/>` +
      `<circle cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" r="26" fill="#b91c1c"/>` +
      `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 11}" font-size="32" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text>`;
  });
  // Labels go wherever they collide least: try each side of the box, score by
  // overlap with the other boxes and by falling off the canvas, take the best.
  const LH = 34;
  boxes.forEach((b, i) => {
    const label = `${i + 1}. ${hardPois[i].name.replace(/&/g, '&amp;')}`;
    const est = label.length * 15;
    const cands = [
      { x: b.x + b.w / 2, y: b.y - 16, anchor: 'middle' },
      { x: b.x + b.w / 2, y: b.y + b.h + LH, anchor: 'middle' },
      { x: b.x - 12, y: b.y + b.h / 2, anchor: 'end' },
      { x: b.x + b.w + 12, y: b.y + b.h / 2, anchor: 'start' },
    ];
    let best = cands[0], bestScore = Infinity;
    for (const c of cands) {
      const x1 = c.anchor === 'middle' ? c.x - est / 2 : c.anchor === 'end' ? c.x - est : c.x;
      const r = { x: x1, y: c.y - LH, w: est, h: LH };
      let score = 0;
      if (r.x < 4 || r.x + r.w > cw - 4 || r.y < 4 || r.y + r.h > ch - 4) score += 1000;
      for (const o of boxes) {
        const ox = Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
        const oy = Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
        score += ox * oy;
      }
      if (score < bestScore) { bestScore = score; best = c; }
    }
    // On a small block every candidate can fall off the canvas, and a label
    // drawn off the edge is simply invisible — block 20's landmark came back
    // numbered but unnamed. Pull it back inside and sit it on the box.
    if (bestScore >= 1000) best = { x: Math.min(Math.max(b.x + 8, 8), cw - est - 8), y: b.y + Math.min(b.h - 10, 34), anchor: 'start' };
    plan +=
      `<text x="${best.x}" y="${best.y}" font-size="30" font-family="Arial" font-weight="bold" fill="#7f1d1d" text-anchor="${best.anchor}" ` +
      `stroke="#ffffff" stroke-width="7" paint-order="stroke">${label}</text>`;
  });
  // Put the caption and the bar in whichever horizontal band is emptiest —
  // block 1 has landmarks in both corners, and a caption dropped blindly at
  // the bottom landed straight on one of them.
  const bandLoad = (y0, y1) =>
    boxes.reduce((s, b) => s + Math.max(0, Math.min(b.y + b.h, y1) - Math.max(b.y, y0)) * b.w, 0);
  const bands = [
    { capY: 46, barY: 96 },
    { capY: ch - 74, barY: ch - 34 },
    { capY: Math.round(ch / 2) - 10, barY: Math.round(ch / 2) + 30 },
  ].map((b) => ({ ...b, load: bandLoad(b.capY - 40, b.barY + 20) }));
  bands.sort((a, b) => a.load - b.load);
  const { capY, barY: barTop } = bands[0];
  const caption = hardPois.length
    ? `${hardPois.length === 1 ? 'Grey = real buildings at true size. Red = the landmark' : `Grey = real buildings at true size. Red = the ${hardPois.length} landmarks`}`
    : 'Grey outlines are the real buildings, at the size they should be painted';
  // A scale bar is the whole point of this image: blocks drawn in separate
  // chats drifted to double size without one.
  const barPx = Math.round(20 / mPerWorkPx);
  const barX = 24, barY = barTop;
  // shrink the caption rather than let it run off a narrow block's canvas
  const capSize = Math.max(15, Math.min(28, Math.floor((cw - 28) / (caption.length * 0.52))));
  const legend =
    `<text x="${cw / 2}" y="${capY}" font-size="${capSize}" font-family="Arial" font-weight="bold" fill="#7f1d1d" text-anchor="middle" stroke="#fff" stroke-width="${Math.max(4, Math.round(capSize / 4))}" paint-order="stroke">${caption}</text>` +
    `<rect x="${barX}" y="${barY}" width="${barPx}" height="14" fill="#111827" stroke="#ffffff" stroke-width="3"/>` +
    `<text x="${barX}" y="${barY - 10}" font-size="26" font-family="Arial" font-weight="bold" fill="#111827" stroke="#fff" stroke-width="6" paint-order="stroke">20 m — a house is about this wide</text>`;
  await sharp(shapePng)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">${plan}${legend}</svg>`), left: 0, top: 0 }])
    .png()
    .toFile(share('layout.png'));
}

const poiLines = otherPois
  .map((p) => `- **${p.name}**${p.what ? ` (${p.what})` : ''} — around (${p.px[0]}, ${p.px[1]})`)
  .join('\n');

const brief = `# ${id} — art brief

**This is a complete, standalone request.** Everything needed is in this
document and its attachments; it assumes no earlier conversation, and nothing
you may have painted before applies to it. If you have attempted this block
before, ignore that attempt entirely and work only from what is written here.

## What we are making

An illustrated top-down map of a real Milwaukee neighbourhood — the Lower East
Side, around Brady Street — used as the board for a city-wide game that people
play on foot. The map's streets, sidewalks and game spaces are already drawn
and cannot move. What is missing is the land *between* the streets, so the city
blocks are being illustrated one at a time and composited back onto the map at
exact positions.

${
  half
    ? `**You are painting HALF of one city block — the ${half === 'a' ? 'first' : 'second'} half of block ${blockNum}.**
That block is a long narrow strip, too long and thin to paint in one image, so
it is being done in two pieces that will be joined edge to edge. Paint your
half complete in itself and carry the detail right to every edge: whichever
edge meets the other half must not fade out, stop short, or round off, because
the join would show as a seam down the middle of the block.`
    : `**You are painting one city block: block ${blockNum}.**`
} It is bounded by real streets,
it contains real buildings, and your painting drops into the hole where that
${half ? 'piece' : 'block'} sits.

## What is attached

- \`${id}-canvas.png\` — **the stencil.** The white shape is the real block:
  the part of your painting we keep. Everything outside it is cut away. It is
  the exact size your painting must be.
- \`${id}-context.png\` — **orientation only, never a thing to copy.** It shows
  where this block sits on the finished map, washed red, with the streets
  around it labelled. Those streets, their labels and the white circular game
  markers are already on the map. **Do not paint any of them.** Look at this
  image to understand which way the block faces, then set it aside.
- \`${id}-layout.png\` — **the site plan, and the most important attachment
  after the stencil.** It shows this block's **real buildings as grey outlines
  at exactly the size they should be painted**, with a 20 m scale bar. Match
  those sizes and that spacing: how many buildings there are, how big each is
  relative to the block, how much garden sits between them.
  **Scale matters more here than any other instruction.** Each block is painted
  separately and then set side by side on one map, so a block drawn at twice
  life size ruins its neighbours as much as itself.${
    hardPois.length
      ? `
  The ${hardPois.length > 1 ? `${hardPois.length} landmarks are` : 'landmark is'} drawn over the top as **numbered red boxes**, deliberately
  bigger than life — those, and only those, are exaggerated. Everything not in
  a red box is ordinary housing at true size.`
      : ''
  }${
    shipStyleRef
      ? `
- \`${id}-style-reference.png\` — **a texture sample: HOW to paint, never WHAT
  to paint.** A close crop of ordinary housing from elsewhere on this map,
  shown only so the whole board looks like one hand made it. Copy its camera
  angle, outline weight, colour temperature, and how big a house and a tree
  are relative to each other.
  **None of the buildings in it belong on your block, and neither does its
  layout.** It is a swatch, not a plan. Your block's contents are specified
  below and they are different — if your painting ends up resembling this
  crop, you have copied the wrong thing.`
      : ''
  }${hardPois
    .filter((p) => p.ref)
    .map(
      (p) => `
- \`${id}-${p.slug}-reference.png\` — our approved painting of ${p.name}, for
  identity only (see its section below).`,
    )
    .join('')}

> ## ⚠ OUTPUT SIZE: **${cw} × ${ch} px — ${cw < ch ? 'PORTRAIT, taller than it is wide' : cw > ch ? 'LANDSCAPE, wider than it is tall' : 'SQUARE'}**
>
> Identical in size and shape to the attached \`${id}-canvas.png\`. This is not a
> preference — the painting is composited onto a map at exactly this size, so a
> different shape gets stretched and every building in it comes out squashed.
> If you cannot output these exact pixels, output a **larger** image with the
> **same ratio (${(cw / ch).toFixed(2)} : 1)** and the same orientation. Never a default 4:3 or
> 16:9 canvas, and never the other orientation.

## Deliverable

- **One PNG, exactly ${cw} × ${ch} px, painted edge to edge.** That is ${WORK_SCALE}× the block's
  final size on the board canvas (${bw} × ${bh} px at position x ${bx1}, y ${by1} on the
  1875 × 2048 base) — we downscale and place it; paint at this working size so
  detail survives.
- **You are painting ONE BLOCK — the land between the streets. You are not
  painting a map.** No roads, no street names, no labels, no markers, no
  neighbouring blocks. Those already exist and yours must not duplicate them.
- **The white shape in \`${id}-canvas.png\` is what you are painting**: the real
  block, traced from the map, including its own sidewalk out to the kerb.
  Every building, tree and detail must sit inside it, comfortably clear of the
  edge — anything crossing that edge gets sliced in half on the finished map.
- **Let the ground — and only the ground — spill about ${Math.round(10 / mPerWorkPx)} px past that
  edge.** Grass, hedge, paving: no buildings, no roads, nothing with a shape.
  We cut along the white edge exactly, and that spill means the cut lands on
  your paint instead of leaving a bare seam beside the road. Outside the
  spill, leave the canvas empty.
- **The perimeter band of your painting is the sidewalk/terrace zone** (~6 m
  ≈ ${Math.round(6 / (mPerPx / WORK_SCALE))} px wide): paint your own sidewalk paving there, with the street
  trees in the grass terrace strip alongside it.
- **North is up. Scale: 1 px = ${mPerWorkPx.toFixed(3)} m**, and this is not negotiable —
  the site plan shows you what that means. A typical Milwaukee two-flat is
  17 × 8 m ≈ **${Math.round(17 / mPerWorkPx)} × ${Math.round(8 / mPerWorkPx)} px**; a big street tree's canopy is 8 m ≈ **${Math.round(8 / mPerWorkPx)} px**
  across; a car is 4.5 m ≈ **${Math.round(4.5 / mPerWorkPx)} px** long. Houses are small on this
  canvas and there are a lot of them — that is correct. The commonest mistake
  is painting a handful of oversized houses to fill the space.

## Style

${shipStyleRef ? `**Paint in the manner of \`${id}-style-reference.png\`** — its brushwork, not its\ncontents. Where this text and that image disagree about *how* something looks,\nfollow the image; about *what* is on this block, this text is the only source.\n\n` : ''}Warm, cartoony **board-game illustration** — the look of a modern tabletop map
or a cosy city-builder, not a satellite photo and not a technical drawing.

- **Camera: strongly top-down.** Roofs dominate; walls are visible but
  vertically compressed. Every building on the block uses the same camera —
  this is the rule most easily broken, and a building drawn from a lower angle
  than its neighbours immediately looks pasted on.
- Thick, friendly dark outlines. Bright but controlled colours, flat fills with
  simple two-tone shading. Charm over realism; readable at small size.
- Shadows soft and consistent, all falling the same way, none of them long.

**Palette anchors** (the map around your block uses these, so matching them
makes your edges disappear into it): grass **#cad7a1**, road surface
**#eeddab**, the dark road outline **#8a7452**, sidewalk paving near
**#d8c78f**. Garden greens a little richer than the base grass; backyards
quiet and low-contrast — fences, vegetable patches, paths.

**No invented readable text anywhere** — no shop names, no street signs, no
house numbers. Real names appear only where this brief explicitly allows them.

## Where you are

${'Bounded by:'}
- **North:** ${sideLine('North')}
- **East:** ${sideLine('East')}
- **South:** ${sideLine('South')}
- **West:** ${sideLine('West')}

See \`${id}-context.png\` — your block outlined in red dashes on the actual base
map (shown at 2×), so you can see the street geometry your edges meet.

${
  hardPois.length
    ? `## The landmark${hardPois.length > 1 ? 's' : ''} — paint ${hardPois.length > 1 ? 'these' : 'this'} first, and paint ${hardPois.length > 1 ? 'them' : 'it'} BIG

This is a game board. ${hardPois.length > 1 ? 'These are places' : 'This is a place'} players physically walk to,
so ${hardPois.length > 1 ? 'they have' : 'it has'} to be the thing the eye lands on first — not one building among many.
**Deliberately exaggerate ${hardPois.length > 1 ? 'them' : 'it'}.** Real-world proportions are the wrong
instinct here; a landmark painted at its true size vanishes into the houses.
${
  hardPois.length > 1
    ? `
**This block has ${hardPois.length} of them: ${hardPois.map((p) => p.name).join(', ')}. All ${hardPois.length} must appear** —
they are separate real businesses at the positions given below, and a block
that is missing one is unusable to us even if the rest is perfect. Check them
off before you finish.
`
    : ''
}

${hardPois
  .map(
    (p, i) => `### ${i + 1}. ${p.name}

${
      p.kind === 'park'
        ? `- **It is a park, not a building** — open ground, and the one place on this
  block where nothing is built. It occupies ${plainPosition(p.px[0], p.px[1])} of the canvas,
  centred near px (${p.px[0]}, ${p.px[1]}), covering roughly **${p.size.pxW} × ${p.size.pxH} px** — its true
  size, about ${p.size.pctBlock}% of the block's width. Do not shrink it to make room for
  houses; the houses give way to it.
- **Nothing is built inside it.** No sheds, no garages, no houses creeping in
  at the edges.
- It must read as **public parkland at a glance** — open mown grass, paths, big
  shade trees around the rim — never as a run of back gardens.`
        : `- **It stands in ${plainPosition(p.px[0], p.px[1])} of the canvas**, centred near
  px (${p.px[0]}, ${p.px[1]}), its front facing the street.${
            p.moved === -1
              ? ` This is a tight corner of the block — turn the building to follow its
  street and tuck it into the space. Trim its length if you must, but keep the
  whole of it inside the white area: a landmark sliced in half by a street is
  the worst thing that can happen on this map.`
              : ' The whole building must sit inside the white area of the stencil: nothing on the finished map is worse than a landmark sliced in half by a street.'
          }
- **Paint it about ${p.size.pxW} × ${p.size.pxH} px** — that is ${p.size.factor}× its real ${p.size.trueW} × ${p.size.trueH} m
  footprint, and roughly ${p.size.pctBlock}% of the block's width. Oversized on purpose.
- **It must be the biggest, tallest, most detailed and most saturated ${p.kind === 'house' ? 'house' : 'building'} on
  the block**, by an obvious margin. If it does not stand out, it is wrong.
- **Clear a halo of ~${p.size.haloPx} px (${p.size.evictM} m) around it** — inside that halo only its own
  grounds belong: steps, entry walks, foundation planting, a little plaza or
  yard. No houses, no garages, no fences crowding it.
- Give it real vertical presence even from this top-down camera: ${p.cue},
  clearly taller than every roof around it and catching light on top.`
    }

${p.note}${
      p.ref
        ? `

**Identity reference: \`${id}-${p.slug}-reference.png\`** (attached) — our own
approved painting of this exact building. Match its materials, colour and
character. **Do NOT match its camera**: that reference is drawn from a lower
three-quarter angle, while this block is strongly top-down. Same building,
your camera.`
        : ''
    }`,
  )
  .join('\n\n')}`
    : `## No landmark here — this block is background

Nothing on this block is a landmark, and that is the point. It is the ordinary
neighbourhood fabric that makes the landmark blocks elsewhere on the board feel
special, so keep it **even and unshowy**: no invented hero building, no
attention-grabbing centrepiece, no one house obviously fancier than the rest.
Pleasant, lived-in, quiet.`
}

${
  hardPois.length
    ? `## Everything else is supporting cast

${
  hardPois.length > 1
    ? `Those ${hardPois.length} are the focal points of this block — nothing else competes with
them.`
    : `That one building is the focal point of this block — nothing else competes
with it.`
} The rest of the block is deliberately **quieter**: ordinary houses,
simpler roofs, less saturated colours, no second attention-grabber. Thin the
fabric rather than packing buildings in — the landmark${hardPois.length > 1 ? 's have' : ' has'} earned the space.

`
    : ''
}## Other named places here

${
  otherPois.length
    ? `Real addresses on this block. Get the building type right; they need no
signage${hardPois.length ? ' — only the landmark above carries readable text' : ' and no readable text'}.

${poiLines}`
    : '_Nothing else on this block is named — it is all ordinary housing._'
}

## Texture guidance — paint the vibe, counts are approximate

What's really on this block (from city data):

${fabricLines || '- (empty block)'}

${propLines ? `Property details (real): \n${propLines}` : ''}

Counts are a vibe, not a checklist${hardPois.length ? ' — and the landmark outranks all of it. Drop houses if they crowd it' : ''}.

Composition rules of thumb: street trees live in the terrace band just inside
each street edge; houses front their street with small setbacks and entry
walks; garages and sheds hide mid-block along the alley side; commercial
buildings sit flush to their corner. Polish flat identity: a cottage raised on
a tall brick basement — raised first floor, front stairs, half-exposed basement
windows.

## Don'ts

- **No streets.** No road surface, kerb line, crosswalk, centre line, or car
  driving on one. The map already has its roads; a second set painted on top
  of them is the single worst outcome here.
- **No river, no water, no shoreline**, even if the block sits beside one. The
  map paints its own river; yours would land on top of it in the wrong place.
- **No street names, no labels, no lettering of any kind on the ground**, and
  no white circular game markers. If you find yourself writing a street name,
  something has gone wrong — reread this brief.
- Nothing from the neighbouring blocks: paint your block, not its surroundings.${
    shipStyleRef
      ? `
- **Nothing from the style sample** — not its buildings, not its layout, not
  any structure that appears in it. It shows brushwork only; every building on
  your block is listed in this brief and nowhere else.`
      : ''
  }
- Nothing outside the stencil. No drop shadows past the polygon edge.
- No rounded corners, no inset border, no empty margin inside the stencil.
- **Don't change the canvas shape.** ${cw} × ${ch} (${(cw / ch).toFixed(2)} : 1, ${cw < ch ? 'portrait' : cw > ch ? 'landscape' : 'square'}) — a
  delivery in the wrong orientation is unusable no matter how good the art is.
- No invented store names, street names, or readable text (exceptions above).
${hardPois.length ? `- Don't relocate or mirror the landmark${hardPois.length > 1 ? 's' : ''}.` : '- No invented centrepiece: this block has no landmark and should not grow one.'}${
    hardPois.length
      ? `
- **Don't paint the landmark${hardPois.length > 1 ? 's' : ''} at realistic size.** Undersized is the one failure
  that makes the whole block useless to us — when in doubt, go bigger.
- Don't give a plain house a feature interesting enough to compete with it.`
      : ''
  }${
    hardPois.length
      ? `

## Before you call it finished

The last thing to do, and the one that matters most. Check the painting against
this list — ${hardPois.length > 1 ? 'each of these is' : 'this is'} a real place people walk to in this game, and a block
missing ${hardPois.length > 1 ? 'one' : 'it'} is unusable to us however good the rest looks. It is by far the
most common way these come back wrong.

${hardPois
  .map(
    (p) =>
      `- [ ] **${p.name}** — ${p.short ?? 'the landmark'} — is in ${plainPosition(p.px[0], p.px[1])}, roughly ${p.size.pxW} × ${p.size.pxH} px, and looks like what it is: not grander, not more civic, not a different kind of building.`,
  )
  .join('\n')}
- [ ] Nothing in a red box on the layout plan has been left out.
- [ ] Buildings match the grey outlines on the site plan in size and number — not bigger, not fewer.
- [ ] **Every part of the white stencil area is painted** — a bare patch becomes a hole in the map.
- [ ] The canvas is ${cw} × ${ch} px.
- [ ] No streets, no lettering other than the name${hardPois.length > 1 ? 's' : ''} above, no map markers.`
      : `

## Before you call it finished

- [ ] Buildings match the grey outlines on the site plan in size and number — not bigger, not fewer.
- [ ] **Every part of the white stencil area is painted** — a bare patch becomes a hole in the map.
- [ ] The canvas is ${cw} × ${ch} px.
- [ ] No streets, no lettering anywhere, no map markers, no invented centrepiece.`
  }
`;
writeFileSync(share('brief.md'), brief);
// sweep anything left from an earlier run under a different name
for (const f of readdirSync(kitDir)) {
  if (!f.startsWith(id + '-')) continue;
  if (!written.has(f.slice(id.length + 1))) rmSync(`${kitDir}/${f}`);
}
// A half-written kit is worse than none — it would be handed to ChatGPT with a
// brief pointing at files that aren't there. Writes have gone missing here
// before (transient file locks while regenerating all 31 back to back), so
// prove the folder is complete rather than assume it.
const short = [...written].filter((f) => !existsSync(`${kitDir}/${id}-${f}`));
if (short.length) {
  console.error(`${id}: INCOMPLETE KIT — missing ${short.join(', ')}. Re-run this block.`);
  process.exit(1);
}

// placement manifest for block-compose.mjs
writeFileSync(
  `${outBase}-${id}-place.json`,
  JSON.stringify({ block: blockNum, x: bx1, y: by1, w: bw, h: bh, workCanvas: [cw, ch], base: [pxW, pxH] })
);

console.log(`${id}: bbox ${bw}×${bh}px @ (${bx1},${by1}) → work canvas ${cw}×${ch}`);
console.log(`  streets N[${sides.North}] E[${sides.East}] S[${sides.South}] W[${sides.West}]`);
console.log(`  hard POIs: ${hardPois.map((p) => p.name).join(', ') || 'none'}; named places: ${namedPois.length}`);
console.log(`  kit → ${kitDir}/ (${[...written].join(', ')})`);
