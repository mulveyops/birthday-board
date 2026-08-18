// Style C prototype slice generator.
// Reads REAL data (OSM footprints, city street trees, the actual board graph),
// composes a SceneModel ({assetId, variant, x, y, scale, rotation, layer}),
// and renders a standalone SVG. No changes to the live app.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { allSymbols, ASSET_META, STRUCT_COUNT, TREATMENT_COUNT, INK, HOUSE_BODIES, HOUSE_ROOFS, SHOP_BODIES, AWNINGS, CAR_BODIES } from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// raster heroes participate in normal placement/collision via ASSET_META
ASSET_META['hero.st_hedwig'] = { halfW: 22, cls: 'standing', hero: true };
const ROOT = join(HERE, '..');
const SCRATCH = 'C:/Users/Steven/AppData/Local/Temp/claude/C--Users-Steven-Documents-Birthday-2026/5d610d7c-43c1-4149-9704-c942971ebd14/scratchpad';

// ---- slices: pass a key as argv[2]; default = the canonical test slice ----
const SLICES = {
  // St. Hedwig -> Wolski's -> Pulaski courts, Brady St south edge
  pulaski: { S: 43.0518, W: -87.8992, N: 43.0566, E: -87.8934, out: 'style-c-slice' },
  // Cass Street Park quadrant (vocabulary-scaling test: unseen ground)
  cass: { S: 43.0493, W: -87.9035, N: 43.0541, E: -87.8975, out: 'style-c-slice-b' },
  // Phase B Test A: the Brady Street commercial spine + Wolski's + transitions
  brady: { S: 43.0517, W: -87.8998, N: 43.0558, E: -87.8933, out: 'style-c-brady' },
};
const SLICE = SLICES[process.argv[2] ?? 'pulaski'];
if (!SLICE) throw new Error(`unknown slice: ${process.argv[2]}`);
const MARGIN = 25; // world meters of grass beyond the slice

const board = JSON.parse(readFileSync(join(ROOT, 'birthday-board.json'), 'utf8'));
const raw = JSON.parse(readFileSync(join(SCRATCH, 'osm_raw.json'), 'utf8'));
const treeData = JSON.parse(readFileSync(join(ROOT, 'data', 'city_street_trees.json'), 'utf8')).trees;

// ---- projection: local meters, y down, origin at slice NW ----
const KY = 111320;
const KX = Math.cos(((SLICE.S + SLICE.N) / 2) * Math.PI / 180) * 111320;
const X = (lng) => (lng - SLICE.W) * KX + MARGIN;
const Y = (lat) => (SLICE.N - lat) * KY + MARGIN;
const W = (SLICE.E - SLICE.W) * KX + 2 * MARGIN;
const H = (SLICE.N - SLICE.S) * KY + 2 * MARGIN;
const inSlice = (lat, lng) => lat >= SLICE.S && lat <= SLICE.N && lng >= SLICE.W && lng <= SLICE.E;
const hash01 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---- board graph inside the slice ----
const sqById = new Map(board.squares.map((s) => [s.id, s]));
const edges = board.edges.filter((e) => {
  const a = sqById.get(e.from), b = sqById.get(e.to);
  return a && b && (inSlice(a.lat, a.lng) || inSlice(b.lat, b.lng));
});
const deg = new Map();
for (const e of edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
const nodes = board.squares
  .filter((s) => inSlice(s.lat, s.lng) && ((deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank'))
  .map((s) => ({ x: X(s.lng), y: Y(s.lat), type: s.type, title: s.title }));

// road segments in local meters (for setbacks + car placement)
const roadSegs = [];
for (const e of edges) {
  const a = sqById.get(e.from), b = sqById.get(e.to);
  const pts = (e.path && e.path.length >= 2 ? e.path : [a, b]).map((p) => [X(p.lng), Y(p.lat)]);
  for (let i = 1; i < pts.length; i++) roadSegs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
}
const distToRoad = (x, y) => {
  let best = Infinity, bx = 0, by = 0, bnx = 0, bny = 0;
  for (const [ax, ay, cx, cy] of roadSegs) {
    const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best) { best = d; bx = qx; by = qy; const L = Math.hypot(dx, dy) || 1; bnx = (x - qx) / (d || 1); bny = (y - qy) / (d || 1); void L; }
  }
  return { d: best, qx: bx, qy: by, nx: bnx, ny: bny };
};
const distToNode = (x, y) => Math.min(...nodes.map((n) => Math.hypot(n.x - x, n.y - y)), Infinity);

// ---- helpers over OSM geometry ----
const cent = (g) => { let la = 0, ln = 0; for (const p of g) { la += p.lat; ln += p.lon; } return { lat: la / g.length, lng: ln / g.length }; };
const areaOf = (g) => {
  if (!g || g.length < 3) return 0;
  let a = 0;
  const pts = g.map((p) => [X(p.lon), Y(p.lat)]);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
};
const longestEdgeAngle = (g) => {
  const pts = g.map((p) => [X(p.lon), Y(p.lat)]);
  let best = 0, bl = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const l = dx * dx + dy * dy;
    if (l > bl) { bl = l; best = Math.atan2(dy, dx) * 180 / Math.PI; }
  }
  return best;
};

// ================= SCENE COMPOSITION =================
const scene = []; // {assetId, variant, x, y, scale, rotation, layer, priority, name?}
const placedB = []; // buildings
const placedT = []; // trees
// commercial frontage packs tighter than detached residential (street-wall rhythm)
const canPlaceB = (x, y, r, f = 1.05) => placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= (p.r + r) * f);
const canPlaceT = (x, y) =>
  placedT.every((p) => Math.hypot(p.x - x, p.y - y) >= 7) &&
  placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= 4.5); // terrace trees may front the houses
const commitB = (entry, r) => { scene.push(entry); placedB.push({ x: entry.x, y: entry.y, r }); };
const commitT = (entry) => { scene.push(entry); placedT.push({ x: entry.x, y: entry.y }); };

// ---- 1. parks + recreation from real leisure geometry ----
// park polygons: programmed open space, not a green void — they get a ground
// tint, their real pitches/playgrounds, mapped picnic tables, and OSM trees
const parkPolys = [];
for (const el of raw.leisure.elements ?? []) {
  if (el.type !== 'way' || !el.geometry || el.tags?.leisure !== 'park') continue;
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  parkPolys.push({ name: el.tags.name, pts: el.geometry.map((g) => [X(g.lon), Y(g.lat)]) });
}
const inPark = (x, y) => parkPolys.some((pk) => {
  let inside = false;
  const p = pk.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
});

