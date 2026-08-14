// Geometry + OpenStreetMap helpers for cleaning up and snapping the boundary.
// All coordinates are lat/lng; math uses a local equirectangular projection,
// which is plenty accurate at neighborhood scale.

import type { LatLng } from './types';

const EARTH_R = 6371000;
const DEG_TO_M = 111320; // meters per degree of latitude
const toRad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Project to a flat plane around a reference latitude (x scaled by cos(lat)).
function project(p: LatLng, lat0: number) {
  return { x: p.lng * Math.cos(toRad(lat0)), y: p.lat };
}
function unproject(x: number, y: number, lat0: number): LatLng {
  return { lat: y, lng: x / Math.cos(toRad(lat0)) };
}

function nearestOnSegment(p: LatLng, a: LatLng, b: LatLng, lat0: number): LatLng {
  const P = project(p, lat0);
  const A = project(a, lat0);
  const B = project(b, lat0);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return unproject(A.x + t * abx, A.y + t * aby, lat0);
}

/** Douglas–Peucker simplification; epsilon is a tolerance in meters. */
export function simplify(points: LatLng[], epsMeters = 12): LatLng[] {
  if (points.length < 3) return points;
  const lat0 = points[0].lat;
  const P = points.map((p) => project(p, lat0));

  const perpMeters = (i: number, a: number, b: number): number => {
    const A = P[a];
    const B = P[b];
    const Pt = P[i];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let cx = A.x;
    let cy = A.y;
    if (len2 !== 0) {
      let t = ((Pt.x - A.x) * dx + (Pt.y - A.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      cx = A.x + t * dx;
      cy = A.y + t * dy;
    }
    return Math.hypot(Pt.x - cx, Pt.y - cy) * DEG_TO_M;
  };

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpMeters(i, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsMeters && idx !== -1) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export type Segment = [LatLng, LatLng];

// The main Overpass server is often overloaded (504s). Try mirrors in turn.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Cache Overpass responses in localStorage so redrawing the same area is
// instant and immune to mirror outages/rate limits. Keyed by query hash,
// a handful of entries, week-long TTL (streets don't change that fast).
const OVP_KEYS = 'ovp:keys';
const OVP_TTL = 7 * 24 * 3600 * 1000;
const OVP_MAX = 4;
function ovpKey(query: string): string {
  let h = 5381;
  for (let i = 0; i < query.length; i++) h = ((h << 5) + h + query.charCodeAt(i)) | 0;
  return 'ovp:' + (h >>> 0).toString(36);
}
function ovpRead(key: string): any | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > OVP_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
function ovpWrite(key: string, data: any): void {
  try {
    const keys: string[] = JSON.parse(localStorage.getItem(OVP_KEYS) ?? '[]').filter((k: string) => k !== key);
    while (keys.length >= OVP_MAX) {
      const old = keys.shift();
      if (old) localStorage.removeItem(old);
    }
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
    keys.push(key);
    localStorage.setItem(OVP_KEYS, JSON.stringify(keys));
  } catch {
    /* quota exceeded / private mode — just skip caching */
  }
}

async function overpass(query: string): Promise<any> {
  const key = ovpKey(query);
  const cached = ovpRead(key);
  if (cached) return cached;
  let lastErr: unknown = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`${res.status} from ${new URL(url).host}`);
        continue; // try the next mirror
      }
      const json = await res.json();
      ovpWrite(key, json);
      return json;
    } catch (err) {
      lastErr = err; // network error / timeout / abort → next mirror
    }
  }
  throw lastErr ?? new Error('all Overpass mirrors failed');
}

/** Fetch walkable street segments around the boundary from Overpass (OSM). */
export async function fetchStreetSegments(points: LatLng[]): Promise<Segment[]> {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 0.0015; // ~150m
  const s = Math.min(...lats) - pad;
  const n = Math.max(...lats) + pad;
  const w = Math.min(...lngs) - pad;
  const e = Math.max(...lngs) + pad;

  const walkable =
    'residential|living_street|tertiary|secondary|primary|unclassified|pedestrian|footway|path|service|cycleway|track';
  const query =
    `[out:json][timeout:20];` +
    `way["highway"~"^(${walkable})$"](${s},${w},${n},${e});` +
    `out geom;`;

  const json = await overpass(query);

  const segs: Segment[] = [];
  for (const el of json.elements ?? []) {
    const g = el.geometry;
    if (!g || g.length < 2) continue;
    for (let i = 0; i < g.length - 1; i++) {
      segs.push([
        { lat: g[i].lat, lng: g[i].lon },
        { lat: g[i + 1].lat, lng: g[i + 1].lon },
      ]);
    }
  }
  return segs;
}

