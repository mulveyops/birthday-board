// Lay the board along the real streets: fetch the walkable streets in the area,
// merge them into one graph, then CLEAN the graph before beading spaces onto it —
// collapse jogged intersections, clip to the (buffered) boundary, prune stub
// dead-ends, drop floating islands — so the track reads as a tidy game board
// rather than a faithful map. All spaces start generic; specials get sprinkled.

import type { Edge, LatLng, Scenery, Square, SquareType, StreetLabel } from './types';
import { makeSquare } from './boardStore';
import { metersBetween, fetchStreetWays, fetchScenery, fetchNamedStreetWays, simplify } from './snap';

const MERGE_LEN = 45; // junctions joined by a run shorter than this collapse into one
const BOUNDARY_PAD = 25; // "inside" tolerance so boundary-snapped streets aren't coin-flipped out
const STUB_LEN = 80; // dead-end stubs shorter than this get pruned
const MAX_TILE = 135; // hard cap on one tile's length; longer blocks subdivide instead

const toRad = (d: number) => (d * Math.PI) / 180;
function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
function offsetPoint(p: LatLng, bearing: number, meters: number): LatLng {
  return {
    lat: p.lat + (meters * Math.cos(toRad(bearing))) / 111320,
    lng: p.lng + (meters * Math.sin(toRad(bearing))) / (111320 * Math.cos(toRad(p.lat))),
  };
}
function polyBBox(poly: LatLng[]) {
  const lats = poly.map((p) => p.lat);
  const lngs = poly.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}
function polyAreaMeters(poly: LatLng[]): number {
  if (poly.length < 3) return 0;
  const k = Math.cos(toRad(poly[0].lat)) * 111320;
  const m = 111320;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].lng * k * (poly[i].lat * m) - poly[i].lng * k * (poly[j].lat * m);
  }
  return Math.abs(a / 2);
}
function scatterInPoly(poly: LatLng[], count: number, out: LatLng[]) {
  const { minLat, maxLat, minLng, maxLng } = polyBBox(poly);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 40) {
    guard++;
    const p = { lat: minLat + Math.random() * (maxLat - minLat), lng: minLng + Math.random() * (maxLng - minLng) };
    if (pointInPoly(p, poly)) {
      out.push(p);
      placed++;
    }
  }
}
function treesAlong(line: LatLng[], spacing: number, offset: number, out: LatLng[]) {
  const arc = [0];
  for (let i = 1; i < line.length; i++) arc.push(arc[i - 1] + metersBetween(line[i - 1], line[i]));
  const total = arc[arc.length - 1];
  for (let d = spacing / 2; d < total; d += spacing) {
    const p = interpAt(line, arc, d);
    const a = interpAt(line, arc, Math.max(0, d - 3));
    const b = interpAt(line, arc, Math.min(total, d + 3));
    const brg = bearingDeg(a, b);
    out.push(offsetPoint(p, brg + 90, offset));
    out.push(offsetPoint(p, brg - 90, offset));
  }
}

/** A random point of interest to sprinkle onto the blank track. */
function randomSpecial(): SquareType {
  const table: [SquareType, number][] = [
    ['coin', 0.3],
    ['chance', 0.25],
    ['challenge', 0.2],
    ['poi', 0.15],
    ['bar', 0.1],
  ];
  let r = Math.random();
  for (const [t, w] of table) {
    if (r < w) return t;
    r -= w;
  }
  return 'coin';
}