const seenGround = [];
const SPORT_ASSET = { tennis: 'ground.tennis', basketball: 'ground.basketball', baseball: 'ground.baseball' };
for (const el of raw.leisure.elements ?? []) {
  if (!el.geometry) {
    // mapped picnic tables inside parks: low-priority park detail
    if (el.type === 'node' && el.tags?.leisure === 'picnic_table') {
      const x = X(el.lon), y = Y(el.lat);
      if (inSlice(el.lat, el.lon) && inPark(x, y) && scene.filter((e) => e.assetId === 'furniture.picnic_table').length < 10) {
        scene.push({ assetId: 'furniture.picnic_table', variant: 0, x: +x.toFixed(1), y: +y.toFixed(1), scale: 1, rotation: Math.round(hash01(x, y) * 60 - 30), layer: 'ground', priority: 8, src: 'osm:picnic_table' });
      }
    }
    continue;
  }
  if (el.type !== 'way') continue;
  const t = el.tags ?? {};
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  const x = X(c.lng), y = Y(c.lat);
  if (t.leisure === 'pitch' && SPORT_ASSET[t.sport]) {
    // adjacent courts render individually (real layout); 8m dedupe kills only
    // duplicate mapping, not neighbors
    if (seenGround.some((g) => Math.hypot(g.x - x, g.y - y) < 8)) continue;
    const scale = t.sport === 'baseball' ? 1.6 : t.sport === 'tennis' ? 1 : 0.85;
    // anti-overlap: our simplified courts are bigger than the real footprints,
    // so nudge a same-sport neighbor apart instead of letting symbols collide
    const minSep = (t.sport === 'tennis' ? 18 : t.sport === 'basketball' ? 25 : 30) * scale;
    let nx = x, ny = y;
    const near = seenGround.find((g) => g.sport === t.sport && Math.hypot(g.x - x, g.y - y) < minSep);
    if (near) {
      const d = Math.hypot(x - near.x, y - near.y) || 1;
      nx = near.x + ((x - near.x) / d) * minSep;
      ny = near.y + ((y - near.y) / d) * minSep;
    }
    seenGround.push({ x: nx, y: ny, sport: t.sport });
    scene.push({ assetId: SPORT_ASSET[t.sport], variant: 0, x: +nx.toFixed(1), y: +ny.toFixed(1), scale, rotation: +longestEdgeAngle(el.geometry).toFixed(1), layer: 'ground', priority: 2, src: `osm:pitch:${t.sport}` });
  } else if (t.leisure === 'playground') {
    if (seenGround.some((g) => Math.hypot(g.x - x, g.y - y) < 26)) continue;
    seenGround.push({ x, y });
    // composition varies deterministically so six playgrounds don't stamp
    scene.push({ assetId: 'ground.playground', structure: Math.floor(hash01(x, y) * 3), variant: 0, x: +x.toFixed(1), y: +y.toFixed(1), scale: 1.6, rotation: 0, layer: 'ground', priority: 3, src: 'osm:playground' });
  }
}

// ---- 2. buildings: classify -> priority cast ----
const bars = new Set(['wolski', 'y-not', 'jamo', 'club brady', 'malone', 'hosed', 'fink']);
const classify = (el) => {
  const t = el.tags ?? {};
  const b = t.building;
  const lv = parseFloat(t['building:levels'] ?? '0');
  const area = areaOf(el.geometry);
  const name = t.name;
  // Phase D2 raster hero test: St. Hedwig only, name-keyed
  if (name && /hedwig catholic/i.test(name)) {
    return { assetId: 'hero.st_hedwig', priority: 0, s: 1, name, structure: 0 };
  }
  if (b === 'church' || (t.amenity === 'place_of_worship' && b !== 'construction' && b)) {
    // real data picks the skyline: tall/large -> tower church, wide -> twin-tower
    // parish, small -> neighborhood church
    const structure = lv >= 4 || area > 450 ? 0 : area > 320 ? 1 : 2;
    return { assetId: 'bldg.civ.church', priority: 1, s: [1.7, 1.4, 1.15][structure], name, structure };
  }
  if (b === 'school' || t.amenity === 'school') {
    const structure = lv >= 3 ? 1 : 0;
    return { assetId: 'bldg.civ.school', priority: 1, s: 1.2, name, structure };
  }
  const isBar = name && [...bars].some((k) => name.toLowerCase().includes(k));
  if (isBar) return { assetId: 'bldg.com.corner_tavern', priority: 2, s: 1.3, name };
  if (b === 'retail' || b === 'commercial') {
    // multi-level commercial = mixed-use (shop below, homes above); the urban
    // bridge between storefront and apartment fabric
    if (lv >= 3 || (lv >= 2 && area > 180)) {
      return { assetId: 'bldg.com.mixed_use', priority: 2, s: Math.min(1.15, 0.9 + lv * 0.05), name, lv };
    }
    return { assetId: 'bldg.com.storefront', priority: 4, s: Math.min(1.15, 0.85 + area / 900), name };
  }
  if (b === 'terrace') {
    return { assetId: 'bldg.res.rowhouse', priority: 3, s: Math.max(0.95, Math.min(1.25, Math.sqrt(area) / 13)), name, structure: 0 };
  }
  if (b === 'apartments' || b === 'condominium' || (lv >= 3 && area > 250)) {
    return { assetId: 'bldg.res.apartment', priority: 3, s: Math.min(1.2, 0.85 + lv * 0.06), name, lv };
  }
  if (b === 'shed') {
    if (area < 8 || area > 40) return null;
    return { assetId: 'bldg.res.shed', priority: 6, s: Math.max(0.9, Math.min(1.15, Math.sqrt(area) / 4.5)), name, structure: Math.floor(hash01(area * 3.1, area + 1) * 2) };
  }
  if (b === 'garage' || b === 'barn' || b === 'roof') {
    if (area < 18 || area > 90) return null;
    return { assetId: 'bldg.res.garage', priority: 6, s: Math.max(0.85, Math.min(1.15, Math.sqrt(area) / 7)), name };
  }
  if (b === 'house' || b === 'residential' || b === 'detached' || b === 'yes') {
    if (area < 55) return null; // fewer tiny objects
    const s = Math.max(1.05, Math.min(1.45, Math.sqrt(area) / 9.5));
    if (lv >= 2) {
      // structure from data: genuinely wide 2-stories become the duplex,
      // the rest split across the three narrow-lot silhouettes
      const structure = area >= 165 ? 2 : [0, 1, 3][Math.floor(hash01(area * 2.3, lv + area) * 3)];
      return { assetId: 'bldg.res.polish_flat', priority: 5, s, name, structure };
    }
    return { assetId: 'bldg.res.bungalow', priority: 5, s, name, structure: Math.floor(hash01(area * 1.7, area) * 3) };
  }
  return null;
};