/** Move each point onto the nearest street segment (up to maxMeters away). */
export function snapPointsToSegments(
  points: LatLng[],
  segs: Segment[],
  maxMeters = 180,
): LatLng[] {
  const lat0 = points[0]?.lat ?? 0;
  return points.map((p) => {
    let best = p;
    let bestD = Infinity;
    for (const [a, b] of segs) {
      const q = nearestOnSegment(p, a, b, lat0);
      const d = metersBetween(p, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return bestD <= maxMeters ? best : p;
  });
}

// ---------------------------------------------------------------------------
// Route-along-streets: snap corners to intersections and walk the road network
// between them, so the boundary's edges lie on real streets.
// ---------------------------------------------------------------------------

interface StreetGraph {
  coords: Map<number, LatLng>;
  adj: Map<number, { to: number; w: number }[]>;
  nodeIds: number[];
}

async function fetchStreetGraph(points: LatLng[]): Promise<StreetGraph> {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 0.0015;
  const s = Math.min(...lats) - pad;
  const n = Math.max(...lats) + pad;
  const w = Math.min(...lngs) - pad;
  const e = Math.max(...lngs) + pad;

  const walkable =
    'residential|living_street|tertiary|secondary|primary|unclassified|pedestrian|footway|path|service|cycleway|track';
  // Get the ways AND recurse down to their nodes so we know how streets connect.
  const query =
    `[out:json][timeout:20];` +
    `way["highway"~"^(${walkable})$"](${s},${w},${n},${e});` +
    `(._;>;);out;`;

  const json = await overpass(query);
  const coords = new Map<number, LatLng>();
  const adj = new Map<number, { to: number; w: number }[]>();

  for (const el of json.elements ?? []) {
    if (el.type === 'node') coords.set(el.id, { lat: el.lat, lng: el.lon });
  }
  const link = (a: number, b: number) => {
    const ca = coords.get(a);
    const cb = coords.get(b);
    if (!ca || !cb) return;
    const wgt = metersBetween(ca, cb);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, w: wgt });
  };
  for (const el of json.elements ?? []) {
    if (el.type === 'way' && Array.isArray(el.nodes)) {
      for (let i = 0; i < el.nodes.length - 1; i++) {
        link(el.nodes[i], el.nodes[i + 1]);
        link(el.nodes[i + 1], el.nodes[i]);
      }
    }
  }
  return { coords, adj, nodeIds: [...coords.keys()] };
}

type BlockKind = 'residential' | 'commercial' | 'retail' | 'industrial' | 'civic';

// Map an OSM point's tags to a little cartoon emoji (or null to skip it).
function poiEmoji(t: Record<string, string>): string | null {
  const a = t.amenity;
  if (a === 'restaurant') return '🍽️';
  if (a === 'cafe' || a === 'coffee_shop') return '☕';
  if (a === 'fast_food') return '🍔';
  if (a === 'ice_cream') return '🍦';
  if (a === 'place_of_worship') return '⛪';
  if (a === 'theatre') return '🎭';
  if (a === 'cinema') return '🎬';
  if (a === 'bank') return '🏦';
  if (a === 'pharmacy') return '💊';
  if (a === 'hospital' || a === 'clinic') return '🏥';
  if (a === 'school' || a === 'college' || a === 'university') return '🏫';
  if (a === 'library') return '📚';
  if (a === 'fuel') return '⛽';
  if (t.tourism === 'hotel') return '🏨';
  if (t.tourism === 'museum' || t.tourism === 'gallery') return '🏛️';
  const shop = t.shop;
  if (shop === 'bakery') return '🥐';
  if (shop === 'supermarket' || shop === 'grocery') return '🛒';
  if (shop === 'convenience') return '🏪';
  if (shop === 'clothes' || shop === 'boutique') return '👕';
  if (shop === 'books') return '📖';
  if (shop === 'hairdresser' || shop === 'beauty') return '💈';
  if (shop) return '🛍️';
  return null;
}