function pointInPoly(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng;
    const yi = poly[i].lat;
    const xj = poly[j].lng;
    const yj = poly[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Meters from a point to the nearest edge of a closed polygon. */
function distToPolyMeters(p: LatLng, poly: LatLng[]): number {
  const k = Math.cos(toRad(p.lat)) * 111320;
  const m = 111320;
  const px = p.lng * k;
  const py = p.lat * m;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].lng * k;
    const ay = poly[j].lat * m;
    const bx = poly[i].lng * k;
    const by = poly[i].lat * m;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Interpolate a point at arc-length `d` along a polyline. */
function interpAt(pts: LatLng[], arc: number[], d: number): LatLng {
  let seg = 0;
  while (seg < pts.length - 2 && arc[seg + 1] < d) seg++;
  const span = arc[seg + 1] - arc[seg];
  const t = span === 0 ? 0 : (d - arc[seg]) / span;
  return {
    lat: pts[seg].lat + t * (pts[seg + 1].lat - pts[seg].lat),
    lng: pts[seg].lng + t * (pts[seg + 1].lng - pts[seg].lng),
  };
}

/** Endpoint-preserving Chaikin corner-cutting: kinked polylines → flowing curves. */
function chaikin(pts: LatLng[], iters: number): LatLng[] {
  let out = pts;
  for (let k = 0; k < iters; k++) {
    if (out.length < 3) break;
    const next: LatLng[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i];
      const q = out[i + 1];
      next.push({ lat: p.lat * 0.75 + q.lat * 0.25, lng: p.lng * 0.75 + q.lng * 0.25 });
      next.push({ lat: p.lat * 0.25 + q.lat * 0.75, lng: p.lng * 0.25 + q.lng * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** The slice of a polyline between two arc-lengths, with interpolated ends. */
function subPolyline(pts: LatLng[], arc: number[], dStart: number, dEnd: number): LatLng[] {
  const out: LatLng[] = [interpAt(pts, arc, dStart)];
  for (let i = 0; i < pts.length; i++) {
    if (arc[i] > dStart + 0.5 && arc[i] < dEnd - 0.5) out.push(pts[i]);
  }
  out.push(interpAt(pts, arc, dEnd));
  return out;
}

/** A stretch of street between two junction/dead-end points. Negative endpoint
 * ids are synthetic cut points where the boundary sliced a street. */
interface Run {
  a: number;
  b: number;
  pts: LatLng[];
}

function arcOf(pts: LatLng[]): number[] {
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + metersBetween(pts[i - 1], pts[i]));
  return arc;
}
function runLen(r: Run): number {
  const arc = arcOf(r.pts);
  return arc[arc.length - 1];
}
function midOf(r: Run): LatLng {
  const arc = arcOf(r.pts);
  return interpAt(r.pts, arc, arc[arc.length - 1] / 2);
}

/** Move one end of a path by (dLat, dLng), blending the shift over the first
 * `blend` meters so the street bends smoothly to follow instead of kinking.
 * Used when the user drags a space: its attached paths come along. */
export function shiftPathEnd(
  path: LatLng[],
  end: 'start' | 'end',
  dLat: number,
  dLng: number,
  blend = 30,
): LatLng[] {
  const arc = arcOf(path);
  const total = arc[arc.length - 1];
  const R = Math.min(blend, total);
  return path.map((p, i) => {
    const s = end === 'start' ? arc[i] : total - arc[i];
    const w = R === 0 ? (s === 0 ? 1 : 0) : Math.max(0, 1 - s / R);
    return { lat: p.lat + w * dLat, lng: p.lng + w * dLng };
  });
}

/** Union-find over node/cluster ids. */
class DSU {
  private parent = new Map<number, number>();
  find(x: number): number {
    const p = this.parent.get(x);
    if (p === undefined || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: number, b: number) {
    this.parent.set(this.find(a), this.find(b));
  }
}

export async function generateStreetBoard(
  boundary: LatLng[],
  spacing = 110,
): Promise<{ squares: Square[]; edges: Edge[] }> {
  const { coords, ways } = await fetchStreetWays(boundary);
  if (!ways.length) throw new Error('no streets found in this area');

  // Merge all ways into one undirected graph so a street split across several
  // OSM ways is treated as continuous.
  const adj = new Map<number, Set<number>>();
  const addAdj = (a: number, b: number) => {
    if (a === b || !coords.has(a) || !coords.has(b)) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const way of ways) for (let i = 0; i < way.length - 1; i++) addAdj(way[i], way[i + 1]);

  const degree = (id: number) => adj.get(id)?.size ?? 0;
  // A node is "significant" (a real board vertex) if it's an intersection
  // (degree ≥ 3) or a dead-end (degree 1). Degree-2 nodes are just shape points.
  const significant = (id: number) => degree(id) !== 2;

  // ---- Trace runs: significant node → shape points → next significant node ----
  const walked = new Set<string>();
  let runs: Run[] = [];
  for (const [id] of adj) {
    if (!significant(id)) continue;
    for (const nb of adj.get(id)!) {
      if (walked.has(`${id}->${nb}`)) continue;
      walked.add(`${id}->${nb}`);
      const nodes = [id, nb];
      let prev = id;
      let cur = nb;
      while (!significant(cur)) {
        const nxt = [...adj.get(cur)!].find((x) => x !== prev);
        if (nxt === undefined) break;
        prev = cur;
        cur = nxt;
        nodes.push(cur);
      }
      walked.add(`${cur}->${prev}`);
      const pts = nodes.map((n) => coords.get(n)!).filter(Boolean);
      if (pts.length >= 2) runs.push({ a: id, b: cur, pts });
    }
  }

  // ---- Collapse jogged/offset intersections: junctions joined by a very short
  // run become ONE junction at their centroid, so no sliver tiles between them.
  const jog = new DSU();
  for (const r of runs) if (r.a !== r.b && runLen(r) < MERGE_LEN) jog.union(r.a, r.b);
  const endpointIds = new Set<number>();
  for (const r of runs) {
    endpointIds.add(r.a);
    endpointIds.add(r.b);
  }
  const sums = new Map<number, { lat: number; lng: number; n: number }>();
  for (const id of endpointIds) {
    const rep = jog.find(id);
    const p = coords.get(id)!;
    const s = sums.get(rep) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += p.lat;
    s.lng += p.lng;
    s.n++;
    sums.set(rep, s);
  }
  const cpos = new Map<number, LatLng>();
  for (const [rep, s] of sums) cpos.set(rep, { lat: s.lat / s.n, lng: s.lng / s.n });

  const merged: Run[] = [];
  for (const r of runs) {
    const A = jog.find(r.a);
    const B = jog.find(r.b);
    if (A === B && runLen(r) < MERGE_LEN) continue; // the contracted jog itself
    const pts = [...r.pts];
    pts[0] = cpos.get(A)!;
    pts[pts.length - 1] = cpos.get(B)!;
    merged.push({ a: A, b: B, pts });
  }

  // ---- Divided roads: two ways hugging each other between the same pair of
  // junctions collapse into one track (keep the shorter carriageway).
  const byPair = new Map<string, Run>();
  const kept: Run[] = [];
  for (const r of merged) {
    if (r.a === r.b) {
      kept.push(r);
      continue;
    }
    const key = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
    const other = byPair.get(key);
    if (!other) {
      byPair.set(key, r);
    } else if (metersBetween(midOf(other), midOf(r)) < 40) {
      if (runLen(r) < runLen(other)) byPair.set(key, r);
    } else {
      kept.push(r); // genuinely different streets between the same junctions
    }
  }
  runs = [...kept, ...byPair.values()];

  // ---- Clip to the boundary, with a buffer so streets the boundary was
  // snapped onto (nodes sitting exactly ON the polygon edge) count as inside.
  const insideB = (p: LatLng) => pointInPoly(p, boundary) || distToPolyMeters(p, boundary) <= BOUNDARY_PAD;
  let cutSeq = -1;
  const clipped: Run[] = [];
  for (const r of runs) {
    let piece: LatLng[] = [];
    let startIdx = 0;
    const flush = (endIdx: number) => {
      if (piece.length >= 2) {
        clipped.push({
          a: startIdx === 0 ? r.a : cutSeq--,
          b: endIdx === r.pts.length - 1 ? r.b : cutSeq--,
          pts: piece,
        });
      }
      piece = [];
    };
    for (let i = 0; i < r.pts.length; i++) {
      if (insideB(r.pts[i])) {
        if (piece.length === 0) startIdx = i;
        piece.push(r.pts[i]);
      } else {
        flush(i - 1);
      }
    }
    flush(r.pts.length - 1);
  }

  // ---- End-trim: a cut end that dangles outside the strict boundary loses its
  // outside points — the buffer is only meant to bridge brief mid-run exits,
  // not to let stubs poke past the edge of the board.
  const strictOutside = (p: LatLng) => !pointInPoly(p, boundary) && distToPolyMeters(p, boundary) > 3;
  const trimmed: Run[] = [];
  for (const r of clipped) {
    let i0 = 0;
    let i1 = r.pts.length - 1;
    if (r.a < 0) while (i0 < i1 && strictOutside(r.pts[i0])) i0++;
    if (r.b < 0) while (i1 > i0 && strictOutside(r.pts[i1])) i1--;
    if (i1 - i0 + 1 < 2) continue;
    trimmed.push({ a: r.a, b: r.b, pts: r.pts.slice(i0, i1 + 1) });
  }

  // ---- Heal: any dead end (real or boundary-cut) whose tip is within HEAL_R
  // of another street gets connected to it. Covers OSM topology gaps, links
  // that only exist via filtered-out way types, and perimeter streets whose
  // curve strays outside the simplified boundary polygon.
  const HEAL_R = 30;
  let pieces = trimmed;
  for (;;) {
    const deg2 = new Map<number, number>();
    for (const r of pieces) {
      deg2.set(r.a, (deg2.get(r.a) ?? 0) + 1);
      deg2.set(r.b, (deg2.get(r.b) ?? 0) + 1);
    }
    let healed = false;
    outer: for (const r of pieces) {
      for (const which of ['a', 'b'] as const) {
        const id = r[which];
        if (deg2.get(id) !== 1) continue;
        const tip = which === 'a' ? r.pts[0] : r.pts[r.pts.length - 1];
        const kx = Math.cos(toRad(tip.lat)) * 111320;
        const ky = 111320;
        const px = tip.lng * kx;
        const py = tip.lat * ky;
        let best: { q: Run; i: number; dist: number; proj: LatLng } | null = null;
        for (const q of pieces) {
          if (q === r) continue;
          for (let i = 1; i < q.pts.length; i++) {
            const A = q.pts[i - 1];
            const B = q.pts[i];
            const ax = A.lng * kx, ay = A.lat * ky, bx = B.lng * kx, by = B.lat * ky;
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
            const qx = ax + t * dx, qy = ay + t * dy;
            const dist = Math.hypot(px - qx, py - qy);
            if (dist < (best?.dist ?? HEAL_R)) best = { q, i, dist, proj: { lat: qy / ky, lng: qx / kx } };
          }
        }
        if (!best) continue;
        const { q, i, proj } = best;
        const nearStart = metersBetween(proj, q.pts[0]) < 12;
        const nearEnd = metersBetween(proj, q.pts[q.pts.length - 1]) < 12;
        // Don't heal back onto our own far endpoint (degenerate mini-loop).
        const otherEnd = which === 'a' ? r.b : r.a;
        if ((nearStart && q.a === otherEnd) || (nearEnd && q.b === otherEnd)) continue;
        let junctionId: number;
        let junctionPt: LatLng;
        if (nearStart) {
          junctionId = q.a;
          junctionPt = q.pts[0];
        } else if (nearEnd) {
          junctionId = q.b;
          junctionPt = q.pts[q.pts.length - 1];
        } else {
          junctionId = cutSeq--;
          junctionPt = proj;
          pieces = pieces.filter((x) => x !== q);
          pieces.push({ a: q.a, b: junctionId, pts: [...q.pts.slice(0, i), proj] });
          pieces.push({ a: junctionId, b: q.b, pts: [proj, ...q.pts.slice(i)] });
        }
        if (which === 'a') {
          r.a = junctionId;
          r.pts = [junctionPt, ...r.pts];
        } else {
          r.b = junctionId;
          r.pts = [...r.pts, junctionPt];
        }
        healed = true;
        break outer;
      }
    }
    if (!healed) break;
  }

  // ---- Prune short dead-end stubs (clip artifacts and tiny spurs), repeating
  // so chains of stubs unravel. Long dead-ends (real cul-de-sacs) survive.
  for (let changed = true; changed; ) {
    changed = false;
    const deg = new Map<number, number>();
    const bump = (x: number) => deg.set(x, (deg.get(x) ?? 0) + 1);
    for (const r of pieces) {
      bump(r.a);
      bump(r.b);
    }
    pieces = pieces.filter((r) => {
      if (r.a === r.b) return true;
      if ((deg.get(r.a) === 1 || deg.get(r.b) === 1) && runLen(r) < STUB_LEN) {
        changed = true;
        return false;
      }
      return true;
    });
  }

  // ---- Keep only the largest connected component: no floating islands.
  const comp = new DSU();
  for (const r of pieces) comp.union(r.a, r.b);
  const compLen = new Map<number, number>();
  for (const r of pieces) {
    const c = comp.find(r.a);
    compLen.set(c, (compLen.get(c) ?? 0) + runLen(r));
  }
  let mainComp = 0;
  let mainLen = -1;
  for (const [c, len] of compLen) {
    if (len > mainLen) {
      mainLen = len;
      mainComp = c;
    }
  }
  pieces = pieces.filter((r) => comp.find(r.a) === mainComp);
  if (!pieces.length) throw new Error('no streets inside the area');

  // ---- Schematize: idealize the geometry like a metro map. Chain pieces into
  // "corridors" (straight-through continuations at junctions), recursively fit
  // lines to their sections, snap them onto the dominant 90°/45° grid, and
  // move junctions to the exact line intersections; genuinely curved streets
  // get smoothed instead. Connectivity and rough GPS positions stay real.
  const KX = Math.cos(toRad(boundary[0].lat)) * 111320;
  const KY = 111320;
  const toXY = (p: LatLng): [number, number] => [p.lng * KX, p.lat * KY];
  const fromXY = (x: number, y: number): LatLng => ({ lat: y / KY, lng: x / KX });

  const dpSimplify = (pts: LatLng[], tol: number): LatLng[] => {
    if (pts.length <= 2) return pts;
    const P = pts.map(toXY);
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop()!;
      let maxD = -1;
      let maxI = -1;
      const [ax, ay] = P[i0];
      const [bx, by] = P[i1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let i = i0 + 1; i < i1; i++) {
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / len2));
        const d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
        if (d > maxD) {
          maxD = d;
          maxI = i;
        }
      }
      if (maxD > tol) {
        keep[maxI] = true;
        stack.push([i0, maxI], [maxI, i1]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  for (const r of pieces) r.pts = dpSimplify(r.pts, 6);

  // Direction (radians) leaving a junction into a piece.
  const armBearing = (r: Run, end: 'a' | 'b'): number => {
    const arc = arcOf(r.pts);
    const total = arc[arc.length - 1];
    const d = Math.min(35, total / 2);
    const p0 = end === 'a' ? r.pts[0] : r.pts[r.pts.length - 1];
    const p1 = end === 'a' ? interpAt(r.pts, arc, d) : interpAt(r.pts, arc, total - d);
    const [x0, y0] = toXY(p0);
    const [x1, y1] = toXY(p1);
    return Math.atan2(y1 - y0, x1 - x0);
  };

  const armsOf = new Map<number, { i: number; r: Run; end: 'a' | 'b' }[]>();
  pieces.forEach((r, i) => {
    for (const end of ['a', 'b'] as const) {
      const id = r[end];
      if (!armsOf.has(id)) armsOf.set(id, []);
      armsOf.get(id)!.push({ i, r, end });
    }
  });
  const corr = new DSU();
  for (const [, arms] of armsOf) {
    if (arms.length < 2) continue;
    const cands: [number, number, number][] = [];
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        let diff = (Math.abs(armBearing(arms[i].r, arms[i].end) - armBearing(arms[j].r, arms[j].end)) * 180) / Math.PI;
        diff = Math.min(diff, 360 - diff);
        const bend = Math.abs(180 - diff); // 0 = perfectly straight-through
        if (bend < 35) cands.push([bend, i, j]);
      }
    }
    cands.sort((x, y) => x[0] - y[0]);
    const used = new Set<number>();
    for (const [, i, j] of cands) {
      if (used.has(i) || used.has(j)) continue;
      used.add(i);
      used.add(j);
      corr.union(arms[i].i, arms[j].i);
    }
  }

  interface Line {
    cx: number;
    cy: number;
    ux: number;
    uy: number;
    maxDev: number;
  }
  const fitLine = (allPts: LatLng[]): Line => {
    const P = allPts.map(toXY);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of P) {
      cx += x;
      cy += y;
    }
    cx /= P.length;
    cy /= P.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const [x, y] of P) {
      const dx = x - cx;
      const dy = y - cy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    let maxDev = 0;
    for (const [x, y] of P) maxDev = Math.max(maxDev, Math.abs(-uy * (x - cx) + ux * (y - cy)));
    return { cx, cy, ux, uy, maxDev };
  };

  const STRAIGHT_DEV = 16; // a section this close to its fitted line is "straight"
  const groupIdx = new Map<number, number[]>();
  pieces.forEach((_, i) => {
    const g = corr.find(i);
    if (!groupIdx.has(g)) groupIdx.set(g, []);
    groupIdx.get(g)!.push(i);
  });

  // Order a corridor's pieces into a walkable chain, then recursively segment:
  // a chain that isn't straight splits at its worst junction and re-tests, so
  // the straight sections of a curvy street still get straightened.
  const orderChain = (memberIdx: number[]): number[] => {
    if (memberIdx.length <= 1) return memberIdx;
    const incid = new Map<number, number[]>();
    for (const pi of memberIdx) {
      for (const end of ['a', 'b'] as const) {
        const id = pieces[pi][end];
        if (!incid.has(id)) incid.set(id, []);
        incid.get(id)!.push(pi);
      }
    }
    let start = memberIdx[0];
    let entry = pieces[start].a;
    for (const [id, list] of incid) {
      if (list.length === 1) {
        start = list[0];
        entry = id;
        break;
      }
    }
    const used = new Set<number>();
    const chain: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      chain.push(cur);
      const exit: number = pieces[cur].a === entry ? pieces[cur].b : pieces[cur].a;
      entry = exit;
      cur = (incid.get(exit) ?? []).find((x) => !used.has(x));
    }
    for (const pi of memberIdx) if (!used.has(pi)) chain.push(pi);
    return chain;
  };

  const segLine = new Map<number, Line>(); // piece index -> its straight segment's line
  const segmentChain = (chain: number[]): void => {
    const all = chain.flatMap((pi) => pieces[pi].pts);
    if (all.length < 2) return;
    const line = fitLine(all);
    if (line.maxDev < STRAIGHT_DEV) {
      for (const pi of chain) segLine.set(pi, line);
      return;
    }
    if (chain.length === 1) return; // genuinely curved piece
    let worst = 1;
    let worstD = -1;
    for (let b = 1; b < chain.length; b++) {
      const p = pieces[chain[b]];
      const prev = pieces[chain[b - 1]];
      const sharedPt = p.a === prev.a || p.a === prev.b ? p.pts[0] : p.pts[p.pts.length - 1];
      const [x, y] = toXY(sharedPt);
      const d = Math.abs(-line.uy * (x - line.cx) + line.ux * (y - line.cy));
      if (d > worstD) {
        worstD = d;
        worst = b;
      }
    }
    segmentChain(chain.slice(0, worst));
    segmentChain(chain.slice(worst));
  };
  for (const [, members] of groupIdx) segmentChain(orderChain(members));

  const segLines = [...new Set(segLine.values())];
  const lineIdOf = new Map<Line, number>(segLines.map((l, i) => [l, i]));
  const lineWeight = segLines.map(() => 0);
  for (const [pi, l] of segLine) {
    const arc = arcOf(pieces[pi].pts);
    lineWeight[lineIdOf.get(l)!] += arc[arc.length - 1];
  }

  // Octilinear snap: rotate straight segments onto the dominant street grid so
  // streets meet at true 90°/45° angles and blocks come out rectangular.
  let c4 = 0;
  let s4 = 0;
  segLines.forEach((l, i) => {
    const th = Math.atan2(l.uy, l.ux);
    c4 += lineWeight[i] * Math.cos(4 * th);
    s4 += lineWeight[i] * Math.sin(4 * th);
  });
  const theta0 = Math.atan2(s4, c4) / 4;
  const SNAP_MAX = (20 * Math.PI) / 180; // don't force truly off-grid streets
  for (const l of segLines) {
    const th = Math.atan2(l.uy, l.ux);
    const k = Math.round((th - theta0) / (Math.PI / 4));
    let rot = theta0 + (k * Math.PI) / 4 - th;
    while (rot > Math.PI / 2) rot -= Math.PI;
    while (rot < -Math.PI / 2) rot += Math.PI;
    if (Math.abs(rot) <= SNAP_MAX) {
      const t2 = th + rot;
      l.ux = Math.cos(t2);
      l.uy = Math.sin(t2);
    }
  }

  const jLines = new Map<number, Set<number>>();
  const jCoord = new Map<number, LatLng>();
  pieces.forEach((r, i) => {
    const line = segLine.get(i);
    for (const end of ['a', 'b'] as const) {
      const id = r[end];
      jCoord.set(id, end === 'a' ? r.pts[0] : r.pts[r.pts.length - 1]);
      if (!line) continue;
      if (!jLines.has(id)) jLines.set(id, new Set());
      jLines.get(id)!.add(lineIdOf.get(line)!);
    }
  });

  // Collinear merge: segments of the same street (same angle, sharing a
  // junction, tiny offset) fuse onto ONE line so streets don't step sideways
  // at junctions — that stepping is what made blocks look rhomboid.
  const lineDSU = new DSU();
  for (const [, set] of jLines) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const l1 = segLines[arr[i]];
        const l2 = segLines[arr[j]];
        let dAng = (Math.abs(Math.atan2(l1.uy, l1.ux) - Math.atan2(l2.uy, l2.ux)) * 180) / Math.PI;
        dAng = Math.min(dAng, 360 - dAng);
        dAng = Math.min(dAng, 180 - dAng);
        if (dAng > 2) continue;
        const off = Math.abs(-l1.uy * (l2.cx - l1.cx) + l1.ux * (l2.cy - l1.cy));
        if (off < 20) lineDSU.union(arr[i], arr[j]);
      }
    }
  }
  const lineGroups = new Map<number, number[]>();
  segLines.forEach((_, i) => {
    const root = lineDSU.find(i);
    if (!lineGroups.has(root)) lineGroups.set(root, []);
    lineGroups.get(root)!.push(i);
  });
  for (const [, li] of lineGroups) {
    if (li.length < 2) continue;
    let wSum = 0;
    let cx = 0;
    let cy = 0;
    let cAx = 0;
    let sAx = 0;
    for (const i of li) {
      const l = segLines[i];
      const w = lineWeight[i] || 1;
      wSum += w;
      cx += w * l.cx;
      cy += w * l.cy;
      const th = Math.atan2(l.uy, l.ux);
      cAx += w * Math.cos(2 * th);
      sAx += w * Math.sin(2 * th);
    }
    cx /= wSum;
    cy /= wSum;
    const th = Math.atan2(sAx, cAx) / 2;
    for (const i of li) {
      const l = segLines[i];
      l.cx = cx;
      l.cy = cy;
      l.ux = Math.cos(th);
      l.uy = Math.sin(th);
    }
  }

  const projectOn = (line: Line, p: LatLng): LatLng => {
    const [x, y] = toXY(p);
    const t = (x - line.cx) * line.ux + (y - line.cy) * line.uy;
    return fromXY(line.cx + t * line.ux, line.cy + t * line.uy);
  };
  const newPos = new Map<number, LatLng>();
  for (const [id, set] of jLines) {
    const ls = [...set].map((i) => segLines[i]);
    const orig = jCoord.get(id)!;
    let target: LatLng;
    let best: { s: number; A: Line; B: Line } | null = null;
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const s = Math.abs(ls[i].ux * ls[j].uy - ls[i].uy * ls[j].ux);
        if (s > (best?.s ?? 0.3)) best = { s, A: ls[i], B: ls[j] };
      }
    }
    if (best) {
      const { A, B } = best;
      const det = A.ux * -B.uy - -B.ux * A.uy;
      const t = ((B.cx - A.cx) * -B.uy - -B.ux * (B.cy - A.cy)) / det;
      target = fromXY(A.cx + t * A.ux, A.cy + t * A.uy);
    } else target = projectOn(ls[0], orig);
    if (metersBetween(orig, target) <= 45) newPos.set(id, target);
  }

  for (let i = 0; i < pieces.length; i++) {
    const r = pieces[i];
    const A = newPos.get(r.a) ?? r.pts[0];
    const B = newPos.get(r.b) ?? r.pts[r.pts.length - 1];
    if (segLine.has(i)) {
      r.pts = [A, B];
    } else {
      r.pts = chaikin(dpSimplify([A, ...r.pts.slice(1, -1), B], 6), 2);
    }
  }

  // ---- Flatten junctions: a junction sitting a couple meters off its
  // through-street's drawn line makes both adjacent strokes tilt down to it,
  // carving a small notch in the track's edge at T intersections. Project each
  // junction onto its local through-line (the intersection of both through-
  // lines at a 4-way) and blend the shift into the incident streets.
  {
    interface Arm {
      r: Run;
      end: 'a' | 'b';
    }
    const incMap = new Map<number, Arm[]>();
    for (const r of pieces) {
      for (const end of ['a', 'b'] as const) {
        const id = r[end];
        if (!incMap.has(id)) incMap.set(id, []);
        incMap.get(id)!.push({ r, end });
      }
    }
    const endPtOf = (arm: Arm) => (arm.end === 'a' ? arm.r.pts[0] : arm.r.pts[arm.r.pts.length - 1]);
    const localFar = (arm: Arm) => {
      const arc = arcOf(arm.r.pts);
      const total = arc[arc.length - 1];
      const d = Math.min(30, total);
      return arm.end === 'a' ? interpAt(arm.r.pts, arc, d) : interpAt(arm.r.pts, arc, total - d);
    };
    const armDir = (arm: Arm) => {
      const [x0, y0] = toXY(endPtOf(arm));
      const [x1, y1] = toXY(localFar(arm));
      return Math.atan2(y1 - y0, x1 - x0);
    };
    const blendShift = (r: Run, end: 'a' | 'b', dLat: number, dLng: number) => {
      const arc = arcOf(r.pts);
      const total = arc[arc.length - 1];
      const R = Math.min(30, total);
      r.pts = r.pts.map((p, i) => {
        const s = end === 'a' ? arc[i] : total - arc[i];
        const w = R === 0 ? (s === 0 ? 1 : 0) : Math.max(0, 1 - s / R);
        return { lat: p.lat + w * dLat, lng: p.lng + w * dLng };
      });
    };
    for (let pass = 0; pass < 3; pass++) {
      for (const [, arms] of incMap) {
        if (arms.length < 2) continue;
        const cpt = endPtOf(arms[0]);
        const cands: { bend: number; i: number; j: number }[] = [];
        for (let i = 0; i < arms.length; i++) {
          for (let j = i + 1; j < arms.length; j++) {
            let diff = (Math.abs(armDir(arms[i]) - armDir(arms[j])) * 180) / Math.PI;
            diff = Math.min(diff, 360 - diff);
            const bend = Math.abs(180 - diff);
            if (bend < 25) cands.push({ bend, i, j });
          }
        }
        if (!cands.length) continue;
        cands.sort((x, y) => x.bend - y.bend);
        const used = new Set<number>();
        const through: { ax: number; ay: number; ux: number; uy: number }[] = [];
        for (const cnd of cands) {
          if (used.has(cnd.i) || used.has(cnd.j)) continue;
          used.add(cnd.i);
          used.add(cnd.j);
          const [ax, ay] = toXY(localFar(arms[cnd.i]));
          const [bx, by] = toXY(localFar(arms[cnd.j]));
          const L = Math.hypot(bx - ax, by - ay) || 1;
          through.push({ ax, ay, ux: (bx - ax) / L, uy: (by - ay) / L });
        }
        const [px, py] = toXY(cpt);
        let tx: number;
        let ty: number;
        if (through.length >= 2 && Math.abs(through[0].ux * through[1].uy - through[0].uy * through[1].ux) > 0.3) {
          const [A, B] = through;
          const det = A.ux * -B.uy - -B.ux * A.uy;
          const t = ((B.ax - A.ax) * -B.uy - -B.ux * (B.ay - A.ay)) / det;
          tx = A.ax + t * A.ux;
          ty = A.ay + t * A.uy;
        } else {
          const A = through[0];
          const t = (px - A.ax) * A.ux + (py - A.ay) * A.uy;
          tx = A.ax + t * A.ux;
          ty = A.ay + t * A.uy;
        }
        const moved = Math.hypot(tx - px, ty - py);
        if (moved < 0.3 || moved > 12) continue;
        const target = fromXY(tx, ty);
        const dLat = target.lat - cpt.lat;
        const dLng = target.lng - cpt.lng;
        for (const arm of arms) blendShift(arm.r, arm.end, dLat, dLng);
      }
    }
  }

  // ---- Bead spaces along each clean run. Tile length is clamped: pick a
  // count near `spacing` but never let a single tile exceed MAX_TILE.
  const squares: Square[] = [];
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  const spaceAt = new Map<number, string>(); // shared spaces at junction/cut ids

  const shared = (endId: number, p: LatLng): string => {
    let sid = spaceAt.get(endId);
    if (!sid) {
      const sq = makeSquare('blank', 'Space', p.lat, p.lng);
      squares.push(sq);
      sid = sq.id;
      spaceAt.set(endId, sid);
    }
    return sid;
  };
  const link = (a: string, b: string, geom: LatLng[]) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ id: crypto.randomUUID(), from: a, to: b, directed: false, path: geom });
  };

  for (const r of pieces) {
    const arc = arcOf(r.pts);
    const total = arc[arc.length - 1];
    if (total < 1) continue;
    const segs = Math.max(1, Math.round(total / spacing), Math.ceil(total / MAX_TILE));
    let prevSid: string | null = null;
    let prevD = 0;
    for (let i = 0; i <= segs; i++) {
      const d = (total * i) / segs;
      let sid: string;
      if (i === 0) sid = shared(r.a, r.pts[0]);
      else if (i === segs) sid = shared(r.b, r.pts[r.pts.length - 1]);
      else {
        const p = interpAt(r.pts, arc, d);
        const sq = makeSquare('blank', 'Space', p.lat, p.lng);
        squares.push(sq);
        sid = sq.id;
      }
      if (prevSid) link(prevSid, sid, subPolyline(r.pts, arc, prevD, d));
      prevSid = sid;
      prevD = d;
    }
  }

  // Sprinkle random points of interest along the otherwise-blank track — but
  // only on path spaces (degree 2): a special at a junction would paint every
  // arm of the intersection its color, drawing a big cross on the board.
  const inc = new Map<string, number>();
  for (const e of edges) {
    inc.set(e.from, (inc.get(e.from) ?? 0) + 1);
    inc.set(e.to, (inc.get(e.to) ?? 0) + 1);
  }
  for (const sq of squares) {
    if (inc.get(sq.id) === 2 && Math.random() < 0.35) sq.type = randomSpecial();
  }

  return { squares, edges };
}

