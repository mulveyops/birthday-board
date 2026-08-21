// The board sits on a real (but caged + stylized) map, so positions are real
// world coordinates. Everything later (teams, tokens, check-ins, stars, battles)
// builds on this same shape and gets GPS for free.

export type SquareType =
  | 'blank'
  | 'start'
  | 'finish'
  | 'coin'
  | 'challenge'
  | 'chance'
  | 'poi'
  | 'bar'
  | 'bowser';

export interface LatLng {
  lat: number;
  lng: number;
}

/** One multiple-choice trivia question — pinned on a square or in the shared bank. */
export interface TriviaQuestion {
  /** Content-row id (present on bank questions; used by Square.questionIds). */
  id?: string;
  q: string;
  /** 2–4 answer options. */
  choices: string[];
  /** Index into `choices` of the correct answer. */
  correct: number;
  /** Optional public URL of a photo shown above the question (photo trivia). */
  image?: string;
}

/** One card in the chance deck. Landing on an unowned chance space draws one. */
export interface ChanceCard {
  id: string;
  /** Flavor text shown on the drawn card. */
  text: string;
  /** What the card does: coins in/out, rob a rival, claim the space, or nothing. */
  effect: 'gain' | 'lose' | 'rob' | 'claim' | 'nothing';
  /** Coin amount for gain/lose (rob/claim amounts come from game config). */
  amount: number;
}

/** Rich point-of-interest properties for real places (bars, landmarks).
 * Edited in the designer; the player's spot sheet (and, as they're built,
 * the encounter runtimes) read from it. */
export interface PoiProps {
  /** What happens here. star-bar = the ⭐ rotation (follows square TYPE
   * 'bar'); h2h = head-to-head between teams; challenge = a specific task
   * to undertake; boss = set-piece showdown; landmark = flavor only. */
  encounter: 'star-bar' | 'h2h' | 'challenge' | 'boss' | 'landmark';
  /** One-liner players read on the spot sheet — what IS this place? */
  blurb?: string;
  /** The play itself: the task/rules a team takes on here. */
  task?: string;
  /** Coins for winning/completing the play. */
  reward?: number;
  /** Bespoke art asset key (ChatGPT art pipeline), e.g. "hero_wolskis". */
  artRef?: string;
}

export interface Square extends LatLng {
  id: string;
  type: SquareType;
  title: string;
  notes: string;
  /** Coins awarded, or the magnitude/difficulty of the square. */
  reward: number;
  /** Point-of-interest properties (bar/poi squares). */
  poi?: PoiProps;
  /** One-off custom trivia written directly on this square; auto-scored in play. */
  questions?: TriviaQuestion[];
  /** Specific shared-bank questions picked for this spot (references, so bank
   * edits flow through). Picked questions leave the general shuffle. */
  questionIds?: string[];
  /** Chance only: limit this spot's draws to these deck cards (empty/unset = whole deck). */
  cardIds?: string[];
}

/** A path connecting two squares. Directed = one-way (from → to). */
export interface Edge {
  id: string;
  from: string;
  to: string;
  directed: boolean;
  /** Street geometry from `from` → `to`, for drawing the path along the road. */
  path?: LatLng[];
}

/** The staged workflow: lock the area, then the framing, then place squares. */
export type Phase = 'area' | 'frame' | 'squares';

export interface SceneryBar {
  lat: number;
  lng: number;
  name: string;
}

/** A land-use block, tinted by what it mostly is. */
export interface SceneryBlock {
  ring: LatLng[];
  kind: 'residential' | 'commercial' | 'retail' | 'industrial' | 'civic';
}

/** A curated point of interest rendered as a little cartoon sprite. */
export interface SceneryPoi {
  lat: number;
  lng: number;
  emoji: string;
  name?: string;
}

/** A named street run inside the board — its label draws along the geometry.
 * Major streets (Brady, Humboldt…) label big and always; minor ones appear
 * once the player zooms in. */
export interface StreetLabel {
  name: string;
  pts: LatLng[];
  major: boolean;
}

/** Stylized surroundings pulled from OSM and baked into the board. */
export interface Scenery {
  blocks: SceneryBlock[];
  parks: LatLng[][];
  woods: LatLng[][];
  water: LatLng[][];
  rivers: LatLng[][];
  bars: SceneryBar[];
  pois: SceneryPoi[];
  trees: LatLng[];
  /** Street-name labels baked from OSM ("🛣 Label the streets"). */
  streetLabels?: StreetLabel[];
}

export interface Board {
  name: string;
  /** Initial map center + zoom (used on first load). */
  center: [number, number];
  zoom: number;
  /** Play-area boundary as world coordinates. */
  boundary: LatLng[];
  /** Whether the boundary is a closed loop. */
  boundaryClosed: boolean;
  /** Which step of the workflow we're on. */
  phase: Phase;
  /** Margin around the area when caged, as a fraction of its size. */
  padding: number;
  squares: Square[];
  /** Paths between squares (the board graph). */
  edges: Edge[];
  /** Whether one-way paths are enforced (order matters) or ignored. */
  enforceDirection: boolean;
  /** Layout lock: protects a hand-curated board from an accidental redraw. */
  locked: boolean;
  /** Stylized surroundings baked from OSM (optional until loaded). */
  scenery?: Scenery;
  /** Show the baked illustrated-city underlay (public/art/board-underlay.webp). */
  artUnderlay?: boolean;
  /** Illustrated backdrop behind the board (public/art/backdrops/*.webp).
   * Replaces the procedural clouds/ribbon/compass — the art brings its own. */
  backdrop?: 'frame' | 'island' | 'cage';
  /** Shared trivia bank, snapshotted from the content table at publish.
   * Challenge spots without pinned questions deal from this. */
  triviaBank?: TriviaQuestion[];
  /** Chance card deck, snapshotted from the content table at publish. */
  chanceDeck?: ChanceCard[];
}
