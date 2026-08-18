// Asset Grounding Packet builder — mines the real datasets into structured
// JSON for ChatGPT's raster production. No rendering, no new assets.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRATCH = 'C:/Users/Steven/AppData/Local/Temp/claude/C--Users-Steven-Documents-Birthday-2026/5d610d7c-43c1-4149-9704-c942971ebd14/scratchpad';
const OUT = join(HERE, 'grounding');
mkdirSync(OUT, { recursive: true });

const board = JSON.parse(readFileSync(join(ROOT, 'birthday-board.json'), 'utf8'));
const raw = JSON.parse(readFileSync(join(SCRATCH, 'osm_raw.json'), 'utf8'));
const trees = JSON.parse(readFileSync(join(ROOT, 'data', 'city_street_trees.json'), 'utf8')).trees;

const poly = board.boundary;
const inBoard = (lat, lng) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat, xi = poly[i].lng, yj = poly[j].lat, xj = poly[j].lng;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const KY = 111320, KX = Math.cos(43.053 * Math.PI / 180) * 111320;

// intersections of the full board graph
const sqById = new Map(board.squares.map((s) => [s.id, s]));
const deg = new Map();
for (const e of board.edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
const nodes = board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3);
const roadSegs = [];
for (const e of board.edges) {
  const a = sqById.get(e.from), b = sqById.get(e.to);
  const pts = (e.path?.length >= 2 ? e.path : [a, b]);
  for (let i = 1; i < pts.length; i++) roadSegs.push([pts[i - 1], pts[i]]);
}
const nearestRoadBearing = (lat, lng) => {
  let best = null;
  for (const [a, b] of roadSegs) {
    const ax = (a.lng - lng) * KX, ay = (a.lat - lat) * KY, bx = (b.lng - lng) * KX, by = (b.lat - lat) * KY;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / l2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = Math.hypot(qx, qy);
    if (!best || d < best.d) best = { d, qx, qy };
  }
  if (!best) return null;
  const deg2 = (Math.atan2(best.qx, best.qy) * 180 / Math.PI + 360) % 360; // bearing E of N
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return { compass: dirs[Math.round(deg2 / 45) % 8], distM: Math.round(best.d) };
};
const nearestNodeDist = (lat, lng) =>
  Math.round(Math.min(...nodes.map((n) => Math.hypot((n.lng - lng) * KX, (n.lat - lat) * KY)), 9999));

// building analysis (oriented bbox etc.)
const analyzeGeom = (g) => {
  const la = g.reduce((s, p) => s + p.lat, 0) / g.length, lo = g.reduce((s, p) => s + p.lon, 0) / g.length;
  const pts = g.map((p) => [(p.lon - lo) * KX, (la - p.lat) * KY]);
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  area = Math.abs(area / 2);
  let ang = 0, bl = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    if (dx * dx + dy * dy > bl) { bl = dx * dx + dy * dy; ang = Math.atan2(dy, dx); }
  }
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const xs = rot.map((p) => p[0]), ys = rot.map((p) => p[1]);
  return { lat: +la.toFixed(6), lng: +lo.toFixed(6), area: Math.round(area),
    w: Math.round(Math.max(...xs) - Math.min(...xs)), d: Math.round(Math.max(...ys) - Math.min(...ys)) };
};
const buildings = (raw.buildings.elements ?? []).filter((el) => el.type === 'way' && el.geometry)
  .map((el) => ({ id: el.id, tags: el.tags ?? {}, ...analyzeGeom(el.geometry), geometry: el.geometry }))
  .filter((b) => inBoard(b.lat, b.lng));
const inFoot = (b, lat, lng) => {
  let inside = false;
  const g = b.geometry;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    if (g[i].lat > lat !== g[j].lat > lat && lng < ((g[j].lon - g[i].lon) * (lat - g[i].lat)) / (g[j].lat - g[i].lat) + g[i].lon) inside = !inside;
  }
  return inside;
};