// POI category index: business category influences storefront TREATMENT
// (awning/sign/window/patio character), never a floating icon
const poiCats = [];
for (const el of raw.pois.elements ?? []) {
  const t = el.tags ?? {};
  const c = el.center ?? el;
  if (c.lat == null) continue;
  let cat = null;
  if (['bar', 'pub', 'biergarten'].includes(t.amenity)) { cat = 'bar'; }
  else if (['restaurant', 'fast_food'].includes(t.amenity)) cat = 'food';
  else if (['cafe', 'ice_cream'].includes(t.amenity)) cat = 'cafe';
  else if (t.shop === 'bakery' || t.shop === 'confectionery') cat = 'bakery';
  else if (['hairdresser', 'beauty', 'tattoo', 'dry_cleaning'].includes(t.shop)) cat = 'salon';
  else if (t.shop) cat = 'shop';
  if (cat) poiCats.push({ x: X(c.lon), y: Y(c.lat), cat, name: t.name });
}
const catNear = (x, y, r = 20) => {
  let best = null;
  for (const p of poiCats) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < r && (!best || d < best.d)) best = { d, cat: p.cat };
  }
  return best?.cat ?? null;
};
// category -> storefront treatment index (t0..t5, see assets.mjs)
const CAT_TREATMENT = { bakery: 0, food: 0, salon: 1, shop: 2, cafe: 3, bar: 5 };

// alley geometry up front so garages can face their alley
const alleyPts = [];
for (const el of raw.transport.elements ?? []) {
  if (el.type === 'way' && el.tags?.highway === 'service' && el.tags.service === 'alley' && el.geometry)
    for (const g of el.geometry) alleyPts.push([X(g.lon), Y(g.lat)]);
}

let candidates = [];
for (const el of raw.buildings.elements ?? []) {
  if (el.type !== 'way' || !el.geometry) continue;
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  const cls = classify(el);
  if (!cls) continue;
  candidates.push({ ...cls, x: X(c.lng), y: Y(c.lat), area: areaOf(el.geometry) });
}

// ---- storefront ROW pre-pass: 2-3 adjacent shops merge into one composite
// building (the Brady St fix: a row asset instead of repeated singles) ----
{
  const shops = candidates.filter((c) => c.assetId === 'bldg.com.storefront');
  const rest = candidates.filter((c) => c.assetId !== 'bldg.com.storefront');
  const used = new Set();
  const out = [];
  for (let i = 0; i < shops.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = 0; j < shops.length && group.length < 3; j++) {
      if (j === i || used.has(j)) continue;
      if (group.some((g) => Math.hypot(shops[g].x - shops[j].x, shops[g].y - shops[j].y) < 26)) group.push(j);
    }
    used.add(i);
    if (group.length >= 2) {
      group.forEach((g) => used.add(g));
      const xs = group.map((g) => shops[g]);
      out.push({
        assetId: 'bldg.com.storefront_row', priority: 3,
        s: 1, name: undefined,
        structure: xs.length - 2, // s0 = 2-bay, s1 = 3-bay
        x: xs.reduce((s2, v) => s2 + v.x, 0) / xs.length,
        y: xs.reduce((s2, v) => s2 + v.y, 0) / xs.length,
        area: xs.reduce((s2, v) => s2 + v.area, 0),
        merged: xs.length,
      });
    } else out.push(shops[i]);
  }
  candidates = [...rest, ...out];
}
// rule: a bar POI in a commercial building near an intersection promotes the
// building to a corner tavern (the Brady Street pattern) — before the sort so
// taverns claim their corners first
for (const c of candidates) {
  if ((c.assetId !== 'bldg.com.storefront' && c.assetId !== 'bldg.com.mixed_use') || distToNode(c.x, c.y) >= 34) continue;
  let bar = null;
  for (const p of poiCats) {
    if (p.cat !== 'bar') continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < 17 && (!bar || d < bar.d)) bar = { d, name: p.name };
  }
  if (bar) { c.assetId = 'bldg.com.corner_tavern'; c.priority = 2; c.s = Math.max(c.s, 1.15); c.name = c.name ?? bar.name; c.structure = 0; }
}
candidates.sort((a, b) => a.priority - b.priority || b.area - a.area);

const NODE_CLEAR = { 0: 26, 1: 22, 2: 20, 3: 22, 4: 20, 5: 24, 6: 22 };
let garages = 0;
for (const c of candidates) {
  const meta = ASSET_META[c.assetId];
  const road = distToRoad(c.x, c.y);
  let { x, y } = c;
  // road half-width is 13m; keep every facade fully off the pavement,
  // trees own the 15m terrace band so buildings start behind it
  const setback = 15.5 + meta.halfW * c.s * 0.55;
  if (road.d < setback) { x = road.qx + road.nx * setback; y = road.qy + road.ny * setback; }
  else if (road.d > 34 && c.priority >= 5) continue; // deep-interior houses: negative space
  if (distToNode(x, y) < NODE_CLEAR[c.priority]) continue;
  const r = meta.halfW * c.s;
  if (!canPlaceB(x, y, r, c.assetId.startsWith('bldg.com') ? 0.82 : 1.05)) continue;
  if (c.assetId === 'bldg.res.garage' || c.assetId === 'bldg.res.shed') {
    // an outbuilding alone in a field reads as debris — only place near a building
    if (!placedB.some((p) => Math.hypot(p.x - x, p.y - y) < 24)) continue;
    if (++garages > 12) continue;
  }
  // min-readable rule: an asset too small to read gets suppressed, never shrunk
  if (c.s < 0.85) continue;
  // apartment structure from data: 4+ stories -> tall s3; near a corner -> s2;
  // big footprint -> wide brick s1; else narrow walk-up s0
  let structure = c.structure ?? 0;
  if (c.assetId === 'bldg.res.apartment') {
    structure = (c.lv ?? 0) >= 4 ? 3 : distToNode(x, y) < 36 ? 2 : c.area > 280 ? 1 : 0;
  }
  if (c.assetId === 'bldg.com.mixed_use') {
    structure = distToNode(x, y) < 34 ? 2 : (c.lv ?? 0) >= 3 ? 1 : 0;
  }
  // garages near a mapped alley become the flat-roof alley type, facing it
  let garageFacing;
  if (c.assetId === 'bldg.res.garage' && alleyPts.length) {
    let bestA = null;
    for (const p of alleyPts) { const d2 = Math.hypot(p[0] - x, p[1] - y); if (!bestA || d2 < bestA.d) bestA = { d: d2, px: p[0], py: p[1] }; }
    if (bestA && bestA.d < 30) { structure = 1; garageFacing = Math.round(Math.atan2(bestA.py - y, bestA.px - x) * 180 / Math.PI); }
  }
  // facing: screen-space bearing toward the frontage this asset addresses
  // (corner assets face their intersection, street assets face the street)
  let facing = garageFacing;
  const isCornerForm = c.assetId === 'bldg.com.corner_tavern' ||
    (c.assetId === 'bldg.res.apartment' && structure === 2) ||
    (c.assetId === 'bldg.com.mixed_use' && structure === 2);
  if (c.assetId.startsWith('bldg.com') || isCornerForm) {
    let tx, ty;
    if (isCornerForm) {
      let best = null;
      for (const n2 of nodes) { const d2 = Math.hypot(n2.x - x, n2.y - y); if (!best || d2 < best.d) best = { d: d2, x: n2.x, y: n2.y }; }
      tx = best.x; ty = best.y;
    } else { tx = road.qx; ty = road.qy; }
    facing = Math.round(Math.atan2(ty - y, tx - x) * 180 / Math.PI);
  }
  const h = hash01(x, y);
  // commercial treatment from business category (variant = treatment*16 + palette)
  let variant = Math.floor(h * 96);
  const nT = TREATMENT_COUNT[c.assetId];
  if (nT) {
    const cat = catNear(x, y);
    const t = c.assetId === 'bldg.com.storefront'
      ? (cat != null ? CAT_TREATMENT[cat] : Math.floor(h * nT))
      : Math.floor(h * nT); // row layouts rotate; bays inside already vary
    commitB({ assetId: c.assetId, variant: (t % nT) * 16 + Math.floor(h * 16), structure, facing, x: +x.toFixed(1), y: +y.toFixed(1), scale: +c.s.toFixed(2), rotation: 0, layer: 'standing', priority: c.priority, name: c.name, cat: cat ?? undefined, src: 'osm:building' }, r);
    continue;
  }
  commitB({ assetId: c.assetId, variant, structure, facing, x: +x.toFixed(1), y: +y.toFixed(1), scale: +c.s.toFixed(2), rotation: 0, layer: 'standing', priority: c.priority, name: c.name, src: 'osm:building' }, r);
}