/** Fetch stylized surroundings (blocks, parks, water, bars, POIs) from OSM. */
export async function fetchScenery(
  boundary: LatLng[],
): Promise<{
  blocks: { ring: LatLng[]; kind: BlockKind }[];
  parks: LatLng[][];
  woods: LatLng[][];
  water: LatLng[][];
  rivers: LatLng[][];
  bars: { lat: number; lng: number; name: string }[];
  pois: { lat: number; lng: number; emoji: string; name?: string }[];
}> {
  const lats = boundary.map((p) => p.lat);
  const lngs = boundary.map((p) => p.lng);
  const s = Math.min(...lats);
  const n = Math.max(...lats);
  const w = Math.min(...lngs);
  const e = Math.max(...lngs);
  const bbox = `(${s},${w},${n},${e})`;

  const query =
    `[out:json][timeout:25];(` +
    `way["landuse"~"^(residential|commercial|retail|industrial)$"]${bbox};` +
    `way["leisure"~"^(park|garden|playground|pitch)$"]${bbox};` +
    `way["landuse"~"^(grass|recreation_ground|village_green|cemetery)$"]${bbox};` +
    `way["natural"~"^(wood|scrub)$"]${bbox};` +
    `way["landuse"="forest"]${bbox};` +
    `way["natural"="water"]${bbox};` +
    `way["waterway"="riverbank"]${bbox};` +
    `way["waterway"~"^(river|stream|canal)$"]${bbox};` +
    `node["amenity"~"^(bar|pub|biergarten)$"]${bbox};` +
    `node["amenity"]${bbox};` +
    `node["shop"]${bbox};` +
    `node["tourism"~"^(hotel|museum|gallery)$"]${bbox};` +
    // Many POIs — especially churches, theatres, and larger bars — are tagged
    // on their BUILDING outline, not on a node. Fetch those too.
    `way["amenity"]${bbox};` +
    `way["shop"]${bbox};` +
    `way["tourism"~"^(hotel|museum|gallery)$"]${bbox};` +
    `);out geom;`;

  const json = await overpass(query);
  const blocks: { ring: LatLng[]; kind: BlockKind }[] = [];
  const parks: LatLng[][] = [];
  const woods: LatLng[][] = [];
  const water: LatLng[][] = [];
  const rivers: LatLng[][] = [];
  const bars: { lat: number; lng: number; name: string }[] = [];
  const pois: { lat: number; lng: number; emoji: string; name?: string }[] = [];

  for (const el of json.elements ?? []) {
    const t: Record<string, string> = el.tags ?? {};
    if (el.type === 'node') {
      if (t.amenity === 'bar' || t.amenity === 'pub' || t.amenity === 'biergarten') {
        bars.push({ lat: el.lat, lng: el.lon, name: t.name ?? 'Bar' });
      } else {
        const emoji = poiEmoji(t);
        if (emoji && pois.length < 140) pois.push({ lat: el.lat, lng: el.lon, emoji, name: t.name });
      }
      continue;
    }
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const ring: LatLng[] = el.geometry.map((g: { lat: number; lon: number }) => ({ lat: g.lat, lng: g.lon }));
      if (ring.length < 2) continue;
      // POI-tagged building outlines (churches, theatres, big bars): centroid.
      if (t.amenity || t.shop || (t.tourism && /^(hotel|museum|gallery)$/.test(t.tourism))) {
        const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
        const center = { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
        if (t.amenity === 'bar' || t.amenity === 'pub' || t.amenity === 'biergarten') {
          bars.push({ lat: center.lat, lng: center.lng, name: t.name ?? 'Bar' });
        } else {
          const emoji = poiEmoji(t);
          if (emoji && pois.length < 140) pois.push({ lat: center.lat, lng: center.lng, emoji, name: t.name });
        }
        continue;
      }
      const lu = t.landuse;
      if (lu === 'residential' || lu === 'commercial' || lu === 'retail' || lu === 'industrial') {
        blocks.push({ ring, kind: lu });
      } else if (t.waterway && /river|stream|canal/.test(t.waterway)) rivers.push(ring);
      else if (t.natural === 'water' || t.waterway === 'riverbank') water.push(ring);
      else if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') woods.push(ring);
      else parks.push(ring);
    }
  }
  return { blocks, parks, woods, water, rivers, bars, pois };
}

/** Fetch walkable streets as ordered node-chains (ways) plus a node→coord map. */
export async function fetchStreetWays(
  boundary: LatLng[],
): Promise<{ coords: Map<number, LatLng>; ways: number[][] }> {
  const lats = boundary.map((p) => p.lat);
  const lngs = boundary.map((p) => p.lng);
  const s = Math.min(...lats);
  const n = Math.max(...lats);
  const w = Math.min(...lngs);
  const e = Math.max(...lngs);

  // Only real walking streets here (no alleys/sidewalks/paths) so the board
  // doesn't explode into thousands of spaces.
  const walkable = 'residential|living_street|tertiary|secondary|primary|unclassified|pedestrian';
  const query =
    `[out:json][timeout:25];` +
    `way["highway"~"^(${walkable})$"](${s},${w},${n},${e});` +
    `(._;>;);out;`;

  const json = await overpass(query);
  const coords = new Map<number, LatLng>();
  for (const el of json.elements ?? []) {
    if (el.type === 'node') coords.set(el.id, { lat: el.lat, lng: el.lon });
  }
  const ways: number[][] = [];
  for (const el of json.elements ?? []) {
    if (el.type === 'way' && Array.isArray(el.nodes)) ways.push(el.nodes);
  }
  return { coords, ways };
}

