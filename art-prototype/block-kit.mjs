// Per-block production kit for the block-asset pipeline.
//
// For one road-bounded block (numbering identical to block-segment.mjs) emit
// everything ChatGPT needs to illustrate that block as a drop-in transparent
// asset, plus what our compositor needs to place it.
//
// The three files to HAND TO CHATGPT land together in their own folder,
// art-prototype/kits/block-NN/ — drag the whole folder into the chat:
//
//   block-NN-brief.md     the art brief: bounding streets by compass, hard
//                         constraints (landmarks + named places with exact
//                         canvas positions), fabric/texture guidance mined
//                         from the baked scene, style + delivery rules
//   block-NN-context.png  crop of the base map around the block, paintable
//                         area washed red, landmarks flagged, streets labeled
//   block-NN-canvas.png   the stencil at WORK_SCALE× the block's exact pixel
//                         bbox — white = paintable, rest transparent
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

const [, , boardPath, blockNumArg, outBase = 'art-prototype/out/reference'] = process.argv;
if (!boardPath || !blockNumArg) {
  console.error('usage: node art-prototype/block-kit.mjs <board.json> <blockNumber> [outBase]');
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
  const sx = Math.round(PXx(ccx)), sy = Math.round(PXy(ccy));
  if (!isInterior(sx, sy)) {
    console.error(`block centroid (${sx},${sy}) is not on block-interior green — cannot trace this block`);
    process.exit(1);
  }
  const stack = [sy * pxW + sx];
  maskBits[stack[0]] = 1;
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
const bw = bx2 - bx1, bh = by2 - by1;
const inMask = (px, py) => {
  const xi = Math.round(px), yi = Math.round(py);
  return xi >= 0 && yi >= 0 && xi < pxW && yi < pxH && maskBits[yi * pxW + xi] === 1;
};
const mPerPx = W / pxW; // base-canvas meters per pixel
const mPerWorkPx = mPerPx / WORK_SCALE;
const nn = String(blockNum).padStart(2, '0');
const id = `block-${nn}`;
// the three shareable files live together, ready to drag into a chat
const kitDir = `art-prototype/kits/${id}`;
mkdirSync(kitDir, { recursive: true });
// clear old landmark references — a renamed slug would otherwise leave a stale
// image in the folder and get handed to ChatGPT alongside the current one
for (const f of readdirSync(kitDir)) if (f.endsWith('-reference.png')) rmSync(`${kitDir}/${f}`);
const share = (suffix) => `${kitDir}/${id}-${suffix}`;
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
const HERO_FILE_NAME = { 'st-hedwig': "ST. HEDWIG'S", wolskis: "WOLSKI'S", gloriosos: "GLORIOSO'S" };
const inBlock = (e) => pointIn(face.ring, X(e), Y(e));
const entries = scene.standing.filter(inBlock);
const heroes = entries.filter((e) => e.t === 'img');
const labeled = entries.filter((e) => e.label);
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
    if (inMask(PXx(X({ lng: lo })), PXy(Y({ lat: la })))) {
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

/** How big to paint a landmark, in work-canvas px, plus its cleared halo. */
function prominence(name, lat, lng, isHero, poiCount) {
  const fallback = { wM: isHero ? 40 : 16, hM: isHero ? 25 : 12 };
  let fp = footprintAt(lat, lng) ?? fallback;
  // A POI node can sit nearer a garage or a porch than its own building. Any
  // "footprint" too small or too sliver-shaped to be the real thing is a bad
  // match, not a tiny landmark — quoting it would ask for a shed.
  if (fp.wM * fp.hM < 60 || fp.hM < 5 || fp.wM / fp.hM > 4) fp = fallback;
  const base = isHero ? 1.4 : 1.8; // small corner buildings need the bigger push
  const cap = isHero ? 1.6 : 2.2; // past this a building stops looking like itself
  const blockWm = bw * mPerPx;
  // A lone landmark spanning less than a third of its block won't read as the
  // focal point, so push it there — but never past the cap: Wolski's is a
  // little wood cottage, and blown up 3× it reads as a different building.
  const floorFactor = poiCount === 1 ? (blockWm * 0.32) / fp.wM : 0;
  const scale = Math.min(cap, Math.max(base, floorFactor));
  const wantM = fp.wM * scale;
  const toPx = (m) => Math.round(m / mPerWorkPx);
  const evictM = HERO_EVICT_M[name] ?? DEFAULT_EVICT_M;
  return {
    trueW: Math.round(fp.wM),
    trueH: Math.round(fp.hM),
    factor: scale.toFixed(1),
    pxW: toPx(wantM),
    pxH: toPx(fp.hM * scale),
    haloPx: toPx(evictM),
    evictM,
    pctBlock: Math.round((wantM / blockWm) * 100),
  };
}

// --- landmark identity notes (the "POI descriptions") -----------------------
// Keyed by hero/label name; blocks whose landmarks aren't written up yet get a
// TODO line in the brief. Full source: art-prototype/HERO_PACKETS.md +
// art-prototype/grounding/.
// Scene labels are truncated at bake (fit-to-width); full names resolved by
// matching label positions to the OSM bar/pub POIs.
const LABEL_FULL = {
  'FINK’S': 'Fink’s',
  'SCAFFIDI’': 'Scaffidi’s Hideout',
  "JAMO'S": "Jamo's",
  THE: 'The Standard Tavern',
  "PETE'S": "Pete's Pub",
  HI: 'Hi Hat Garage',
  "ANGELO'S": "Angelo's Piano Lounge",
};
const POI_NOTES = {
  "ST. HEDWIG'S": `**Saint Hedwig Catholic Church** (1886, Henry Messmer) — THE landmark of this block and the visual crest of Brady Street.
   - **Cream City brick** body (pale warm cream — NOT red brick), stone trim, Romanesque round-arched windows.
   - Single tall central tower with a **copper-patina-green spire** (162 ft) — slightly bulbous Eastern-European transition at its base. The spire is the tallest thing on the whole board; let it read over everything.
   - **Long axis runs east–west**: the tower and main doors at the WEST end, the tall gabled nave stretching back EAST behind it.
   - Palette: cream body, patina-green spire, brown-gray slate nave roof, pale stone trim, dark wood doors, stained-glass blue-purple.`,
  "WOLSKI'S": `**Wolski's Tavern** (a 1908 bar in an 1895 front-gabled wood house) — a house that became a tavern, and the most beloved dive in the neighbourhood. White/cream clapboard, dark roof, a painted WOLSKI'S signboard band across the first floor (readable text allowed), warm amber windows. Its charm is that it is small and wooden where everything else is brick — keep that character while still making it dominate the block.`,
  "GLORIOSO'S": `**Glorioso's Italian Market**, in the former Astor Theatre (1907–13) — a wide, low theatre block with a tall flat parapet, light stucco body, a long run of storefront glass along Brady, a bold GLORIOSO'S signage band and Italian tricolour (green/white/red) awnings. It should read instantly as "old movie house turned Italian grocery".`,
};
// Our own approved painting of a landmark, shipped with the kit as a visual
// identity reference. Camera differs on purpose — see the wording in the brief.
const POI_REFERENCE = {
  "ST. HEDWIG'S": 'art-prototype/heroes/st-hedwig-v2.png',
  "WOLSKI'S": 'art-prototype/heroes/wolskis-v2.png',
  "GLORIOSO'S": 'art-prototype/heroes/gloriosos-v1.png',
};

// --- output 1: stencil canvas ----------------------------------------------
const cw = bw * WORK_SCALE, ch = bh * WORK_SCALE;
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
for (const h of heroes) {
  const name = HERO_FILE_NAME[Object.keys(HERO_FILE_NAME).find((k) => (h.href || '').includes(k))] ?? 'HERO';
  const hx = PXx(X(h)) - cx1, hy = PXy(Y(h)) - cy1;
  anno += `<circle cx="${hx}" cy="${hy}" r="7" fill="#dc2626"/><text x="${hx + 11}" y="${hy + 5}" font-size="17" font-family="Arial" font-weight="bold" fill="#dc2626">${name}</text>`;
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
const poiCount = heroes.length + labeled.length;
const hardPois = [];
for (const h of heroes) {
  const name = HERO_FILE_NAME[Object.keys(HERO_FILE_NAME).find((k) => (h.href || '').includes(k))] ?? 'HERO';
  hardPois.push({
    name,
    // clamp: a hero anchored at its door can sit a hair outside the stencil
    px: [Math.max(0, Math.min(cw, Math.round(LX(X(h))))), Math.max(0, Math.min(ch, Math.round(LY(Y(h)))))],
    size: prominence(name, h.lat, h.lng, true, poiCount),
    note: POI_NOTES[name] ?? '_TODO: identity notes not written yet._',
    ref: POI_REFERENCE[name],
  });
}
for (const e of labeled) {
  const full = LABEL_FULL[e.label] ?? e.label;
  hardPois.push({
    name: full,
    px: [Math.round(LX(X(e))), Math.round(LY(Y(e)))],
    size: prominence(full, e.lat, e.lng, false, poiCount),
    note:
      POI_NOTES[full] ??
      `Corner tavern — a real Brady-area bar and a place people on this board actually walk into. Two-story corner building, tavern front at street level, warm lit windows, and a painted sign band reading "${full}" (readable text allowed for this name). Give it more character than anything around it: a bolder colour, an awning, a corner entrance cut across the corner.`,
  });
}
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
const poiLines = otherPois.length
  ? otherPois.map((p) => `- **${p.name}**${p.what ? ` (${p.what})` : ''} — around (${p.px[0]}, ${p.px[1]})`).join('\n')
  : '- (none besides the above)';

const brief = `# ${id} — art brief

One block of the board, painted by you, composited by us. Numbering matches
reference-blocks.png (this is block ${blockNum}).

## Deliverable

- **One transparent PNG, exactly ${cw} × ${ch} px.** That is ${WORK_SCALE}× the block's
  final size on the board canvas (${bw} × ${bh} px at position x ${bx1}, y ${by1} on the
  1875 × 2048 base) — we downscale and place it; paint at this working size so
  detail survives.
- **Paint only inside the white area of the stencil.** The attached
  \`${id}-canvas.png\` (same ${cw} × ${ch}) is the paintable region, traced
  pixel-exact from the rendered base map: the full block INCLUDING its sidewalk
  apron, running right up to the street's dark outline — your art borders the
  road directly. Everything outside stays fully transparent. The roads, their
  dark outlines and the white game spots belong to the base map — never paint
  over them, never let art or shadows cross the stencil edge.
- **The perimeter band of your painting is the sidewalk/terrace zone** (~6 m
  ≈ ${Math.round(6 / (mPerPx / WORK_SCALE))} px wide): paint your own sidewalk paving there, with the street
  trees in the grass terrace strip alongside it.
- **North is up.** Scale: **1 px = ${mPerWorkPx.toFixed(3)} m** (a typical 17 × 8 m Polish
  flat ≈ ${Math.round(17 / mPerWorkPx)} × ${Math.round(8 / mPerWorkPx)} px; a street tree canopy ~8 m ≈ ${Math.round(8 / mPerWorkPx)} px across).

## Style (locked)

Style C, matching the island base map and our existing sprites: **strongly
top-down camera — roofs dominant, walls vertically compressed**, thick friendly
dark outlines, bright flat colors with simple 2-tone shading, cartoony
board-game warmth. Ground between buildings is yard/garden texture in greens
that sit naturally on the base grass **#cad7a1**. Your edges meet the road's
dark outline (#8a7452) directly; the road surface beyond it is sand **#eeddab**
— sidewalk tones near #d8c78f blend well at the boundary.
Backyards: fences, garden patches, paths — quiet, low-contrast. **No invented
readable text anywhere** — real names only where this brief explicitly allows.

## Where you are

${'Bounded by:'}
- **North:** ${sideLine('North')}
- **East:** ${sideLine('East')}
- **South:** ${sideLine('South')}
- **West:** ${sideLine('West')}

See \`${id}-context.png\` — your block outlined in red dashes on the actual base
map (shown at 2×), so you can see the street geometry your edges meet.

## The landmark${hardPois.length > 1 ? 's' : ''} — paint ${hardPois.length > 1 ? 'these' : 'this'} first, and paint ${hardPois.length > 1 ? 'them' : 'it'} BIG

${
  hardPois.length
    ? `This is a game board. ${hardPois.length > 1 ? 'These are places' : 'This is a place'} players physically walk to,
so ${hardPois.length > 1 ? 'they have' : 'it has'} to be the thing the eye lands on first — not one building among many.
**Deliberately exaggerate ${hardPois.length > 1 ? 'them' : 'it'}.** Real-world proportions are the wrong
instinct here; a landmark painted at its true size vanishes into the houses.

${hardPois
  .map(
    (p, i) => `### ${i + 1}. ${p.name}

- **Ground anchor: canvas px (${p.px[0]}, ${p.px[1]})** — its main entrance meets the sidewalk here.
- **Paint it about ${p.size.pxW} × ${p.size.pxH} px** — that is ${p.size.factor}× its real ${p.size.trueW} × ${p.size.trueH} m
  footprint, and roughly ${p.size.pctBlock}% of the block's width. Oversized on purpose.
- **It must be the biggest, tallest, most detailed and most saturated thing on
  the block**, by an obvious margin. If it does not dominate, it is wrong.
- **Clear a halo of ~${p.size.haloPx} px (${p.size.evictM} m) around it** — inside that halo only its own
  grounds belong: steps, entry walks, foundation planting, a little plaza or
  yard. No houses, no garages, no fences crowding it.
- Give it real vertical presence even from this top-down camera: a tall
  element (tower, spire, parapet, chimney mass) that clearly rises above every
  roof around it, catching light on top.

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
    : '_No named landmarks on this block — this one is pure neighborhood fabric, so let it be quiet and even._'
}

## Everything else is supporting cast

${
  hardPois.length
    ? `${
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
}Named real places on this block (get the buildings right, no signage needed
unless noted above):

${poiLines}

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

- No roads, crosswalks, cars-on-the-road, or game spots — the road surface and
  its dark outline are the base map's.
- Nothing outside the stencil. No drop shadows past the polygon edge.
- No invented store names, street names, or readable text (exceptions above).
- Don't relocate or mirror the landmark${hardPois.length > 1 ? 's' : ''}.${
    hardPois.length
      ? `
- **Don't paint the landmark${hardPois.length > 1 ? 's' : ''} at realistic size.** Undersized is the one failure
  that makes the whole block useless to us — when in doubt, go bigger.
- Don't give a plain house a feature interesting enough to compete with it.`
      : ''
  }
`;
writeFileSync(share('brief.md'), brief);
// placement manifest for block-compose.mjs
writeFileSync(
  `${outBase}-${id}-place.json`,
  JSON.stringify({ block: blockNum, x: bx1, y: by1, w: bw, h: bh, workCanvas: [cw, ch], base: [pxW, pxH] })
);

console.log(`${id}: bbox ${bw}×${bh}px @ (${bx1},${by1}) → work canvas ${cw}×${ch}`);
console.log(`  streets N[${sides.North}] E[${sides.East}] S[${sides.South}] W[${sides.West}]`);
console.log(`  hard POIs: ${hardPois.map((p) => p.name).join(', ') || 'none'}; named places: ${namedPois.length}`);
console.log(`  kit → ${kitDir}/ (brief.md, context.png, canvas.png)`);