// ---------- 1. commercial inventory ----------
const CAT = (t) => {
  const a = t.amenity, s = t.shop;
  if (['bar', 'pub', 'biergarten', 'nightclub'].includes(a)) return 'tavern_bar';
  if (['restaurant', 'fast_food'].includes(a)) return 'restaurant';
  if (['cafe', 'ice_cream'].includes(a)) return 'cafe';
  if (['bakery', 'confectionery', 'pastry'].includes(s)) return 'bakery';
  if (['supermarket', 'convenience', 'greengrocer', 'deli', 'alcohol', 'butcher', 'cheese', 'seafood', 'wine', 'health_food'].includes(s)) return 'grocery_specialty';
  if (['hairdresser', 'beauty', 'tattoo', 'dry_cleaning', 'laundry', 'optician', 'massage'].includes(s)) return 'salon_service';
  if (['theatre', 'cinema', 'events_venue', 'music_venue', 'studio', 'community_centre'].includes(a) || t.leisure === 'dance') return 'entertainment';
  if (s) return 'retail';
  if (['bank', 'pharmacy', 'clinic', 'dentist', 'veterinary', 'post_office', 'car_wash'].includes(a)) return 'salon_service';
  if (t.tourism === 'hotel' || t.office) return 'other_local';
  return null;
};
const KNOWN_DISTINCTIVE = /wolski|glorioso|y[-\s]?not|hosed|nomad|up and under|jamo|hi hat|casablanca|dorsia|w[uü]rst|club brady|malone|scaffidi|angelo|pete's pub|regano|jack's|red lion|fink|thurman|standard tavern|smallest bar|jo[-\s]?cat|emperor of china|lucky liu/i;
const seen = new Set();
const inventory = [];
for (const el of raw.pois.elements ?? []) {
  const t = el.tags ?? {};
  if (!t.name) continue;
  const c = el.center ?? el;
  if (c.lat == null || !inBoard(c.lat, c.lon)) continue;
  const cat = CAT(t);
  if (!cat) continue;
  const key = t.name.toLowerCase().replace(/\W/g, '');
  if (seen.has(key)) continue;
  seen.add(key);
  let bld = buildings.find((b) => inFoot(b, c.lat, c.lon));
  if (!bld) {
    let bd = 25;
    for (const b of buildings) { const d = Math.hypot((b.lng - c.lon) * KX, (b.lat - c.lat) * KY); if (d < bd) { bd = d; bld = b; } }
  }
  const front = nearestRoadBearing(c.lat, c.lon);
  const nodeD = nearestNodeDist(c.lat, c.lon);
  inventory.push({
    name: t.name,
    category: cat,
    lat: +c.lat.toFixed(6), lng: +c.lon.toFixed(6),
    address: t['addr:housenumber'] ? `${t['addr:housenumber']} ${t['addr:street'] ?? ''}`.trim() : (bld?.tags['addr:housenumber'] ? `${bld.tags['addr:housenumber']} ${bld.tags['addr:street'] ?? ''}`.trim() : null),
    osmTags: Object.fromEntries(Object.entries(t).filter(([k]) => /^(amenity|shop|cuisine|tourism|leisure|office|craft|historic|start_date|building)/.test(k))),
    building: bld ? {
      id: bld.id, areaM2: bld.area, dims: `${bld.w}x${bld.d}m`,
      levels: bld.tags['building:levels'] ?? null,
      material: bld.tags['building:material'] ?? null,
      buildingTag: bld.tags.building ?? null,
      historic: bld.tags.historic === 'building' || t.historic === 'building',
      architecture: bld.tags['building:architecture'] ?? null,
      startDate: bld.tags.start_date ?? null,
      name: bld.tags.name ?? null,
    } : null,
    frontage: front ? { faces: front.compass, streetDistM: front.distM } : null,
    corner: nodeD < 35,
    nodeDistM: nodeD,
    distinctive: KNOWN_DISTINCTIVE.test(t.name) || bld?.tags.historic === 'building' || t.historic != null,
  });
}
inventory.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
writeFileSync(join(OUT, 'commercial-inventory.json'), JSON.stringify({
  generated: '2026-08-18', area: 'Lower East Side board polygon',
  counts: inventory.reduce((m, e) => { m[e.category] = (m[e.category] ?? 0) + 1; return m; }, {}),
  businesses: inventory,
}, null, 1));

