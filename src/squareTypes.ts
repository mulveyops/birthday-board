import type { SquareType } from './types';

export interface SquareTypeMeta {
  label: string;
  emoji: string;
  color: string;
  hint: string;
}

export const SQUARE_TYPES: Record<SquareType, SquareTypeMeta> = {
  blank: {
    label: 'Space',
    emoji: '',
    color: '#d8d4cc',
    hint: 'A plain walking slab — just part of the path.',
  },
  bar: {
    label: 'Bar',
    emoji: '🍺',
    color: '#f97316',
    hint: 'A real place on the map — stars land here, you can camp here, and it draws as its own building.',
  },
  challenge: {
    label: 'Challenge',
    emoji: '🧩',
    color: '#3b82f6',
    hint: 'A puzzle or task; reward scales with how well you do.',
  },
  coin: {
    label: 'Coins',
    emoji: '🪙',
    color: '#eab308',
    hint: 'A simple pickup — the grind currency.',
  },
  chance: {
    label: 'Chance',
    emoji: '❓',
    color: '#a855f7',
    hint: 'A random event, good or bad.',
  },
  poi: {
    label: 'Point of Interest',
    emoji: '📍',
    color: '#ec4899',
    hint: 'A monument or a photo/picture-clue spot.',
  },
  start: {
    label: 'Start',
    emoji: '🚩',
    color: '#22c55e',
    hint: 'Where a team begins the night.',
  },
  finish: {
    label: 'Final Bar',
    emoji: '🏁',
    color: '#111827',
    hint: 'The known endgame bar everyone converges on.',
  },
  bowser: {
    label: 'Bowser',
    emoji: '👹',
    color: '#166534',
    hint: 'A forced gauntlet — do the challenge or lose coins (worse you do, more you lose).',
  },
};

/**
 * What you can PLACE. Every ordinary space is the same thing now — the board
 * doesn't advertise what a space does, so there's nothing to choose between.
 * Coins, chance and challenge are resolved at play time, not authored.
 */
export const PLACE_ORDER: SquareType[] = ['blank', 'start', 'finish'];

/**
 * What a selected square can be CHANGED to. Landmarks are here and not in the
 * palette because they're placed on a real building, not dropped on a corner.
 * A square already carrying a retired type keeps it listed (see the editor) so
 * it can be seen and converted rather than silently stranded.
 */
// Every named place on this board is a bar, so 'poi' is retired from the
// vocabulary — it survives in the type union only so older boards still load.
export const TYPE_ORDER: SquareType[] = ['blank', 'bar', 'bowser', 'start', 'finish'];