// ---- 3. trees: real city inventory, species -> asset, DBH -> scale ----
const speciesAsset = (t) => {
  const g = (t.genus || '').toLowerCase(), s = (t.species || '').toLowerCase();
  if (g === 'linden') return 'tree.linden';
  if (g === 'honeylocust') return 'tree.honeylocust';
  if (g === 'maple') return 'tree.maple';
  if (g === 'ash') return 'tree.ash';
  if (g === 'elm' || g === 'hackberry') return 'tree.elm';
  if (g === 'oak') return 'tree.oak';
  if (['lilac', 'pear', 'serviceberry', 'apple', 'hawthorn'].includes(g)) return 'tree.flowering';
  if (s.includes('linden')) return 'tree.linden';
  return 'tree.maple'; // generic shade fallback
};
let treeStats = { cast: 0, skipped: 0 };
for (const t of treeData) {
  if (!inSlice(t.lat, t.lng)) continue;
  const assetId = speciesAsset(t);
  // mature elm/oak become small environmental landmarks — higher scale ceiling
  const cap = assetId === 'tree.elm' || assetId === 'tree.oak' ? 2.05 : 1.7;
  const s = Math.max(0.85, Math.min(cap, 0.85 + (t.dbh_in ?? 8) / 24));
  let x = X(t.lng), y = Y(t.lat);
  const road = distToRoad(x, y);
  // terrace band: trees stand just off the road edge (half-width 13m) so
  // canopies peek over the pavement — in FRONT of the building line
  if (road.d < 15) { x = road.qx + road.nx * 15; y = road.qy + road.ny * 15; }
  if (distToNode(x, y) < 22) { treeStats.skipped++; continue; }
  if (!canPlaceT(x, y)) { treeStats.skipped++; continue; }
  const structure = assetId === 'tree.flowering' ? Math.floor(hash01(x * 0.9, y * 1.1) * 2) : 0;
  commitT({ assetId, structure, variant: Math.floor(hash01(x, y) * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: +s.toFixed(2), rotation: 0, layer: 'standing', priority: 7, src: `city:${t.species} ${t.dbh_in}"` });
  treeStats.cast++;
}

// ---- 3a2. OSM tree nodes inside parks: the city inventory covers streets,
// OSM covers park interiors — species unknown, so hash-pick a shade family
let parkTrees = 0;
for (const el of raw.trees.elements ?? []) {
  if (el.type !== 'node' || el.tags?.natural !== 'tree') continue;
  if (!inSlice(el.lat, el.lon)) continue;
  const x = X(el.lon), y = Y(el.lat);
  if (!inPark(x, y)) continue;
  if (distToRoad(x, y).d < 15 || distToNode(x, y) < 20) continue;
  if (!canPlaceT(x, y)) continue;
  // parks breathe: wider tree spacing than street terraces, and canopies must
  // not bury the recreation assets
  if (!placedT.every((p) => Math.hypot(p.x - x, p.y - y) >= 10)) continue;
  if (scene.some((e) => e.layer === 'ground' && e.assetId !== 'furniture.picnic_table' && Math.hypot(e.x - x, e.y - y) < 15)) continue;
  const h = hash01(x * 1.3, y * 0.9);
  const assetId = ['tree.maple', 'tree.linden', 'tree.ash', 'tree.oak'][Math.floor(h * 4)];
  commitT({ assetId, structure: 0, variant: Math.floor(h * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: +(0.9 + h * 0.4).toFixed(2), rotation: 0, layer: 'standing', priority: 7, src: 'osm:tree' });
  parkTrees++;
}

// ---- 3b. yard conifers: procedural dressing tucked behind a few houses
// (the city street inventory has zero conifers — these are private-yard trees)
let conifers = 0;
for (const e of [...scene]) {
  if (conifers >= 12) break;
  if (e.layer !== 'standing' || (e.assetId !== 'bldg.res.polish_flat' && e.assetId !== 'bldg.res.bungalow')) continue;
  if (hash01(e.x * 2.1, e.y * 1.7) > 0.34) continue;
  const road = distToRoad(e.x, e.y);
  const bx = e.x - road.nx * 10 + (hash01(e.y, e.x) - 0.5) * 9;
  const by = e.y - road.ny * 10 + (hash01(e.x + 7, e.y) - 0.5) * 9;
  if (distToRoad(bx, by).d < 15.5 || distToNode(bx, by) < 22) continue;
  if (!canPlaceT(bx, by)) continue;
  commitT({ assetId: 'tree.conifer', structure: Math.floor(hash01(bx, by) * 3), variant: 0, x: +bx.toFixed(1), y: +by.toFixed(1), scale: +(0.9 + hash01(by, bx) * 0.35).toFixed(2), rotation: 0, layer: 'standing', priority: 7, src: 'procedural:yard_conifer' });
  conifers++;
}

// ---- 4. parked cars: ambient, near commercial frontage, E-W streets only ----
let cars = 0;
for (const [ax, ay, bx, by] of roadSegs) {
  if (cars >= 12) break;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 34 || Math.abs(dx) < Math.abs(dy) * 1.2) continue; // E-W-ish only (side-view sprite)
  for (const f of [0.35, 0.68]) {
    if (cars >= 12) break;
    const px = ax + dx * f, py = ay + dy * f;
    if (hash01(px, py) < 0.45) continue; // scatter, not a parade
    const side = hash01(py, px) < 0.5 ? 1 : -1;
    const nx = -dy / len, ny = dx / len;
    const x = px + nx * 10 * side, y = py + ny * 10 * side;
    if (distToNode(x, y) < 22) continue;
    if (!placedT.every((p) => Math.hypot(p.x - x, p.y - y) >= 5)) continue;
    if (!placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= 7)) continue;
    scene.push({ assetId: 'vehicle.parked_car', structure: hash01(x + 3, y) < 0.6 ? 0 : hash01(x + 3, y) < 0.9 ? 1 : 2, variant: Math.floor(hash01(x, y) * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: 2.1, rotation: 0, layer: 'standing', priority: 8, src: 'procedural:parked_car' });
    placedB.push({ x, y, r: 4 });
    cars++;
  }
}

// ---- 5. QUIET PROPERTY-GROUNDING LAYER (real mapped lot fabric) ----
// driveways/alleys from highway=service, fences/walls from barrier ways,
// short entry walks derived per placed house. Low contrast, planar, selective.
const propStats = { driveway: 0, alley: 0, fence: 0, retaining_wall: 0, wall: 0, hedge: 0, walk: 0 };
const inView = (x, y) => x > -5 && y > -5 && x < W + 5 && y < H + 5;
// clip a polyline against the road pavement and the viewport; return sub-runs
const clipRuns = (pts, minLen = 4) => {
  const runs = [];
  let cur = [];
  for (const [x, y] of pts) {
    if (inView(x, y) && distToRoad(x, y).d > 13.2) cur.push([+x.toFixed(1), +y.toFixed(1)]);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r2) => r2.length >= 2 && r2.reduce((s2, p, i) => i ? s2 + Math.hypot(p[0] - r2[i - 1][0], p[1] - r2[i - 1][1]) : 0, 0) > minLen);
};
const pushProp = (kind, pts) => {
  scene.push({ assetId: `prop.${kind}`, layer: 'property', pts, src: kind === 'walk' ? 'derived' : 'osm' });
  propStats[kind]++;
};
for (const el of raw.transport.elements ?? []) {
  if (el.type !== 'way' || !el.geometry || el.tags?.highway !== 'service') continue;
  const svc = el.tags.service;
  if (svc !== 'driveway' && svc !== 'alley') continue;
  const pts = el.geometry.map((g) => [X(g.lon), Y(g.lat)]);
  // driveway fragments under 7.5m visible read as disconnected dashes — drop
  for (const run of clipRuns(pts, svc === 'driveway' ? 7.5 : 4)) {
    if (svc === 'driveway') {
      // only driveways that serve a building we actually rendered
      if (propStats.driveway >= 130) continue;
      if (!run.some(([x, y]) => placedB.some((p) => Math.hypot(p.x - x, p.y - y) < 30))) continue;
      pushProp('driveway', run);
    } else pushProp('alley', run);
  }
}
for (const el of raw.trees.elements ?? []) {
  if (el.type !== 'way' || !el.geometry || !el.tags?.barrier) continue;
  const kind = el.tags.barrier;
  if (!['fence', 'retaining_wall', 'wall', 'hedge'].includes(kind)) continue;
  if (propStats.fence + propStats.retaining_wall + propStats.wall >= 190) continue;
  const pts = el.geometry.map((g) => [X(g.lon), Y(g.lat)]);
  for (const run of clipRuns(pts)) pushProp(kind, run);
}
// derived entry walks: house front door -> sidewalk edge
for (const e of scene) {
  if (e.layer !== 'standing') continue;
  if (e.assetId !== 'bldg.res.polish_flat' && e.assetId !== 'bldg.res.bungalow') continue;
  if (hash01(e.x * 1.3, e.y * 0.7) > 0.55) continue;
  const road = distToRoad(e.x, e.y);
  if (road.d < 14.5 || road.d > 30) continue;
  const ex = road.qx + road.nx * 13.6, ey = road.qy + road.ny * 13.6;
  scene.push({ assetId: 'prop.walk', layer: 'property', pts: [[+e.x.toFixed(1), +(e.y + 0.6).toFixed(1)], [+ex.toFixed(1), +ey.toFixed(1)]], src: 'procedural:entry_walk' });
  propStats.walk++;
}

