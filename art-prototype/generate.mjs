// Style C prototype slice generator.
// Reads REAL data (OSM footprints, city street trees, the actual board graph),
// composes a SceneModel ({assetId, variant, x, y, scale, rotation, layer}),
// and renders a standalone SVG. No changes to the live app.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { allSymbols, ASSET_META, INK, HOUSE_BODIES, HOUSE_ROOFS, SHOP_BODIES, AWNINGS, CAR_BODIES } from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRATCH = 'C:/Users/Steven/AppData/Local/Temp/claude/C--Users-Steven-Documents-Birthday-2026/5d610d7c-43c1-4149-9704-c942971ebd14/scratchpad';

// ---- slice: St. Hedwig -> Wolski's -> Pulaski courts, Brady St south edge ----
const SLICE = { S: 43.0518, W: -87.8992, N: 43.0566, E: -87.8934 };
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
const canPlaceB = (x, y, r) => placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= (p.r + r) * 0.95);
const canPlaceT = (x, y) =>
  placedT.every((p) => Math.hypot(p.x - x, p.y - y) >= 7) &&
  placedB.every((p) => Math.hypot(p.x - x, p.y - y) >= 4.5); // terrace trees may front the houses
const commitB = (entry, r) => { scene.push(entry); placedB.push({ x: entry.x, y: entry.y, r }); };
const commitT = (entry) => { scene.push(entry); placedT.push({ x: entry.x, y: entry.y }); };

// ---- 1. ground assets from real leisure polygons ----
const seenGround = [];
for (const el of raw.leisure.elements ?? []) {
  if (el.type !== 'way' || !el.geometry) continue;
  const t = el.tags ?? {};
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  const x = X(c.lng), y = Y(c.lat);
  if (t.leisure === 'pitch' && t.sport === 'tennis') {
    if (seenGround.some((g) => Math.hypot(g.x - x, g.y - y) < 20)) continue;
    seenGround.push({ x, y });
    scene.push({ assetId: 'ground.tennis', variant: 0, x, y, scale: 1, rotation: +longestEdgeAngle(el.geometry).toFixed(1), layer: 'ground', priority: 2, src: 'osm:pitch' });
  } else if (t.leisure === 'playground') {
    if (seenGround.some((g) => Math.hypot(g.x - x, g.y - y) < 26)) continue;
    seenGround.push({ x, y });
    scene.push({ assetId: 'ground.playground', variant: 0, x, y, scale: 1.6, rotation: 0, layer: 'ground', priority: 2, src: 'osm:playground' });
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
  if (b === 'church') return { assetId: 'bldg.civ.church', priority: 0, s: 1.5, name };
  if (b === 'school' || t.amenity === 'school') return { assetId: 'bldg.civ.school', priority: 1, s: 1.15, name };
  const isBar = name && [...bars].some((k) => name.toLowerCase().includes(k));
  if (isBar) return { assetId: 'bldg.com.corner_tavern', priority: 2, s: 1.25, name };
  if (b === 'retail' || b === 'commercial') {
    return { assetId: 'bldg.com.storefront', priority: 3, s: Math.min(1.15, 0.85 + area / 900), name };
  }
  if (b === 'apartments' || b === 'condominium' || (lv >= 3 && area > 250)) {
    return { assetId: 'bldg.res.apartment', priority: 4, s: Math.min(1.2, 0.85 + lv * 0.06), name };
  }
  if (b === 'garage' || b === 'shed' || b === 'barn' || b === 'roof') {
    if (area < 18 || area > 90) return null;
    return { assetId: 'bldg.res.garage', priority: 6, s: Math.max(0.85, Math.min(1.15, Math.sqrt(area) / 7)), name };
  }
  if (b === 'house' || b === 'residential' || b === 'detached' || b === 'yes') {
    if (area < 45) return null;
    const s = Math.max(1, Math.min(1.35, Math.sqrt(area) / 10.5));
    return lv >= 2
      ? { assetId: 'bldg.res.polish_flat', priority: 5, s, name }
      : { assetId: 'bldg.res.bungalow', priority: 5, s, name };
  }
  return null;
};

const candidates = [];
for (const el of raw.buildings.elements ?? []) {
  if (el.type !== 'way' || !el.geometry) continue;
  const c = cent(el.geometry);
  if (!inSlice(c.lat, c.lng)) continue;
  const cls = classify(el);
  if (!cls) continue;
  candidates.push({ ...cls, x: X(c.lng), y: Y(c.lat), area: areaOf(el.geometry) });
}
candidates.sort((a, b) => a.priority - b.priority || b.area - a.area);

const NODE_CLEAR = { 0: 26, 1: 26, 2: 21, 3: 23, 4: 26, 5: 24, 6: 22 };
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
  if (!canPlaceB(x, y, r)) continue;
  if (c.assetId === 'bldg.res.garage') {
    // a garage alone in a field reads as debris — only place near a building
    if (!placedB.some((p) => Math.hypot(p.x - x, p.y - y) < 24)) continue;
    if (++garages > 14) continue;
  }
  const h = hash01(x, y);
  commitB({ assetId: c.assetId, variant: Math.floor(h * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: +c.s.toFixed(2), rotation: 0, layer: 'standing', priority: c.priority, name: c.name, src: 'osm:building' }, r);
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
  const s = Math.max(0.85, Math.min(1.7, 0.85 + (t.dbh_in ?? 8) / 24));
  let x = X(t.lng), y = Y(t.lat);
  const road = distToRoad(x, y);
  // terrace band: trees stand just off the road edge (half-width 13m) so
  // canopies peek over the pavement — in FRONT of the building line
  if (road.d < 15) { x = road.qx + road.nx * 15; y = road.qy + road.ny * 15; }
  if (distToNode(x, y) < 22) { treeStats.skipped++; continue; }
  if (!canPlaceT(x, y)) { treeStats.skipped++; continue; }
  commitT({ assetId, variant: Math.floor(hash01(x, y) * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: +s.toFixed(2), rotation: 0, layer: 'standing', priority: 7, src: `city:${t.species} ${t.dbh_in}"` });
  treeStats.cast++;
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
    scene.push({ assetId: 'veh.car', variant: Math.floor(hash01(x, y) * 96), x: +x.toFixed(1), y: +y.toFixed(1), scale: 2.1, rotation: 0, layer: 'standing', priority: 8, src: 'ambient' });
    placedB.push({ x, y, r: 4 });
    cars++;
  }
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
    return `--body:${body};--roof:${roof};--side:${shade(body, -18)}`;
  }
  if (e.assetId === 'bldg.com.storefront') {
    const body = SHOP_BODIES[v % SHOP_BODIES.length];
    return `--body:${body};--side:${shade(body, -22)};--awn:${AWNINGS[v % AWNINGS.length]}`;
  }
  if (e.assetId === 'veh.car') return `--body:${CAR_BODIES[v % CAR_BODIES.length]}`;
  if (e.assetId === 'bldg.res.apartment') {
    const body = ['#e0b48f', '#d9a8a0', '#c9c09a'][v % 3];
    return `--body:${body};--side:${shade(body, -20)}`;
  }
  return '';
};
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (x) => Math.max(0, Math.min(255, x + amt));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => c(x).toString(16).padStart(2, '0')).join('');
}