// ---------- 3. residential archetypes ----------
const arch = {};
const bump = (k, b, lv) => {
  if (!arch[k]) arch[k] = { count: 0, widths: [], depths: [], areas: [], levels: {}, materials: {} };
  const a = arch[k];
  a.count++;
  a.widths.push(b.w); a.depths.push(b.d); a.areas.push(b.area);
  if (lv) a.levels[lv] = (a.levels[lv] ?? 0) + 1;
  const m = b.tags['building:material'];
  if (m) a.materials[m] = (a.materials[m] ?? 0) + 1;
};
for (const b of buildings) {
  const t = b.tags, bt = t.building, lv = parseFloat(t['building:levels'] ?? '0');
  const area = b.area;
  if (bt === 'terrace') bump('rowhouse', b, lv);
  else if (bt === 'apartments' || bt === 'condominium' || (lv >= 3 && area > 250)) {
    bump(lv >= 4 ? 'apartment_tall_4plus' : area > 280 ? 'apartment_wide_brick' : 'apartment_walkup_3story', b, lv);
  } else if (bt === 'shed') bump('shed', b, lv);
  else if (bt === 'garage' || bt === 'barn' || bt === 'roof') { if (area >= 18 && area <= 90) bump('detached_garage', b, lv); }
  else if (['house', 'residential', 'detached', 'yes'].includes(bt)) {
    if (area < 55) continue;
    if (lv >= 2) bump(area >= 165 ? 'wide_duplex' : 'polish_flat_2story', b, lv);
    else bump('bungalow_cottage_1story', b, lv);
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const archetypes = Object.fromEntries(Object.entries(arch).map(([k, a]) => [k, {
  count: a.count,
  medianWidthM: med(a.widths), medianDepthM: med(a.depths), medianAreaM2: med(a.areas),
  levelsDist: a.levels, materialsTagged: a.materials,
}]));
writeFileSync(join(OUT, 'residential-archetypes.json'), JSON.stringify({
  generated: '2026-08-18', totalBuildingsInPolygon: buildings.length, archetypes,
}, null, 1));

// ---------- 6. tree classes ----------
const CLASS = (t) => {
  const g = (t.genus || '').toLowerCase();
  if (g === 'linden') return 'linden';
  if (g === 'honeylocust') return 'honeylocust';
  if (g === 'maple') return 'maple';
  if (g === 'ash') return 'ash';
  if (g === 'elm' || g === 'hackberry') return 'elm';
  if (g === 'oak') return 'oak';
  if (['lilac', 'pear', 'serviceberry', 'apple', 'hawthorn'].includes(g)) return 'flowering_ornamental';
  return 'other';
};
const tc = {};
for (const t of trees.filter((x) => x.inBoard)) {
  const k = CLASS(t);
  if (!tc[k]) tc[k] = { count: 0, dbh: [], species: {} };
  tc[k].count++;
  if (t.dbh_in != null) tc[k].dbh.push(t.dbh_in);
  tc[k].species[t.species] = (tc[k].species[t.species] ?? 0) + 1;
}
const treeClasses = Object.fromEntries(Object.entries(tc).map(([k, v]) => {
  const s = [...v.dbh].sort((a, b) => a - b);
  return [k, { count: v.count, dbhMin: s[0], dbhMedian: s[Math.floor(s.length / 2)], dbhMax: s[s.length - 1], species: v.species }];
}));

// ---------- 7. production priority ----------
const priority = [];
const push2 = (assetId, why, count) => priority.push({ assetId, boardInstances: count, rationale: why });
push2('raster.res.polish_flat.s0_stacked_porch', 'workhorse: 2-story flats dominate', arch.polish_flat_2story?.count ?? 0);
push2('raster.res.polish_flat.s1_front_gable_bay', 'silhouette variety within the dominant family', arch.polish_flat_2story?.count ?? 0);
push2('raster.res.polish_flat.s3_porch_gable', 'third flat silhouette to prevent stamping', arch.polish_flat_2story?.count ?? 0);
push2('raster.res.wide_duplex', 'data-selected: 2-story footprints >=165m2', arch.wide_duplex?.count ?? 0);
push2('raster.res.bungalow_craftsman', '1-story family lead silhouette', arch.bungalow_cottage_1story?.count ?? 0);
push2('raster.res.bungalow_hipped_dormer', '1-story variety', arch.bungalow_cottage_1story?.count ?? 0);
push2('raster.res.cottage_side_gable', '1-story variety', arch.bungalow_cottage_1story?.count ?? 0);
push2('raster.res.apartment_walkup_3story', 'most common apartment form', arch.apartment_walkup_3story?.count ?? 0);
push2('raster.res.apartment_wide_brick', 'large-footprint apartment form', arch.apartment_wide_brick?.count ?? 0);
push2('raster.res.apartment_corner', 'corner apartment (facing-aware)', arch.apartment_walkup_3story?.count ?? 0);
push2('raster.com.storefront_single', 'generic 1-business frontage — NO invented names', inventory.length);
push2('raster.com.storefront_row_3bay', 'dense-corridor workhorse', 0);
push2('raster.com.mixed_use_3story', 'commercial-residential bridge', 0);
push2('raster.res.detached_garage', 'alley fabric', arch.detached_garage?.count ?? 0);
push2('raster.tree.linden', 'top street tree', treeClasses.linden?.count ?? 0);
push2('raster.tree.maple', '2nd most common genus', treeClasses.maple?.count ?? 0);
push2('raster.tree.honeylocust', 'airy silhouette anchor', treeClasses.honeylocust?.count ?? 0);
push2('raster.tree.flowering_ornamental', '18% of street trees, distinct class', treeClasses.flowering_ornamental?.count ?? 0);
push2('raster.tree.elm_mature', 'landmark-scale vase (also covers hero elm later)', treeClasses.elm?.count ?? 0);
push2('raster.tree.oak_mature', 'broadest crown, landmark-scale', treeClasses.oak?.count ?? 0);
writeFileSync(join(OUT, 'raster-production-priority.json'), JSON.stringify({
  generated: '2026-08-18',
  rules: ['No invented readable text on generic assets', 'Strongly top-down near-head-on camera, roof dominant, walls vertically compressed', 'Transparent background, no sidewalk apron, foundation planting only'],
  treeClasses,
  pack: priority,
}, null, 1));

// ---------- console summary for the MD ----------
console.log('BUSINESSES', inventory.length, JSON.stringify(inventory.reduce((m, e) => { m[e.category] = (m[e.category] ?? 0) + 1; return m; }, {})));
console.log('DISTINCTIVE', inventory.filter((e) => e.distinctive).map((e) => e.name).join(' | '));
console.log('CORNER BARS', inventory.filter((e) => e.category === 'tavern_bar' && e.corner).map((e) => e.name).join(' | '));
console.log('ARCH', JSON.stringify(archetypes, null, 1));
console.log('TREES', JSON.stringify(treeClasses));