// ---- 5b. PARKING LOTS: real polygons (fetched geometry), quietest layer ----
const parkingLots = [];
for (const el of raw.parking?.elements ?? []) {
  if (el.type !== 'way' || !el.geometry) continue;
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  const area = areaOf(el.geometry);
  if (area < 220 || area > 4500) continue;
  const cx = X(c.lng), cy = Y(c.lat);
  if (distToNode(cx, cy) < 30) continue;
  if (parkingLots.length >= 8) break;
  const ang = longestEdgeAngle(el.geometry) * Math.PI / 180;
  parkingLots.push({ pts: el.geometry.map((g) => [+X(g.lon).toFixed(1), +Y(g.lat).toFixed(1)]), cx, cy, area, ang });
  scene.push({ assetId: 'prop.parking', layer: 'property', pts: parkingLots[parkingLots.length - 1].pts, src: 'osm:parking' });
  // sparse deterministic occupancy: a lot shows a few cars, never a full grid
  const k = Math.max(1, Math.min(5, Math.floor(area / 260)));
  const ux = Math.cos(ang), uy = Math.sin(ang);
  for (let i = 0; i < k; i++) {
    if (hash01(cx + i * 7.1, cy) < 0.35) continue;
    const off = (i - (k - 1) / 2) * 6;
    const px = cx + ux * off, py = cy + uy * off;
    if (distToNode(px, py) < 22 || distToRoad(px, py).d < 13.5) continue;
    scene.push({ assetId: 'vehicle.parked_car', structure: hash01(px, py) < 0.6 ? 0 : hash01(px, py) < 0.9 ? 1 : 2, variant: Math.floor(hash01(py, px) * 96), x: +px.toFixed(1), y: +py.toFixed(1), scale: 1.9, rotation: 0, layer: 'standing', priority: 8, src: 'procedural:parking_cluster' });
  }
}

