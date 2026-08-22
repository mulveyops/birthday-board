import type { Board } from './types';

// ---------------------------------------------------------------------------
// Territory graph: which corners are claimable, which corners are "consecutive",
// and how long a team's best run is. A run is a simple path through adjacent
// owned corners — turns are fine (a1 → b1 → c1 → c2 is a run of 4); what breaks
// it is a corner you don't own.
// ---------------------------------------------------------------------------

/** Spot types that are claimable turf. POIs (bars, bowser, monuments) and the
 * start/finish anchors are the "big" layer — they never become territory. */
const TERRITORY_TYPES = new Set(['blank', 'coin', 'challenge', 'chance']);

/** All squares that play as spots: 3+-road intersections or explicitly typed. */
function spotIds(board: Board): Set<string> {
  const deg = new Map<string, number>();
  for (const e of board.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const s of board.squares) {
    if ((deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank') out.add(s.id);
  }
  return out;
}

/** The claimable corners of a board. */
export function territoryIds(board: Board): Set<string> {
  const spots = spotIds(board);
  const out = new Set<string>();
  for (const s of board.squares) {
    if (spots.has(s.id) && TERRITORY_TYPES.has(s.type)) out.add(s.id);
  }
  return out;
}

/**
 * Adjacency between claimable corners. Two corners are neighbors when a street
 * path connects them without passing through another claimable corner — plain
 * path nodes and POIs in between are walked through (a bar mid-block doesn't
 * sever the run; it's just not paintable itself).
 */
export function territoryAdjacency(board: Board): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const [id, links] of territoryLinks(board)) adj.set(id, links.map((l) => l.to));
  return adj;
}

/** One hop between adjacent corners, plus the board edges the street runs
 * along â so a run can be DRAWN on the map, not just counted. */
export interface TurfLink {
  to: string;
  /** Edge ids from this corner to `to`, in order. */
  edges: string[];
}

/** Adjacency with the connecting streets attached. Same BFS as above, but it
 * remembers how it got there. */
export function territoryLinks(board: Board): Map<string, TurfLink[]> {
  const turf = territoryIds(board);
  const nbr = new Map<string, { node: string; edge: string }[]>();
  const push = (a: string, b: string, edge: string) => {
    if (!nbr.has(a)) nbr.set(a, []);
    nbr.get(a)!.push({ node: b, edge });
  };
  for (const e of board.edges) {
    push(e.from, e.to, e.id);
    push(e.to, e.from, e.id);
  }
  const out = new Map<string, TurfLink[]>();
  for (const id of turf) {
    // BFS out of this corner through non-turf nodes; stop at the first turf
    // corner reached along each branch. `via` walks back to rebuild the street.
    const found = new Map<string, string[]>();
    const via = new Map<string, { from: string; edge: string }>();
    const seen = new Set<string>([id]);
    const queue: string[] = [];
    for (const step of nbr.get(id) ?? []) {
      if (seen.has(step.node)) continue;
      seen.add(step.node);
      via.set(step.node, { from: id, edge: step.edge });
      queue.push(step.node);
    }
    while (queue.length) {
      const cur = queue.shift()!;
      if (turf.has(cur)) {
        // Walk the breadcrumbs home to collect the streets in between.
        const chain: string[] = [];
        for (let at = cur; at !== id; ) {
          const step = via.get(at)!;
          chain.unshift(step.edge);
          at = step.from;
        }
        if (!found.has(cur)) found.set(cur, chain);
        continue; // don't pass through a claimable corner
      }
      for (const step of nbr.get(cur) ?? []) {
        if (!seen.has(step.node)) {
          seen.add(step.node);
          via.set(step.node, { from: cur, edge: step.edge });
          queue.push(step.node);
        }
      }
    }
    out.set(id, [...found].map(([to, edges]) => ({ to, edges })));
  }
  return out;
}

/** Longest simple path (in corners) within one team's owned subgraph. Exact
 * DFS on small components; randomized greedy walks as a fallback on big ones
 * so a huge late-game empire can't hang a phone. */
export function longestRun(owned: Set<string>, adj: Map<string, string[]>): number {
  return longestRunPath(owned, adj).length;
}

/** The winning run itself, in order â what the map draws. */
export function longestRunPath(owned: Set<string>, adj: Map<string, string[]>): string[] {
  if (owned.size === 0) return [];
  const ownedAdj = new Map<string, string[]>();
  for (const id of owned) ownedAdj.set(id, (adj.get(id) ?? []).filter((n) => owned.has(n)));

  // Split into connected components.
  const seen = new Set<string>();
  let best: string[] = [];
  for (const start of owned) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of ownedAdj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const path = comp.length <= 18 ? exactLongestPath(comp, ownedAdj) : approxLongestPath(comp, ownedAdj);
    if (path.length > best.length) best = path;
  }
  return best;
}

/** Exhaustive DFS longest path â fine up to ~18 nodes (grid corners branch little). */
function exactLongestPath(comp: string[], adj: Map<string, string[]>): string[] {
  let best: string[] = [];
  const onPath: string[] = [];
  const inPath = new Set<string>();
  const dfs = (node: string) => {
    onPath.push(node);
    inPath.add(node);
    if (onPath.length > best.length) best = [...onPath];
    for (const n of adj.get(node) ?? []) {
      if (!inPath.has(n)) dfs(n);
    }
    onPath.pop();
    inPath.delete(node);
  };
  for (const s of comp) dfs(s);
  return best;
}

/** Randomized greedy walks â a solid lower bound for oversized components. */
function approxLongestPath(comp: string[], adj: Map<string, string[]>): string[] {
  let best: string[] = [];
  const tries = Math.min(400, comp.length * 12);
  for (let t = 0; t < tries; t++) {
    const onPath = new Set<string>();
    let cur = comp[Math.floor(Math.random() * comp.length)];
    onPath.add(cur);
    const path = [cur];
    for (;;) {
      const options = (adj.get(cur) ?? []).filter((n) => !onPath.has(n));
      if (!options.length) break;
      cur = options[Math.floor(Math.random() * options.length)];
      onPath.add(cur);
      path.push(cur);
    }
    if (path.length > best.length) best = path;
  }
  return best;
}

/** Every team's longest run, from the shared spotâowner map. */
export function computeRuns(
  ownership: Record<string, string>,
  adj: Map<string, string[]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [team, path] of Object.entries(computeRunPaths(ownership, adj))) out[team] = path.length;
  return out;
}

/** Every team's winning run as an ordered corner list. */
export function computeRunPaths(
  ownership: Record<string, string>,
  adj: Map<string, string[]>,
): Record<string, string[]> {
  const byTeam = new Map<string, Set<string>>();
  for (const [spot, team] of Object.entries(ownership)) {
    if (!byTeam.has(team)) byTeam.set(team, new Set());
    byTeam.get(team)!.add(spot);
  }
  const out: Record<string, string[]> = {};
  for (const [team, owned] of byTeam) out[team] = longestRunPath(owned, adj);
  return out;
}
