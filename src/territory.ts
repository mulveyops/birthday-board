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
  const turf = territoryIds(board);
  const nbr = new Map<string, Set<string>>();
  for (const e of board.edges) {
    if (!nbr.has(e.from)) nbr.set(e.from, new Set());
    if (!nbr.has(e.to)) nbr.set(e.to, new Set());
    nbr.get(e.from)!.add(e.to);
    nbr.get(e.to)!.add(e.from);
  }
  const adj = new Map<string, string[]>();
  for (const id of turf) {
    // BFS out of this corner through non-turf nodes; stop at the first turf
    // corner reached along each branch.
    const found = new Set<string>();
    const seen = new Set<string>([id]);
    const queue: string[] = [...(nbr.get(id) ?? [])];
    for (const q of queue) seen.add(q);
    while (queue.length) {
      const cur = queue.shift()!;
      if (turf.has(cur)) {
        found.add(cur);
        continue; // don't pass through a claimable corner
      }
      for (const nx of nbr.get(cur) ?? []) {
        if (!seen.has(nx)) {
          seen.add(nx);
          queue.push(nx);
        }
      }
    }
    adj.set(id, [...found]);
  }
  return adj;
}

/** Longest simple path (in corners) within one team's owned subgraph. Exact
 * DFS on small components; randomized greedy walks as a fallback on big ones
 * so a huge late-game empire can't hang a phone. */
export function longestRun(owned: Set<string>, adj: Map<string, string[]>): number {
  if (owned.size === 0) return 0;
  const ownedAdj = new Map<string, string[]>();
  for (const id of owned) ownedAdj.set(id, (adj.get(id) ?? []).filter((n) => owned.has(n)));

  // Split into connected components.
  const seen = new Set<string>();
  let best = 0;
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
    best = Math.max(best, comp.length <= 18 ? exactLongestPath(comp, ownedAdj) : approxLongestPath(comp, ownedAdj));
  }
  return best;
}

/** Exhaustive DFS longest path — fine up to ~18 nodes (grid corners branch little). */
function exactLongestPath(comp: string[], adj: Map<string, string[]>): number {
  let best = 1;
  const onPath = new Set<string>();
  const dfs = (node: string, len: number) => {
    best = Math.max(best, len);
    onPath.add(node);
    for (const n of adj.get(node) ?? []) {
      if (!onPath.has(n)) dfs(n, len + 1);
    }
    onPath.delete(node);
  };
  for (const s of comp) dfs(s, 1);
  return best;
}

/** Randomized greedy walks — a solid lower bound for oversized components. */
function approxLongestPath(comp: string[], adj: Map<string, string[]>): number {
  let best = 1;
  const tries = Math.min(400, comp.length * 12);
  for (let t = 0; t < tries; t++) {
    const onPath = new Set<string>();
    let cur = comp[Math.floor(Math.random() * comp.length)];
    onPath.add(cur);
    let len = 1;
    for (;;) {
      const options = (adj.get(cur) ?? []).filter((n) => !onPath.has(n));
      if (!options.length) break;
      cur = options[Math.floor(Math.random() * options.length)];
      onPath.add(cur);
      len++;
    }
    best = Math.max(best, len);
  }
  return best;
}

/** Every team's longest run, from the shared spot→owner map. */
export function computeRuns(
  ownership: Record<string, string>,
  adj: Map<string, string[]>,
): Record<string, number> {
  const byTeam = new Map<string, Set<string>>();
  for (const [spot, team] of Object.entries(ownership)) {
    if (!byTeam.has(team)) byTeam.set(team, new Set());
    byTeam.get(team)!.add(spot);
  }
  const out: Record<string, number> = {};
  for (const [team, owned] of byTeam) out[team] = longestRun(owned, adj);
  return out;
}