// ---- 6. FURNITURE (D1): exact mapped objects; loses every collision fight ----
// Context emerges from the data itself: benches/racks cluster where mapped
// (commercial + parks), hydrants pepper residential streets, dumpsters hide
// behind commercial along alleys.
const furn = [];
const furnStats = {};
const furnOK = (x, y, clear) =>
  distToNode(x, y) > 18 &&
  placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r * 0.5 + 2.5) &&
  placedT.every((p) => Math.hypot(p.x - x, p.y - y) >= 2.5) &&
  furn.every((p) => Math.hypot(p.x - x, p.y - y) >= clear);
const placeFurn = (assetId, x0, y0, opts = {}) => {
  let x = x0, y = y0;
  const road = distToRoad(x, y);
  if (road.d < 13.8) { x = road.qx + road.nx * 13.8; y = road.qy + road.ny * 13.8; } // curb band
  if (!inView(x, y)) return false;
  if (!furnOK(x, y, opts.clear ?? 4)) return false;
  scene.push({ assetId, structure: opts.structure ?? 0, variant: 0, x: +x.toFixed(1), y: +y.toFixed(1), scale: opts.scale ?? 1, rotation: 0, layer: 'standing', priority: 8, src: opts.src });
  furn.push({ x, y });
  furnStats[assetId] = (furnStats[assetId] ?? 0) + 1;
  return true;
};
for (const el of raw.transport.elements ?? []) {
  if (el.type !== 'node' || !inSlice(el.lat, el.lon)) continue;
  const t = el.tags ?? {};
  const x = X(el.lon), y = Y(el.lat);
  if (t.emergency === 'fire_hydrant') placeFurn('furniture.hydrant', x, y, { scale: 1.15, src: 'osm:fire_hydrant' });
  else if (t.highway === 'bus_stop') placeFurn('furniture.bus_stop', x, y, { structure: t.shelter === 'yes' ? 1 : 0, clear: 6, src: 'osm:bus_stop' });
  else if (t.man_made === 'flagpole') placeFurn('furniture.flagpole', x, y, { src: 'osm:flagpole' });
}
let racks = 0, cans = 0;
for (const el of raw.pois.elements ?? []) {
  if (el.type !== 'node' || !inSlice(el.lat ?? 0, el.lon ?? 0)) continue;
  const t = el.tags ?? {};
  const x = X(el.lon), y = Y(el.lat);
  // thinning by class: benches 12m apart, racks 25m apart + cap, cans 40m + cap
  if (t.amenity === 'bench') placeFurn('furniture.bench', x, y, { clear: 12, src: 'osm:bench' });
  else if (t.amenity === 'bicycle_parking' && racks < 12) { if (placeFurn('furniture.bike_rack', x, y, { clear: 25, src: 'osm:bicycle_parking' })) racks++; }
  else if (t.amenity === 'waste_basket' && cans < 6) { if (placeFurn('furniture.trash_can', x, y, { clear: 40, src: 'osm:waste_basket' })) cans++; }
}
// dumpsters: procedural, extremely sparse — alley midpoints behind commercial
let dumpsters = 0;
for (const e of scene.filter((s2) => s2.assetId === 'prop.alley')) {
  if (dumpsters >= 3) break;
  const mid = e.pts[Math.floor(e.pts.length / 2)];
  const commercialNear = scene.some((b2) => b2.assetId?.startsWith?.('bldg.com') && Math.hypot(b2.x - mid[0], b2.y - mid[1]) < 34);
  if (!commercialNear) continue;
  const jx = mid[0] + (hash01(mid[0], mid[1]) - 0.5) * 5, jy = mid[1] + 3;
  if (placeFurn('infra.dumpster', jx, jy, { clear: 30, src: 'procedural:dumpster' })) dumpsters++;
}

// ---- 7. HERO EVICTION: heroes claim visual territory (30m), path untouched ----
// suppress ordinary buildings (prio>=4), furniture/cars (8), procedural & park
// trees; KEEP city-inventory street trees outside 20m, all ground assets, path
const HERO_RASTER = {
  'hero.st_hedwig': {
    file: join(HERE, 'heroes', 'st-hedwig-v2.png'),
    widthM: 60,            // display width in world meters (aspect preserved)
    aspect: 1448 / 1086,   // h/w of the bitmap
    anchorX: 0.21,         // v2: tower-base entrance sits lower-LEFT (west facade)
    anchorY: 0.88,
    dxM: -20,              // anchor the tower over the real tower (west end of the
                           // 48m footprint), letting the nave stretch back east
    evict: 30,
  },
};
const heroes = scene.filter((e) => HERO_RASTER[e.assetId]);
if (heroes.length) {
  const keep = (e) => {
    for (const hz of heroes) {
      if (e === hz) continue;
      const d = Math.hypot(e.x - hz.x, e.y - hz.y);
      const R = HERO_RASTER[hz.assetId].evict;
      if (d > R) continue;
      if (e.layer === 'ground') continue;                             // recreation stays
      if (e.layer === 'property') continue;                           // handled below by kind
      if (e.priority <= 3 && !e.assetId.startsWith('tree.') && e.layer === 'standing') continue; // civic/commercial neighbors stay
      if (e.src?.startsWith('city:') && d > 20) continue;             // real street trees survive at the terrace band
      return false;
    }
    return true;
  };
  const before = scene.length;
  const propMid = (e) => [(e.pts[0][0] + e.pts[e.pts.length - 1][0]) / 2, (e.pts[0][1] + e.pts[e.pts.length - 1][1]) / 2];
  const kept = scene.filter((e) => {
    if (e.layer === 'property' && (e.assetId === 'prop.walk' || e.assetId === 'prop.driveway')) {
      // baked-in sidewalk/landscaping in the raster replaces derived walks nearby
      const [mx, my] = propMid(e);
      return !heroes.some((hz) => Math.hypot(mx - hz.x, my - hz.y) < 26);
    }
    if (e.assetId === 'prop.parking') {
      // a half-hidden lot poking out from behind a hero reads as an artifact —
      // drop the lot if ANY vertex sits inside the hero zone
      return !heroes.some((hz) => e.pts.some((p) => Math.hypot(p[0] - hz.x, p[1] - hz.y) < 40));
    }
    if (e.src === 'procedural:parking_cluster') {
      return !heroes.some((hz) => Math.hypot(e.x - hz.x, e.y - hz.y) < 42);
    }
    return keep(e);
  });
  scene.length = 0;
  scene.push(...kept);
  console.error('hero eviction removed', before - kept.length, 'entries');
}

// ================= RENDER =================
const GRASS = '#a9d476';
const ROAD_FILL = '#f3ead6';
const CASING = '#4a3f33';
const SIDEWALK = '#e3d9bf';
const CASING_M = 26, FILL_M = 20;