function nearestGraphNode(g: StreetGraph, p: LatLng, intersectionsOnly: boolean): number {
  let best = -1;
  let bestD = Infinity;
  for (const id of g.nodeIds) {
    if (intersectionsOnly && (g.adj.get(id)?.length ?? 0) < 3) continue;
    const d = metersBetween(p, g.coords.get(id)!);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

class MinHeap {
  private a: { id: number; key: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(id: number, key: number) {
    const a = this.a;
    a.push({ id, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Remove out-and-back spurs: a node whose two neighbors are the same node. */
function despike(nodes: number[]): number[] {
  let arr = nodes.slice();
  let changed = true;
  while (changed && arr.length > 3) {
    changed = false;
    for (let i = 0; i < arr.length; i++) {
      const prev = arr[(i - 1 + arr.length) % arr.length];
      const next = arr[(i + 1) % arr.length];
      if (prev === next) {
        const a = i;
        const b = (i + 1) % arr.length;
        arr = arr.filter((_, idx) => idx !== a && idx !== b);
        changed = true;
        break;
      }
    }
  }
  return arr;
}

function dijkstra(g: StreetGraph, start: number, goal: number): number[] {
  if (start === goal) return [start];
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  heap.push(start, 0);
  while (heap.size) {
    const { id: u, key: du } = heap.pop();
    if (u === goal) break;
    if (du > (dist.get(u) ?? Infinity)) continue;
    for (const { to, w } of g.adj.get(u) ?? []) {
      const nd = du + w;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, u);
        heap.push(to, nd);
      }
    }
  }
  if (!prev.has(goal)) return [];
  const path = [goal];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur);
    if (p === undefined) return [];
    path.push(p);
    cur = p;
  }
  return path.reverse();
}

/**
 * Snap the drawn outline to the street network: corners → nearest intersections,
 * edges → shortest walking path along the roads between them. Returns a clean
 * closed ring of lat/lng points.
 */
export async function snapToStreetsFollowing(points: LatLng[]): Promise<LatLng[]> {
  if (points.length < 3) throw new Error('draw at least 3 points first');
  const g = await fetchStreetGraph(points);
  if (!g.nodeIds.length) throw new Error('no walkable streets found nearby');

  const waypoints: number[] = [];
  for (const p of points) {
    let id = nearestGraphNode(g, p, true);
    if (id === -1) id = nearestGraphNode(g, p, false);
    if (id !== -1 && id !== waypoints[waypoints.length - 1]) waypoints.push(id);
  }
  if (waypoints.length < 2) throw new Error('could not match your outline to streets');

  const ringNodes: number[] = [];
  const pushNode = (id: number) => {
    if (ringNodes[ringNodes.length - 1] !== id) ringNodes.push(id);
  };
  for (let i = 0; i < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % waypoints.length];
    const path = dijkstra(g, a, b);
    if (path.length === 0) {
      // Disconnected pieces (e.g. across a river) → straight hop as fallback.
      pushNode(a);
      pushNode(b);
    } else {
      for (const id of path) pushNode(id);
    }
  }
  // Drop the closing duplicate if present.
  if (ringNodes.length > 1 && ringNodes[0] === ringNodes[ringNodes.length - 1]) ringNodes.pop();

  const cleaned = despike(ringNodes);
  let ring = cleaned.map((id) => g.coords.get(id)!).filter(Boolean);
  // Collapse near-collinear street shape-points into clean, flat edges.
  ring = simplify(ring, 18);
  return ring;
}

/**
 * Route a single path between two points along the street network — for manually
 * filling in a connection the auto-generator missed. Falls back to a straight
 * line if no streets are found or the two points aren't connected.
 */
export async function routeAlongStreets(a: LatLng, b: LatLng): Promise<LatLng[]> {
  const g = await fetchStreetGraph([a, b]);
  if (!g.nodeIds.length) return [a, b];
  let na = nearestGraphNode(g, a, true);
  if (na === -1) na = nearestGraphNode(g, a, false);
  let nb = nearestGraphNode(g, b, true);
  if (nb === -1) nb = nearestGraphNode(g, b, false);
  if (na === -1 || nb === -1) return [a, b];
  const path = dijkstra(g, na, nb);
  if (path.length === 0) return [a, b];
  const mid = path.map((id) => g.coords.get(id)!).filter(Boolean);
  // Anchor the ends at the actual spaces so the drawn street meets them cleanly.
  return simplify([a, ...mid, b], 12);
}