const groundEls = scene.filter((e) => e.layer === 'ground');
const standingEls = scene.filter((e) => e.layer === 'standing').sort((a, b) => a.y - b.y);

const shadowFor = (e) => {
  const m = ASSET_META[e.assetId];
  if (m.cls === 'ground') return '';
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
<!-- ground assets (top-down, rotated to real geometry) -->
${groundEls.map((e) => `<use href="#${e.assetId}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation}) scale(${e.scale})"/>`).join('\n')}
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
  const st = variantStyle(e);
  const base = `<use href="#${e.assetId}" transform="translate(${e.x} ${e.y}) scale(${e.scale})"${st ? ` style="${st}"` : ''}/>`;
  if (e.assetId === 'bldg.com.corner_tavern') {
    const label = (e.name ?? 'TAVERN').toUpperCase().split(/\s+/)[0].replace(/[^A-Z'’\-]/g, '').slice(0, 9) || 'TAVERN';
    return base + `<text x="${e.x}" y="${(e.y - 7.55 * e.scale).toFixed(1)}" font-size="${(1.7 * e.scale).toFixed(2)}" font-weight="700" text-anchor="middle" fill="#f2c94c" letter-spacing="0.12">${label}</text>`;
  }
  return base;
}).join('\n')}
</svg>`;

mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', 'style-c-slice.svg'), svg);
writeFileSync(join(HERE, 'out', 'scene-model.json'), JSON.stringify({ slice: SLICE, counts: countScene(), scene }, null, 1));
writeFileSync(join(HERE, 'out', 'style-c-slice.html'),
  `<!doctype html><meta charset="utf-8"><title>Style C slice</title><body style="margin:0;background:#7ec4e0">${svg.replace('<svg ', '<svg style="width:100vw;height:100vh;display:block" ')}</body>`);

function countScene() {
  const c = {};
  for (const e of scene) c[e.assetId] = (c[e.assetId] || 0) + 1;
  return c;
}
console.log('scene:', JSON.stringify(countScene(), null, 1));
console.log('trees cast/skipped:', treeStats.cast, '/', treeStats.skipped, '| nodes:', nodes.length, '| edges:', edges.length);