const edgeLines = edges.map((e) => {
  const a = sqById.get(e.from), b = sqById.get(e.to);
  const pts = (e.path && e.path.length >= 2 ? e.path : [a, b]).map((p) => `${X(p.lng).toFixed(1)},${Y(p.lat).toFixed(1)}`).join(' ');
  return pts;
});

const variantStyle = (e) => {
  const v = e.variant ?? 0;
  if (e.assetId === 'bldg.res.polish_flat' || e.assetId === 'bldg.res.bungalow') {
    const body = HOUSE_BODIES[v % HOUSE_BODIES.length];
    const roof = HOUSE_ROOFS[(v + 2) % HOUSE_ROOFS.length];
    return `--body:${body};--roof:${roof};--roofdark:${shade(roof, -26)};--side:${shade(body, -18)}`;
  }
  if (e.assetId === 'bldg.com.storefront' || e.assetId === 'bldg.com.mixed_use') {
    const p = v % 16;
    const body = SHOP_BODIES[p % SHOP_BODIES.length];
    return `--body:${body};--side:${shade(body, -22)};--awn:${AWNINGS[p % AWNINGS.length]}`;
  }
  if (e.assetId === 'bldg.com.storefront_row') {
    const p = v % 16;
    const b = (i) => SHOP_BODIES[(p + i * 2) % SHOP_BODIES.length];
    const a = (i) => AWNINGS[(p + i * 3 + 1) % AWNINGS.length];
    return `--b0:${b(0)};--b1:${b(1)};--b2:${b(2)};--a0:${a(0)};--a1:${a(1)};--a2:${a(2)};--side:${shade(b(2), -22)}`;
  }
  if (e.assetId === 'bldg.res.rowhouse') {
    const u = (i) => HOUSE_BODIES[(v + i * 3) % HOUSE_BODIES.length];
    return `--u0:${u(0)};--u1:${u(1)};--u2:${u(2)}`;
  }
  if (e.assetId === 'vehicle.parked_car') return `--body:${CAR_BODIES[v % CAR_BODIES.length]}`;
  if (e.assetId === 'bldg.res.apartment' && (e.structure ?? 0) === 0) {
    const body = ['#e0b48f', '#d9a8a0', '#c9c09a'][v % 3];
    return `--body:${body};--side:${shade(body, -20)}`;
  }
  return '';
};
const symbolRef = (e) => {
  const nT = TREATMENT_COUNT[e.assetId];
  const t = nT ? Math.floor((e.variant ?? 0) / 16) % nT : 0;
  if (e.assetId === 'bldg.com.storefront') return `${e.assetId}.t${t}`;
  if (e.assetId === 'bldg.com.storefront_row') return `${e.assetId}.s${(e.structure ?? 0) % 2}.t${t}`;
  return STRUCT_COUNT[e.assetId] ? `${e.assetId}.s${(e.structure ?? 0) % STRUCT_COUNT[e.assetId]}` : e.assetId;
};
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (x) => Math.max(0, Math.min(255, x + amt));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => c(x).toString(16).padStart(2, '0')).join('');
}

const groundEls = scene.filter((e) => e.layer === 'ground');
const standingEls = scene.filter((e) => e.layer === 'standing').sort((a, b) => a.y - b.y);

const heroData = {};
for (const [id, cfg] of Object.entries(HERO_RASTER)) {
  try { heroData[id] = 'data:image/png;base64,' + readFileSync(cfg.file).toString('base64'); } catch { /* missing file: hero renders nothing */ }
}
const shadowFor = (e) => {
  const m = ASSET_META[e.assetId];
  if (!m || m.cls === 'ground') return '';
  const rx = (m.halfW * 0.92 * e.scale).toFixed(1);
  return `<ellipse cx="${e.x + 1.2}" cy="${e.y + 1.3}" rx="${rx}" ry="${(m.cls === 'tree' ? 1.9 : 2.6)}" fill="#2c2318" opacity="0.13"/>`;
};

const nodeColor = { blank: '#f7f1e0', coin: '#f2c94c', chance: '#b06ef7', challenge: '#5b8fd9', bar: '#e8a33d', poi: '#ec6fa9', start: '#6fbf73', finish: '#e8e4da', bowser: '#5b8fd9' };

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="Georgia, serif">
<defs>${allSymbols()}
  <filter id="lift" x="-5%" y="-5%" width="110%" height="110%">
    <feDropShadow dx="0" dy="1.6" stdDeviation="2" flood-color="#33291f" flood-opacity="0.3"/>
  </filter>
