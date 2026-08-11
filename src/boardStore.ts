import type { Board, Square, SquareType } from './types';

const KEY = 'mke-birthday-board-v3';

/** Center of the Lower East Side play area (roughly Brady St). */
export const DEFAULT_CENTER: [number, number] = [43.0545, -87.8895];

export function makeSquare(
  type: SquareType,
  title: string,
  lat: number,
  lng: number,
): Square {
  return {
    id: crypto.randomUUID(),
    type,
    title,
    lat,
    lng,
    notes: '',
    reward: type === 'coin' ? 10 : 0,
  };
}

export function defaultBoard(): Board {
  return {
    name: 'Lower East Side — Birthday Board',
    center: DEFAULT_CENTER,
    zoom: 15,
    boundary: [],
    boundaryClosed: false,
    phase: 'area',
    padding: 0.04,
    squares: [],
    edges: [],
    enforceDirection: false,
    locked: false,
  };
}

export function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw) as Board;
      // Backfill fields added after this board was first saved.
      if (!b.phase) b.phase = 'area';
      if (typeof b.padding !== 'number') b.padding = 0.04;
      if (!Array.isArray(b.edges)) b.edges = [];
      if (typeof b.enforceDirection !== 'boolean') b.enforceDirection = false;
      if (typeof b.locked !== 'boolean') b.locked = false;
      return b;
    }
  } catch {
    /* fall through to default */
  }
  return defaultBoard();
}

export function saveBoard(board: Board): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    /* ignore quota / private-mode errors */
  }
}