// ---------------------------------------------------------------------------
// Street labels: fetch NAMED streets, stitch each street's OSM ways into
// continuous chains, clip to the board, and classify major vs minor.
// Majors (Brady, Humboldt…) label big & always; minors appear on zoom-in.
// ---------------------------------------------------------------------------

/** "East Brady Street" → "Brady St" — map-label shorthand. */
function shortStreetName(raw: string): string {
  const suffix: Record<string, string> = {
    street: 'St',
    avenue: 'Ave',
    boulevard: 'Blvd',
    drive: 'Dr',
    court: 'Ct',
    place: 'Pl',
    terrace: 'Ter',
    lane: 'Ln',
    road: 'Rd',
    parkway: 'Pkwy',
    circle: 'Cir',
  };
  let words = raw.trim().split(/\s+/);
  if (words.length > 2 && /^(north|south|east|west|n\.?|s\.?|e\.?|w\.?)$/i.test(words[0])) words = words.slice(1);
  return words.map((w) => suffix[w.toLowerCase()] ?? w).join(' ');
}

const MAJOR_HIGHWAYS = new Set(['primary', 'secondary', 'tertiary']);
const LABEL_MIN_RUN = 140; // in-board runs shorter than this stay unlabeled
const LABEL_SPLIT_LEN = 1000; // repeat the label on very long runs