</defs>
<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${GRASS}"/>
<!-- subtle lawn variation -->
${Array.from({ length: 60 }, (_, i) => {
  const gx = hash01(i * 3.7, 11) * W, gy = hash01(i * 7.1, 5) * H;
  const gr = 16 + hash01(i, i) * 34;
  return `<circle cx="${gx.toFixed(0)}" cy="${gy.toFixed(0)}" r="${gr.toFixed(0)}" fill="#9ecb6a" opacity="0.35"/>`;
}).join('')}
<!-- PARK GROUND — programmed open space gets its own richer green -->
${parkPolys.map((pk) => `<polygon points="${pk.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="#a2d06c" stroke="#92c05d" stroke-width="1.2" stroke-linejoin="round"/>`).join('\n')}
<!-- QUIET PROPERTY FABRIC — real lot lines, below everything but grass -->
${(() => {
  const style = {
    driveway: 'stroke="#cfc7ae" stroke-width="2.8" stroke-linecap="round" opacity="0.9"',
    alley: 'stroke="#d8cfb6" stroke-width="5.5" stroke-linecap="round" opacity="0.9"',
    walk: 'stroke="#e3dbc6" stroke-width="1.3" stroke-linecap="round" opacity="0.95"',
    fence: 'stroke="#a08453" stroke-width="0.55" stroke-dasharray="2.1 1.5" opacity="0.75"',
    retaining_wall: 'stroke="#a29a8a" stroke-width="1.25" stroke-linecap="round" opacity="0.9"',
    wall: 'stroke="#a29a8a" stroke-width="1.05" stroke-linecap="round" opacity="0.9"',
    hedge: 'stroke="#4f8f45" stroke-width="1.9" stroke-linecap="round" opacity="0.85"',
  };
  return scene.filter((e) => e.layer === 'property')
    .map((e) => {
      if (e.assetId === 'prop.parking') {
        // planar service space: subdued fill, faint edge, minimal stall rhythm
        const cx = e.pts.reduce((s2, p) => s2 + p[0], 0) / e.pts.length;
        const cy = e.pts.reduce((s2, p) => s2 + p[1], 0) / e.pts.length;
        let ang = 0, bl = -1;
        for (let i = 1; i < e.pts.length; i++) {
          const dx = e.pts[i][0] - e.pts[i - 1][0], dy = e.pts[i][1] - e.pts[i - 1][1];
          if (dx * dx + dy * dy > bl) { bl = dx * dx + dy * dy; ang = Math.atan2(dy, dx); }
        }
        const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
        const n = Math.min(7, Math.floor(Math.sqrt(bl) / 3.2));
        const ticks = Array.from({ length: n }, (_, i) => {
          const o = (i - (n - 1) / 2) * 2.9;
          const sx = cx + ux * o, sy = cy + uy * o;
          return `<path d="M${(sx - vx * 1.3).toFixed(1)} ${(sy - vy * 1.3).toFixed(1)} L${(sx + vx * 1.3).toFixed(1)} ${(sy + vy * 1.3).toFixed(1)}" stroke="#b9b2a0" stroke-width="0.4" opacity="0.8"/>`;
        }).join('');
        return `<polygon points="${e.pts.map((p) => p.join(',')).join(' ')}" fill="#cfc9b8" stroke="#b9b2a0" stroke-width="0.6" opacity="0.9"/>${ticks}`;
      }
      return `<polyline points="${e.pts.map((p) => p.join(',')).join(' ')}" fill="none" ${style[e.assetId.slice(5)] ?? style.fence}/>`;
    })
    .join('\n');
})()}
<!-- ground assets (top-down, rotated to real geometry) -->
${groundEls.map((e) => `<use href="#${symbolRef(e)}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation}) scale(${e.scale})"/>`).join('\n')}
<!-- sidewalk apron -->
${edgeLines.map((pts) => `<polyline points="${pts}" fill="none" stroke="${SIDEWALK}" stroke-width="${CASING_M + 11}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n')}
<!-- THE PATH: casing, fill, nodes -->
<g filter="url(#lift)">
${edgeLines.map((pts) => `<polyline points="${pts}" fill="none" stroke="${CASING}" stroke-width="${CASING_M}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n')}
${edgeLines.map((pts) => `<polyline points="${pts}" fill="none" stroke="${ROAD_FILL}" stroke-width="${FILL_M}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n')}
${nodes.map((n) => {
  const cx = n.x.toFixed(1), cy = n.y.toFixed(1);
  let inner = '';
  if (n.type === 'chance') inner = `<text x="${cx}" y="${(n.y + 0.6).toFixed(1)}" font-size="16" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="Arial">?</text>`;
  if (n.type === 'coin') inner = `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="#c8901a" stroke-width="2.2"/>`;
  if (n.type === 'challenge' || n.type === 'bowser') inner = `<text x="${cx}" y="${(n.y + 0.6).toFixed(1)}" font-size="14" font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="Arial">!</text>`;
  if (n.type === 'bar') inner = `<g transform="translate(${cx} ${cy})">` +
    `<rect x="-4.6" y="-4" width="8" height="9.5" rx="1.4" fill="#f7d980" stroke="${INK}" stroke-width="1.1"/>` +
    `<path d="M3.4 -1.6 A2.6 2.6 0 0 1 3.4 4" fill="none" stroke="${INK}" stroke-width="1.1"/>` +
    `<ellipse cx="-0.6" cy="-4.4" rx="4.4" ry="1.9" fill="#fffdf5" stroke="${INK}" stroke-width="0.9"/>` +
    `<path d="M-3.2 -2 v5.6 M-0.6 -2 v6.4 M2 -2 v5.6" stroke="#c8901a" stroke-width="0.7" opacity="0.7"/></g>`;
  return `<circle cx="${cx}" cy="${cy}" r="15" fill="${nodeColor[n.type] ?? nodeColor.blank}" stroke="${CASING}" stroke-width="3.4"/>${inner}`;
}).join('\n')}
</g>
<!-- shadows -->
${standingEls.map(shadowFor).join('')}
<!-- standing assets, painter-sorted -->
${standingEls.map((e) => {
  // raster heroes: <image> in the same painter sort, anchored at the tower base
  if (HERO_RASTER[e.assetId] && heroData[e.assetId]) {
    const cfg = HERO_RASTER[e.assetId];
    const w2 = cfg.widthM, h2 = w2 * cfg.aspect;
    const hx = e.x + (cfg.dxM ?? 0);
    return `<ellipse cx="${(hx + w2 * (0.5 - cfg.anchorX)).toFixed(1)}" cy="${(e.y + 2).toFixed(1)}" rx="${(w2 * 0.38).toFixed(1)}" ry="3.4" fill="#2c2318" opacity="0.13"/>` +
      `<image href="${heroData[e.assetId]}" x="${(hx - w2 * cfg.anchorX).toFixed(1)}" y="${(e.y - h2 * cfg.anchorY).toFixed(1)}" width="${w2}" height="${h2.toFixed(1)}"/>`;
  }
  const st = variantStyle(e);
  // facing-aware mirror: flip the sprite when its frontage (street/corner)
  // lies clearly to the west, so doors/chamfers address what they belong to
  const mirror = e.facing != null && Math.cos(e.facing * Math.PI / 180) < -0.45;
  const base = `<use href="#${symbolRef(e)}" transform="translate(${e.x} ${e.y}) scale(${mirror ? -e.scale : e.scale} ${e.scale})"${st ? ` style="${st}"` : ''}/>`;
  if (e.assetId === 'bldg.com.corner_tavern') {
    const label = (e.name ?? 'TAVERN').toUpperCase().split(/\s+/)[0].replace(/[^A-Z'’\-]/g, '').slice(0, 9) || 'TAVERN';
    return base + `<text x="${e.x}" y="${(e.y - 7.55 * e.scale).toFixed(1)}" font-size="${(1.7 * e.scale).toFixed(2)}" font-weight="700" text-anchor="middle" fill="#f2c94c" letter-spacing="0.12">${label}</text>`;
  }
  return base;
}).join('\n')}
</svg>`;

mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', `${SLICE.out}.svg`), svg);
writeFileSync(join(HERE, 'out', `${SLICE.out}.scene-model.json`), JSON.stringify({ slice: SLICE, counts: countScene(), scene }, null, 1));
writeFileSync(join(HERE, 'out', `${SLICE.out}.html`),
  `<!doctype html><meta charset="utf-8"><title>Style C slice</title><body style="margin:0;background:#7ec4e0">${svg.replace('<svg ', '<svg style="width:100vw;height:100vh;display:block" ')}</body>`);

function countScene() {
  const c = {};
  for (const e of scene) c[e.assetId] = (c[e.assetId] || 0) + 1;
  return c;
}
console.log('scene:', JSON.stringify(countScene(), null, 1));
console.log('trees cast/skipped:', treeStats.cast, '/', treeStats.skipped, '| nodes:', nodes.length, '| edges:', edges.length);