/** Build the street-name labels for a board area. */
export async function buildStreetLabels(boundary: LatLng[]): Promise<StreetLabel[]> {
  const { coords, ways } = await fetchNamedStreetWays(boundary);
  if (!ways.length) return [];

  // Group ways by street name; remember the "biggest" highway class seen.
  const groups = new Map<string, { highway: Set<string>; segs: number[][] }>();
  for (const w of ways) {
    const g = groups.get(w.name) ?? { highway: new Set<string>(), segs: [] };
    g.highway.add(w.highway);
    g.segs.push(w.nodes);
    groups.set(w.name, g);
  }

  const insideish = (p: LatLng) => pointInPoly(p, boundary) || distToPolyMeters(p, boundary) <= BOUNDARY_PAD;
  const runLenM = (pts: LatLng[]) => {
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += metersBetween(pts[i - 1], pts[i]);
    return m;
  };

  const labels: StreetLabel[] = [];
  for (const [name, g] of groups) {
    // ---- Stitch this street's ways into continuous node chains ----
    const unused = g.segs.map((s) => [...s]);
    const chains: number[][] = [];
    while (unused.length) {
      let chain = unused.pop()!;
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < unused.length; i++) {
          const s = unused[i];
          const head = chain[0];
          const tail = chain[chain.length - 1];
          if (s[0] === tail) chain = [...chain, ...s.slice(1)];
          else if (s[s.length - 1] === tail) chain = [...chain, ...[...s].reverse().slice(1)];
          else if (s[s.length - 1] === head) chain = [...s, ...chain.slice(1)];
          else if (s[0] === head) chain = [...[...s].reverse(), ...chain.slice(1)];
          else continue;
          unused.splice(i, 1);
          grew = true;
          break;
        }
      }
      chains.push(chain);
    }

    // ---- Clip each chain to the (buffered) boundary → in-board runs ----
    const runs: LatLng[][] = [];
    for (const chain of chains) {
      const pts = chain.map((id) => coords.get(id)).filter((p): p is LatLng => !!p);
      let cur: LatLng[] = [];
      for (const p of pts) {
        if (insideish(p)) cur.push(p);
        else {
          if (cur.length >= 2) runs.push(cur);
          cur = [];
        }
      }
      if (cur.length >= 2) runs.push(cur);
    }
    const kept = runs.filter((r) => runLenM(r) >= LABEL_MIN_RUN);
    if (!kept.length) continue;

    // Major = a real corridor by OSM class (Brady, Humboldt, Water…). Length
    // alone doesn't qualify — in a grid, every side street runs the full board.
    const major = [...g.highway].some((h) => MAJOR_HIGHWAYS.has(h));
    const short = shortStreetName(name);

    for (const run of kept) {
      // Long runs carry the name more than once, like a real map.
      const len = runLenM(run);
      const pieces = len >= LABEL_SPLIT_LEN ? 2 : 1;
      const per = Math.ceil(run.length / pieces);
      for (let k = 0; k < pieces; k++) {
        const slice = run.slice(k * per, Math.min(run.length, (k + 1) * per + 1));
        if (slice.length < 2 || runLenM(slice) < LABEL_MIN_RUN) continue;
        labels.push({ name: short, pts: simplify(slice, 8), major });
      }
    }
  }
  return labels;
}

/** Fetch the surroundings and bake in tree positions (parks + street-lining). */
export async function buildScenery(boundary: LatLng[], edges: Edge[]): Promise<Scenery> {
  const raw = await fetchScenery(boundary);
  const trees: LatLng[] = [];

  const TREE_CAP = 260;
  for (const poly of [...raw.parks, ...raw.woods]) {
    if (trees.length >= TREE_CAP) break;
    const count = Math.min(45, Math.max(4, Math.round(polyAreaMeters(poly) / 550)));
    scatterInPoly(poly, count, trees);
  }
  for (const e of edges) {
    if (trees.length >= TREE_CAP) break;
    // 17m offset clears the 26m-wide drawn track so canopies peek out from
    // behind the road edge instead of sitting on the pavement.
    if (e.path && e.path.length >= 2) treesAlong(e.path, 70, 17, trees);
  }

  return { ...raw, trees: trees.slice(0, TREE_CAP) };
}
