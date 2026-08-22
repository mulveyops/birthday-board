import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import BoardCanvas, { type Mode } from './BoardCanvas';
import type { Board, ChanceCard, Edge, LatLng, Phase, PoiProps, Square, SquareType, TriviaQuestion } from './types';
import { SQUARE_TYPES, TYPE_ORDER, PLACE_ORDER } from './squareTypes';
import { DUELS, AMBUSH_DUELS, duelByName, randomDuel, duelMaterial } from './duels';
import { loadBoard, saveBoard, makeSquare, defaultBoard } from './boardStore';
import { metersBetween, simplify, snapToStreetsFollowing, routeAlongStreets } from './snap';
import { generateStreetBoard, buildScenery, buildStreetLabels, closeStreetGaps, shiftPathEnd } from './generate';
import { isConfigured } from './supabase';
import {
  publishGame,
  joinGame,
  savedMembership,
  saveMembership,
  listTeams,
  subscribeTeams,
  getBoard,
  myClaims,
  checkInSpot,
  listPositions,
  subscribePositions,
  subscribeClaims,
  seedSpawns,
  listSpawns,
  subscribeSpawns,
  claimSpawnDb,
  listStarClaims,
  subscribeStars,
  buyRoundDb,
  lockStar,
  stealStarClaim,
  logEvent,
  logTriviaAnswers,
  listEvents,
  subscribeEvents,
  getGameFull,
  subscribeGame,
  updateGameStatus,
  updateGameConfig,
  PARTY_CONFIG,
  TEST_CONFIG,
  deviceId,
  adjustCoins,
  transferCoins,
  adjustStars,
  dropSpawnNow,
  listStarSpawns,
  subscribeStarSpawns,
  dropStar,
  hostCancelStarClaims,
  hostReleaseTurf,
  hostUnclearSpot,
  savedHostGame,
  getGameByCode,
  saveHostGame,
  sendMessage,
  listMessages,
  subscribeMessages,
  listAmbushes,
  subscribeAmbushes,
  proposeAmbush,
  respondAmbush,
  cancelAmbush,
  springAmbush,
  resolveAmbush,
  cfg,
  listTerritory,
  subscribeTerritory,
  claimTerritory,
  stealTerritory,
  reinforceCorner,
  grantReinforcement,
  listRaidLocks,
  subscribeRaidLocks,
  setRaidLock,
  claimTerritoryTick,
  type RaidLockRow,
  type TerritoryRow,
  uploadTriviaPhoto,
  uploadPartyPhoto,
  startDuel,
  seenQuestionIds,
  acceptQuest,
  listQuests,
  subscribeQuests,
  closeQuest,
  getPosition,
  type QuestRow,
  type QuestKind,
  listDuels,
  subscribeDuels,
  resolveDuel,
  cancelDuel,
  startCamp,
  pingCamp,
  collectCamp,
  raidCamp,
  listCamps,
  subscribeCamps,
  campIncrement,
  type DuelRow,
  type CampRow,
  submitPhoto,
  listPhotos,
  subscribePhotos,
  vetoPhoto,
  unvetoPhoto,
  deletePhoto,
  type PhotoRow,
  listContent,
  subscribeContent,
  listLayouts,
  getLayout,
  createLayout,
  saveLayout,
  renameLayout,
  deleteLayout,
  subscribeLayouts,
  isNoTableError,
  type LayoutMeta,
  type Membership,
  type MessageRow,
  type AmbushRow,
  type GameRow,
  type TeamRow,
  type Position,
  type SpawnRow,
  type StarClaimRow,
  type StarSpawnRow,
  type EventRow,
  type GameConfig,
} from './net';
import {
  territoryIds,
  territoryAdjacency,
  territoryLinks,
  longestRun,
  computeRuns,
  computeRunPaths,
} from './territory';
import { navigate } from './Root';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'area', label: 'Area' },
  { key: 'frame', label: 'Frame' },
  { key: 'squares', label: 'Board' },
];
const phaseIndex = (p: Phase) => PHASES.findIndex((s) => s.key === p);

// --- Play-mode model -------------------------------------------------------
// 'quest' is a resolved outcome, not something you can author onto a square:
// it's what a plain space turns out to be when the pool rolls that way.
type SpotType = 'coin' | 'challenge' | 'chance' | 'bar' | 'bowser' | 'quest';
// Sim-speed timers: seconds here stand in for the real-world minutes (§ tunable).
const SPAWN_MIN_MS = 15000;
const SPAWN_MAX_MS = 25000;
const SPAWN_TTL_MS = 30000;
const CLAIM_MS = 12000;
const STAR_COST = 150;
// Online star claim — test-friendly (reachable cost, short meter). Bump for the party.
const ONLINE_STAR_COST = 40;
const ONLINE_METER_MS = 15000;
// Battle = app-as-toolbox: it picks the round type; teams play physically & report.
function pickRound() {
  return randomDuel().name;
}
/** Turf paint per team — assigned by join order (listTeams sorts by created_at),
 * so every phone derives the same colors without storing them. */
const TEAM_COLORS = ['#e0533a', '#2f7fe0', '#2fa05a', '#e6a817', '#9a5fe0', '#e05fa0', '#17b0b8', '#8a6d3b'];
function teamColorOf(teams: { id: string }[], teamId: string): string {
  const i = teams.findIndex((t) => t.id === teamId);
  return TEAM_COLORS[(i >= 0 ? i : 0) % TEAM_COLORS.length];
}
/** Encounter kinds shown in the POI editor (emoji + short label). */
const ENC_META: Record<string, { emoji: string; label: string }> = {
  'star-bar': { emoji: '⭐', label: 'Star bar' },
  h2h: { emoji: '⚔️', label: 'Head-to-head' },
  challenge: { emoji: '🎯', label: 'Challenge' },
  boss: { emoji: '🔥', label: 'Boss' },
  landmark: { emoji: '📍', label: 'Landmark' },
};
/** Deterministic 0..1 from a string id — stable spot typing, no persistence. */
function strHash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
/** The board's spots: road intersections (3+ roads) + any explicitly-typed square. */
// Placed on purpose and allowed to sit mid-block: landmarks are real
// buildings, and start/finish/Bowser are authored one-offs. Everything else
// - the generated coin/chance/challenge spaces - has to be at a junction.
const OFF_JUNCTION_OK = new Set(['poi', 'bar', 'start', 'finish', 'bowser']);
function deriveSpots(board: Board): Square[] {
  const deg = new Map<string, number>();
  for (const e of board.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  // A space is a CROSSING — three or more street ends meeting. A degree-2
  // node is just a vertex partway along one street (a bend, or a point the
  // tracer dropped), and putting a space there floats it mid-block.
  return board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || OFF_JUNCTION_OK.has(s.type));
}
/** Explicit type wins; blank intersections get a deterministic coin/chance mix. */
function deriveNodeType(spots: Square[], chanceShare = 25, questShare = 20): Record<string, SpotType> {
  const SPOT: string[] = ['coin', 'challenge', 'chance', 'bar', 'bowser'];
  const m: Record<string, SpotType> = {};
  // One pool, one roll. A plain space is coins, a card, or a job — the quest
  // isn't a separate lottery layered on top of the other two any more.
  // Hashed from the id, so a space always answers the same way and backing out
  // to re-roll gets you nowhere.
  for (const sq of spots) {
    if (SPOT.includes(sq.type)) {
      m[sq.id] = sq.type as SpotType;
      continue;
    }
    const r = strHash01(sq.id) * 100;
    m[sq.id] = r < questShare ? 'quest' : r < questShare + chanceShare ? 'chance' : 'coin';
  }
  return m;
}
/** A spot's hand-chosen questions: one-off custom ones win, else its picked
 * bank questions (id references, resolved against the given bank). */
function resolvePinnedQuestions(sq: Square | undefined, bank: TriviaQuestion[]): TriviaQuestion[] {
  if (!sq) return [];
  if (sq.questions?.length) return sq.questions;
  if (sq.questionIds?.length) {
    const by = new Map(bank.filter((q) => q.id).map((q) => [q.id as string, q]));
    return sq.questionIds.map((id) => by.get(id)).filter((q): q is TriviaQuestion => !!q);
  }
  return [];
}
/** Questions a challenge spot deals. Pinned/picked questions win; otherwise the
 * spot gets its deterministic share of the unclaimed shared bank — seeded by
 * game id, so every phone deals the same questions at the same spot and spots
 * don't repeat a question until the bank runs out. */
function questionsForSpot(board: Board, seed: string, spotId: string): TriviaQuestion[] {
  const bank = board.triviaBank ?? [];
  const sq = board.squares.find((s) => s.id === spotId);
  const pinned = resolvePinnedQuestions(sq, bank);
  if (pinned.length) return pinned;
  // Questions hand-picked onto ANY spot leave the general shuffle.
  const taken = new Set(board.squares.flatMap((s) => s.questionIds ?? []));
  const pool = bank.filter((q) => !q.id || !taken.has(q.id));
  if (!pool.length) return [];
  const spotIds = board.squares
    .filter((s) => s.type === 'challenge' && !resolvePinnedQuestions(s, bank).length)
    .map((s) => s.id)
    .sort();
  const idx = Math.max(0, spotIds.indexOf(spotId));
  const order = pool
    .map((q, i) => ({ q, k: strHash01(`${seed}:${i}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.q);
  const per = Math.max(1, Math.min(4, Math.floor(pool.length / Math.max(1, spotIds.length)) || 1));
  const out: TriviaQuestion[] = [];
  for (let k = 0; k < Math.min(per, pool.length); k++) out.push(order[(idx * per + k) % pool.length]);
  return out;
}
/** Fallback chance deck for games published before decks existed — mirrors the
 * old hardcoded roll weights (35% rob / 20% claim / 23% gain / 15% lose / 7% dud). */
const DEFAULT_CHANCE_DECK: ChanceCard[] = [
  { id: 'd-rob1', text: '🦹 Stick-em-up! Rob a rival team.', effect: 'rob', amount: 0 },
  { id: 'd-rob2', text: '🦹 Pickpocket! Rob a rival team.', effect: 'rob', amount: 0 },
  { id: 'd-rob3', text: '🦹 Heist time! Rob a rival team.', effect: 'rob', amount: 0 },
  { id: 'd-rob4', text: '🦹 Smash and grab! Rob a rival team.', effect: 'rob', amount: 0 },
  { id: 'd-rob5', text: '🦹 The perfect crime! Rob a rival team.', effect: 'rob', amount: 0 },
  { id: 'd-claim1', text: '🎺 A brass band follows you down Brady. Tips!', effect: 'gain', amount: 20 },
  { id: 'd-claim2', text: '🌭 You win a hot dog eating contest nobody entered.', effect: 'gain', amount: 25 },
  { id: 'd-claim3', text: '🎩 You find a twenty in a coat you swear is yours.', effect: 'gain', amount: 20 },
  { id: 'd-gain1', text: '🍀 Found coins on the sidewalk!', effect: 'gain', amount: 20 },
  { id: 'd-gain2', text: '🍀 Bar dice champion!', effect: 'gain', amount: 30 },
  { id: 'd-gain3', text: '🎰 Jackpot!', effect: 'gain', amount: 40 },
  { id: 'd-lose1', text: '💸 You bought a round for strangers.', effect: 'lose', amount: 15 },
  { id: 'd-lose2', text: '💸 Parking ticket!', effect: 'lose', amount: 25 },
  { id: 'd-none1', text: '😐 The wind blows. Nothing happens.', effect: 'nothing', amount: 0 },
];
/** Draw one card from the game's chance deck (rob cards need a robbable rival).
 * A spot with hand-picked cardIds draws only those (falls back to the full deck
 * if none of them survive the filters). */
function drawChanceCard(board: Board, canRob: boolean, cardIds?: string[]): ChanceCard {
  const full = (board.chanceDeck?.length ? board.chanceDeck : DEFAULT_CHANCE_DECK).filter(
    (c) => canRob || c.effect !== 'rob',
  );
  const limited = cardIds?.length ? full.filter((c) => cardIds.includes(c.id)) : full;
  const deck = limited.length ? limited : full;
  if (!deck.length) return { id: 'none', text: '😐 Nothing happens.', effect: 'nothing', amount: 0 };
  return deck[Math.floor(Math.random() * deck.length)];
}

export default function App({
  variant = 'admin',
  initialCode,
  classicMap = false,
}: {
  variant?: 'admin' | 'player';
  initialCode?: string;
  /** Old Leaflet player view (?classic=1) — kept as a same-day escape hatch. */
  classicMap?: boolean;
}) {
  const [board, setBoard] = useState<Board>(() => loadBoard());
  const [mode, setMode] = useState<Mode>('select');
  // A plain space: the only thing the palette places by default now that a
  // space no longer advertises what it does.
  const [addType, setAddType] = useState<SquareType>('blank');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null); // first space picked in Connect mode
  const [connecting, setConnecting] = useState(false);
  const [connectStraight, setConnectStraight] = useState(false); // join ends directly, ignoring the road network
  const [snapping, setSnapping] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sceneryLoading, setSceneryLoading] = useState(false);
  const [undoBoundary, setUndoBoundary] = useState<LatLng[] | null>(null);
  const [recage, setRecage] = useState(0);
  const [photoUploading, setPhotoUploading] = useState<number | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // --- Cloud layouts (shared, named boards saved to Supabase) ----------------
  type CloudStatus = 'offline' | 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'needs-setup';
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [currentLayoutId, setCurrentLayoutId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(isConfigured ? 'idle' : 'offline');
  const [remoteNewer, setRemoteNewer] = useState(false);
  const [dirty, setDirty] = useState(false); // edits made since the last save
  const currentLayoutIdRef = useRef<string | null>(null);
  const lastSavedAtRef = useRef<string | null>(null); // timestamp of our last write/load (echo suppression)
  const skipSaveRef = useRef(false); // set true right before a programmatic setBoard so it doesn't re-save
  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingSaveRef = useRef<{ id: string; board: Board } | null>(null);
  const CURRENT_KEY = 'mke-current-layout-v1';

  const phase = board.phase;
  const bumpCage = () => setRecage((n) => n + 1);

  // --- Shared content (trivia bank + chance deck) for the spot editor -------
  // Admin-only: lets the Edit-space panel pick specific bank questions/cards.
  const [bankRows, setBankRows] = useState<TriviaQuestion[]>([]);
  const [deckRows, setDeckRows] = useState<ChanceCard[]>([]);
  useEffect(() => {
    if (variant !== 'admin' || !isConfigured) return;
    let alive = true;
    const load = () => {
      Promise.all([listContent<TriviaQuestion>('trivia'), listContent<ChanceCard>('chance')])
        .then(([t, c]) => {
          if (!alive) return;
          setBankRows(t.map((r) => ({ ...r.data, id: r.id })));
          setDeckRows(c.map((r) => ({ ...r.data, id: r.id })));
        })
        .catch(() => {}); // content table not set up yet → pickers just hide
    };
    load();
    const unsub = subscribeContent(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [variant]);

  useEffect(() => {
    saveBoard(board);
  }, [board]);

  useEffect(() => {
    currentLayoutIdRef.current = currentLayoutId;
  }, [currentLayoutId]);

  // Backfill fields on a board loaded from the cloud (same as importJson).
  function hydrateBoard(b: Board): Board {
    if (!b.phase) b.phase = 'area';
    if (typeof b.padding !== 'number') b.padding = 0.04;
    if (!Array.isArray(b.edges)) b.edges = [];
    if (typeof b.enforceDirection !== 'boolean') b.enforceDirection = false;
    if (typeof b.locked !== 'boolean') b.locked = false;
    return b;
  }

  // Write any pending edit to its layout NOW (used before switching layouts).
  async function flushSave(): Promise<void> {
    const p = pendingSaveRef.current;
    window.clearTimeout(saveTimerRef.current);
    if (!p) return;
    pendingSaveRef.current = null;
    try {
      const at = await saveLayout(p.id, p.board);
      lastSavedAtRef.current = at;
      if (currentLayoutIdRef.current === p.id) setCloudStatus('saved');
    } catch {
      setCloudStatus('error');
    }
  }

  // MANUAL SAVE: an edit only marks the board dirty. Nothing reaches the cloud
  // until you press Save, so the saved layout stays a safe point to revert to.
  useEffect(() => {
    if (!isConfigured || !currentLayoutId) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      setDirty(false);
      return;
    }
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, currentLayoutId]);

  /** Write the working board to its layout (the only path to the cloud). */
  async function saveNow() {
    if (!currentLayoutId) return;
    setCloudStatus('saving');
    try {
      lastSavedAtRef.current = await saveLayout(currentLayoutId, board);
      setDirty(false);
      setCloudStatus('saved');
    } catch {
      setCloudStatus('error');
    }
  }

  /** Throw away everything since the last save and reload that saved board. */
  async function revertToSaved() {
    if (!currentLayoutId) return;
    if (!confirm('Discard every change since your last save and reload the saved board?')) return;
    await openLayout(currentLayoutId, true);
    setDirty(false);
  }

  // Load a layout into the working board. discardLocal=true skips flushing local
  // edits first (used by "Load latest" to take the remote version).
  async function openLayout(id: string, discardLocal = false) {
    if (discardLocal) {
      pendingSaveRef.current = null;
      window.clearTimeout(saveTimerRef.current);
    } else if (dirty && !confirm('You have unsaved changes. Open this layout and lose them?')) {
      return;
    }
    setCloudStatus('loading');
    try {
      const res = await getLayout(id);
      skipSaveRef.current = true;
      lastSavedAtRef.current = res.updated_at;
      setCurrentLayoutId(id);
      currentLayoutIdRef.current = id;
      localStorage.setItem(CURRENT_KEY, id);
      setBoard(hydrateBoard(res.board));
      setSelectedId(null);
      setSelectedVertex(null);
      setSelectedEdgeId(null);
      setMode('select');
      setRemoteNewer(false);
      bumpCage();
      setCloudStatus('saved');
    } catch (e) {
      setCloudStatus('error');
      throw e;
    }
  }

  // Initial load + realtime subscription (once).
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listLayouts();
        if (cancelled) return;
        setLayouts(list);
        const saved = localStorage.getItem(CURRENT_KEY);
        const toOpen = saved && list.some((l) => l.id === saved) ? saved : list[0]?.id ?? null;
        if (toOpen) await openLayout(toOpen);
        else setCloudStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setCloudStatus(isNoTableError(e) ? 'needs-setup' : 'error');
      }
    })();
    const unsub = subscribeLayouts((c) => {
      listLayouts().then(setLayouts).catch(() => {});
      const row = c.new;
      if (
        c.eventType !== 'DELETE' &&
        row &&
        row.id === currentLayoutIdRef.current &&
        row.updated_by &&
        row.updated_by !== deviceId() &&
        row.updated_at !== lastSavedAtRef.current
      ) {
        setRemoteNewer(true);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the working board as a new layout (the safe default), or start a
  // blank one — which REPLACES the board on screen, so it confirms first.
  async function newLayout(fromCurrent: boolean) {
    if (
      !fromCurrent &&
      !confirm(
        'Start a blank layout? The board on screen will be replaced by an empty one — anything not already saved to a layout or exported to a file will be lost.',
      )
    ) {
      return;
    }
    const suggested = fromCurrent
      ? currentLayoutId
        ? `${layouts.find((l) => l.id === currentLayoutId)?.name ?? 'Layout'} copy`
        : 'Party board'
      : `Version ${String.fromCharCode(65 + layouts.length)}`;
    const name = prompt(
      fromCurrent ? 'Save the board on screen as a layout named:' : 'Name this new blank layout',
      suggested,
    );
    if (!name?.trim()) return;
    await flushSave();
    setCloudStatus('saving');
    try {
      const meta = await createLayout(name.trim(), fromCurrent ? board : hydrateBoard(defaultBoard()));
      skipSaveRef.current = true;
      lastSavedAtRef.current = meta.updated_at;
      setCurrentLayoutId(meta.id);
      currentLayoutIdRef.current = meta.id;
      localStorage.setItem(CURRENT_KEY, meta.id);
      if (!fromCurrent) {
        setBoard(hydrateBoard(defaultBoard()));
        setSelectedId(null);
        setSelectedVertex(null);
        setSelectedEdgeId(null);
        setMode('select');
        bumpCage();
      }
      setLayouts(await listLayouts());
      setCloudStatus('saved');
    } catch {
      setCloudStatus('error');
    }
  }

  async function renameCurrentLayout() {
    if (!currentLayoutId) return;
    const cur = layouts.find((l) => l.id === currentLayoutId);
    const name = prompt('Rename layout', cur?.name ?? '');
    if (!name?.trim()) return;
    try {
      await renameLayout(currentLayoutId, name.trim());
      setLayouts(await listLayouts());
    } catch {
      setCloudStatus('error');
    }
  }

  async function deleteCurrentLayout() {
    if (!currentLayoutId) return;
    const cur = layouts.find((l) => l.id === currentLayoutId);
    if (!confirm(`Delete "${cur?.name ?? 'this layout'}" for everyone? This can't be undone.`)) return;
    const id = currentLayoutId;
    pendingSaveRef.current = null;
    window.clearTimeout(saveTimerRef.current);
    try {
      await deleteLayout(id);
      const remaining = (await listLayouts()).filter((l) => l.id !== id);
      setLayouts(remaining);
      if (remaining.length) await openLayout(remaining[0].id, true);
      else {
        setCurrentLayoutId(null);
        currentLayoutIdRef.current = null;
        localStorage.removeItem(CURRENT_KEY);
        setCloudStatus('idle');
      }
    } catch {
      setCloudStatus('error');
    }
  }

  const selected = useMemo(
    () => board.squares.find((s) => s.id === selectedId) ?? null,
    [board.squares, selectedId],
  );
  const selectedEdge = useMemo(
    () => board.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [board.edges, selectedEdgeId],
  );

  const counts = useMemo(() => {
    const c: Partial<Record<SquareType, number>> = {};
    for (const s of board.squares) c[s.type] = (c[s.type] ?? 0) + 1;
    return c;
  }, [board.squares]);

  // --- Play mode (desktop sim) ----------------------------------------------
  const [appMode, setAppMode] = useState<'design' | 'play' | 'online'>('design');
  // On mobile the side panel and map stack; this collapses the panel so the map
  // can go full-screen for drawing the area / placing spaces. Ignored on desktop.
  const [panelOpen, setPanelOpen] = useState(variant !== 'player');
  const [play, setPlay] = useState<{
    coins: number;
    stars: number;
    items: number;
    cleared: string[];
    starBars: string[];
    last: string | null;
  }>({ coins: 0, stars: 0, items: 0, cleared: [], starBars: [], last: null });
  const [spawns, setSpawns] = useState<{ id: string; lat: number; lng: number; reward: number; expires: number }[]>([]);
  const [claim, setClaim] = useState<{ barId: string; name: string; ends: number } | null>(null);
  const [claimLeft, setClaimLeft] = useState(0);
  const [modal, setModal] = useState<{ id: string; name: string; type: SpotType } | null>(null);
  const [rollResult, setRollResult] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [dieFace, setDieFace] = useState(1);
  // Play-mode quiz: which choice the player picked per question, + submitted flag.
  const [quizPick, setQuizPick] = useState<Record<number, number>>({});
  const [quizDone, setQuizDone] = useState(false);
  const [burst, setBurst] = useState<{ text: string; key: number } | null>(null);
  const burstKey = useRef(0);
  function flash(text: string) {
    burstKey.current += 1;
    setBurst({ text, key: burstKey.current });
  }
  function closeModal() {
    setModal(null);
    setRollResult(null);
    setRolling(false);
    setQuizPick({});
    setQuizDone(false);
    setBowserLoss(null);
  }
  function rollChance(id: string) {
    if (rolling) return;
    setRolling(true);
    const iv = window.setInterval(() => setDieFace(1 + Math.floor(Math.random() * 6)), 80);
    window.setTimeout(() => {
      window.clearInterval(iv);
      setRolling(false);
      resolveChance(id);
    }, 850);
  }

  const spots = useMemo(() => deriveSpots(board), [board.edges, board.squares]);
  // Offline practice has no quests — there's nobody to hunt and no clock.
  const nodeType = useMemo(() => deriveNodeType(spots, 25, 0), [spots]);

  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const claimRef = useRef(claim);
  claimRef.current = claim;
  const nextSpawn = useRef(0);

  // One tick loop drives dynamic spawns + star-claim completion while playing.
  useEffect(() => {
    if (appMode !== 'play') return;
    nextSpawn.current = Date.now() + SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS);
    const iv = setInterval(() => {
      const now = Date.now();
      const c = claimRef.current;
      if (c && now >= c.ends) {
        setClaim(null);
        setClaimLeft(0);
        setPlay((p) => ({ ...p, stars: p.stars + 1, starBars: [...p.starBars, c.barId], last: `⭐ Star claimed at ${c.name}!` }));
        flash('⭐ Star!');
      } else if (c) {
        setClaimLeft(Math.max(0, Math.ceil((c.ends - now) / 1000)));
      }
      setSpawns((s) => {
        const f = s.filter((x) => now < x.expires);
        return f.length === s.length ? s : f;
      });
      if (now >= nextSpawn.current && spotsRef.current.length) {
        const arr = spotsRef.current;
        const sq = arr[Math.floor(Math.random() * arr.length)];
        setSpawns((s) =>
          s.length >= 2
            ? s
            : [...s, { id: 'sp' + now, lat: sq.lat, lng: sq.lng, reward: 35 + Math.floor(Math.random() * 26), expires: now + SPAWN_TTL_MS }],
        );
        nextSpawn.current = now + SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS);
      }
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  const spotNotes = (id: string) => board.squares.find((s) => s.id === id)?.notes || '';

  function checkIn(id: string) {
    if (play.cleared.includes(id) || play.starBars.includes(id)) return;
    if (claim && claim.barId === id) return;
    const name = board.squares.find((s) => s.id === id)?.title || 'Spot';
    const type = nodeType[id] ?? 'coin';
    if (type === 'coin') {
      const reward = 8 + Math.floor(Math.random() * 13);
      setPlay((p) => ({ ...p, coins: p.coins + reward, cleared: [...p.cleared, id], last: `+${reward} 🪙 at ${name}` }));
      flash(`+${reward} 🪙`);
    } else {
      setModal({ id, name, type });
    }
  }
  function resolveChallenge(id: string, good: boolean) {
    const reward = good ? 30 + Math.floor(Math.random() * 21) : 12;
    setPlay((p) => ({ ...p, coins: p.coins + reward, cleared: [...p.cleared, id], last: `+${reward} 🪙 · challenge` }));
    flash(`+${reward} 🪙`);
    closeModal();
  }
  // Auto-scored multiple-choice: award the square's reward scaled by % correct.
  function resolveQuiz(sq: Square) {
    const qs = sq.questions ?? [];
    const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
    const base = sq.reward > 0 ? sq.reward : 20;
    const award = qs.length ? Math.round((base * correct) / qs.length) : base;
    setPlay((p) => ({
      ...p,
      coins: p.coins + award,
      cleared: [...p.cleared, sq.id],
      last: `+${award} 🪙 · ${correct}/${qs.length} correct`,
    }));
    if (award) flash(`+${award} 🪙`);
    setQuizDone(true);
  }
  // Play-sim Bowser: lose coins by performance (trivia %wrong, or a physical tier).
  function resolveBowserPlay(sq: Square, tier?: 'nailed' | 'struggled' | 'failed') {
    const qs = sq.questions ?? [];
    const penalty = sq.reward > 0 ? sq.reward : 30;
    let loss: number;
    if (qs.length > 0 && !tier) {
      const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
      loss = Math.round((penalty * (qs.length - correct)) / qs.length);
    } else {
      loss = tier === 'nailed' ? 0 : tier === 'struggled' ? Math.round(penalty / 2) : penalty;
    }
    setPlay((p) => ({ ...p, coins: Math.max(0, p.coins - loss), cleared: [...p.cleared, sq.id], last: `👹 Bowser: -${loss} 🪙` }));
    setBowserLoss(loss);
    setQuizDone(true);
  }
  function resolveChance(id: string) {
    const r = Math.random();
    let dc = 0;
    let di = 0;
    let text = '';
    if (r < 0.4) {
      dc = 25 + Math.floor(Math.random() * 26);
      text = `🍀 Lucky! +${dc} 🪙`;
    } else if (r < 0.62) {
      di = 1;
      text = '🎒 Found an item!';
    } else if (r < 0.82) {
      text = '😐 Nothing here…';
    } else {
      dc = -(10 + Math.floor(Math.random() * 16));
      text = `💸 Mugged! ${dc} 🪙`;
    }
    setPlay((p) => ({ ...p, coins: Math.max(0, p.coins + dc), items: p.items + di, cleared: [...p.cleared, id], last: text }));
    setRollResult(text); // keep the modal open to reveal the outcome
  }
  function buyRound(id: string, name: string) {
    if (play.coins < STAR_COST) {
      setPlay((p) => ({ ...p, last: 'Not enough 🪙 to buy a round' }));
      return;
    }
    if (claim) {
      setPlay((p) => ({ ...p, last: 'Already claiming a star' }));
      return;
    }
    setPlay((p) => ({ ...p, coins: p.coins - STAR_COST, last: `Buying a round at ${name}…` }));
    setClaim({ barId: id, name, ends: Date.now() + CLAIM_MS });
    setClaimLeft(Math.round(CLAIM_MS / 1000));
    closeModal();
  }
  function claimSpawn(id: string) {
    const sp = spawns.find((x) => x.id === id);
    if (!sp) return;
    setSpawns((s) => s.filter((x) => x.id !== id));
    setPlay((p) => ({ ...p, coins: p.coins + sp.reward, last: `Grabbed a drop! +${sp.reward} 🪙` }));
    flash(`+${sp.reward} 🪙`);
  }
  function resetPlay() {
    setPlay({ coins: 0, stars: 0, items: 0, cleared: [], starBars: [], last: null });
    setSpawns([]);
    setClaim(null);
    setClaimLeft(0);
  }

  // --- Multiplayer (Supabase — slice 1: publish + join + live lobby) ----------
  const [membership, setMembership] = useState<Membership | null>(() => savedMembership());
  const [hostGame, setHostGame] = useState<GameRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // The link players open (pre-fills the join code); the host shows it as a QR.
  const joinUrl = hostGame ? `${window.location.origin}/#/play?code=${hostGame.code}` : '';
  useEffect(() => {
    if (!joinUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(joinUrl, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [joinUrl]);
  const [hostConfig, setHostConfig] = useState<GameConfig>(PARTY_CONFIG);
  const [hostStatus, setHostStatus] = useState<'lobby' | 'live' | 'paused' | 'ended'>('lobby');
  const [teams, setTeams] = useState<TeamRow[]>([]);
  // Live console state: per-team fix-it panel.
  const [fixTeamId, setFixTeamId] = useState<string | null>(null);
  const [fixClaims, setFixClaims] = useState<string[]>([]);
  const [fixSpot, setFixSpot] = useState('');

  // Resume a hosted game after a refresh (phone locks, tab reloads mid-party).
  useEffect(() => {
    if (variant !== 'admin') return;
    const saved = savedHostGame();
    if (!saved) return;
    getGameFull(saved.id)
      .then((g) => {
        setHostGame({ id: g.id, code: g.code, name: g.name, status: g.status });
        setHostStatus(g.status as 'lobby' | 'live' | 'paused' | 'ended');
        if (g.config) setHostConfig(g.config);
      })
      .catch(() => saveHostGame(null)); // game gone → forget it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // Host live feed: status/config + activity while the dashboard is open.
  useEffect(() => {
    if (variant !== 'admin' || appMode !== 'design' || !hostGame) return;
    let alive = true;
    const gid = hostGame.id;
    const loadEv = () => listEvents(gid).then((e) => alive && setEvents(e)).catch(() => {});
    const loadGame = () =>
      getGameFull(gid)
        .then((g) => {
          if (!alive) return;
          setHostStatus(g.status as 'lobby' | 'live' | 'paused' | 'ended');
        })
        .catch(() => {});
    const loadMsgs = () => listMessages(gid).then((m) => alive && setMessages(m)).catch(() => {});
    const loadPhotos = () => listPhotos(gid).then((p) => alive && setPhotos(p)).catch(() => {});
    loadEv();
    loadGame();
    loadMsgs();
    loadPhotos();
    const u1 = subscribeEvents(gid, loadEv);
    const u2 = subscribeGame(gid, loadGame);
    const u3 = subscribeMessages(gid, loadMsgs);
    const uPh = subscribePhotos(gid, loadPhotos);
    return () => {
      alive = false;
      u1();
      u2();
      u3();
      uPh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, appMode, hostGame?.id]);
  const [joinCode, setJoinCode] = useState((initialCode ?? '').toUpperCase());
  const [joinName, setJoinName] = useState('');
  const [joinEmoji, setJoinEmoji] = useState('🎲');
  const [netBusy, setNetBusy] = useState(false);

  const activeGameId = hostGame?.id ?? membership?.gameId ?? null;
  useEffect(() => {
    if (!activeGameId) {
      setTeams([]);
      return;
    }
    let alive = true;
    const load = () =>
      listTeams(activeGameId)
        .then((t) => alive && setTeams(t))
        .catch(() => {});
    load();
    const unsub = subscribeTeams(activeGameId, load);
    return () => {
      alive = false;
      unsub();
    };
  }, [activeGameId]);

  /**
   * Take over hosting from another device. The dashboard lives in whichever
   * browser published, which is fine right up until you publish from a laptop
   * and then spend the afternoon holding a phone. A code is enough — the admin
   * password already got you into this screen.
   */
  const [takeoverCode, setTakeoverCode] = useState('');
  async function doTakeOverHosting() {
    const code = takeoverCode.trim().toUpperCase();
    if (!code) return;
    setNetBusy(true);
    try {
      const g = await getGameByCode(code);
      if (!g) {
        alert('No game with that code.');
        return;
      }
      setHostGame(g);
      saveHostGame(g);
      setHostStatus(g.status as "lobby" | "live" | "paused" | "ended");
      setTakeoverCode('');
    } catch (e) {
      alert('Could not pick it up: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }

  async function doPublish() {

    setNetBusy(true);
    try {
      const g = await publishGame(board.name || 'Birthday Game', board, hostConfig);
      setHostGame(g);
      saveHostGame(g); // dashboard survives a refresh
      setHostStatus('lobby');
    } catch (e) {
      alert('Publish failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  async function doPause() {
    if (!hostGame) return;
    setNetBusy(true);
    try {
      await updateGameStatus(hostGame.id, 'paused');
      await logEvent(hostGame.id, 'announce', '⏸ The host paused the game — hold tight!');
      setHostStatus('paused');
    } catch (e) {
      alert('Pause failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  async function doResume() {
    if (!hostGame) return;
    setNetBusy(true);
    try {
      await updateGameStatus(hostGame.id, 'live');
      await logEvent(hostGame.id, 'announce', '▶ Game back on — go!');
      setHostStatus('live');
    } catch (e) {
      alert('Resume failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  /** Host-forced star drop: lands at the next rotation-eligible bar. */
  async function doDropStar() {
    if (!hostGame) return;
    const pool = board.squares.filter((s) => s.type === 'bar').sort((a, b) => a.id.localeCompare(b.id));
    if (!pool.length) {
      alert('The board has no bar spots to land a star on.');
      return;
    }
    const target = pool.find((sq) => (starAvailable[sq.id] ?? 0) <= 0 && !starClaimRows.some((c) => c.bar_spot_id === sq.id && c.status === 'claiming')) ?? null;
    if (!target) {
      alert('Every bar already has a star waiting or a claim running.');
      return;
    }
    setNetBusy(true);
    try {
      await dropStar(hostGame.id, target.id, null);
      await logEvent(hostGame.id, 'star', `⭐ A star just landed at ${target.title || 'a bar'} — first team to buy a round claims it!`);
    } catch (e) {
      alert('Star drop failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  async function doDropSpawn() {
    if (!hostGame) return;
    setNetBusy(true);
    try {
      await dropSpawnNow(hostGame.id, board, hostConfig.spawnTtlSec);
      await logEvent(hostGame.id, 'spawn', '🎁 A surprise drop just appeared!');
    } catch (e) {
      alert('Drop failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  async function doApplyConfig() {
    if (!hostGame) return;
    setNetBusy(true);
    try {
      await updateGameConfig(hostGame.id, hostConfig);
      await logEvent(hostGame.id, 'announce', '⚙️ The host tweaked the game settings.');
    } catch (e) {
      alert('Apply failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  // Per-team fix-it actions (wrench menu).
  async function fixCoins(teamId: string, delta: number) {
    try {
      await adjustCoins(teamId, delta);
    } catch (e) {
      alert('Adjust failed: ' + (e as Error).message);
    }
  }
  async function fixStars(teamId: string, delta: number) {
    try {
      await adjustStars(teamId, delta);
    } catch (e) {
      alert('Adjust failed: ' + (e as Error).message);
    }
  }
  async function openFix(teamId: string) {
    if (fixTeamId === teamId) {
      setFixTeamId(null);
      return;
    }
    setFixTeamId(teamId);
    setFixSpot('');
    if (hostGame) {
      myClaims(hostGame.id, teamId)
        .then(setFixClaims)
        .catch(() => setFixClaims([]));
    }
  }
  async function fixCancelClaim(teamId: string) {
    if (!hostGame) return;
    try {
      const n = await hostCancelStarClaims(hostGame.id, teamId);
      alert(n ? 'Star claim cancelled — the bar is free again.' : 'No active claim to cancel.');
    } catch (e) {
      alert('Cancel failed: ' + (e as Error).message);
    }
  }
  async function fixReleaseSpaces(teamId: string) {
    if (!hostGame) return;
    try {
      const n = await hostReleaseTurf(hostGame.id, teamId);
      alert(n ? `Released ${n} painted corner${n > 1 ? 's' : ''}.` : 'This team owns no turf.');
    } catch (e) {
      alert('Release failed: ' + (e as Error).message);
    }
  }
  async function fixUnclear(teamId: string) {
    if (!hostGame || !fixSpot) return;
    try {
      await hostUnclearSpot(hostGame.id, teamId, fixSpot);
      setFixClaims((c) => c.filter((s) => s !== fixSpot));
      setFixSpot('');
      alert('Spot un-cleared — they can do it again.');
    } catch (e) {
      alert('Un-clear failed: ' + (e as Error).message);
    }
  }
  async function doStart() {
    if (!hostGame) return;
    setNetBusy(true);
    try {
      await updateGameConfig(hostGame.id, hostConfig);
      await seedSpawns(hostGame.id, board, hostConfig.spawnCount, hostConfig.spawnMinSec, hostConfig.spawnMaxSec, hostConfig.spawnTtlSec);
      await updateGameStatus(hostGame.id, 'live');
      await logEvent(hostGame.id, 'star', '🎮 Game started — go!');
      setHostStatus('live');
    } catch (e) {
      alert('Start failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  async function doEnd() {
    if (!hostGame) return;
    if (!confirm('End the game for everyone?')) return;
    setNetBusy(true);
    try {
      await updateGameStatus(hostGame.id, 'ended');
      await logEvent(hostGame.id, 'star', '🏁 Game over!');
      setHostStatus('ended');
    } catch (e) {
      alert('End failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  const cfgField = (label: string, key: Exclude<keyof GameConfig, 'gpsRequired'>) => (
    <label
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '3px 0', fontSize: '0.82rem' }}
    >
      <span>{label}</span>
      <input
        type="number"
        value={hostConfig[key]}
        disabled={hostStatus === 'ended'}
        onChange={(e) => setHostConfig((c) => ({ ...c, [key]: Number(e.target.value) }))}
        style={{ width: 72, padding: '3px 6px', border: '1px solid #cfc7b5', borderRadius: 5 }}
      />
    </label>
  );
  // Placeholder team icons — tap one instead of typing an emoji on a phone.
  // Proper team icons are a later job; these just make teams tellable apart.
  const TEAM_ICONS = ['🎲', '🚀', '🦄', '🦖', '🌹', '🍕', '🎸', '🦈'];

  async function doJoin() {
    if (!joinCode.trim() || !joinName.trim()) {
      alert('Enter a game code and a team name.');
      return;
    }
    setNetBusy(true);
    try {
      setMembership(await joinGame(joinCode, joinName, joinEmoji));
    } catch (e) {
      alert('Join failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
    }
  }
  function leaveGame() {
    saveMembership(null);
    setMembership(null);
    setAppMode('design');
  }
  // On the public /play page, drop straight into the live game once joined.
  useEffect(() => {
    if (variant === 'player' && membership && appMode !== 'online') setAppMode('online');
  }, [variant, membership, appMode]);

  // --- Online play (slice 2: shared check-ins, coins, live board) ------------
  const [onlineBoard, setOnlineBoard] = useState<Board | null>(null);
  const [onlineConfig, setOnlineConfig] = useState<GameConfig>(PARTY_CONFIG);
  const [onlineStatus, setOnlineStatus] = useState<'lobby' | 'live' | 'paused' | 'ended'>('live');
  // Latest host announcement + which one the player has dismissed.
  const [dismissedAnnounceId, setDismissedAnnounceId] = useState<string | null>(null);
  const [onlineCleared, setOnlineCleared] = useState<string[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [allSpawns, setAllSpawns] = useState<SpawnRow[]>([]);
  const [starClaimRows, setStarClaimRows] = useState<StarClaimRow[]>([]);
  const [starSpawnRows, setStarSpawnRows] = useState<StarSpawnRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  /**
   * Last call, read back out of the feed rather than stored anywhere. The
   * referee's button logs one announcement and every phone already subscribes
   * to that feed, so there's no column to add and no migration to run on the
   * morning of the party — and it survives a refresh because the feed does.
   */
  const lastCallOpen = useMemo(
    () => events.some((e) => /LAST CALL/i.test(e.payload?.text ?? '')),
    [events],
  );
  // Messaging: shared row store + composer state for whichever surface is active.
  const [messages, setMessages] = useState<MessageRow[]>([]);
  // --- Messaging: three layers, keyed by channel ---------------------------
  //   'all'            the Party room (everyone posts; host posts also banner)
  //   'host:<teamId>'  that team's private line to the hosts
  //   'dm:<a>:<b>'     team ↔ team (ids sorted) — hidden from the host UI
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgThread, setMsgThread] = useState<string | null>(null); // null = thread list
  const [msgPick, setMsgPick] = useState(false); // "message a team" picker
  const [msgText, setMsgText] = useState('');
  // Per-thread read counts, persisted so badges survive a refresh.
  const [msgSeen, setMsgSeen] = useState<Record<string, number>>({});
  const msgSeenKey = `mke-msgseen-${membership?.gameId ?? savedHostGame()?.id ?? 'x'}`;
  useEffect(() => {
    try {
      setMsgSeen(JSON.parse(localStorage.getItem(msgSeenKey) || '{}'));
    } catch {
      setMsgSeen({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgSeenKey]);
  const markSeen = (ch: string, count: number) =>
    setMsgSeen((m) => {
      if ((m[ch] ?? 0) >= count) return m;
      const next = { ...m, [ch]: count };
      localStorage.setItem(msgSeenKey, JSON.stringify(next));
      return next;
    });

  /** Display name for a message party (null = the host). */
  const msgName = (id: string | null) =>
    id == null ? 'Host' : teams.find((t) => t.id === id)?.name ?? 'a team';
  const chanDm = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;
  /** A row's channel; legacy rows (pre-channels.sql) derive from from/to. */
  const channelOf = (m: MessageRow): string =>
    m.channel ??
    (m.from_team == null && m.to_team == null
      ? 'all'
      : m.from_team == null
        ? `host:${m.to_team}`
        : m.to_team == null
          ? `host:${m.from_team}`
          : chanDm(m.from_team, m.to_team));

  // This viewer's threads: Party + my host line always exist; DMs as they come.
  const myThreads = useMemo(() => {
    const tid = membership?.teamId;
    const map = new Map<string, MessageRow[]>();
    if (!tid) return map;
    map.set('all', []);
    map.set(`host:${tid}`, []);
    for (const m of messages) {
      const ch = channelOf(m);
      if (ch === 'all' || ch === `host:${tid}` || (ch.startsWith('dm:') && ch.includes(tid))) {
        map.set(ch, [...(map.get(ch) ?? []), m]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, membership, teams]);
  const threadUnread = (ch: string) => Math.max(0, (myThreads.get(ch)?.length ?? 0) - (msgSeen[ch] ?? 0));
  const msgUnread = [...myThreads.keys()].reduce((n, ch) => n + threadUnread(ch), 0);
  /** A thread's display name for the player. */
  const threadLabel = (ch: string) => {
    if (ch === 'all') return '📣 Party';
    if (ch.startsWith('host:')) return '🎩 Hosts';
    const other = ch.slice(3).split(':').find((x) => x !== membership?.teamId);
    const t = teams.find((x) => x.id === other);
    return `${t?.emoji ?? '🎲'} ${t?.name ?? 'a team'}`;
  };
  function openMsgPanel() {
    setMsgThread(null);
    setMsgPick(false);
    setMsgOpen(true);
  }
  // Reading a thread marks it seen (also as new messages arrive while open).
  useEffect(() => {
    if (!msgOpen || !msgThread) return;
    markSeen(msgThread, myThreads.get(msgThread)?.length ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgOpen, msgThread, messages]);

  async function sendTeamMsg() {
    if (!membership || !msgText.trim() || !msgThread) return;
    const tid = membership.teamId;
    const to = msgThread.startsWith('dm:') ? msgThread.slice(3).split(':').find((x) => x !== tid) ?? null : null;
    try {
      await sendMessage(membership.gameId, tid, to, msgText.trim(), msgThread);
      setMsgText('');
      markSeen(msgThread, (myThreads.get(msgThread)?.length ?? 0) + 1); // don't badge our own message
    } catch (e) {
      alert('Send failed: ' + (e as Error).message);
    }
  }

  // --- Host messaging: Party + one line per team (team↔team DMs stay private).
  const [hostThread, setHostThread] = useState<string | null>(null);
  const hostThreads = useMemo(() => {
    const map = new Map<string, MessageRow[]>();
    map.set('all', []);
    for (const t of teams) map.set(`host:${t.id}`, []);
    for (const m of messages) {
      const ch = channelOf(m);
      if (map.has(ch)) map.set(ch, [...(map.get(ch) ?? []), m]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, teams]);
  const hostThreadUnread = (ch: string) => Math.max(0, (hostThreads.get(ch)?.length ?? 0) - (msgSeen[ch] ?? 0));
  useEffect(() => {
    if (!hostThread) return;
    markSeen(hostThread, hostThreads.get(hostThread)?.length ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostThread, messages]);
  async function sendHostMsg() {
    if (!hostGame || !msgText.trim() || !hostThread) return;
    const text = msgText.trim();
    try {
      if (hostThread === 'all') {
        await sendMessage(hostGame.id, null, null, text, 'all');
        await logEvent(hostGame.id, 'announce', `📣 ${text}`);
      } else {
        await sendMessage(hostGame.id, null, hostThread.slice(5), text, hostThread);
      }
      setMsgText('');
      markSeen(hostThread, (hostThreads.get(hostThread)?.length ?? 0) + 1);
    } catch (e) {
      alert('Send failed: ' + (e as Error).message);
    }
  }
  // --- Party Cam: the shared album, and the drink check that pays -----------
  // Every picture anyone takes lands in one place, live, for everyone to see
  // (and to keep afterwards). A photo tagged with drinks is a claim and pays
  // the moment it's posted — submission alone is enough. A host or ref vetoes
  // a bogus one afterwards and the coins come straight back off.
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [duels, setDuels] = useState<DuelRow[]>([]);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [camOpen, setCamOpen] = useState(false);
  const [camTab, setCamTab] = useState<'gallery' | 'post'>('gallery');
  const [camFile, setCamFile] = useState<File | null>(null);
  const [camPreview, setCamPreview] = useState('');
  const [camCaption, setCamCaption] = useState('');
  const [camDrinks, setCamDrinks] = useState(0);
  const [camBusy, setCamBusy] = useState(false);
  const [camNote, setCamNote] = useState('');
  const [lightbox, setLightbox] = useState<PhotoRow | null>(null);
  const drinkCoins = cfg.drinkCoins(onlineConfig);
  /** Swap the staged photo, keeping the object URL from leaking. */
  function pickCamFile(f: File | null) {
    setCamPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : '';
    });
    setCamFile(f);
  }
  /** `drinks` seeds the stepper: tapping 🍻 Beers means you're claiming one. */
  function openCam(tab: 'gallery' | 'post', drinks = 0) {
    setCamTab(tab);
    setCamNote('');
    setCamDrinks(drinks);
    setCamOpen(true);
  }
  function closeCam() {
    setCamOpen(false);
    pickCamFile(null);
    setCamCaption('');
    setCamDrinks(0);
    setCamNote('');
  }
  async function postPhoto() {
    if (!membership || !camFile || camBusy) return;
    const me = teams.find((t) => t.id === membership.teamId);
    setCamBusy(true);
    setCamNote('Uploading…');
    try {
      const url = await uploadPartyPhoto(membership.gameId, camFile);
      const paid = await submitPhoto({
        gameId: membership.gameId,
        teamId: membership.teamId,
        teamName: me?.name ?? 'a team',
        teamEmoji: me?.emoji ?? '🎲',
        url,
        caption: camCaption.trim(),
        drinks: camDrinks,
        perDrink: drinkCoins,
      });
      // The feed is how the rest of the party finds out — fire and forget.
      logEvent(
        membership.gameId,
        'photo',
        paid > 0
          ? `🍻 ${me?.name ?? 'A team'} put away ${camDrinks} — +${paid} 🪙`
          : `📸 ${me?.name ?? 'A team'} posted a photo`,
      ).catch(() => {});
      pickCamFile(null);
      setCamCaption('');
      setCamDrinks(0);
      setCamTab('gallery');
      setCamNote(paid > 0 ? `🍻 Cheers — +${paid} coins!` : '📸 Posted!');
    } catch (e) {
      setCamNote('Failed: ' + (e as Error).message);
    } finally {
      setCamBusy(false);
    }
  }
  /** Host/ref controls, shared by the console and the lightbox. */
  async function doVetoPhoto(p: PhotoRow) {
    try {
      const ok = p.vetoed ? await unvetoPhoto(p) : await vetoPhoto(p);
      if (!ok) return; // someone else got there first
    } catch (e) {
      alert('Veto failed: ' + (e as Error).message);
    }
  }
  async function doDeletePhoto(p: PhotoRow) {
    if (!confirm('Delete this photo from the album?')) return;
    try {
      await deletePhoto(p.id);
      // Drop it locally too: the realtime DELETE gets us there anyway, but the
      // phone that tapped the button shouldn't wait on a round trip.
      setPhotos((rows) => rows.filter((r) => r.id !== p.id));
      setLightbox(null);
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }
  const [onlineBarModal, setOnlineBarModal] = useState<{ spotId: string; name: string } | null>(null);
  // The dealt questions ride in the modal state (pinned or drawn from the bank).
  const [onlineQuizModal, setOnlineQuizModal] = useState<{ spotId: string; name: string; questions: TriviaQuestion[] } | null>(null);
  // Online chance square: draw a card → gain/lose/rob/claim. 'rob' opens a team picker.
  const [onlineChanceModal, setOnlineChanceModal] = useState<{ spotId: string; name: string } | null>(null);
  const [chanceOutcome, setChanceOutcome] = useState<'rob' | 'claim' | 'gain' | 'lose' | 'nothing' | null>(null);
  const [chanceText, setChanceText] = useState('');
  const [chanceBusy, setChanceBusy] = useState(false);
  const [chanceDrawing, setChanceDrawing] = useState(false); // card-flip animation running
  const [chanceCardText, setChanceCardText] = useState(''); // drawn card's flavor text (rob/claim pickers)
  // Turf: painted corners (owner + 🧱 flag; runs pay coins per tick).
  const [territoryRows, setTerritoryRows] = useState<TerritoryRow[]>([]);
  const territoryMap = useMemo(
    () => Object.fromEntries(territoryRows.map((r) => [r.spot_id, r.team_id])),
    [territoryRows],
  );
  // 🧱 is retired — a corner is just a corner now, and one fewer rule to
  // explain while standing on a pavement. The column stays in the database so
  // older games still load; nothing reads it to make a decision any more.
  const reinforcedSet = useMemo(
    () => new Set<string>([]),
    [territoryRows],
  );
  // Failed-steal cooldowns (attacker→defender pairs, whole game — filtered to us).
  const [raidLocks, setRaidLocks] = useState<RaidLockRow[]>([]);
  // Steal play: 1 question normally; 2 (all right) vs a 🧱 or home-turf defense.
  // Failing a 🧱 corner also forfeits coins to the defender.
  const [stealModal, setStealModal] = useState<{
    spotId: string;
    name: string;
    defenderId: string;
    questions: TriviaQuestion[];
    reinforced: boolean;
    defenderNear: boolean;
  } | null>(null);
  const [stealPicks, setStealPicks] = useState<Record<number, number>>({});
  const [stealResult, setStealResult] = useState<'won' | 'lost' | 'gone' | null>(null);
  const [stealBusy, setStealBusy] = useState(false);
  /** Questions we've already been asked this game — refreshed after each play. */
  const [seenQs, setSeenQs] = useState<string[]>([]);
  const [stealForfeited, setStealForfeited] = useState(0); // coins lost on a failed 🧱 hit
  // Tapping a corner you own: reinforce it / set a trap.
  const [myCornerModal, setMyCornerModal] = useState<{ spotId: string; name: string } | null>(null);
  const [cornerBusy, setCornerBusy] = useState(false);
  // Game start time — the turf-income tick counter is anchored to it.
  const [onlineStartedAt, setOnlineStartedAt] = useState<string | null>(null);
  const tickTried = useRef<Set<number>>(new Set());
  // Ambushes: active rows + the arm/victim/showdown UI state.
  const [ambushes, setAmbushes] = useState<AmbushRow[]>([]);
  const [ambushArmModal, setAmbushArmModal] = useState<{ spotId: string; name: string } | null>(null);
  const [armAllyId, setArmAllyId] = useState('');
  const [ambushedName, setAmbushedName] = useState<string | null>(null); // spot name when WE just got trapped
  const [showdownOpen, setShowdownOpen] = useState(false);
  const spotAmbush = useMemo(() => {
    const m: Record<string, AmbushRow> = {};
    for (const a of ambushes) m[a.spot_id] = a;
    return m;
  }, [ambushes]);
  // A trap proposal waiting on MY yes/no (I'm the named ally).
  const allyProposal = useMemo(
    () => ambushes.find((a) => a.status === 'proposed' && a.ally === membership?.teamId) ?? null,
    [ambushes, membership],
  );
  // A sprung trap involving my team → showdown pending.
  const myShowdown = useMemo(
    () =>
      ambushes.find(
        (a) =>
          a.status === 'sprung' &&
          (a.initiator === membership?.teamId || a.ally === membership?.teamId || a.victim === membership?.teamId),
      ) ?? null,
    [ambushes, membership],
  );
  // Bowser: forced gauntlet (trivia or physical) → lose coins by performance.
  const [onlineBowserModal, setOnlineBowserModal] = useState<{ spotId: string; name: string } | null>(null);
  const [bowserLoss, setBowserLoss] = useState<number | null>(null);
  const [battleModal, setBattleModal] = useState<{
    claimId: string;
    barName: string;
    defenderName: string;
    round: string;
  } | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const lockTried = useRef<Set<string>>(new Set());

  // Timestamp-driven: a spawn is live once now is past spawn_at, before expires_at.
  const activeSpawns = useMemo(
    () =>
      allSpawns
        .filter((s) => !s.claimed_by && Date.parse(s.spawn_at) <= nowTs && nowTs < Date.parse(s.expires_at))
        .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
    [allSpawns, nowTs],
  );

  // Star-meter rings for bars under an active claim, painted in the claiming
  // team's turf color with a live countdown so the play reads from across the map.
  const onlineStarClaims = useMemo(
    () =>
      starClaimRows
        .filter((c) => c.status === 'claiming')
        .map((c) => {
          const total = onlineConfig.meterSec * 1000;
          const remaining = Date.parse(c.ends_at) - nowTs;
          return {
            barSpotId: c.bar_spot_id,
            pct: Math.min(1, Math.max(0, (total - remaining) / total)),
            mine: c.team_id === membership?.teamId,
            color: teamColorOf(teams, c.team_id),
            secs: Math.max(0, Math.ceil(remaining / 1000)),
          };
        }),
    [starClaimRows, nowTs, membership, onlineConfig, teams],
  );

  // A bar has a star AVAILABLE when more stars have landed there than claims
  // were ever started there (claiming or locked). Buy-a-round needs one.
  const starAvailable = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of starSpawnRows) m[s.bar_spot_id] = (m[s.bar_spot_id] ?? 0) + 1;
    for (const c of starClaimRows) if (c.status !== 'lost') m[c.bar_spot_id] = (m[c.bar_spot_id] ?? 0) - 1;
    return m;
  }, [starSpawnRows, starClaimRows]);
  // Auto star drops: every starIntervalSec one client wins the tick (guarded
  // insert) and lands a star at the next bar in rotation that isn't already
  // holding or resolving one. Unclaimed stars WAIT — no expiry.
  const starTickTried = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (appMode !== 'online' || !membership || !onlineBoard || onlineStatus !== 'live' || !onlineStartedAt) return;
    const ivMs = cfg.starIntervalSec(onlineConfig) * 1000;
    if (ivMs <= 0) return;
    const tickNo = Math.floor((nowTs - Date.parse(onlineStartedAt)) / ivMs);
    if (tickNo < 1 || starTickTried.current.has(tickNo)) return;
    starTickTried.current.add(tickNo);
    const pool = onlineBoard.squares.filter((s) => s.type === 'bar').sort((a, b) => a.id.localeCompare(b.id));
    if (!pool.length) return;
    // deterministic rotation start + skip bars already engaged, so every
    // client that could win the tick would land the star at the SAME bar
    let target: Square | null = null;
    for (let i = 0; i < pool.length; i++) {
      const sq = pool[(tickNo + i) % pool.length];
      const midClaim = starClaimRows.some((c) => c.bar_spot_id === sq.id && c.status === 'claiming');
      if ((starAvailable[sq.id] ?? 0) <= 0 && !midClaim) {
        target = sq;
        break;
      }
    }
    if (!target) return; // every bar is holding a star nobody claimed
    const barName = target.title || 'a bar';
    const gid = membership.gameId;
    const barId = target.id;
    void (async () => {
      try {
        const won = await dropStar(gid, barId, tickNo);
        if (won) await logEvent(gid, 'star', `⭐ A star just landed at ${barName} — first team to buy a round claims it!`);
      } catch {
        /* net hiccup — another client's attempt covers the tick */
      }
    })();
  }, [appMode, nowTs, membership, onlineBoard, onlineStatus, onlineStartedAt, onlineConfig, starAvailable]);

  const myTeam = useMemo(() => teams.find((t) => t.id === membership?.teamId) ?? null, [teams, membership]);
  const onlineNodeType = useMemo(
    () =>
      onlineBoard
        ? deriveNodeType(deriveSpots(onlineBoard), cfg.chanceShare(onlineConfig), cfg.questChance(onlineConfig))
        : {},
    [onlineBoard, onlineConfig],
  );
  // Turf graph: which corners are claimable + which are "consecutive" (runs can turn).
  const turfIds = useMemo(() => (onlineBoard ? territoryIds(onlineBoard) : new Set<string>()), [onlineBoard]);
  const turfAdj = useMemo(
    () => (onlineBoard ? territoryAdjacency(onlineBoard) : new Map<string, string[]>()),
    [onlineBoard],
  );
  const myRun = useMemo(() => {
    if (!membership) return 0;
    const mine = new Set(Object.entries(territoryMap).filter(([, t]) => t === membership.teamId).map(([s]) => s));
    return longestRun(mine, turfAdj);
  }, [territoryMap, turfAdj, membership]);
  // --- Player HUD: standings that rotate, a feed that ticks ----------------
  // ~8 teams will never fit across a phone, so the strip shows ONE team at a
  // time and cycles every 5s; tapping opens the whole board. The activity feed
  // works the same way — one line, tap for the log. Both live in the dead space
  // above the board, which the letterboxed map wasn't using anyway.
  // Every team's winning chain, kept as the PATH so the map can draw it and
  // the HUD can count it from the same answer.
  const runPaths = useMemo(() => computeRunPaths(territoryMap, turfAdj), [territoryMap, turfAdj]);
  const allRuns = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [team, path] of Object.entries(runPaths)) out[team] = path.length;
    return out;
  }, [runPaths]);
  const standings = useMemo(() => [...teams].sort((a, b) => b.stars - a.stars || b.coins - a.coins), [teams]);
  const [standOpen, setStandOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  /**
   * The feed answers "is there anything I should do about this?" — a camp
   * sitting on a pile of coins, a star landing, someone taking your corner,
   * a challenge in progress. Bookkeeping ('income', 'coin', 'photo') is real
   * and worth logging, but reading it off a ticker mid-walk tells you nothing
   * you can act on, and it buries the lines that do.
   */
  const FEED_TYPES = new Set(['announce', 'star', 'battle', 'camp', 'spawn']);
  // Rows logged before those types were split still say 'star', so the
  // bookkeeping ones are recognised by what they open with. New rows carry the
  // right type and never reach this.
  const LEDGER = /^(\u{1F517}|\u{1F340}|\u{1F4B8})/u; // 🔗 turf income · 🍀 lucky card · 💸 unlucky card
  const feed = useMemo(
    () => events.filter((e) => FEED_TYPES.has(e.type) && !LEDGER.test(String(e.payload?.text ?? ''))),
    [events],
  );
  const [rotIdx, setRotIdx] = useState(0);
  const [tickIdx, setTickIdx] = useState(0);
  // Hold still while someone's reading the expanded view.
  useEffect(() => {
    if (standOpen || standings.length < 2) return;
    const iv = setInterval(() => setRotIdx((i) => (i + 1) % standings.length), 5000);
    return () => clearInterval(iv);
  }, [standOpen, standings.length]);
  useEffect(() => {
    if (feedOpen || feed.length < 2) return;
    const iv = setInterval(() => setTickIdx((i) => (i + 1) % Math.min(feed.length, 8)), 4000);
    return () => clearInterval(iv);
  }, [feedOpen, feed.length]);
  // A new event jumps the line to the front — that's the whole point of a feed.
  useEffect(() => setTickIdx(0), [feed.length]);
  // Corner paint for the map: spot → team color (thicker ring for our own,
  // 🧱 badge when reinforced).
  const turfPaint = useMemo(() => {
    const out: Record<string, { color: string; mine: boolean; reinforced?: boolean }> = {};
    for (const r of territoryRows) {
      out[r.spot_id] = {
        color: teamColorOf(teams, r.team_id),
        mine: r.team_id === membership?.teamId,
        // Retired: old rows may still carry the flag, but no corner wears the
        // badge any more.
        reinforced: false,
      };
    }
    return out;
  }, [territoryRows, teams, membership]);
  /** The chain made physical: every street segment along a team's longest run,
   * so the board shows the snake instead of just a 🔗 number. A lone corner
   * isn't a chain, so runs of one draw nothing. */
  const turfLinks = useMemo(
    () => (onlineBoard ? territoryLinks(onlineBoard) : new Map<string, { to: string; edges: string[] }[]>()),
    [onlineBoard],
  );
  const runEdges = useMemo(() => {
    const out: Record<string, { color: string; mine: boolean }> = {};
    for (const [teamId, path] of Object.entries(runPaths)) {
      if (path.length < 2) continue;
      const style = { color: teamColorOf(teams, teamId), mine: teamId === membership?.teamId };
      for (let i = 1; i < path.length; i++) {
        const link = (turfLinks.get(path[i - 1]) ?? []).find((l) => l.to === path[i]);
        for (const id of link?.edges ?? []) out[id] = style;
      }
    }
    return out;
  }, [runPaths, turfLinks, teams, membership]);
  const tokens = useMemo(
    () =>
      positions.map((p) => {
        const t = teams.find((x) => x.id === p.team_id);
        return {
          teamId: p.team_id,
          lat: p.lat,
          lng: p.lng,
          emoji: t?.emoji ?? '📍',
          name: t?.name ?? '',
          me: p.team_id === membership?.teamId,
        };
      }),
    [positions, teams, membership],
  );

  useEffect(() => {
    if (appMode !== 'online' || !membership) return;
    let alive = true;
    const gid = membership.gameId;
    const tid = membership.teamId;
    getBoard(gid)
      .then((b) => alive && setOnlineBoard(b))
      .catch((e) => alert('Load failed: ' + (e as Error).message));
    const loadClaims = () => myClaims(gid, tid).then((c) => alive && setOnlineCleared(c)).catch(() => {});
    const loadPos = () => listPositions(gid).then((p) => alive && setPositions(p)).catch(() => {});
    const loadSpawns = () => listSpawns(gid).then((s) => alive && setAllSpawns(s)).catch(() => {});
    const loadStars = () => listStarClaims(gid).then((s) => alive && setStarClaimRows(s)).catch(() => {});
    const loadStarSpawns = () => listStarSpawns(gid).then((s) => alive && setStarSpawnRows(s)).catch(() => {});
    const loadEvents = () => listEvents(gid).then((e) => alive && setEvents(e)).catch(() => {});
    const loadMsgs = () => listMessages(gid).then((m) => alive && setMessages(m)).catch(() => {});
    const loadPhotos = () => listPhotos(gid).then((p) => alive && setPhotos(p)).catch(() => {});
    const loadDuels = () => listDuels(gid).then((d) => alive && setDuels(d)).catch(() => {});
    const loadCamps = () => listCamps(gid).then((c) => alive && setCamps(c)).catch(() => {});
    const loadQuests = () => listQuests(gid).then((q) => alive && setQuests(q)).catch(() => {});
    const loadSeen = () =>
      membership
        ? seenQuestionIds(gid, membership.teamId).then((q) => alive && setSeenQs(q)).catch(() => {})
        : undefined;
    const loadAmbushes = () => listAmbushes(gid).then((a) => alive && setAmbushes(a)).catch(() => {});
    const loadTurf = () =>
      listTerritory(gid)
        .then((rows) => alive && setTerritoryRows(rows))
        .catch(() => {});
    const loadRaids = () => listRaidLocks(gid).then((r) => alive && setRaidLocks(r)).catch(() => {});
    const loadGame = () =>
      getGameFull(gid)
        .then((g) => {
          if (!alive) return;
          if (g.config) setOnlineConfig(g.config);
          setOnlineStatus((g.status as 'lobby' | 'live' | 'paused' | 'ended') ?? 'live');
          setOnlineStartedAt(g.started_at);
        })
        .catch(() => {});
    loadClaims();
    loadPos();
    loadSpawns();
    loadStars();
    loadStarSpawns();
    loadEvents();
    loadMsgs();
    loadPhotos();
    loadDuels();
    loadCamps();
    loadQuests();
    void loadSeen();
    loadAmbushes();
    loadTurf();
    loadRaids();
    loadGame();
    const u1 = subscribeClaims(gid, loadClaims);
    const u2 = subscribePositions(gid, loadPos);
    const u3 = subscribeSpawns(gid, loadSpawns);
    const u4 = subscribeStars(gid, loadStars);
    const u12 = subscribeStarSpawns(gid, loadStarSpawns);
    const u5 = subscribeEvents(gid, loadEvents);
    const u6 = subscribeGame(gid, loadGame);
    const u8 = subscribeMessages(gid, loadMsgs);
    const uPh = subscribePhotos(gid, loadPhotos);
    const uDu = subscribeDuels(gid, loadDuels);
    const uCa = subscribeCamps(gid, loadCamps);
    const uQu = subscribeQuests(gid, loadQuests);
    const u9 = subscribeAmbushes(gid, loadAmbushes);
    const u10 = subscribeTerritory(gid, loadTurf);
    const u11 = subscribeRaidLocks(gid, loadRaids);
    return () => {
      alive = false;
      u1();
      u2();
      u3();
      uPh();
      uDu();
      uCa();
      uQu();
      u4();
      u5();
      u6();
      u8();
      u9();
      u10();
      u11();
      u12();
    };
  }, [appMode, membership]);

  // Timestamp-driven star lock: whoever observes a finished meter locks it (guarded
  // so only one client succeeds and the owning team gets the star).
  useEffect(() => {
    if (appMode !== 'online') return;
    for (const c of starClaimRows) {
      if (c.status === 'claiming' && Date.parse(c.ends_at) <= nowTs && !lockTried.current.has(c.id)) {
        lockTried.current.add(c.id);
        lockStar(c.id, c.team_id)
          .then((won) => {
            if (!won || !membership) return;
            const teamName = teams.find((t) => t.id === c.team_id)?.name ?? 'A team';
            const barName = onlineBoard?.squares.find((s) => s.id === c.bar_spot_id)?.title ?? 'a bar';
            logEvent(membership.gameId, 'star', `⭐ ${teamName} locked a star at ${barName}`).catch(() => {});
            if (c.team_id === membership.teamId) flash('⭐ Star!');
          })
          .catch(() => {});
      }
    }
  }, [appMode, starClaimRows, nowTs, membership, teams, onlineBoard]);

  // Local clock so spawns appear/expire by time (the schedule is pre-baked in the DB).
  useEffect(() => {
    if (appMode !== 'online') return;
    const iv = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [appMode]);

  // Turf income: each tick pays every team coins equal to its longest run of
  // painted corners. Timestamp-driven like star locks — whichever phone notices
  // the tick tries a guarded insert; exactly one wins and pays everyone from a
  // FRESH territory read (our cache could be seconds stale).
  useEffect(() => {
    if (appMode !== 'online' || !membership || !onlineBoard || onlineStatus !== 'live' || !onlineStartedAt) return;
    const tickMs = cfg.territoryTickSec(onlineConfig) * 1000;
    if (tickMs <= 0) return;
    const tickNo = Math.floor((nowTs - Date.parse(onlineStartedAt)) / tickMs);
    if (tickNo < 1 || tickTried.current.has(tickNo)) return;
    tickTried.current.add(tickNo);
    (async () => {
      try {
        const payer = await claimTerritoryTick(membership.gameId, tickNo, membership.teamId);
        if (!payer) return;
        const rows = await listTerritory(membership.gameId);
        const ownership = Object.fromEntries(rows.map((r) => [r.spot_id, r.team_id]));
        const runs = computeRuns(ownership, turfAdj);
        const parts: string[] = [];
        for (const t of teams) {
          const n = runs[t.id] ?? 0;
          if (n > 0) {
            // A chain pays its LENGTH times the rate — holding six in a row is
            // worth more than six scattered corners, which is the whole point.
            await adjustCoins(t.id, n * cfg.chainMultiplier(onlineConfig));
            parts.push(`${t.emoji} +${n}`);
          }
        }
        if (parts.length) {
          logEvent(membership.gameId, 'income', `🔗 Turf income paid: ${parts.join(' · ')} 🪙`).catch(() => {});
        }
      } catch {
        /* another phone will cover the next tick */
      }
    })();
  }, [appMode, nowTs, membership, onlineBoard, onlineStatus, onlineStartedAt, onlineConfig, teams, turfAdj]);

  function onlineClaimSpawn(spawnId: string) {
    if (!membership) return;
    const sp = allSpawns.find((s) => s.id === spawnId);
    if (!sp) return;
    const commit = async () => {
      setAllSpawns((list) => list.map((s) => (s.id === spawnId ? { ...s, claimed_by: membership.teamId } : s))); // optimistic
      try {
        const won = await claimSpawnDb(membership.gameId, membership.teamId, spawnId, sp.reward, sp.lat, sp.lng);
        if (won) logEvent(membership.gameId, 'spawn', `🎁 ${myTeam?.name ?? 'A team'} grabbed a drop (+${sp.reward} 🪙)`).catch(() => {});
        else alert('Too slow — another team grabbed that drop.');
      } catch (e) {
        alert('Grab failed: ' + (e as Error).message);
      }
    };
    withProximity({ lat: sp.lat, lng: sp.lng }, commit);
  }

  // GPS gate (party) — off for desk testing, on requires being within the radius.
  /** Human, actionable text for each way geolocation fails. */
  function geoErrorText(err: GeolocationPositionError): string {
    if (err.code === err.PERMISSION_DENIED) {
      return '📍 Location is blocked for this site. iPhone: tap "aA" in the address bar → Website Settings → Location → Allow (and check Settings → Privacy → Location Services is on for your browser). Android: tap the lock icon → Permissions → Location → Allow.';
    }
    if (err.code === err.TIMEOUT) {
      return '📍 Timed out waiting for a GPS fix — step outside or near a window and try again.';
    }
    return '📍 Location unavailable — make sure Location Services are switched on for your browser, then try again.';
  }
  function withProximity(target: { lat: number; lng: number }, cb: () => void, ui?: { fail: (msg: string) => void }) {
    if (!cfg.gpsRequired(onlineConfig)) return cb(); // host setting — no player opt-out
    // No ui hook (e.g. grabbing a drop) → the shared popup carries the pending
    // state; the spot sheet reports inline via ui.fail instead.
    if (!ui) setGpsPopup({ emoji: '📡', title: 'Checking your location…', body: 'Hold tight — getting a fresh GPS fix.' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = metersBetween({ lat: pos.coords.latitude, lng: pos.coords.longitude }, target);
        if (d <= onlineConfig.radiusM) {
          if (!ui) setGpsPopup(null);
          cb();
        } else {
          const msg = `You're ${Math.round(d)}m away — get within ${onlineConfig.radiusM}m of the spot. (fix ±${Math.round(pos.coords.accuracy)}m)`;
          if (ui) ui.fail(msg);
          else setGpsPopup({ emoji: '☝️', title: 'Not close enough!', body: msg });
        }
      },
      (err) => {
        const msg = geoErrorText(err);
        if (ui) ui.fail(msg);
        else setGpsPopup({ emoji: '🛰️', title: 'Location trouble', body: msg });
      },
      // maximumAge 0 — NEVER accept a cached fix. The field test showed why:
      // rejected at 36m, kept walking into the radius, and every retap for 20s
      // got the same stale fix handed back.
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }
  // "Test my GPS" (menu): grabs a fix and reports accuracy + the nearest spot,
  // so radius tuning on the walk uses real numbers instead of guesses.
  const [gpsTest, setGpsTest] = useState('');
  // GPS verdicts get the game's own popup, not a browser alert. Tapping
  // anywhere dismisses; it also clears itself after a beat.
  const [gpsPopup, setGpsPopup] = useState<{ emoji: string; title: string; body: string } | null>(null);
  useEffect(() => {
    if (!gpsPopup) return;
    const t = setTimeout(() => setGpsPopup(null), 3000);
    return () => clearTimeout(t);
  }, [gpsPopup]);
  async function runGpsTest() {
    setGpsTest('Getting a GPS fix…');
    // The permission STATE disambiguates which layer is blocking: 'denied'
    // here + system toggles on means the SITE permission; 'prompt' that
    // errors without ever asking means the OS-level switch for the browser.
    let perm = '?';
    try {
      perm = (await navigator.permissions.query({ name: 'geolocation' })).state;
    } catch {
      /* Permissions API missing (older Safari) — proceed without it */
    }
    setGpsTest(`Getting a GPS fix… (permission: ${perm})`);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const spots = onlineBoard ? deriveSpots(onlineBoard) : [];
        let best: { d: number; name: string } | null = null;
        for (const sq of spots) {
          const d = metersBetween(here, sq);
          if (!best || d < best.d) best = { d, name: sq.title || 'a spot' };
        }
        setGpsTest(
          `✅ Fix ±${Math.round(pos.coords.accuracy)}m${best ? ` · nearest spot (${best.name}) is ${Math.round(best.d)}m away` : ''} · radius ${onlineConfig.radiusM}m`,
        );
      },
      (err) =>
        setGpsTest(`${geoErrorText(err)} [state: ${perm} · ${navigator.userAgent.includes('CriOS') ? 'Chrome iOS' : navigator.userAgent.includes('iPhone') ? 'Safari iOS' : 'other'}]`),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }
  // Tap = information, always. The sheet shows what the spot is and who holds
  // it; only its "I'm here" button runs the GPS gate and the actual play.
  const [spotSheet, setSpotSheet] = useState<{ spotId: string } | null>(null);
  const [sheetGps, setSheetGps] = useState<{ checking?: boolean; msg?: string } | null>(null);
  function openSpotSheet(spotId: string) {
    if (!membership || !onlineBoard) return;
    if (!onlineBoard.squares.some((s) => s.id === spotId)) return;
    setSheetGps(null);
    setSpotSheet({ spotId });
  }
  /** The play itself — everything that used to happen on tap. Runs only after
   * the sheet's action button passes the proximity gate. */
  // --- Camping & duels -----------------------------------------------------
  // Park at a spot and coins pile up, each interval worth more than the last,
  // but they sit in a BANK that only pays when you leave and check in somewhere
  // else. You must tap "still here" every interval (GPS-gated) or the
  // escalation resets. Anyone who finds you can challenge for half the bank —
  // and that challenge is a DUEL: one prompt, both phones, tap who won.
  const myCamp = useMemo(
    () => camps.find((c) => c.team_id === membership?.teamId && c.status === 'active') ?? null,
    [camps, membership],
  );
  /** Spot → whoever is camped there, for the spot sheet and the map. */
  const campBySpot = useMemo(() => {
    const out: Record<string, CampRow> = {};
    for (const c of camps) if (c.status === 'active') out[c.spot_id] = c;
    return out;
  }, [camps]);
  /** Bars with someone camped at them, for the map: spot -> that team's colour.
   * A camp is a visible pile of coins and hunting one is a real play, so it has
   * to be findable from across the board, not only by tapping the spot. */
  const campGlow = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of camps) if (c.status === 'active') out[c.spot_id] = teamColorOf(teams, c.team_id);
    return out;
  }, [camps, teams]);
  const campTick = cfg.campTickSec(onlineConfig) * 1000;
  /** Seconds until this camp's next payout is claimable (0 = tap it now). */
  const campDue = myCamp ? Math.max(0, Math.ceil((Date.parse(myCamp.last_ping) + campTick - nowTs) / 1000)) : 0;
  /** Missed the window by a whole interval → the streak is gone, bank isn't. */
  const campLapsed = !!myCamp && nowTs - Date.parse(myCamp.last_ping) > campTick * 2;
  const campNext = myCamp
    ? campIncrement(campLapsed ? 0 : myCamp.ticks, cfg.campStep(onlineConfig), cfg.campMaxStep(onlineConfig))
    : 0;
  const [campBusy, setCampBusy] = useState(false);
  /** At the ceiling there is nothing left to earn by staying — the only move
   * is to carry it out, and the bar should say so rather than keep offering
   * a payout it can't make. */
  const campFull = !!myCamp && myCamp.banked >= cfg.campBankCap(onlineConfig);

  async function doStartCamp(spotId: string, name: string) {
    if (!membership || campBusy) return;
    setCampBusy(true);
    try {
      const row = await startCamp(membership.gameId, membership.teamId, spotId);
      if (!row) {
        setGpsPopup({ emoji: '🏕️', title: 'Already camped', body: "Your team is set up somewhere else — collect that first." });
        return;
      }
      setSpotSheet(null);
      setGpsPopup({
        emoji: '🏕️',
        title: `Camped at ${name}`,
        body: `Tap "still here" every ${Math.round(cfg.campTickSec(onlineConfig) / 60) || 1} min to keep earning. Check in somewhere else to bank it.`,
      });
    } catch (e) {
      alert('Could not camp: ' + (e as Error).message);
    } finally {
      setCampBusy(false);
    }
  }

  /** "Still here" — proximity-gated, so you can't hold a corner from the couch. */
  function doPingCamp() {
    if (!membership || !myCamp || campBusy || campDue > 0) return;
    const sq = onlineBoard?.squares.find((s) => s.id === myCamp.spot_id);
    if (!sq) return;
    withProximity(sq, () => {
      setCampBusy(true);
      pingCamp(myCamp, {
        step: cfg.campStep(onlineConfig),
        maxStep: cfg.campMaxStep(onlineConfig),
        cap: cfg.campBankCap(onlineConfig),
        lapsed: campLapsed,
      })
        .then((row) => {
          if (!row) return; // another phone on this team got the same interval
          const cap = cfg.campBankCap(onlineConfig);
          setGpsPopup(
            campLapsed
              ? { emoji: '⏳', title: 'Streak reset', body: 'You missed an interval — the bank is safe, the run starts over.' }
              : row.banked >= cap
                ? {
                    emoji: '🏦',
                    title: `Bank full — 🪙${cap}`,
                    body: "That's as much as a camp will hold. Sitting here earns nothing now — check in somewhere else to carry it out before someone takes half.",
                  }
                : { emoji: '🏕️', title: `+${campNext} banked`, body: `🪙${row.banked} waiting. Check in elsewhere to carry it out.` },
          );
        })
        .catch((e) => alert('Ping failed: ' + (e as Error).message))
        .finally(() => setCampBusy(false));
    });
  }

  /** Leaving pays out — called from the check-in path at any OTHER spot. */
  async function collectMyCamp(atSpotId: string) {
    if (!membership || !myCamp || myCamp.spot_id === atSpotId) return;
    try {
      const coins = await collectCamp(myCamp.id);
      if (coins <= 0) return;
      await adjustCoins(membership.teamId, coins);
      logEvent(membership.gameId, 'camp', `🏕️ ${myTeam?.name ?? 'A team'} cashed out ${coins} 🪙 from camp`).catch(() => {});
      setGpsPopup({ emoji: '💰', title: `Banked ${coins} 🪙`, body: 'Carried it out clean.' });
    } catch {
      /* the bank survives — they can try again at the next spot */
    }
  }

  /** Found someone sitting on a pile. Half of it is on the table. */
  async function doRaidCamp(camp: CampRow, name: string) {
    if (!membership || campBusy) return;
    const stake = Math.floor((camp.banked * cfg.campRaidPct(onlineConfig)) / 100);
    if (stake <= 0) {
      setGpsPopup({ emoji: '🪹', title: 'Nothing to take', body: "They haven't banked anything yet." });
      return;
    }
    setCampBusy(true);
    try {
      const duel = await startDuel({
        gameId: membership.gameId,
        challenger: membership.teamId,
        opponent: camp.team_id,
        kind: 'camp',
        prompt: pickRound(),
        stake,
        spotId: camp.spot_id,
      });
      if (!duel) {
        setGpsPopup({ emoji: '⚔️', title: 'Already on', body: 'A challenge with this team is already running.' });
        return;
      }
      setSpotSheet(null);
      // A hunt in progress is the most actionable thing on the board: the camper
      // needs to know, and everyone else needs to know that pile is contested.
      logEvent(
        membership.gameId,
        'camp',
        `⚔️ ${myTeam?.name ?? 'A team'} is hunting ${teams.find((t) => t.id === camp.team_id)?.name ?? 'a team'} at ${name} — ${stake} 🪙 on the line`,
      ).catch(() => {});
      sendMessage(
        membership.gameId,
        null,
        camp.team_id,
        `⚔️ ${myTeam?.name ?? 'A team'} found your camp at ${name} — ${stake} 🪙 on the line!`,
      ).catch(() => {});
    } catch (e) {
      alert('Challenge failed: ' + (e as Error).message);
    } finally {
      setCampBusy(false);
    }
  }

  /** The open duel this team is part of — drives the banner and the modal. */
  const myDuel = useMemo(
    () =>
      duels.find(
        (d) => d.status === 'open' && (d.challenger === membership?.teamId || d.opponent === membership?.teamId),
      ) ?? null,
    [duels, membership],
  );
  const [duelOpen, setDuelOpen] = useState(false);
  const [duelBusy, setDuelBusy] = useState(false);
  useEffect(() => {
    if (myDuel) setDuelOpen(true);
  }, [myDuel?.id]);

  /**
   * A duel nobody answers shouldn't haunt two phones for the rest of the party.
   * Somebody springs a trap, wanders into a bar, and the other team is left
   * with a banner they can't clear — only the challenger can call one off. So
   * after a while it gives up: nobody pays, and any quest riding on it closes.
   */
  useEffect(() => {
    if (!myDuel || !membership) return;
    const ttl = cfg.duelTimeoutSec(onlineConfig) * 1000;
    const dead = Date.parse(myDuel.created_at) + ttl <= nowTs;
    if (!dead) return;
    let alive = true;
    (async () => {
      await cancelDuel(myDuel.id).catch(() => {});
      const q = quests.find((x) => x.status === 'active' && x.target_spot === myDuel.spot_id);
      if (q) await closeQuest(q.id, 'failed').catch(() => {});
      if (!alive) return;
      setDuelOpen(false);
      setGpsPopup({ emoji: '🕰️', title: 'Challenge expired', body: 'Nobody called it, so nothing changes hands.' });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDuel?.id, nowTs >= (myDuel ? Date.parse(myDuel.created_at) + cfg.duelTimeoutSec(onlineConfig) * 1000 : Infinity)]);

  /** Either side can walk away now — it was the challenger's call alone, which
   * is exactly backwards when they're the one who might wander off. */
  async function doCallOffDuel(id: string) {
    await cancelDuel(id).catch(() => {});
    setDuelOpen(false);
  }

  /** Either phone can call it; the guard decides who actually pays out. */
  // --- Side quests: TAG ------------------------------------------------------
  // A quest occupies the one slot a team has; it does NOT freeze normal play,
  // because tagging someone IS a check-in. You're given a mark, you find them
  // from their last check-in on the map, and you have to check in where they
  // check in, close behind them. They're never told — the feed announces it the
  // moment you land it, so a team that loses coins knows it was a hunt.
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const myQuest = useMemo(
    () => quests.find((q) => q.team_id === membership?.teamId && q.status === 'active') ?? null,
    [quests, membership],
  );
  /** A quest offered by the space we just checked into, awaiting yes or no. */
  const [questOffer, setQuestOffer] = useState<{ spotId: string; name: string } | null>(null);
  const [questBusy, setQuestBusy] = useState(false);
  /** Re-open the photo mid-hunt — you can't solve a picture you can't see. */
  const [questPhoto, setQuestPhoto] = useState(false);
  /** The trapper names the game — they're the one lying in wait, so they get to
   * pick the ground. Stored on the quest because the VICTIM's phone is what
   * builds the duel when it springs. */
  const [ambushPick, setAmbushPick] = useState<string>(AMBUSH_DUELS[0].name);
  const questLeft = myQuest ? Math.max(0, Math.floor((Date.parse(myQuest.expires_at) - nowTs) / 1000)) : 0;
  const questMark = myQuest?.target_team ? teams.find((t) => t.id === myQuest.target_team) : undefined;
  const questSpotName =
    onlineBoard?.squares.find((sq) => sq.id === myQuest?.target_spot)?.title || 'this space';

  /**
   * Does this space offer a quest? Hashed from game+team+spot so it's the same
   * answer every time — a refresh can't re-roll it, and a space that said no
   * keeps saying no.
   */
  function spaceOffersQuest(spotId: string): boolean {
    if (!membership || myQuest) return false; // one at a time
    if (teams.length < 2) return false; // nobody to hunt
    if (quests.some((q) => q.team_id === membership.teamId && q.from_spot === spotId)) return false;
    return strHash01(`${membership.gameId}:${membership.teamId}:${spotId}`) * 100 < cfg.questChance(onlineConfig);
  }

  /** Places we have a photograph of, keyed by the square they're taken at.
   * Asked for once, so dropping a new photo in only needs a reload. */
  const [explorerSpots, setExplorerSpots] = useState<{ id: string; what: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/art/explorer/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((m) => alive && setExplorerSpots(Array.isArray(m) ? m : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Which job this space is offering — same hash, so it never re-rolls. */
  function questKindFor(spotId: string): QuestKind {
    if (!membership) return 'tag';
    const r = strHash01(`kind:${membership.gameId}:${membership.teamId}:${spotId}`);
    // Explorer needs a photographed place far enough away to be a journey.
    if (r < 0.25 && explorerTargetFrom(spotId)) return 'explorer';
    return r < 0.5 ? 'tag' : r < 0.75 ? 'recon' : 'ambush';
  }

  /** A photographed place you can't already see from here. */
  function explorerTargetFrom(spotId: string): { id: string; what: string } | null {
    const here = onlineBoard?.squares.find((sq) => sq.id === spotId);
    if (!here || !explorerSpots.length) return null;
    const minM = cfg.explorerMinM(onlineConfig);
    const far = explorerSpots.filter((t) => {
      const sq = onlineBoard?.squares.find((x) => x.id === t.id);
      return sq && sq.id !== spotId && metersBetween(here, sq) >= minM;
    });
    if (!far.length) return null;
    // Deterministic, so the offer doesn't change if you look at it twice.
    const i = Math.floor(strHash01(`exp:${membership?.teamId}:${spotId}`) * far.length);
    return far[Math.min(i, far.length - 1)];
  }


  /** The next bars in the star rotation — Recon's payoff, and real intel:
   * a drop lands at the first bar with no star waiting and no claim running. */
  function nextStarBars(n: number): string[] {
    const pool = (onlineBoard?.squares ?? [])
      .filter((sq) => sq.type === 'bar')
      .sort((a, b) => a.id.localeCompare(b.id));
    const out: string[] = [];
    const taken = new Set<string>();
    for (const sq of pool) {
      if (out.length >= n) break;
      const busy =
        (starAvailable[sq.id] ?? 0) > 0 ||
        starClaimRows.some((c) => c.bar_spot_id === sq.id && c.status === 'claiming') ||
        taken.has(sq.id);
      if (!busy) {
        out.push(sq.title || 'a bar');
        taken.add(sq.id);
      }
    }
    return out;
  }

  async function doAcceptQuest(kind: QuestKind, spotId: string, spotName: string) {
    if (!membership || questBusy) return;
    setQuestBusy(true);
    try {
      if (kind === 'tag') {
        await doAcceptTag(spotId);
        return;
      }
      if (kind === 'explorer') {
        const t = explorerTargetFrom(spotId);
        if (!t) {
          setQuestOffer(null);
          return;
        }
        const row = await acceptQuest({
          gameId: membership.gameId,
          teamId: membership.teamId,
          kind: 'explorer',
          targetSpot: t.id,
          fromSpot: spotId,
          reward: cfg.explorerReward(onlineConfig),
          seconds: cfg.explorerSec(onlineConfig),
        });
        setQuestOffer(null);
        if (!row) {
          setGpsPopup({ emoji: '🧭', title: 'Already on a job', body: 'Finish the one you have first.' });
          return;
        }
        setGpsPopup({
          emoji: '🧭',
          title: 'Find this place',
          body: `Work out where the photo was taken and check in there — and nowhere else on the way. You have ${Math.round(cfg.explorerSec(onlineConfig) / 60)} minutes.`,
        });
        return;
      }
      const secs = kind === 'recon' ? cfg.reconSec(onlineConfig) : cfg.ambushSec(onlineConfig);

      const row = await acceptQuest({
        gameId: membership.gameId,
        teamId: membership.teamId,
        kind,
        targetSpot: spotId,
        fromSpot: spotId,
        choice: kind === 'ambush' ? ambushPick : null,
        reward: kind === 'recon' ? 0 : cfg.ambushTake(onlineConfig),
        seconds: secs,
      });
      setQuestOffer(null);
      if (!row) {
        setGpsPopup({ emoji: '🎯', title: 'Already on a job', body: 'Finish the one you have first.' });
        return;
      }
      const mins = Math.round(secs / 60);
      setGpsPopup(
        kind === 'recon'
          ? {
              emoji: '🔭',
              title: `Holding ${spotName}`,
              body: `Stay put ${mins} min. Anyone who turns up can challenge you — beat them, or last it out, and you'll know where the next stars land.`,
            }
          : {
              emoji: '🪤',
              title: `Trap set at ${spotName}`,
              body: `Armed for ${mins} min. The next team to check in here walks into it — win and you take ${cfg.ambushTake(onlineConfig)} 🪙.`,
            },
      );
      logEvent(
        membership.gameId,
        'battle',
        kind === 'recon'
          ? `🔭 ${myTeam?.name ?? 'A team'} is holding ${spotName} — go challenge them`
          : `🪤 Something's set up somewhere. Watch your step.`,
      ).catch(() => {});
    } catch (e) {
      alert('Could not accept: ' + (e as Error).message);
    } finally {
      setQuestBusy(false);
    }
  }

  /** Someone else's job running at the spot we just walked into. */
  const questHere = (spotId: string) =>
    quests.find(
      (q) => q.status === 'active' && q.target_spot === spotId && q.team_id !== membership?.teamId,
    ) ?? null;

  /** Walk into an armed trap and it springs on you — no button to decline. */
  async function springAmbushOn(spotId: string) {
    if (!membership) return;
    const trap = quests.find(
      (q) => q.status === 'active' && q.kind === 'ambush' && q.target_spot === spotId && q.team_id !== membership.teamId,
    );
    if (!trap) return;
    const sq = onlineBoard?.squares.find((x) => x.id === spotId);
    try {
      await startDuel({
        gameId: membership.gameId,
        challenger: trap.team_id,
        opponent: membership.teamId,
        kind: 'quest',
        prompt: trap.choice || pickRound(),
        stake: cfg.ambushTake(onlineConfig),
        spotId,
      });
      logEvent(
        membership.gameId,
        'battle',
        `🪤 ${teams.find((t) => t.id === trap.team_id)?.name ?? 'A team'} sprang a trap on ${myTeam?.name ?? 'a team'} at ${sq?.title || 'a space'}!`,
      ).catch(() => {});
    } catch {
      /* already running */
    }
  }

  async function doAcceptTag(spotId: string) {
    if (!membership || questBusy) return;
    setQuestBusy(true);
    try {
      const rivals = teams.filter((t) => t.id !== membership.teamId);
      const mark = rivals[Math.floor(Math.random() * rivals.length)];
      const row = await acceptQuest({
        gameId: membership.gameId,
        teamId: membership.teamId,
        kind: 'tag',
        targetTeam: mark.id,
        fromSpot: spotId,
        reward: cfg.tagSteal(onlineConfig),
        seconds: cfg.tagQuestSec(onlineConfig),
      });
      setQuestOffer(null);
      if (!row) {
        setGpsPopup({ emoji: '🎯', title: 'Already on a job', body: 'Finish the one you have first.' });
        return;
      }
      setGpsPopup({
        emoji: '🎯',
        title: `Hunt ${mark.name}`,
        body: `Find them on the map, then check in where they check in — within ${Math.round(cfg.tagWindowSec(onlineConfig) / 60)} min of them. Don't let on.`,
      });
    } catch (e) {
      alert('Could not accept: ' + (e as Error).message);
    } finally {
      setQuestBusy(false);
    }
  }

  /**
   * Called right after our own check-in lands. Reads the mark's position fresh —
   * a tag turns on seconds, and the subscribed copy can be stale.
   */
  /**
   * Explorer is decided by wherever you check in next. The right place wins it;
   * anywhere else is "touching another space" and ends it. That's the whole
   * cost of the job — you walk past everything you'd normally take.
   */
  async function checkExplorerOn(spotId: string) {
    if (!membership || !myQuest || myQuest.kind !== 'explorer') return;
    const won = myQuest.target_spot === spotId;
    if (!(await closeQuest(myQuest.id, won ? 'done' : 'failed').catch(() => false))) return;
    if (won) {
      const prize = myQuest.reward || cfg.explorerReward(onlineConfig);
      await adjustCoins(membership.teamId, prize).catch(() => {});
      logEvent(
        membership.gameId,
        'battle',
        `🧭 ${myTeam?.name ?? 'A team'} found the place in the photo — +${prize} 🪙`,
      ).catch(() => {});
      setGpsPopup({ emoji: '🧭', title: 'This is the place', body: `Nicely read. +${prize} 🪙.` });
    } else {
      setGpsPopup({
        emoji: '🧭',
        title: 'Off the trail',
        body: 'You checked in somewhere else, so the job is off. The photo was somewhere else entirely.',
      });
    }
  }

  async function checkTagOn(spotId: string) {

    if (!membership || !myQuest || myQuest.kind !== 'tag' || !myQuest.target_team) return;
    try {
      const pos = await getPosition(membership.gameId, myQuest.target_team);
      // No timestamp means we can't tell how far behind them we are, and a
      // tag that can't be timed isn't a tag.
      if (!pos || pos.spot_id !== spotId || !pos.updated_at) return;
      const behind = (Date.now() - Date.parse(pos.updated_at)) / 1000;
      if (behind < 0 || behind > cfg.tagWindowSec(onlineConfig)) return;
      if (!(await closeQuest(myQuest.id, 'done'))) return;
      const steal = cfg.tagSteal(onlineConfig);
      await transferCoins(myQuest.target_team, membership.teamId, steal);
      const markName = teams.find((t) => t.id === myQuest.target_team)?.name ?? 'a team';
      logEvent(
        membership.gameId,
        'battle',
        `🎯 ${myTeam?.name ?? 'A team'} tagged ${markName} — ${steal} 🪙 lifted`,
      ).catch(() => {});
      sendMessage(
        membership.gameId,
        null,
        myQuest.target_team,
        `🎯 You were tagged by ${myTeam?.name ?? 'a team'} — they followed you in and took ${steal} 🪙.`,
      ).catch(() => {});
      setGpsPopup({ emoji: '🎯', title: 'Tagged!', body: `You caught ${markName} — +${steal} 🪙.` });
    } catch {
      /* a missed tag is not worth interrupting the check-in for */
    }
  }

  // The clock runs out and the mark collects for never having noticed.
  useEffect(() => {
    if (!membership || !myQuest || questLeft > 0) return;
    let alive = true;
    (async () => {
      // Recon that runs its full length is a WIN — nobody came for you.
      if (myQuest.kind === 'recon') {
        if (!(await closeQuest(myQuest.id, 'done').catch(() => false))) return;
        if (!alive) return;
        const bars = nextStarBars(2);
        setGpsPopup({
          emoji: '🔭',
          title: 'Nobody came',
          body: bars.length
            ? `Word is the next stars land at: ${bars.join(', then ')}.`
            : 'Every bar already has a star waiting — go take one.',
        });
        return;
      }
      if (myQuest.kind === 'explorer') {
        if (!(await closeQuest(myQuest.id, 'failed').catch(() => false))) return;
        if (!alive) return;
        setGpsPopup({ emoji: '🧭', title: 'Out of time', body: 'The trail went cold. Somebody else will find it.' });
        return;
      }
      if (myQuest.kind === 'ambush') {
        if (!(await closeQuest(myQuest.id, 'failed').catch(() => false))) return;
        if (!alive) return;
        setGpsPopup({ emoji: '🪤', title: 'Trap went cold', body: 'Nobody walked into it. Try somewhere busier.' });
        return;
      }
      if (!(await closeQuest(myQuest.id, 'failed').catch(() => false))) return;
      if (!alive) return;
      const evade = cfg.tagEvade(onlineConfig);

      if (myQuest.target_team && evade > 0) {
        await adjustCoins(myQuest.target_team, evade).catch(() => {});
        const markName = teams.find((t) => t.id === myQuest.target_team)?.name ?? 'a team';
        logEvent(membership.gameId, 'battle', `🫥 ${markName} shook off a tail — +${evade} 🪙`).catch(() => {});
      }
      setGpsPopup({ emoji: '🫥', title: 'They got away', body: 'Your mark is clear. Better luck at the next space.' });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myQuest?.id, questLeft === 0]);
  async function doResolveDuel(duel: DuelRow, winner: string) {
    if (duelBusy) return;
    setDuelBusy(true);
    try {
      const mine = await resolveDuel(duel.id, winner);
      if (!mine) return; // the other phone reported first — their payout stands
      const wName = teams.find((t) => t.id === winner)?.name ?? 'A team';
      if (duel.kind === 'quest') {
        const q = quests.find((x) => x.status === 'active' && x.target_spot === duel.spot_id);
        const wq = teams.find((t) => t.id === winner)?.name ?? 'A team';
        if (q && (await closeQuest(q.id, winner === q.team_id ? 'done' : 'failed'))) {
          if (q.kind === 'ambush') {
            // The trapper wins and takes the purse; lose and it backfires.
            const from = winner === q.team_id ? duel.opponent : q.team_id;
            const to = winner === q.team_id ? q.team_id : duel.opponent;
            const amt = winner === q.team_id ? duel.stake : cfg.ambushBackfire(onlineConfig);
            // transfer_coins moves only what the loser actually has, so report
            // what MOVED rather than what was asked for.
            const moved = amt > 0 ? await transferCoins(from, to, amt) : 0;
            logEvent(duel.game_id, 'battle', `🪤 ${wq} came out of the trap ${moved} 🪙 up`).catch(() => {});
          } else if (winner !== q.team_id) {
            // Recon broken up: the challenger lifts coins off the watcher.
            const took = await transferCoins(q.team_id, winner, cfg.reconSteal(onlineConfig));
            logEvent(duel.game_id, 'battle', `🔭 ${wq} broke up a recon — ${took} 🪙`).catch(() => {});
          } else {
            logEvent(duel.game_id, 'battle', `🔭 ${wq} held their ground`).catch(() => {});
            if (q.team_id === membership?.teamId) {
              const bars = nextStarBars(2);
              setGpsPopup({
                emoji: '🔭',
                title: 'You held it',
                body: bars.length ? `Next stars land at: ${bars.join(', then ')}.` : 'Every bar has a star waiting.',
              });
            }
          }
        }
      } else if (duel.kind === 'camp' && winner === duel.challenger) {

        const camp = camps.find((c) => c.team_id === duel.opponent && c.status === 'active');
        if (camp && (await raidCamp(camp, duel.stake))) {
          await adjustCoins(duel.challenger, duel.stake);
        }
        logEvent(duel.game_id, 'camp', `⚔️ ${wName} raided a camp for ${duel.stake} 🪙!`).catch(() => {});
      } else if (duel.kind === 'camp') {
        logEvent(duel.game_id, 'camp', `🛡️ ${wName} defended their camp!`).catch(() => {});
      } else {
        logEvent(duel.game_id, 'battle', `⚔️ ${wName} won the challenge!`).catch(() => {});
      }
    } catch (e) {
      alert('Could not report: ' + (e as Error).message);
    } finally {
      setDuelBusy(false);
      setDuelOpen(false);
    }
  }
  function runSpotAction(spotId: string) {
    if (!membership || !onlineBoard || onlineStatus !== 'live') return;
    // Checking in ANYWHERE else is what carries a camp's bank out. Self-guards
    // on the camp's own spot, so pinging where you sit doesn't cash you out.
    void collectMyCamp(spotId);
    // Did we just walk in behind our mark? And does this space have work going?
    void checkTagOn(spotId);
    void springAmbushOn(spotId);
    void checkExplorerOn(spotId);

    const sq = onlineBoard.squares.find((s) => s.id === spotId);
    if (!sq) return;
    const type = onlineNodeType[spotId] ?? 'coin';
    {
      // An armed trap? Third parties spring it (the two ambushers pass safely).
      const trap = spotAmbush[spotId];
      if (trap && trap.status === 'armed' && trap.initiator !== membership.teamId && trap.ally !== membership.teamId) {
        void doSpringAmbush(trap, sq);
        return;
      }
      if (type === 'bar') {
        setOnlineBarModal({ spotId, name: sq.title || 'Bar' });
        return;
      }
      // A painted corner (recurring; bypasses the cleared gate): a rival's →
      // a steal play; your own → the corner menu (reinforce / set a trap).
      const turfOwner = territoryMap[spotId];
      if (turfOwner && turfIds.has(spotId)) {
        if (turfOwner !== membership.teamId) openSteal(spotId, sq, turfOwner);
        else setMyCornerModal({ spotId, name: sq.title || 'Your corner' });
        return;
      }
      // The pool said this one's a job. Same gate as the other outcomes: a
      // space you've already cleared doesn't pay out twice, and you can only
      // carry one job, so a second offer just becomes a plain check-in.
      if (type === 'quest' && !onlineCleared.includes(spotId) && !myQuest && teams.length > 1) {
        setQuestOffer({ spotId, name: sq.title || 'this space' });
        setOnlineCleared((c) => [...c, spotId]);
        checkInSpot(membership.gameId, membership.teamId, spotId, sq.lat, sq.lng, 0).catch(() => {});
        paintTurf(spotId);
        return;
      }
      if (type === 'chance') {
        if (onlineCleared.includes(spotId)) {
          openArmOnCleared(spotId, sq);
          return;
        }
        setChanceOutcome(null);
        setChanceText('');
        setChanceBusy(false);
        setChanceDrawing(false);
        setChanceCardText('');
        setOnlineChanceModal({ spotId, name: sq.title || 'Chance' });
        return;
      }
      if (onlineCleared.includes(spotId)) {
        openArmOnCleared(spotId, sq);
        return;
      }
      // A challenge → deal trivia (pinned questions, else the shared bank).
      if (type === 'challenge') {
        const dealt = questionsForSpot(onlineBoard, membership.gameId, spotId);
        if (dealt.length > 0) {
          setQuizPick({});
          setQuizDone(false);
          setOnlineQuizModal({ spotId, name: sq.title || 'Challenge', questions: dealt });
          return;
        }
      }
      // Bowser: a forced gauntlet — do the challenge or lose coins.
      if (type === 'bowser') {
        setQuizPick({});
        setQuizDone(false);
        setBowserLoss(null);
        setOnlineBowserModal({ spotId, name: sq.title || 'Bowser' });
        return;
      }
      setOnlineCleared((c) => [...c, spotId]); // optimistic; subscription confirms coins/pos
      checkInSpot(membership.gameId, membership.teamId, spotId, sq.lat, sq.lng, onlineConfig.coinReward).catch((e) =>
        alert('Check-in failed: ' + (e as Error).message),
      );
      paintTurf(spotId);
    }
  }
  // --- Turf steal handlers ---------------------------------------------------
  /** Deal n distinct bank questions; no bank published → coin-flip calls. */
  function dealStealQuestions(n: number): TriviaQuestion[] {
    const bank = onlineBoard?.triviaBank ?? [];
    if (bank.length) {
      // Questions this team has already been asked go to the back. Being asked
      // one twice is a free right answer, and steals draw two of them.
      const fresh = bank.filter((q) => !q.id || !seenQs.includes(q.id));
      const rest = bank.filter((q) => q.id && seenQs.includes(q.id));
      const shuffled = [
        ...fresh.sort(() => Math.random() - 0.5),
        ...rest.sort(() => Math.random() - 0.5),
      ];
      return shuffled.slice(0, Math.min(n, shuffled.length));
    }
    return Array.from({ length: n }, () => ({
      q: '🪙 No trivia bank in this game — call the coin flip to make the play!',
      choices: ['Heads', 'Tails'],
      correct: Math.floor(Math.random() * 2),
    }));
  }
  /** Home-turf defense: the defender's LAST check-in is fresh (≤10 min) and
   * within defendRadiusM of this corner — they're standing right there. */
  function defenderIsNear(defenderId: string, sq: Square): boolean {
    const pos = positions.find((p) => p.team_id === defenderId);
    if (!pos) return false;
    const fresh = pos.updated_at ? Date.now() - Date.parse(pos.updated_at) <= 10 * 60 * 1000 : false;
    return fresh && metersBetween({ lat: pos.lat, lng: pos.lng }, sq) <= cfg.defendRadiusM(onlineConfig);
  }
  /** Land on a rival corner: locked out → bounce; otherwise deal the play.
   * 🧱 reinforced or defender-on-site → hard mode (2 questions, all right). */
  function openSteal(spotId: string, sq: Square, defenderId: string) {
    if (!membership || onlineStatus !== 'live') return;
    const lock = raidLocks.find(
      (r) => r.attacker === membership.teamId && r.defender === defenderId && Date.parse(r.until_ts) > Date.now(),
    );
    if (lock) {
      const secs = Math.ceil((Date.parse(lock.until_ts) - Date.now()) / 1000);
      const defName = teams.find((t) => t.id === defenderId)?.name ?? 'that team';
      alert(`🚫 You blew your last shot at ${defName} — wait ${Math.ceil(secs / 60)} min before hitting them again.`);
      return;
    }
    const reinforced = reinforcedSet.has(spotId);
    const defenderNear = defenderIsNear(defenderId, sq);
    setStealPicks({});
    setStealResult(null);
    setStealBusy(false);
    setStealForfeited(0);
    setStealModal({
      spotId,
      name: sq.title || 'this corner',
      defenderId,
      // Always two, both right. Fifteen of the fifty questions are
      // Abby-or-Steven two-handers, so a single question makes roughly a third
      // of steals a coin flip — and a corner shouldn't change hands on a guess.
      questions: dealStealQuestions(2),
      reinforced,
      defenderNear,
    });
  }
  /** Resolve the play: ALL right = flip the corner; any wrong = lockout vs
   * that team, plus a coin forfeit to them if the corner was 🧱 reinforced. */
  async function resolveSteal() {
    if (!membership || !stealModal || stealBusy) return;
    const { spotId, name, defenderId, questions, reinforced } = stealModal;
    if (questions.some((_, i) => stealPicks[i] == null)) return;
    const defName = teams.find((t) => t.id === defenderId)?.name ?? 'a team';
    const allRight = questions.every((q, i) => stealPicks[i] === q.correct);
    logTriviaAnswers(membership.gameId, membership.teamId, 'steal', spotId, questions, stealPicks).catch(() => {});
    setSeenQs((prev) => [...new Set([...prev, ...questions.map((q) => q.id).filter(Boolean) as string[]])]);
    setStealBusy(true);
    try {
      if (allRight) {
        const ok = await stealTerritory(membership.gameId, spotId, membership.teamId, defenderId);
        if (ok) {
          setStealResult('won');
          // A flat bounty off the loser — zero-sum, so bouncing a corner back and
          // forth can't farm the bank. The real damage is still the cut chain.
          const bounty = cfg.stealBounty(onlineConfig);
          if (bounty > 0) transferCoins(defenderId, membership.teamId, bounty).catch(() => {});
          const sq = onlineBoard?.squares.find((s) => s.id === spotId);
          if (sq) checkInSpot(membership.gameId, membership.teamId, spotId, sq.lat, sq.lng, 0).catch(() => {});
          logEvent(membership.gameId, 'battle', `🏴 ${myTeam?.name ?? 'A team'} stole ${name} from ${defName} — +${bounty} 🪙`).catch(() => {});
          sendMessage(membership.gameId, null, defenderId, `🏴 ${myTeam?.name ?? 'A team'} took your corner at ${name} and ${bounty} 🪙 — your run may be cut!`).catch(() => {});
        } else {
          setStealResult('gone'); // ownership changed under us — map will refresh
        }
      } else {
        setStealResult('lost');
        const until = new Date(Date.now() + cfg.stealLockSec(onlineConfig) * 1000).toISOString();
        setRaidLock(membership.gameId, membership.teamId, defenderId, until).catch(() => {});
        let extra = '';
        if (reinforced) {
          const forfeit = cfg.reinforceForfeit(onlineConfig);
          const moved = await transferCoins(membership.teamId, defenderId, forfeit).catch(() => 0);
          setStealForfeited(moved);
          extra = ` and forfeited ${moved} 🪙 to the wall`;
        }
        logEvent(membership.gameId, 'battle', `🛡 ${defName} held ${name} — ${myTeam?.name ?? 'a team'} fumbled the steal${extra}`).catch(() => {});
        sendMessage(membership.gameId, null, defenderId, `🛡 ${myTeam?.name ?? 'A team'} tried to steal your corner at ${name} and blew it${extra}!`).catch(() => {});
      }
    } catch (e) {
      alert('Steal failed: ' + (e as Error).message);
      setStealModal(null);
    } finally {
      setStealBusy(false);
    }
  }
  /** Spend a 🧱 charge on the corner you're standing on. */
  async function doReinforce() {
    if (!membership || !myCornerModal || cornerBusy) return;
    setCornerBusy(true);
    try {
      const r = await reinforceCorner(membership.gameId, myCornerModal.spotId, membership.teamId);
      if (r === 'ok') {
        setTerritoryRows((rows) =>
          rows.map((row) => (row.spot_id === myCornerModal.spotId ? { ...row, reinforced: true } : row)),
        );
        flash('🧱 Reinforced!');
        logEvent(membership.gameId, 'battle', `🧱 ${myTeam?.name ?? 'A team'} reinforced a corner`).catch(() => {});
        setMyCornerModal(null);
      } else if (r === 'nocharge') {
        alert('No 🧱 charges — win one from a chance card.');
      } else {
        alert('This corner just changed — refresh and try again.');
        setMyCornerModal(null);
      }
    } catch (e) {
      alert('Reinforce failed: ' + (e as Error).message);
    } finally {
      setCornerBusy(false);
    }
  }

  // --- Ambush handlers -------------------------------------------------------
  /** Re-tapping a spot you've cleared → set (or inspect) a trap there. */
  function openArmOnCleared(spotId: string, sq: Square) {
    if (onlineStatus !== 'live') return;
    setArmAllyId('');
    setAmbushArmModal({ spotId, name: sq.title || 'this spot' });
  }
  /** We stepped on an armed trap (guarded server-side → exactly one springer). */
  async function doSpringAmbush(a: AmbushRow, sq: Square) {
    if (!membership) return;
    const won = await springAmbush(a.id, membership.teamId).catch(() => false);
    if (!won) return;
    const spot = sq.title || 'a spot';
    setAmbushedName(spot);
    const alertText = `🪤 Your trap at ${spot} caught ${myTeam?.name ?? 'a team'} — get there for the showdown!`;
    logEvent(membership.gameId, 'battle', `🪤 An ambush was sprung at ${spot}!`).catch(() => {});
    sendMessage(membership.gameId, null, a.initiator, alertText).catch(() => {});
    sendMessage(membership.gameId, null, a.ally, alertText).catch(() => {});
  }
  async function doProposeAmbush() {
    if (!membership || !ambushArmModal || !armAllyId) return;
    const stake = cfg.ambushStake(onlineConfig);
    try {
      const r = await proposeAmbush(membership.gameId, ambushArmModal.spotId, membership.teamId, armAllyId, stake);
      if (r === 'nocoins') alert(`Not enough 🪙 (the stake is ${stake}).`);
      else if (r === 'taken') alert('There is already a trap tied to this spot.');
      else {
        sendMessage(
          membership.gameId,
          null,
          armAllyId,
          `🪤 ${myTeam?.name ?? 'A team'} proposes an ambush at ${ambushArmModal.name} — accept in your game to stake ${stake} 🪙.`,
        ).catch(() => {});
        setAmbushArmModal(null);
      }
    } catch (e) {
      alert('Ambush failed: ' + (e as Error).message);
    }
  }
  async function doRespondAmbush(accept: boolean) {
    if (!allyProposal) return;
    const stake = cfg.ambushStake(onlineConfig);
    try {
      const r = await respondAmbush(allyProposal, accept, stake);
      if (r === 'nocoins') alert(`Not enough 🪙 to stake (${stake}).`);
    } catch (e) {
      alert('Respond failed: ' + (e as Error).message);
    }
  }
  async function doCancelAmbush(a: AmbushRow) {
    try {
      await cancelAmbush(a, cfg.ambushStake(onlineConfig));
      setAmbushArmModal(null);
    } catch (e) {
      alert('Cancel failed: ' + (e as Error).message);
    }
  }
  async function doResolveAmbush(ambushersWon: boolean) {
    if (!membership || !myShowdown) return;
    const stake = cfg.ambushStake(onlineConfig);
    const reward = cfg.ambushReward(onlineConfig);
    try {
      const ok = await resolveAmbush(myShowdown, ambushersWon, stake, reward);
      if (ok) {
        const nameOfTeam = (id: string | null) => teams.find((t) => t.id === id)?.name ?? 'a team';
        logEvent(
          membership.gameId,
          'battle',
          ambushersWon
            ? `🪤 ${nameOfTeam(myShowdown.initiator)} & ${nameOfTeam(myShowdown.ally)} won their ambush on ${nameOfTeam(myShowdown.victim)}!`
            : `🛡 ${nameOfTeam(myShowdown.victim)} fought off ${nameOfTeam(myShowdown.initiator)} & ${nameOfTeam(myShowdown.ally)} and took the pot!`,
        ).catch(() => {});
      }
      setShowdownOpen(false);
    } catch (e) {
      alert('Resolve failed: ' + (e as Error).message);
    }
  }

  // Record the chance spot as cleared (once per team) without a coin reward.
  function markChanceCleared(sq: Square) {
    if (!membership) return;
    setOnlineCleared((c) => (c.includes(sq.id) ? c : [...c, sq.id]));
    checkInSpot(membership.gameId, membership.teamId, sq.id, sq.lat, sq.lng, 0).catch(() => {});
    paintTurf(sq.id);
  }
  // Clearing a claimable corner paints it your color (extends/starts a run).
  // First-come insert; if a rival owns it the check-in already routed to steal.
  function paintTurf(spotId: string) {
    if (!membership || !turfIds.has(spotId) || territoryMap[spotId]) return;
    setTerritoryRows((rows) => [...rows, { spot_id: spotId, team_id: membership.teamId }]); // optimistic
    claimTerritory(membership.gameId, spotId, membership.teamId).catch(() => {});
  }
  // Draw a chance card. 'rob'/'claim' defer to a follow-up choice; others resolve now.
  async function rollOnlineChance() {
    if (!membership || !onlineBoard || !onlineChanceModal || chanceBusy) return;
    const sq = onlineBoard.squares.find((s) => s.id === onlineChanceModal.spotId);
    if (!sq) return;
    const others = teams.filter((t) => t.id !== membership.teamId);
    const card = drawChanceCard(onlineBoard, others.length > 0, sq.cardIds);
    setChanceBusy(true);
    setChanceDrawing(true);
    await new Promise((r) => setTimeout(r, 900)); // let the card flip
    setChanceDrawing(false);
    setChanceCardText(card.text);
    // Robbery and claim-this-space defer to a follow-up choice.
    if (card.effect === 'rob') {
      setChanceBusy(false);
      setChanceOutcome('rob');
      return;
    }
    try {
      // 'claim' cards (the old land-grab) now award a 🧱 reinforcement charge.
      if (card.effect === 'claim') {
        try {
          await grantReinforcement(membership.teamId);
          setChanceText(`${card.text} +1 🧱 — check in at a corner you own to fortify it.`);
          await logEvent(membership.gameId, 'star', `🧱 ${myTeam?.name ?? 'A team'} picked up a reinforcement`);
        } catch {
          // reinforce.sql not applied yet — degrade to a small coin prize.
          await adjustCoins(membership.teamId, 20);
          setChanceText(`${card.text} …the armory is closed — +20 🪙 instead.`);
        }
        setChanceOutcome('gain');
        markChanceCleared(sq);
        setChanceBusy(false);
        return;
      }
      if (card.effect === 'gain') {
        await adjustCoins(membership.teamId, card.amount);
        setChanceText(`${card.text} +${card.amount} 🪙`);
        setChanceOutcome('gain');
        await logEvent(membership.gameId, 'coin', `🍀 ${myTeam?.name ?? 'A team'} drew a lucky card (+${card.amount} 🪙)`);
      } else if (card.effect === 'lose') {
        await adjustCoins(membership.teamId, -card.amount);
        setChanceText(`${card.text} −${card.amount} 🪙`);
        setChanceOutcome('lose');
        await logEvent(membership.gameId, 'coin', `💸 ${myTeam?.name ?? 'A team'} drew an unlucky card (−${card.amount} 🪙)`);
      } else {
        setChanceText(card.text || '😐 Nothing happens.');
        setChanceOutcome('nothing');
      }
      markChanceCleared(sq);
    } catch (e) {
      alert('Chance failed: ' + (e as Error).message);
    } finally {
      setChanceBusy(false);
    }
  }
  // Rob the chosen rival team of a flat robAmount.
  async function robPick(victim: TeamRow) {
    if (!membership || !onlineBoard || !onlineChanceModal || chanceBusy) return;
    const sq = onlineBoard.squares.find((s) => s.id === onlineChanceModal.spotId);
    if (!sq) return;
    setChanceBusy(true);
    try {
      const amount = cfg.robAmount(onlineConfig);
      const moved = await transferCoins(victim.id, membership.teamId, amount);
      setChanceText(`🦹 Robbed ${victim.name} for ${moved} 🪙!`);
      setChanceOutcome('gain');
      await logEvent(
        membership.gameId,
        'battle',
        `🦹 ${myTeam?.name ?? 'A team'} robbed ${victim.name} of ${moved} 🪙`,
      );
      markChanceCleared(sq);
    } catch (e) {
      alert('Robbery failed: ' + (e as Error).message);
    } finally {
      setChanceBusy(false);
    }
  }
  // Score the online trivia, then clear the spot + award scaled coins via checkInSpot.
  function resolveOnlineQuiz() {
    if (!membership || !onlineBoard || !onlineQuizModal) return;
    const sq = onlineBoard.squares.find((s) => s.id === onlineQuizModal.spotId);
    if (!sq) return;
    const qs = onlineQuizModal.questions;
    const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
    const base = sq.reward > 0 ? sq.reward : onlineConfig.coinReward;
    const award = qs.length ? Math.round((base * correct) / qs.length) : base;
    logTriviaAnswers(membership.gameId, membership.teamId, 'spot', sq.id, qs, quizPick).catch(() => {});
    setOnlineCleared((c) => (c.includes(sq.id) ? c : [...c, sq.id]));
    checkInSpot(membership.gameId, membership.teamId, sq.id, sq.lat, sq.lng, award).catch((e) =>
      alert('Check-in failed: ' + (e as Error).message),
    );
    paintTurf(sq.id);
    setQuizDone(true);
  }
  // Bowser resolution: lose coins by performance. Trivia → penalty × %wrong;
  // physical → a self-reported tier (nailed/struggled/failed). Floored at 0.
  async function resolveOnlineBowser(tier?: 'nailed' | 'struggled' | 'failed') {
    if (!membership || !onlineBoard || !onlineBowserModal) return;
    const sq = onlineBoard.squares.find((s) => s.id === onlineBowserModal.spotId);
    if (!sq) return;
    const qs = resolvePinnedQuestions(sq, onlineBoard.triviaBank ?? []);
    const penalty = sq.reward > 0 ? sq.reward : 30;
    let loss: number;
    if (qs.length > 0 && !tier) {
      const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
      loss = Math.round((penalty * (qs.length - correct)) / qs.length);
      logTriviaAnswers(membership.gameId, membership.teamId, 'bowser', sq.id, qs, quizPick).catch(() => {});
    } else {
      loss = tier === 'nailed' ? 0 : tier === 'struggled' ? Math.round(penalty / 2) : penalty;
    }
    try {
      if (loss > 0) await adjustCoins(membership.teamId, -loss);
      setOnlineCleared((c) => (c.includes(sq.id) ? c : [...c, sq.id]));
      checkInSpot(membership.gameId, membership.teamId, sq.id, sq.lat, sq.lng, 0).catch(() => {});
      await logEvent(membership.gameId, 'battle', `👹 ${myTeam?.name ?? 'A team'} faced Bowser and lost ${loss} 🪙`);
      setBowserLoss(loss);
      setQuizDone(true);
    } catch (e) {
      alert('Bowser failed: ' + (e as Error).message);
    }
  }
  async function doBuyRound() {
    if (!membership || !onlineBarModal) return;
    if ((starAvailable[onlineBarModal.spotId] ?? 0) <= 0) {
      alert('No star at this bar right now — wait for one to land!');
      return;
    }
    try {
      const r = await buyRoundDb(membership.gameId, membership.teamId, onlineBarModal.spotId, onlineConfig.starCost, onlineConfig.meterSec * 1000);
      if (r === 'nocoins') alert(`Not enough 🪙 (need ${onlineConfig.starCost}).`);
      else if (r === 'taken') alert('This bar is already being claimed.');
    } catch (e) {
      alert('Buy a round failed: ' + (e as Error).message);
    }
    setOnlineBarModal(null);
  }
  function openBattle() {
    if (!onlineBarModal) return;
    const claim = starClaimRows.find((c) => c.bar_spot_id === onlineBarModal.spotId && c.status === 'claiming');
    if (!claim) {
      setOnlineBarModal(null);
      return;
    }
    const defenderName = teams.find((t) => t.id === claim.team_id)?.name ?? 'the defender';
    setBattleModal({ claimId: claim.id, barName: onlineBarModal.name, defenderName, round: pickRound() });
    setOnlineBarModal(null);
  }
  async function resolveBattle(attackerWon: boolean) {
    if (!membership || !battleModal) return;
    const bm = battleModal;
    setBattleModal(null);
    try {
      if (attackerWon) {
        const ok = await stealStarClaim(bm.claimId, membership.teamId, onlineConfig.meterSec * 1000);
        if (ok) await logEvent(membership.gameId, 'battle', `⚔️ ${myTeam?.name ?? 'A team'} beat ${bm.defenderName} and took ${bm.barName}`);
        else alert('That claim already resolved.');
      } else {
        await logEvent(membership.gameId, 'battle', `⚔️ ${myTeam?.name ?? 'A team'} challenged ${bm.defenderName} at ${bm.barName} and lost`);
      }
    } catch (e) {
      alert('Battle failed: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selectedVertex === null) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteVertex(selectedVertex);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVertex]);

  // --- canvas interactions ---------------------------------------------------
  function onMapClick(lat: number, lng: number) {
    if (phase === 'area' && mode === 'boundary') {
      setBoard((b) => ({ ...b, boundary: [...b.boundary, { lat, lng }], boundaryClosed: false }));
    } else if (phase === 'squares' && mode === 'add') {
      const sq = makeSquare(addType, SQUARE_TYPES[addType].label, lat, lng);
      setBoard((b) => ({ ...b, squares: [...b.squares, sq] }));
      // One-shot placement: drop back into select mode with the new spot
      // selected, so its editor opens immediately instead of stacking icons.
      setMode('select');
      setSelectedId(sq.id);
    }
  }

  function selectSquare(id: string) {
    if (mode === 'connect') {
      void connectPick(id);
      return;
    }
    // Clicking an existing spot always means "edit it" — even mid-placement.
    if (mode === 'add') setMode('select');
    setSelectedId(id || null);
    setSelectedVertex(null);
    setSelectedEdgeId(null);
  }
  // Connect mode: click one space, then another, to draw a street between them.
  async function connectPick(id: string) {
    if (connecting) return;
    if (!connectFrom) {
      setConnectFrom(id);
      return;
    }
    if (connectFrom === id) {
      setConnectFrom(null); // clicked the same space → cancel
      return;
    }
    const a = board.squares.find((s) => s.id === connectFrom);
    const b = board.squares.find((s) => s.id === id);
    setConnectFrom(null);
    if (!a || !b) return;
    if (board.edges.some((e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) {
      return; // already connected
    }
    setConnecting(true);
    try {
      const straight = [
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
      ];
      // Straight mode joins the two ends directly. Use it where the real road
      // network would detour (or doesn't link them at all) and you just want
      // the corners to meet on the board.
      let path: LatLng[];
      if (connectStraight) {
        path = straight;
      } else {
        try {
          path = await routeAlongStreets({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
        } catch {
          path = straight;
        }
      }
      setBoard((bd) => ({
        ...bd,
        edges: [...bd.edges, { id: crypto.randomUUID(), from: a.id, to: b.id, directed: false, path }],
      }));
    } finally {
      setConnecting(false);
    }
  }

  function moveSquare(id: string, lat: number, lng: number) {
    setBoard((b) => {
      const old = b.squares.find((s) => s.id === id);
      if (!old) return b;
      const dLat = lat - old.lat;
      const dLng = lng - old.lng;
      // Attached paths follow the space, bending smoothly near it.
      const blend = Math.max(30, metersBetween(old, { lat, lng }) * 1.5);
      return {
        ...b,
        squares: b.squares.map((s) => (s.id === id ? { ...s, lat, lng } : s)),
        edges: b.edges.map((e) => {
          if (!e.path || e.path.length < 2) return e;
          if (e.from === id) return { ...e, path: shiftPathEnd(e.path, 'start', dLat, dLng, blend) };
          if (e.to === id) return { ...e, path: shiftPathEnd(e.path, 'end', dLat, dLng, blend) };
          return e;
        }),
      };
    });
  }
  function moveVertex(index: number, lat: number, lng: number) {
    setBoard((b) => ({ ...b, boundary: b.boundary.map((p, i) => (i === index ? { lat, lng } : p)) }));
  }
  function deleteVertex(index: number) {
    setBoard((b) => ({ ...b, boundary: b.boundary.filter((_, i) => i !== index) }));
    setSelectedVertex(null);
  }
  function updateSquare(id: string, patch: Partial<Square>) {
    setBoard((b) => ({ ...b, squares: b.squares.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }
  /** Patch a square's POI properties, defaulting the encounter by type. */
  function updatePoi(sq: Square, patch: Partial<PoiProps>) {
    const base: PoiProps = sq.poi ?? { encounter: sq.type === 'bar' ? 'star-bar' : 'landmark' };
    updateSquare(sq.id, { poi: { ...base, ...patch } });
  }
  // --- Trivia question authoring (on a challenge square) ---------------------
  function patchQuestions(sq: Square, fn: (qs: TriviaQuestion[]) => TriviaQuestion[]) {
    updateSquare(sq.id, { questions: fn(sq.questions ? sq.questions.map((q) => ({ ...q, choices: [...q.choices] })) : []) });
  }
  function addQuestion(sq: Square) {
    patchQuestions(sq, (qs) => [...qs, { q: '', choices: ['', ''], correct: 0 }]);
  }
  function removeQuestion(sq: Square, qi: number) {
    patchQuestions(sq, (qs) => qs.filter((_, i) => i !== qi));
  }
  function updateQuestion(sq: Square, qi: number, patch: Partial<TriviaQuestion>) {
    patchQuestions(sq, (qs) => qs.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
  }
  async function uploadQuestionPhoto(sq: Square, qi: number, file: File) {
    setPhotoUploading(qi);
    try {
      const url = await uploadTriviaPhoto(file);
      updateQuestion(sq, qi, { image: url });
    } catch (e) {
      alert('Photo upload failed: ' + (e as Error).message);
    } finally {
      setPhotoUploading(null);
    }
  }
  function addChoice(sq: Square, qi: number) {
    patchQuestions(sq, (qs) => qs.map((q, i) => (i === qi && q.choices.length < 4 ? { ...q, choices: [...q.choices, ''] } : q)));
  }
  function updateChoice(sq: Square, qi: number, ci: number, val: string) {
    patchQuestions(sq, (qs) =>
      qs.map((q, i) => (i === qi ? { ...q, choices: q.choices.map((c, j) => (j === ci ? val : c)) } : q)),
    );
  }
  function removeChoice(sq: Square, qi: number, ci: number) {
    patchQuestions(sq, (qs) =>
      qs.map((q, i) => {
        if (i !== qi || q.choices.length <= 2) return q;
        const choices = q.choices.filter((_, j) => j !== ci);
        const correct = ci === q.correct ? 0 : ci < q.correct ? q.correct - 1 : q.correct;
        return { ...q, choices, correct };
      }),
    );
  }
  function removeSquare(id: string) {
    // A connected square is part of the road network — deleting it takes its
    // road segments with it (and cuts the turf graph there). That is almost
    // never what "remove this stray bar" means, so make it loud and point at
    // the safe alternative.
    const connected = board.edges.filter((e) => e.from === id || e.to === id).length;
    if (
      connected > 0 &&
      !confirm(
        `⚠️ ${connected} road segment${connected === 1 ? '' : 's'} meet at this space — deleting it removes those roads too.\n\n` +
          `To just remove a bar/icon and keep the intersection, Cancel and set its Type to "blank" instead.`,
      )
    )
      return;
    setBoard((b) => ({
      ...b,
      squares: b.squares.filter((s) => s.id !== id),
      edges: b.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelectedId(null);
  }
  // Clear the spot layer: drop hand-placed (unconnected) spots and reset every
  // graph node back to blank — leaving just the bare intersection grid.
  function clearSpots() {
    if (!confirm('Clear all spots? Removes hand-placed spots and resets every space to blank.')) return;
    setBoard((b) => {
      const deg = new Map<string, number>();
      for (const e of b.edges) {
        deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
        deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      }
      return {
        ...b,
        squares: b.squares.filter((s) => (deg.get(s.id) ?? 0) > 0).map((s) => ({ ...s, type: 'blank' as SquareType })),
      };
    });
    setSelectedId(null);
  }

  // --- the real POI roster (one-click seed) ----------------------------------
  // Wolski's is the only TYPE 'bar' (custom-art rule: bars join the ⭐ rotation
  // as bespoke art lands); everything else starts as a POI to be authored.
  const POI_ROSTER: { name: string; lat: number; lng: number; type: SquareType; artRef?: string }[] = [
    { name: "Wolski's", lat: 43.05523, lng: -87.89651, type: 'bar', artRef: 'hero_wolskis' },
    { name: "Fink's", lat: 43.05599, lng: -87.8983, type: 'poi' },
    { name: "Scaffidi's Hideout", lat: 43.05535, lng: -87.89831, type: 'poi' },
    { name: 'The Standard', lat: 43.05419, lng: -87.89652, type: 'poi' },
    { name: "Pete's Pub", lat: 43.05314, lng: -87.89553, type: 'poi' },
    { name: 'Hi Hat', lat: 43.05314, lng: -87.89528, type: 'poi' },
    { name: "Jamo's", lat: 43.05459, lng: -87.89474, type: 'poi' },
    { name: "Angelo's", lat: 43.05284, lng: -87.90311, type: 'poi' },
    { name: "St. Hedwig's", lat: 43.05322, lng: -87.89788, type: 'poi', artRef: 'st-hedwig' },
    { name: "Glorioso's", lat: 43.05269, lng: -87.89927, type: 'poi', artRef: 'gloriosos' },
    { name: 'Cass St Playground', lat: 43.0508, lng: -87.9017, type: 'poi' },
    { name: 'Pulaski Playfield', lat: 43.0553, lng: -87.8959, type: 'poi' },
    { name: '811 E Pleasant', lat: 43.05038, lng: -87.90173, type: 'poi' },
  ];
  const rosterMissing = POI_ROSTER.filter(
    (p) => !board.squares.some((s) => s.title.trim().toLowerCase() === p.name.toLowerCase()),
  );
  /** Seed every roster POI not already on the board (matched by title). */
  function addRosterPois() {
    setBoard((b) => {
      const have = new Set(b.squares.map((s) => s.title.trim().toLowerCase()));
      const add = POI_ROSTER.filter((p) => !have.has(p.name.toLowerCase())).map((p) => {
        const sq = makeSquare(p.type, p.name, p.lat, p.lng);
        sq.poi = { encounter: p.type === 'bar' ? 'star-bar' : 'landmark', artRef: p.artRef };
        return sq;
      });
      return add.length ? { ...b, squares: [...b.squares, ...add] } : b;
    });
  }

  // --- real bars (suggested from OSM scenery) --------------------------------
  // De-duped list of real bars pulled from OSM; the designer adds/removes them.
  const realBars = useMemo(() => {
    const seen = new Set<string>();
    return (board.scenery?.bars ?? []).filter((b) => {
      const key = b.name || `${b.lat},${b.lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [board.scenery]);
  const placedBarNames = useMemo(
    () => new Set(board.squares.filter((s) => s.type === 'bar').map((s) => s.title)),
    [board.squares],
  );
  function addBar(name: string, lat: number, lng: number) {
    const sq = makeSquare('bar', name, lat, lng);
    setBoard((b) => ({ ...b, squares: [...b.squares, sq] }));
    setSelectedId(sq.id);
  }
  function removeBarByName(name: string) {
    setBoard((b) => ({ ...b, squares: b.squares.filter((s) => !(s.type === 'bar' && s.title === name)) }));
  }
  function addAllBars() {
    setBoard((b) => {
      const have = new Set(b.squares.filter((s) => s.type === 'bar').map((s) => s.title));
      const add = realBars.filter((r) => !have.has(r.name)).map((r) => makeSquare('bar', r.name, r.lat, r.lng));
      return { ...b, squares: [...b.squares, ...add] };
    });
  }

  // --- edge editing ----------------------------------------------------------
  function updateEdge(id: string, patch: Partial<Edge>) {
    setBoard((b) => ({ ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }
  function flipEdge(id: string) {
    setBoard((b) => ({ ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)) }));
  }
  function deleteEdge(id: string) {
    setBoard((b) => ({ ...b, edges: b.edges.filter((e) => e.id !== id) }));
    setSelectedEdgeId(null);
  }

  // --- boundary tools (Area step) --------------------------------------------
  function drawArea() {
    setMode('boundary');
    setSelectedId(null);
    setBoard((b) => ({ ...b, boundaryClosed: false }));
  }
  function finishDrawing() {
    setBoard((b) => ({ ...b, boundaryClosed: b.boundary.length >= 3 }));
    setMode('select');
    bumpCage();
  }
  function clearArea() {
    setBoard((b) => ({ ...b, boundary: [], boundaryClosed: false }));
    setSelectedVertex(null);
    setUndoBoundary(null);
  }
  function tidyArea() {
    setBoard((b) => ({ ...b, boundary: simplify(b.boundary, 12) }));
    setSelectedVertex(null);
    bumpCage();
  }
  async function snapArea() {
    if (board.boundary.length < 3) {
      alert('Draw at least 3 boundary points first.');
      return;
    }
    setSnapping(true);
    try {
      const snapped = await snapToStreetsFollowing(board.boundary);
      if (snapped.length < 3) throw new Error('could not trace a street loop');
      setUndoBoundary(board.boundary);
      setBoard((b) => ({ ...b, boundary: snapped, boundaryClosed: true }));
      setSelectedVertex(null);
      bumpCage();
    } catch (err) {
      alert('Snap failed: ' + (err as Error).message + '\n(Overpass may be busy — try again.)');
    } finally {
      setSnapping(false);
    }
  }
  function undoSnap() {
    if (!undoBoundary) return;
    setBoard((b) => ({ ...b, boundary: undoBoundary }));
    setUndoBoundary(null);
    bumpCage();
  }

  // --- phase navigation ------------------------------------------------------
  function goToPhase(target: Phase) {
    setMode('select');
    setSelectedId(null);
    setSelectedVertex(null);
    setSelectedEdgeId(null);
    setBoard((b) => ({
      ...b,
      phase: target,
      boundaryClosed: target !== 'area' ? b.boundary.length >= 3 : b.boundaryClosed,
    }));
    bumpCage();
  }
  function setPadding(delta: number) {
    setBoard((b) => ({ ...b, padding: Math.max(0, Math.min(0.25, +(b.padding + delta).toFixed(2))) }));
    bumpCage();
  }

  function pickType(t: SquareType) {
    setAddType(t);
    setMode('add');
    setSelectedId(null);
  }

  async function generateFromStreets() {
    if (board.boundary.length < 3) {
      alert('Set the area first (Steps 1–2).');
      return;
    }
    if (board.locked && board.squares.length) {
      alert('The layout is locked. Unlock it below to redraw.');
      return;
    }
    if (board.squares.length && !confirm('Redraw the board? This replaces the current spaces and paths.')) return;
    setGenerating(true);
    try {
      const { squares, edges } = await generateStreetBoard(board.boundary, 110);
      if (!squares.length) throw new Error('no spaces landed inside the area');
      setBoard((b) => ({ ...b, squares, edges }));
      setSelectedId(null);
      setSelectedEdgeId(null);
      setMode('select');
    } catch (err) {
      alert('Generate failed: ' + (err as Error).message + '\n(Overpass may be busy — try again.)');
    } finally {
      setGenerating(false);
    }
  }

  function addSurroundings() {
    if (board.boundary.length < 3) {
      alert('Set the area first (Steps 1–2).');
      return;
    }
    // The surroundings are pre-baked from real OSM + city tree data into one
    // illustrated underlay image (see art-prototype/), so this is an instant
    // toggle on the board itself — saved with the board, visible to players.
    setBoard((b) => ({ ...b, artUnderlay: !b.artUnderlay }));
  }
  /** The hand-painted block board replaces the sprite city when it's on. */
  function togglePaintedBoard() {
    setBoard((b) => ({ ...b, paintedBoard: !b.paintedBoard }));
  }

  // Weld dead-end stubs onto the junction they nearly touch, so a street
  // doesn't visibly break a few metres short of its corner.
  const [closingGaps, setClosingGaps] = useState(false);
  async function closeGaps() {
    setClosingGaps(true);
    let res;
    try {
      res = await closeStreetGaps(board.squares, board.edges);
    } catch (e) {
      alert('Gap check failed: ' + (e as Error).message);
      return;
    } finally {
      setClosingGaps(false);
    }
    const { squares, edges, fixed, skipped } = res;
    if (fixed.length) {
      setBoard((b) => ({ ...b, squares, edges }));
      const welds = fixed.filter((f) => f.kind === 'merged').length;
      const links = fixed.length - welds;
      const bits = [welds && `welded ${welds} split corner${welds > 1 ? 's' : ''}`, links && `drew ${links} missing block${links > 1 ? 's' : ''}`];
      alert(`Closed ${fixed.length} gap${fixed.length > 1 ? 's' : ''} — ${bits.filter(Boolean).join(', ')} (${fixed.map((f) => f.gap + 'm').join(', ')}).`);
      return;
    }
    // Nothing qualified: say what IS nearby, so a gap you can see on screen
    // isn't met with a bare "none found".
    if (!skipped.length) {
      alert('Every space already connects — no unconnected spaces are within 95m of each other.');
      return;
    }
    const near = [...skipped].sort((a, b) => a.gap - b.gap).slice(0, 4);
    alert(
      `No gaps closed. Nearest unconnected spaces:\n\n` +
        near.map((s) => `• ${s.gap}m apart — ${s.why}\n  (${s.at.lat.toFixed(5)}, ${s.at.lng.toFixed(5)})`).join('\n') +
        `\n\nIf one of these is the gap you can see, use Connect spaces to join them by hand.`,
    );
  }

  // Bake street-name labels from OSM into the board's scenery. Safe with a
  // locked layout — it never touches squares/edges, only the label layer.
  const [labelingStreets, setLabelingStreets] = useState(false);
  async function labelStreets() {
    if (board.boundary.length < 3) {
      alert('Set the area first (Steps 1–2).');
      return;
    }
    setLabelingStreets(true);
    try {
      // Labels sit in the blocks BETWEEN the drawn spaces — pass the pips.
      const spaces = deriveSpots(board).map((s) => ({ lat: s.lat, lng: s.lng }));
      const streetLabels = await buildStreetLabels(board.boundary, spaces);
      if (!streetLabels.length) {
        alert('No named streets found in this area.');
        return;
      }
      setBoard((b) => ({
        ...b,
        scenery: {
          ...(b.scenery ?? { blocks: [], parks: [], woods: [], water: [], rivers: [], bars: [], pois: [], trees: [] }),
          streetLabels,
        },
      }));
    } catch (e) {
      alert('Street names failed: ' + (e as Error).message);
    } finally {
      setLabelingStreets(false);
    }
  }

  // --- file io ---------------------------------------------------------------
  function exportJson() {
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'birthday-board.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Board;
        if (!Array.isArray(parsed.squares)) throw new Error('bad board');
        if (!parsed.phase) parsed.phase = 'area';
        if (typeof parsed.padding !== 'number') parsed.padding = 0.04;
        if (!Array.isArray(parsed.edges)) parsed.edges = [];
        if (typeof parsed.enforceDirection !== 'boolean') parsed.enforceDirection = false;
        if (typeof parsed.locked !== 'boolean') parsed.locked = false;
        setBoard(parsed);
        setSelectedId(null);
        setSelectedVertex(null);
        setSelectedEdgeId(null);
        setMode('select');
        bumpCage();
      } catch {
        alert('That file was not a valid board JSON.');
      }
    };
    reader.readAsText(file);
  }

  const hasArea = board.boundary.length > 0;
  const areaReady = board.boundary.length >= 3;
  const curStep = phaseIndex(phase);
  const nameOf = (id: string) => board.squares.find((s) => s.id === id)?.title ?? '?';

  // --- Sidebar accordion (admin design surface) ------------------------------
  // Each tool category is a header button; one section open at a time. Bodies
  // stay mounted (hidden attr) so inputs keep state when collapsed.
  const [openSection, setOpenSection] = useState('setup');
  // Which POI row is expanded in the Points-of-interest list editor.
  const [openPoiId, setOpenPoiId] = useState<string | null>(null);
  // Designer sidebar width — draggable (desktop), remembered per device.
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('mke-sidebar-w'));
    return v >= 300 && v <= 680 ? v : 340;
  });
  const poiSquares = useMemo(
    () =>
      board.squares
        .filter((s) => s.type === 'poi' || s.type === 'bar')
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [board.squares],
  );
  const accHead = (id: string, title: string) => (
    <button
      type="button"
      className={`acc-head${openSection === id ? ' acc-head--on' : ''}`}
      onClick={() => setOpenSection((s) => (s === id ? '' : id))}
    >
      <span>{title}</span>
      <span className="acc-caret">{openSection === id ? '▾' : '▸'}</span>
    </button>
  );

  // A player who hasn't joined gets a plain full page — the split
  // sidebar/map view made no sense before there's a game to look at.
  if (variant === 'player' && !membership) {
    return (
      <div className="site">
        <div className="site-card">
          <div className="site-hero">
            <h1>Join the game</h1>
            <p className="site-date">Enter the code your host gives you at the party.</p>
          </div>
          <div className="join-form">
            <label className="field">
              <span>Game code</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="GAME CODE"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </label>
            <label className="field">
              <span>Team name</span>
              <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Team name" />
            </label>
            <div className="field">
              <span>Team icon</span>
              <div className="icon-picker">
                {TEAM_ICONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    className={`icon-pick${joinEmoji === ic ? ' icon-pick--on' : ''}`}
                    onClick={() => setJoinEmoji(ic)}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <button className="site-btn site-btn--primary" onClick={doJoin} disabled={netBusy}>
              {netBusy ? '…' : 'Join game'}
            </button>
            <p className="hint">
              Playing as a group? Everyone can join on their own phone — enter the <b>same team name</b> to share one
              team.
            </p>
            <p className="hint">No code yet? The game goes live at the party — check back then.</p>
          </div>
        </div>
        <button className="site-admin-link" onClick={() => navigate('/')}>
          ← back
        </button>
      </div>
    );
  }

  return (
    <div
      className={`app${panelOpen ? '' : ' app--panel-collapsed'}${
        variant === 'player' || appMode === 'play' || appMode === 'online' ? ' app--game' : ''
      }${variant === 'player' ? ' app--player' : ''}`}
      style={variant === 'admin' ? ({ ['--sidebar-w' as string]: `${sidebarW}px` } as React.CSSProperties) : undefined}
    >
      <aside className="sidebar">
        <header className="brand">
          <h1>🎲 Birthday Board</h1>
          <p className="sub">Lower East Side · Milwaukee</p>
        </header>

        {variant === 'player' && appMode !== 'online' ? (
          <section className="panel">
            <h2>🎮 Join the game</h2>
            <p className="hint">Enter the code your host gives you at the party.</p>
            <label className="field">
              <span>Game code</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="GAME CODE"
              />
            </label>
            <label className="field">
              <span>Team name</span>
              <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Team name" />
            </label>
            <label className="field">
              <span>Team emoji</span>
              <input value={joinEmoji} onChange={(e) => setJoinEmoji(e.target.value)} maxLength={2} style={{ width: 72 }} />
            </label>
            <button className="btn btn--go" onClick={doJoin} disabled={netBusy}>
              {netBusy ? '…' : 'Join game'}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              No code yet? The game goes live at the party — check back then.
            </p>
            <p className="hint">
              Playing as a group? Everyone can join on their own phone — just enter the <b>same team name</b> to share
              one team.
            </p>
          </section>
        ) : appMode === 'play' ? (
          <section className="panel">
            <h2>▶ Play — desktop sim</h2>
            <p className="hint">Click a node to check in · grab 🎁 drops · claim ⭐ at bars.</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '10px 0 2px' }}>
              🪙 {play.coins} &nbsp;·&nbsp; ⭐ {play.stars}
            </p>
            <p className="hint">
              {play.cleared.length} / {spots.length} spots · 🎒 {play.items} items
            </p>
            {claim && (
              <p className="hint">
                Claiming ⭐ at <b>{claim.name}</b>… {claimLeft}s
              </p>
            )}
            {spawns.length > 0 && (
              <p className="hint">
                🎁 {spawns.length} drop{spawns.length > 1 ? 's' : ''} live — grab {spawns.length > 1 ? 'them' : 'it'}!
              </p>
            )}
            {play.last && <p className="hint" style={{ color: '#7c2d12', fontWeight: 600 }}>{play.last}</p>}
            <button className="btn btn--ghost" onClick={resetPlay}>
              Reset run
            </button>
            <button className="btn btn--ghost" onClick={() => setAppMode('design')}>
              ← Exit test play
            </button>
          </section>
        ) : appMode === 'online' ? (
          <section className="panel">
            <h2>🌐 Game {membership?.code}</h2>
            <p className="hint">
              Team <b>{myTeam?.name ?? membership?.teamName}</b>
              {onlineBoard ? '' : ' · loading board…'}
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0 2px' }}>
              🪙 {myTeam?.coins ?? 0} &nbsp;·&nbsp; ⭐ {myTeam?.stars ?? 0}
            </p>
            {onlineStatus === 'lobby' && (
              <p
                className="hint"
                style={{ background: '#16233d', borderRadius: 8, padding: '8px 10px', color: '#fde68a', margin: '6px 0' }}
              >
                ⏳ Waiting for the host to start the game…
              </p>
            )}
            {onlineStatus === 'paused' && (
              <p
                className="hint"
                style={{ background: '#3b1d1d', borderRadius: 8, padding: '8px 10px', color: '#fecaca', margin: '6px 0' }}
              >
                ⏸ Game paused by the host — check-ins are frozen.
              </p>
            )}
            <p className="hint">{onlineCleared.length} spots cleared</p>
            <p className="hint">
              🔗 Longest run: <b>{myRun}</b>
              {myRun > 0 && (
                <>
                  {' '}
                  — earning +{myRun} 🪙 every{' '}
                  {cfg.territoryTickSec(onlineConfig) >= 120
                    ? `${Math.round(cfg.territoryTickSec(onlineConfig) / 60)} min`
                    : `${cfg.territoryTickSec(onlineConfig)}s`}
                </>
              )}
            </p>
            <p className="hint">
              {cfg.gpsRequired(onlineConfig)
                ? `📍 GPS check-ins on — be within ${onlineConfig.radiusM}m of a spot`
                : '📍 GPS check-ins off (host setting) — desk-testing mode'}
            </p>
            <button className="btn" onClick={runGpsTest}>
              📍 Test my GPS
            </button>
            <p className="hint" style={{ opacity: 0.6, fontSize: '0.7rem' }}>build {__BUILD_SHA__}</p>
            {gpsTest && <p className="hint">{gpsTest}</p>}
            <p className="hint" style={{ marginTop: 8 }}>Scoreboard</p>
            <div style={{ maxHeight: 128, overflowY: 'auto' }}>
              {[...teams]
                .sort((a, b) => b.coins - a.coins)
                .map((t) => (
                  <div
                    key={t.id}
                    className="hint"
                    style={{ margin: '2px 0', fontWeight: t.id === membership?.teamId ? 700 : 400 }}
                  >
                    {t.emoji} {t.name} — 🪙 {t.coins} · ⭐ {t.stars}
                  </div>
                ))}
            </div>
            <button
              className="btn btn--ghost"
              onClick={() => (variant === 'player' ? leaveGame() : setAppMode('design'))}
            >
              {variant === 'player' ? 'Leave game' : 'Exit to design'}
            </button>
          </section>
        ) : (
        <>
        {accHead('setup', '🗺️ Board setup')}
        <div className="acc-body" hidden={openSection !== 'setup'}>
        <div className="stepper">
          {PHASES.map((s, i) => (
            <button
              key={s.key}
              className={`step ${phase === s.key ? 'step--on' : ''} ${i < curStep ? 'step--done' : ''}`}
              disabled={i > curStep}
              onClick={() => i <= curStep && goToPhase(s.key)}
              title={i > curStep ? 'Finish the current step first' : `Go to ${s.label}`}
            >
              <span className="step-n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1 · AREA */}
        {phase === 'area' && (
          <section className="panel">
            <h2>Step 1 · Draw the area</h2>
            <p className="hint">
              {mode === 'boundary'
                ? 'Click to add points · drag to move · right-click a point to delete.'
                : hasArea
                  ? `${board.boundary.length} points — drag to adjust, or snap to streets.`
                  : 'Outline where the game is played.'}
            </p>
            <div className="row">
              {mode === 'boundary' ? (
                <button className="btn" onClick={finishDrawing}>Done drawing</button>
              ) : (
                <button className="btn" onClick={drawArea}>{hasArea ? 'Add points' : 'Draw area'}</button>
              )}
              {hasArea && <button className="btn btn--ghost" onClick={clearArea}>Clear</button>}
            </div>
            {board.boundary.length >= 2 && (
              <div className="row">
                <button className="btn" onClick={tidyArea} title="Remove jitter / redundant points">Tidy up</button>
                <button className="btn" onClick={snapArea} disabled={snapping}>
                  {snapping ? 'Snapping…' : 'Snap to streets'}
                </button>
              </div>
            )}
            {selectedVertex !== null && (
              <button className="btn btn--danger" onClick={() => deleteVertex(selectedVertex)}>Delete selected point</button>
            )}
            {undoBoundary && <button className="btn btn--ghost" onClick={undoSnap}>Undo snap</button>}
            <button className="btn btn--go" disabled={!areaReady} onClick={() => goToPhase('frame')}>Lock area →</button>
          </section>
        )}

        {/* STEP 2 · FRAME */}
        {phase === 'frame' && (
          <section className="panel">
            <h2>Step 2 · Set the frame</h2>
            <p className="hint">This is how the board opens, and the farthest you can zoom out. Adjust the margin so it just surrounds the area.</p>
            <div className="row">
              <button className="btn" onClick={() => setPadding(-0.02)}>– Tighter</button>
              <button className="btn" onClick={() => setPadding(+0.02)}>Looser +</button>
            </div>
            <p className="hint">margin: {Math.round(board.padding * 100)}%</p>
            <div className="row">
              <button className="btn btn--ghost" onClick={() => goToPhase('area')}>← Area</button>
              <button className="btn btn--go" onClick={() => goToPhase('squares')}>Lock board →</button>
            </div>
          </section>
        )}

        {/* STEP 3 · generation (placement tools live in the Spaces section) */}
        {phase === 'squares' && (
            <section className="panel">
              <h2>Step 3 · Generate</h2>
              <button
                className="btn btn--go"
                onClick={generateFromStreets}
                disabled={generating || (board.locked && board.squares.length > 0)}
              >
                {generating
                  ? 'Reading streets…'
                  : board.locked && board.squares.length
                    ? '🔒 Layout locked'
                    : board.squares.length
                      ? '🧭 Redraw from streets'
                      : '🧭 Draw board from streets'}
              </button>
              {board.squares.length > 0 && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={board.locked}
                    onChange={(e) => setBoard((b) => ({ ...b, locked: e.target.checked }))}
                  />
                  🔒 Lock layout (protects your hand edits from a redraw)
                </label>
              )}
              <button className="btn" onClick={addSurroundings}>
                {board.artUnderlay ? '🎨 Remove surroundings' : '🎨 Add surroundings'}
              </button>
              <button className="btn" onClick={togglePaintedBoard}>
                {board.paintedBoard ? '🖼️ Painted board: ON' : '🖼️ Painted board: off'}
              </button>
              <button className="btn" onClick={() => void closeGaps()} disabled={closingGaps}>
                {closingGaps ? '🩹 Checking streets…' : '🩹 Close street gaps'}
              </button>
              <button className="btn" onClick={() => void labelStreets()} disabled={labelingStreets}>
                {labelingStreets
                  ? '🛣 Fetching names…'
                  : board.scenery?.streetLabels?.length
                    ? '🛣 Refresh street names'
                    : '🛣 Label the streets'}
              </button>
              <label className="field">
                <span>🖼️ Backdrop (sky, river & banner art)</span>
                <select
                  value={board.backdrop ?? ''}
                  onChange={(e) =>
                    setBoard((b) => ({ ...b, backdrop: (e.target.value || undefined) as Board['backdrop'] }))
                  }
                >
                  <option value="">Plain sky (drawn)</option>
                  <option value="frame">Frame — river & bridge, open center</option>
                  <option value="island">Island — shores all around</option>
                  <option value="cage">Cage — green board on blue</option>
                </select>
              </label>
              <p className="hint">
                Draws the track along the streets; “surroundings” paints the whole
                illustrated neighborhood — houses, real street trees, parks, and
                landmarks baked from real Milwaukee data.
              </p>
              <button className="btn btn--ghost" onClick={() => goToPhase('area')}>← Edit the area</button>
            </section>
        )}
        </div>

        {accHead('spaces', '🧩 Spaces')}
        <div className="acc-body" hidden={openSection !== 'spaces'}>
        {phase !== 'squares' ? (
          <p className="hint">Finish Board setup first — then place and type spaces here.</p>
        ) : (
            <section className="panel">
              <p className="hint">
                {mode === 'add'
                  ? `Click the map to place a ${SQUARE_TYPES[addType].label} — it opens for editing right away.`
                  : 'Click a spot to edit it (type, name, reward, trivia) · click a path to edit it.'}
              </p>
              <div className="palette">
                {PLACE_ORDER.map((t) => (
                  <button
                    key={t}
                    className={`chip ${mode === 'add' && addType === t ? 'chip--on' : ''}`}
                    style={{ ['--c' as string]: SQUARE_TYPES[t].color } as React.CSSProperties}
                    onClick={() => (mode === 'add' && addType === t ? setMode('select') : pickType(t))}
                  >
                    <span className="chip-emoji">{SQUARE_TYPES[t].emoji || '▦'}</span>
                    <span>{SQUARE_TYPES[t].label}</span>
                    <span className="chip-count">{counts[t] ?? 0}</span>
                  </button>
                ))}
              </div>
              {board.squares.some((s) => s.type !== 'blank') && (
                <button className="btn btn--danger" onClick={clearSpots}>
                  Clear all spots
                </button>
              )}
              <p className="hint">Tip: click a spot to select it, then “Delete space” to remove just that one.</p>
              <button
                className={`btn ${mode === 'connect' ? 'btn--go' : ''}`}
                onClick={() => {
                  setConnectFrom(null);
                  setMode(mode === 'connect' ? 'select' : 'connect');
                }}
                disabled={board.squares.length < 2}
              >
                {mode === 'connect' ? '✓ Done connecting' : '🔗 Connect spaces (fill in a street)'}
              </button>
              {mode === 'connect' && (
                <>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={connectStraight}
                      onChange={(e) => setConnectStraight(e.target.checked)}
                    />
                    Straight line (join the two ends directly)
                  </label>
                  <p className="hint">
                    {connecting
                      ? 'Drawing the street…'
                      : connectFrom
                        ? `Now click the second space — ${connectStraight ? 'a straight link is drawn to it.' : 'a street is drawn between them.'}`
                        : connectStraight
                          ? 'Click one end, then the other — they join in a straight line, ignoring the real roads.'
                          : 'Click one space, then another, to link them along the street.'}
                  </p>
                </>
              )}
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={board.enforceDirection}
                  onChange={(e) => setBoard((b) => ({ ...b, enforceDirection: e.target.checked }))}
                />
                Enforce one-way paths (order matters)
              </label>
              <p className="hint">{board.squares.length} spaces · {board.edges.length} paths</p>
            </section>
        )}
        </div>

        {accHead('pois', '📍 Points of interest')}
        <div className="acc-body" hidden={openSection !== 'pois'}>
          {phase !== 'squares' ? (
            <p className="hint">Finish Board setup first.</p>
          ) : (
            <section className="panel">
              <h2>Points of interest ({poiSquares.length})</h2>
              <p className="hint">
                The real places of the board. Each gets a <b>story</b> (the blurb players read) and a <b>play</b> (its
                encounter). Tap one to edit — changes ride the normal board save.
              </p>
              {rosterMissing.length > 0 && (
                <button className="btn" onClick={addRosterPois}>
                  📍 Add the real POIs ({rosterMissing.length} missing)
                </button>
              )}
              <div style={{ maxHeight: 430, overflowY: 'auto', margin: '4px -4px 0', padding: '0 4px' }}>
                {poiSquares.map((s) => {
                  const enc = s.poi?.encounter ?? (s.type === 'bar' ? 'star-bar' : 'landmark');
                  const em = ENC_META[enc] ?? ENC_META.landmark;
                  const isOpen = openPoiId === s.id;
                  const hasPlay = enc === 'h2h' || enc === 'challenge' || enc === 'boss';
                  return (
                    <div key={s.id} style={{ borderBottom: '1px solid rgba(63,59,54,0.15)', padding: '3px 0' }}>
                      <button
                        className="linkbtn"
                        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left' }}
                        onClick={() => {
                          setOpenPoiId(isOpen ? null : s.id);
                          setSelectedId(s.id);
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {em.emoji} <b>{s.title || '(untitled)'}</b>
                        </span>
                        <span style={{ flex: '0 0 auto', fontSize: '0.72rem', opacity: 0.75 }}>
                          {em.label}
                          {!s.poi?.blurb && ' · needs blurb'}
                          {isOpen ? ' ▾' : ' ▸'}
                        </span>
                      </button>
                      {isOpen && (
                        <div style={{ padding: '4px 2px 8px' }}>
                          <label className="field">
                            <span>Title</span>
                            <input value={s.title} onChange={(e) => updateSquare(s.id, { title: e.target.value })} />
                          </label>
                          <label className="field">
                            <span>Type — Bar joins the ⭐ star rotation</span>
                            <select
                              value={s.type}
                              onChange={(e) => updateSquare(s.id, { type: e.target.value as SquareType })}
                            >
                              <option value="poi">📍 Point of interest</option>
                              <option value="bar">🍺 Bar (star rotation)</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>Encounter</span>
                            <select value={enc} onChange={(e) => updatePoi(s, { encounter: e.target.value as PoiProps['encounter'] })}>
                              <option value="star-bar">⭐ Star bar (in the rotation)</option>
                              <option value="h2h">⚔️ Head-to-head vs another team</option>
                              <option value="challenge">🎯 Specific challenge to undertake</option>
                              <option value="boss">🔥 Boss / set-piece</option>
                              <option value="landmark">📍 Landmark (flavor only)</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>Blurb — what players read when they tap it</span>
                            <textarea
                              rows={2}
                              value={s.poi?.blurb ?? ''}
                              placeholder={'e.g. Milwaukee legend since 1908 — home of "I Closed Wolski’s."'}
                              onChange={(e) => updatePoi(s, { blurb: e.target.value || undefined })}
                            />
                          </label>
                          {hasPlay && (
                            <>
                              <label className="field">
                                <span>
                                  {enc === 'h2h' ? 'The head-to-head — rules of the showdown' : enc === 'boss' ? 'The gauntlet — what teams face here' : 'The task — what a team must do here'}
                                </span>
                                <textarea
                                  rows={3}
                                  value={s.poi?.task ?? ''}
                                  placeholder={
                                    enc === 'h2h'
                                      ? 'e.g. Both teams pick a champion: bags toss, closest to the board wins.'
                                      : 'e.g. Order a cannoli and get the counter staff to say "happy birthday Abby & Steven."'
                                  }
                                  onChange={(e) => updatePoi(s, { task: e.target.value || undefined })}
                                />
                              </label>
                              <p className="hint" style={{ marginTop: -4 }}>
                                🕶️ Blank = <b>black box</b> — the referee invents the game on site.
                              </p>
                              <label className="field">
                                <span>Reward for winning it (🪙)</span>
                                <input
                                  type="number"
                                  value={s.poi?.reward ?? 0}
                                  onChange={(e) => updatePoi(s, { reward: Number(e.target.value) || undefined })}
                                />
                              </label>
                            </>
                          )}
                          <label className="field">
                            <span>Art asset key (bespoke sprite, optional)</span>
                            <input
                              value={s.poi?.artRef ?? ''}
                              placeholder="e.g. hero_wolskis"
                              onChange={(e) => updatePoi(s, { artRef: e.target.value || undefined })}
                            />
                          </label>
                          <p className="hint" style={{ marginBottom: 0 }}>
                            📍 It's selected on the map — drag its pin to reposition.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {poiSquares.length === 0 && <p className="hint">None yet — add the roster above.</p>}
              </div>
            </section>
          )}
        </div>
        {accHead('bars', '🍺 Real bars')}
        <div className="acc-body" hidden={openSection !== 'bars'}>
        {phase !== 'squares' ? (
          <p className="hint">Finish Board setup first.</p>
        ) : realBars.length > 0 ? (
              <section className="panel">
                <h2>
                  Real bars ({realBars.filter((b) => placedBarNames.has(b.name)).length}/{realBars.length})
                </h2>
                <p className="hint">
                  Suggested from OSM. Add one to drop it as a bar spot — then drag, retype, or delete it on the board.
                </p>
                <div className="row">
                  <button className="btn" onClick={addAllBars}>
                    Add all
                  </button>
                </div>
                <div style={{ maxHeight: 190, overflowY: 'auto', margin: '4px -4px 0', padding: '0 4px' }}>
                  {realBars.map((bar, i) => {
                    const on = placedBarNames.has(bar.name);
                    return (
                      <div
                        key={i}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '3px 0' }}
                      >
                        <span
                          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                          title={bar.name}
                        >
                          🍺 {bar.name}
                        </span>
                        <button
                          className={`btn ${on ? 'btn--danger' : ''}`}
                          style={{ padding: '2px 10px', flex: '0 0 auto' }}
                          onClick={() => (on ? removeBarByName(bar.name) : addBar(bar.name, bar.lat, bar.lng))}
                        >
                          {on ? 'Remove' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section className="panel">
                <p className="hint">Run “Add surroundings” to pull real bars from OSM — they’ll show up here to add with one click.</p>
              </section>
            )}
        </div>

        {phase === 'squares' && selectedEdge && (
              <section className="panel">
                <h2>Edit path</h2>
                <p className="hint">
                  {nameOf(selectedEdge.from)} {selectedEdge.directed ? '→' : '↔'} {nameOf(selectedEdge.to)}
                </p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={selectedEdge.directed}
                    onChange={(e) => updateEdge(selectedEdge.id, { directed: e.target.checked })}
                  />
                  One-way (from → to)
                </label>
                <div className="row">
                  <button className="btn" onClick={() => flipEdge(selectedEdge.id)} disabled={!selectedEdge.directed}>
                    Flip direction
                  </button>
                  <button className="btn btn--danger" onClick={() => deleteEdge(selectedEdge.id)}>
                    Delete path
                  </button>
                </div>
                {(selectedEdge.path?.length ?? 0) > 2 && (
                  <button
                    className="btn"
                    onClick={() => updateEdge(selectedEdge.id, { path: undefined })}
                    title="Drop the traced street geometry — draw this street as a straight line"
                  >
                    📏 Straighten street
                  </button>
                )}
              </section>
            )}

        {phase === 'squares' && selected && (
              <section className="panel">
                <h2>Edit space</h2>
                <label className="field">
                  <span>Type</span>
                  <select
                    value={selected.type}
                    onChange={(e) => updateSquare(selected.id, { type: e.target.value as SquareType })}
                  >
                    {/* a retired type stays listed while a square still has
                        one, so it can be converted instead of stranded */}
                    {(TYPE_ORDER.includes(selected.type) ? TYPE_ORDER : [...TYPE_ORDER, selected.type]).map((t) => (
                      <option key={t} value={t}>
                        {SQUARE_TYPES[t].emoji} {SQUARE_TYPES[t].label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">{SQUARE_TYPES[selected.type].hint}</p>
                <label className="field">
                  <span>Title</span>
                  <input value={selected.title} onChange={(e) => updateSquare(selected.id, { title: e.target.value })} />
                </label>
                <label className="field">
                  <span>{selected.type === 'bowser' ? 'Penalty at stake (🪙)' : 'Reward (🪙 / magnitude)'}</span>
                  <input
                    type="number"
                    value={selected.reward}
                    onChange={(e) => updateSquare(selected.id, { reward: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>
                    {selected.type === 'challenge'
                      ? 'Notes / intro (shown above the questions)'
                      : selected.type === 'bowser'
                        ? 'Physical challenge (used if there are no questions below)'
                        : 'Notes / challenge details'}
                  </span>
                  <textarea
                    rows={3}
                    value={selected.notes}
                    onChange={(e) => updateSquare(selected.id, { notes: e.target.value })}
                    placeholder="e.g. Count the ducks on the mural. More found = more 🪙."
                  />
                </label>
                {(selected.type === 'bar' || selected.type === 'poi') &&
                  (() => {
                    const enc = selected.poi?.encounter ?? (selected.type === 'bar' ? 'star-bar' : 'landmark');
                    const hasPlay = enc === 'h2h' || enc === 'challenge' || enc === 'boss';
                    return (
                      <div className="quiz-editor">
                        <span className="quiz-editor-label">📍 Point of interest</span>
                        <p className="hint" style={{ marginTop: 2 }}>
                          What this place IS and what happens here. The ⭐ star rotation follows the square <b>Type</b> ("Bar") —
                          these fields add the story and the play.
                        </p>
                        <label className="field">
                          <span>Encounter</span>
                          <select value={enc} onChange={(e) => updatePoi(selected, { encounter: e.target.value as PoiProps['encounter'] })}>
                            <option value="star-bar">⭐ Star bar (in the rotation)</option>
                            <option value="h2h">⚔️ Head-to-head vs another team</option>
                            <option value="challenge">🎯 Specific challenge to undertake</option>
                            <option value="boss">🔥 Boss / set-piece</option>
                            <option value="landmark">📍 Landmark (flavor only)</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Blurb — what players read when they tap it</span>
                          <textarea
                            rows={2}
                            value={selected.poi?.blurb ?? ''}
                            placeholder={'e.g. Milwaukee legend since 1908 — home of "I Closed Wolski’s."'}
                            onChange={(e) => updatePoi(selected, { blurb: e.target.value || undefined })}
                          />
                        </label>
                        {hasPlay && (
                          <>
                            <label className="field">
                              <span>{enc === 'h2h' ? 'The head-to-head — rules of the showdown' : enc === 'boss' ? 'The gauntlet — what teams face here' : 'The task — what a team must do here'}</span>
                              <textarea
                                rows={3}
                                value={selected.poi?.task ?? ''}
                                placeholder={
                                  enc === 'h2h'
                                    ? 'e.g. Both teams pick a champion: bags toss, closest to the board wins.'
                                    : 'e.g. Order a cannoli and get the counter staff to say "happy birthday Abby & Steven."'
                                }
                                onChange={(e) => updatePoi(selected, { task: e.target.value || undefined })}
                              />
                            </label>
                            <p className="hint" style={{ marginTop: -4 }}>
                              🕶️ Leave it blank for a <b>black box</b>: the referee invents the game on site and just
                              reports the winner.
                            </p>
                            <label className="field">
                              <span>Reward for winning it (🪙)</span>
                              <input
                                type="number"
                                value={selected.poi?.reward ?? 0}
                                onChange={(e) => updatePoi(selected, { reward: Number(e.target.value) || undefined })}
                              />
                            </label>
                          </>
                        )}
                        <label className="field">
                          <span>Art asset key (bespoke sprite, optional)</span>
                          <input
                            value={selected.poi?.artRef ?? ''}
                            placeholder="e.g. hero_wolskis"
                            onChange={(e) => updatePoi(selected, { artRef: e.target.value || undefined })}
                          />
                        </label>
                      </div>
                    );
                  })()}
                {(selected.type === 'challenge' || selected.type === 'bowser') && (
                  <div className="quiz-editor">
                    <span className="quiz-editor-label">
                      {selected.type === 'bowser'
                        ? 'Trivia questions (optional — else physical)'
                        : 'Pinned questions (optional — this spot otherwise deals from the shared bank)'}
                    </span>
                    {(selected.questions ?? []).map((q, qi) => (
                      <div className="qedit" key={qi}>
                        <div className="qedit-head">
                          <strong>Q{qi + 1}</strong>
                          <button className="linkbtn" onClick={() => removeQuestion(selected, qi)}>
                            Remove
                          </button>
                        </div>
                        <input
                          className="qedit-q"
                          value={q.q}
                          placeholder="Question"
                          onChange={(e) => updateQuestion(selected, qi, { q: e.target.value })}
                        />
                        <div className="qedit-photo">
                          {q.image ? (
                            <>
                              <img src={q.image} alt="" className="qedit-photo-thumb" />
                              <button className="linkbtn" onClick={() => updateQuestion(selected, qi, { image: undefined })}>
                                Remove photo
                              </button>
                            </>
                          ) : (
                            <label className="linkbtn qedit-photo-add">
                              {photoUploading === qi ? 'Uploading…' : '📷 Add photo'}
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void uploadQuestionPhoto(selected, qi, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                        {q.choices.map((c, ci) => (
                          <div className="qedit-choice" key={ci}>
                            <input
                              type="radio"
                              name={`correct-${selected.id}-${qi}`}
                              checked={q.correct === ci}
                              onChange={() => updateQuestion(selected, qi, { correct: ci })}
                              title="Mark as the correct answer"
                            />
                            <input
                              value={c}
                              placeholder={`Choice ${ci + 1}`}
                              onChange={(e) => updateChoice(selected, qi, ci, e.target.value)}
                            />
                            {q.choices.length > 2 && (
                              <button
                                className="linkbtn"
                                title="Remove choice"
                                onClick={() => removeChoice(selected, qi, ci)}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        {q.choices.length < 4 && (
                          <button className="linkbtn" onClick={() => addChoice(selected, qi)}>
                            ＋ Add choice
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="btn" onClick={() => addQuestion(selected)}>
                      ＋ Add question
                    </button>
                    <p className="hint">Select the radio next to the correct answer. Players auto-score in Play.</p>
                  </div>
                )}
                {(selected.type === 'challenge' || selected.type === 'bowser') && bankRows.length > 0 && !(selected.questions?.length) && (
                  <div className="bank-pick">
                    <span className="quiz-editor-label">📚 Pick bank questions for this spot</span>
                    <p className="hint" style={{ marginTop: 2 }}>
                      {selected.type === 'bowser'
                        ? 'Checked = Bowser asks these. None checked = physical challenge (notes above).'
                        : 'Checked = dealt here (and pulled out of the random shuffle). None checked = random deal.'}
                    </p>
                    <div className="bank-pick-list">
                      {bankRows.map((q) => (
                        <label key={q.id} className="bank-pick-row">
                          <input
                            type="checkbox"
                            checked={(selected.questionIds ?? []).includes(q.id as string)}
                            onChange={(e) => {
                              const cur = selected.questionIds ?? [];
                              const next = e.target.checked ? [...cur, q.id as string] : cur.filter((x) => x !== q.id);
                              updateSquare(selected.id, { questionIds: next.length ? next : undefined });
                            }}
                          />
                          <span>{q.q || '(blank question)'}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {selected.type === 'chance' && deckRows.length > 0 && (
                  <div className="bank-pick">
                    <span className="quiz-editor-label">🃏 Limit which cards this spot draws</span>
                    <p className="hint" style={{ marginTop: 2 }}>
                      None checked = draws from the whole deck. Check cards to make this spot special.
                    </p>
                    <div className="bank-pick-list">
                      {deckRows.map((c) => (
                        <label key={c.id} className="bank-pick-row">
                          <input
                            type="checkbox"
                            checked={(selected.cardIds ?? []).includes(c.id)}
                            onChange={(e) => {
                              const cur = selected.cardIds ?? [];
                              const next = e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id);
                              updateSquare(selected.id, { cardIds: next.length ? next : undefined });
                            }}
                          />
                          <span>{c.text || '(blank card)'}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <p className="hint">📍 Drag the spot on the map to fine-tune where it sits — mid-block is fine for a bar.</p>
                <button className="btn btn--danger" onClick={() => removeSquare(selected.id)}>Delete space</button>
              </section>
            )}

        {accHead('layouts', '☁ Board layouts')}
        <div className="acc-body" hidden={openSection !== 'layouts'}>
        <section className="panel">
          {cloudStatus === 'needs-setup' ? (
            <p className="hint">
              Cloud sync needs a one-time setup — run <code>supabase/board_layouts.sql</code> in your
              Supabase SQL editor, then reload.
            </p>
          ) : cloudStatus === 'offline' ? (
            <p className="hint">Cloud sync is off (Supabase not configured). Boards save to this browser only.</p>
          ) : (
            <>
              {layouts.length > 0 ? (
                <label className="field">
                  <span>Editing (shared — changes sync live)</span>
                  <select
                    value={currentLayoutId ?? ''}
                    onChange={(e) => {
                      if (e.target.value) void openLayout(e.target.value);
                    }}
                  >
                    {!currentLayoutId && <option value="">— pick a layout —</option>}
                    {layouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="hint">No shared layouts yet — create one to start editing together.</p>
              )}
              <div className="row">
                <button className="btn" onClick={() => void newLayout(true)}>
                  ＋ Save board as new
                </button>
                <button className="btn btn--ghost" onClick={() => void newLayout(false)}>
                  Blank
                </button>
              </div>
              <div className="row">
                <button className="btn btn--ghost" onClick={() => void renameCurrentLayout()} disabled={!currentLayoutId}>
                  Rename
                </button>
                <button className="btn btn--ghost" onClick={() => void deleteCurrentLayout()} disabled={!currentLayoutId}>
                  Delete
                </button>
              </div>
              <div className="row">
                <button
                  className="btn btn--go"
                  onClick={() => void saveNow()}
                  disabled={!currentLayoutId || !dirty || cloudStatus === 'saving'}
                >
                  {cloudStatus === 'saving' ? '💾 Saving…' : dirty ? '💾 Save' : '💾 Saved'}
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => void revertToSaved()}
                  disabled={!currentLayoutId || !dirty}
                >
                  ↩ Revert
                </button>
              </div>
              <p className="hint">
                {cloudStatus === 'saving'
                  ? 'Saving…'
                  : cloudStatus === 'loading'
                    ? 'Loading…'
                    : cloudStatus === 'error'
                      ? '⚠ Save failed — press Save to try again.'
                      : !currentLayoutId
                        ? 'Pick or create a layout to save to.'
                        : dirty
                          ? '● Unsaved changes — Revert goes back to your last save.'
                          : 'Saved ✓ — this is your revert point.'}
              </p>
              {remoteNewer && (
                <div className="cloud-alert">
                  <span>✏️ A newer version was saved on another device.</span>
                  <button className="btn" onClick={() => currentLayoutId && void openLayout(currentLayoutId, true)}>
                    ↻ Load latest
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        </div>

        {accHead('file', '📁 Board file')}
        <div className="acc-body" hidden={openSection !== 'file'}>
        <section className="panel">
          <div className="row">
            <button className="btn" onClick={exportJson}>Export JSON</button>
            <button className="btn" onClick={() => jsonInputRef.current?.click()}>Import JSON</button>
          </div>
          <input
            ref={jsonInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }}
          />
          <button
            className="btn btn--ghost"
            onClick={() => {
              if (
                confirm(
                  currentLayoutId
                    ? 'Clear this layout? Area, spaces, and paths will be wiped for everyone (Duplicate first to keep a copy).'
                    : 'Reset the whole board? Area, spaces, and paths will be lost.',
                )
              ) {
                setBoard(defaultBoard());
                setSelectedId(null);
                setSelectedVertex(null);
                setSelectedEdgeId(null);
                setMode('select');
                bumpCage();
              }
            }}
          >
            Reset board
          </button>
          <p className="hint">{board.squares.length} spaces · Export a JSON backup anytime</p>
        </section>
        </div>

        {accHead('test', '▶ Test play')}
        <div className="acc-body" hidden={openSection !== 'test'}>
          <section className="panel">
            <p className="hint">Try the board solo as a desktop sim — check-ins, drops, chance, stars.</p>
            <button
              className="btn btn--go"
              disabled={!spots.length}
              title={spots.length ? 'Play the board' : 'Draw a board first'}
              onClick={() => {
                setMode('select');
                setAppMode('play');
              }}
            >
              ▶ Start test play
            </button>
          </section>
        </div>

        {accHead('host', '🎮 Host game')}
        <div className="acc-body" hidden={openSection !== 'host'}>
        <section className="panel">
          {!isConfigured ? (
            <p className="hint">
              Add your Supabase URL + anon key to <code>.env.local</code> (see <code>.env.example</code>), and run{' '}
              <code>supabase/schema.sql</code> in the SQL editor, to enable this.
            </p>
          ) : membership ? (
            <>
              <p className="hint">
                Joined game <b>{membership.code}</b> as <b>{membership.teamName}</b>.
              </p>
              <div style={{ maxHeight: 130, overflowY: 'auto', margin: '2px 0' }}>
                {teams.map((t) => (
                  <div key={t.id} className="hint" style={{ margin: '2px 0' }}>
                    {t.emoji} {t.name}
                    {t.id === membership.teamId ? ' — you' : ''}
                  </div>
                ))}
              </div>
              <button className="btn btn--go" onClick={() => setAppMode('online')}>
                ▶ Play online
              </button>
              <button className="btn btn--ghost" onClick={leaveGame}>
                Leave game
              </button>
            </>
          ) : hostGame ? (
            <>
              <p className="hint">Code — share for teams to join:</p>
              <p style={{ fontSize: '1.9rem', fontWeight: 800, letterSpacing: 5, textAlign: 'center', margin: '6px 0' }}>
                {hostGame.code}
              </p>
              {qrDataUrl && (
                <div style={{ textAlign: 'center', margin: '6px 0 10px' }}>
                  <img
                    src={qrDataUrl}
                    alt="Scan to join"
                    style={{ width: 180, height: 180, background: '#fff', borderRadius: 10, padding: 6 }}
                  />
                  <p className="hint" style={{ margin: '4px 0 0' }}>Scan to join — or share the link:</p>
                  <div className="row" style={{ marginTop: 4 }}>
                    <input readOnly value={joinUrl} style={{ flex: 1, fontSize: 11 }} onFocus={(e) => e.target.select()} />
                    <button className="btn" style={{ flex: 'none' }} onClick={() => navigator.clipboard?.writeText(joinUrl)}>
                      Copy
                    </button>
                  </div>
                </div>
              )}
              <p className="hint">
                Status: <b>{hostStatus}</b> · {teams.length} team{teams.length === 1 ? '' : 's'}
              </p>

              {hostStatus === 'lobby' && (
                <button className="btn btn--go" onClick={doStart} disabled={netBusy}>
                  {netBusy ? '…' : '▶ Start game'}
                </button>
              )}
              {(hostStatus === 'live' || hostStatus === 'paused') && (
                <>
                  <div className="row">
                    {hostStatus === 'live' ? (
                      <button className="btn" style={{ flex: 1 }} onClick={doPause} disabled={netBusy}>
                        ⏸ Pause
                      </button>
                    ) : (
                      <button className="btn btn--go" style={{ flex: 1 }} onClick={doResume} disabled={netBusy}>
                        ▶ Resume
                      </button>
                    )}
                    <button className="btn btn--danger" style={{ flex: 1 }} onClick={doEnd} disabled={netBusy}>
                      🏁 End
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 8 }}>💬 Messages (Party posts also banner)</p>
                  {hostThread == null ? (
                    <div className="msg-threads msg-threads--host">
                      {[...hostThreads.keys()].map((ch) => {
                        const rows = hostThreads.get(ch) ?? [];
                        const last = rows[rows.length - 1];
                        const unread = hostThreadUnread(ch);
                        const team = ch === 'all' ? null : teams.find((t) => t.id === ch.slice(5));
                        return (
                          <button key={ch} className="msg-thread" onClick={() => setHostThread(ch)}>
                            <span className="msg-thread__name">
                              {ch === 'all' ? '📣 Party' : `${team?.emoji ?? '🎲'} ${team?.name ?? 'team'}`}
                              {unread > 0 && <span className="msg-badge msg-badge--inline">{unread}</span>}
                            </span>
                            <span className="msg-thread__last">{last ? last.text : '—'}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <button className="btn btn--ghost" onClick={() => setHostThread(null)}>
                        ‹ All conversations
                      </button>
                      <div style={{ maxHeight: 150, overflowY: 'auto', margin: '4px 0' }}>
                        {(hostThreads.get(hostThread) ?? []).map((m) => (
                          <div key={m.id} className="hint" style={{ margin: '2px 0' }}>
                            <b>{m.from_team == null ? 'You' : msgName(m.from_team)}:</b> {m.text}
                          </div>
                        ))}
                        {(hostThreads.get(hostThread) ?? []).length === 0 && <div className="hint">No messages yet.</div>}
                      </div>
                      <div className="msg-compose-row">
                        <input
                          value={msgText}
                          onChange={(e) => setMsgText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void sendHostMsg()}
                          placeholder={hostThread === 'all' ? 'Announce to everyone…' : 'Message this team…'}
                          style={{ flex: 1 }}
                        />
                        <button className="msg-send" onClick={() => void sendHostMsg()} disabled={netBusy || !msgText.trim()} aria-label="Send">
                          ➤
                        </button>
                      </div>
                    </>
                  )}
                  <button className="btn" onClick={doDropSpawn} disabled={netBusy}>
                    🎁 Drop a bonus spawn now
                  </button>
                  <button className="btn" onClick={doDropStar} disabled={netBusy}>
                    ⭐ Land a star at a bar now
                  </button>
                  {/* Where the next one goes if nobody intervenes: the drop takes
                      the first bar with no star waiting and no claim running, so
                      it's readable off the board rather than a surprise. */}
                  <p className="hint" style={{ marginTop: 4 }}>
                    Next drop lands at <b>{nextStarBars(1)[0] ?? 'nowhere — every bar has one'}</b>
                    {nextStarBars(2)[1] ? <>, then <b>{nextStarBars(2)[1]}</b></> : null}
                  </p>

                  <p className="hint" style={{ marginTop: 8 }}>
                    📸 Party Cam — {cfg.drinkCoins(hostConfig)} 🪙 a drink, paid on post. Veto anything bogus.
                  </p>
                  <div className="cam-review">
                    {photos.length === 0 && <div className="hint">No photos yet.</div>}
                    {photos.map((p) => (
                      <div key={p.id} className={`cam-review__row${p.vetoed ? ' is-vetoed' : ''}`}>
                        <a href={p.url} target="_blank" rel="noreferrer">
                          <img src={p.url} alt={p.caption || 'party photo'} loading="lazy" />
                        </a>
                        <div className="cam-review__body">
                          <b>
                            {p.team_emoji} {p.team_name}
                          </b>
                          <span className="hint">
                            {p.drinks > 0
                              ? `🍻 ${p.drinks} · ${p.vetoed ? `−${p.coins} taken back` : `+${p.coins} 🪙`}`
                              : '📸 just a photo'}
                            {p.caption ? ` · ${p.caption}` : ''}
                          </span>
                        </div>
                        <div className="cam-review__acts">
                          {p.drinks > 0 && (
                            <button className="btn btn--ghost" onClick={() => void doVetoPhoto(p)}>
                              {p.vetoed ? '↩ Undo' : '🚫 Veto'}
                            </button>
                          )}
                          <button className="btn btn--danger" onClick={() => void doDeletePhoto(p)} aria-label="Delete">
                            🗑
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {hostStatus === 'ended' && <p className="hint">Game ended — final standings below.</p>}

              <p className="hint" style={{ marginTop: 6 }}>Standings — tap 🔧 to fix a team</p>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {[...teams]
                  .sort((a, b) => b.stars - a.stars || b.coins - a.coins)
                  .map((t) => (
                    <div key={t.id}>
                      <div className="hint" style={{ margin: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.emoji} {t.name} — 🪙 {t.coins} · ⭐ {t.stars}
                        </span>
                        <button className="fix-btn" onClick={() => void openFix(t.id)} title="Fix-it tools">
                          🔧
                        </button>
                      </div>
                      {fixTeamId === t.id && (
                        <div className="fix-panel">
                          <div className="row">
                            <button className="btn" onClick={() => void fixCoins(t.id, 10)}>🪙 +10</button>
                            <button className="btn" onClick={() => void fixCoins(t.id, -10)}>🪙 −10</button>
                            <button className="btn" onClick={() => void fixStars(t.id, 1)}>⭐ +1</button>
                            <button className="btn" onClick={() => void fixStars(t.id, -1)}>⭐ −1</button>
                          </div>
                          <div className="row">
                            <button className="btn btn--ghost" onClick={() => void fixCancelClaim(t.id)}>
                              Cancel star claim
                            </button>
                            <button className="btn btn--ghost" onClick={() => void fixReleaseSpaces(t.id)}>
                              Release turf
                            </button>
                          </div>
                          {fixClaims.length > 0 && (
                            <div className="row">
                              <select value={fixSpot} onChange={(e) => setFixSpot(e.target.value)} style={{ flex: 1 }}>
                                <option value="">— un-clear a spot —</option>
                                {fixClaims.map((sid) => (
                                  <option key={sid} value={sid}>
                                    {board.squares.find((s) => s.id === sid)?.title || sid.slice(0, 8)}
                                  </option>
                                ))}
                              </select>
                              <button className="btn" disabled={!fixSpot} onClick={() => void fixUnclear(t.id)}>
                                Un-clear
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              <p className="hint" style={{ marginTop: 6 }}>Activity</p>
              <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                {events.length === 0 ? (
                  <div className="hint">Nothing yet…</div>
                ) : (
                  events.map((e) => (
                    <div key={e.id} className="hint" style={{ margin: '2px 0' }}>
                      {e.payload?.text ?? e.type}
                    </div>
                  ))
                )}
              </div>

              <p className="hint" style={{ marginTop: 8 }}>⚙️ Settings {hostStatus === 'lobby' ? '(applied at start)' : '(Apply pushes to all phones)'}</p>
              {hostStatus === 'lobby' && (
                <div className="row">
                  <button className="btn" style={{ flex: 1 }} onClick={() => setHostConfig(PARTY_CONFIG)}>
                    Party preset
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setHostConfig(TEST_CONFIG)}>
                    Test (fast)
                  </button>
                </div>
              )}
              {cfgField('Star cost (🪙)', 'starCost')}
              {cfgField('Star meter (sec)', 'meterSec')}
              {cfgField('Spawn every ≥ (sec)', 'spawnMinSec')}
              {cfgField('Spawn every ≤ (sec)', 'spawnMaxSec')}
              {cfgField('Spawns total', 'spawnCount')}
              {cfgField('Drop lasts (sec)', 'spawnTtlSec')}
              {cfgField('Coins / check-in', 'coinReward')}
              {cfgField('GPS radius (m)', 'radiusM')}
              {cfgField('Star drop interval (s)', 'starIntervalSec')}
              <label
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '3px 0', fontSize: '0.82rem' }}
              >
                <span>📍 Require GPS presence</span>
                <input
                  type="checkbox"
                  checked={hostConfig.gpsRequired}
                  disabled={hostStatus === 'ended'}
                  onChange={(e) => setHostConfig((c) => ({ ...c, gpsRequired: e.target.checked }))}
                />
              </label>
              {cfgField('Rob amount (🪙)', 'robAmount')}
              {cfgField('Ambush stake (🪙)', 'ambushStake')}
              {cfgField('Ambush reward (🪙)', 'ambushReward')}
              {cfgField('Turf income tick (sec)', 'territoryTickSec')}
              {cfgField('Failed-steal lockout (sec)', 'stealLockSec')}
              {cfgField('🧱 fail forfeit (🪙)', 'reinforceForfeit')}
              {cfgField('Home-turf radius (m)', 'defendRadiusM')}
              {cfgField('Coins per drink (🍻)', 'drinkCoins')}
              {cfgField('Chain pay multiplier', 'chainMultiplier')}
              {cfgField('Steal bounty (🪙)', 'stealBounty')}
              {(hostStatus === 'live' || hostStatus === 'paused') && (
                <button className="btn" onClick={doApplyConfig} disabled={netBusy}>
                  ⚙️ Apply settings now
                </button>
              )}

              <button
                className="btn btn--ghost"
                onClick={() => {
                  saveHostGame(null);
                  setHostGame(null);
                }}
              >
                Close dashboard
              </button>
            </>
          ) : (
            <>
              <p className="hint">Organizer — publish this board so teams can join:</p>
              <button className="btn btn--go" onClick={doPublish} disabled={netBusy || !board.squares.length}>
                {netBusy ? 'Publishing…' : '📡 Publish game'}
              </button>
              {/* Or pick up one that's already running. The console lives in the
                  browser that published, and today that browser is a laptop. */}
              <p className="hint" style={{ marginTop: 10, marginBottom: 4 }}>
                Already published somewhere else? Take the controls here:
              </p>
              <div className="row">
                <input
                  value={takeoverCode}
                  onChange={(e) => setTakeoverCode(e.target.value.toUpperCase())}
                  placeholder="GAME CODE"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  style={{ flex: 'none' }}
                  disabled={netBusy || !takeoverCode.trim()}
                  onClick={() => void doTakeOverHosting()}
                >
                  🎛️ Host it
                </button>
              </div>

              <p className="hint" style={{ marginTop: 12 }}>Player — join with a code:</p>
              <input
                placeholder="GAME CODE"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #cfc7b5', borderRadius: 6, marginBottom: 5, boxSizing: 'border-box' }}
              />
              <input
                placeholder="Team name"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #cfc7b5', borderRadius: 6, marginBottom: 5, boxSizing: 'border-box' }}
              />
              <div className="row">
                <input
                  value={joinEmoji}
                  onChange={(e) => setJoinEmoji(e.target.value.slice(0, 2))}
                  style={{ width: 48, textAlign: 'center', padding: '6px', border: '1px solid #cfc7b5', borderRadius: 6 }}
                />
                <button className="btn" style={{ flex: 1 }} onClick={doJoin} disabled={netBusy}>
                  {netBusy ? '…' : 'Join'}
                </button>
              </div>
            </>
          )}
        </section>
        </div>
        </>
        )}
      </aside>

      {variant === 'admin' && (
        <div
          className="sidebar-resizer"
          title="Drag to resize the panel"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const x0 = e.clientX;
            const w0 = sidebarW;
            const onMove = (ev: PointerEvent) => setSidebarW(Math.max(300, Math.min(680, w0 + (ev.clientX - x0))));
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              setSidebarW((w) => {
                localStorage.setItem('mke-sidebar-w', String(w));
                return w;
              });
              // Leaflet + PanZoom re-fit on window resize; the panel drag
              // changes their container without one, so send the signal.
              window.dispatchEvent(new Event('resize'));
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
        />
      )}

      <main className="map-wrap">
        <button
          className="panel-toggle"
          onClick={() => setPanelOpen((o) => !o)}
          aria-label={panelOpen ? 'Hide the menu to expand the map' : 'Show the menu'}
        >
          {panelOpen ? '🗺️ Expand map' : '☰ Menu'}
        </button>
        {appMode === 'online' &&
          (() => {
            const latest = events.find((e) => e.type === 'announce');
            if (!latest || latest.id === dismissedAnnounceId) return null;
            return (
              <div className="announce-banner">
                <span>{latest.payload?.text ?? 'Announcement'}</span>
                <button onClick={() => setDismissedAnnounceId(latest.id)} aria-label="Dismiss">
                  ✕
                </button>
              </div>
            );
          })()}
        {appMode === 'online' && membership && (
          <button className="msg-fab" onClick={() => (msgOpen ? setMsgOpen(false) : openMsgPanel())}>
            💬{msgUnread > 0 && <span className="msg-badge">{msgUnread}</span>}
          </button>
        )}
        {standOpen && (
          <div className="msg-scrim msg-scrim--cam" onClick={() => setStandOpen(false)}>
            <div className="msg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                <span className="msg-head__pad" />
                <span>🏆 Standings</span>
                <button onClick={() => setStandOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="stand-list">
                {standings.map((t, i) => (
                  <div key={t.id} className={`stand-row${t.id === membership?.teamId ? ' is-me' : ''}`}>
                    <span className="stand-place">{i === 0 ? '🏆' : `${i + 1}.`}</span>
                    <span className="stand-name">
                      {t.emoji} {t.name}
                      {t.id === membership?.teamId && <em className="hud-you">you</em>}
                    </span>
                    <span className="stand-stats">
                      <b>⭐{t.stars}</b> <b>🪙{t.coins}</b> <b>🔗{allRuns[t.id] ?? 0}</b>
                    </span>
                  </div>
                ))}
                {standings.length === 0 && <p className="msg-empty">No teams have joined yet.</p>}
              </div>
              <p className="hint stand-key">⭐ stars · 🪙 coins · 🔗 longest chain of corners (pays out every tick)</p>
            </div>
          </div>
        )}
        {feedOpen && (
          <div className="msg-scrim msg-scrim--cam" onClick={() => setFeedOpen(false)}>
            <div className="msg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                <span className="msg-head__pad" />
                <span>📣 Activity</span>
                <button onClick={() => setFeedOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="feed-list">
                {feed.length === 0 && <p className="msg-empty">Nothing worth reporting yet.</p>}
                {feed.map((e) => (
                  <div key={e.id} className="feed-row">
                    <span className="feed-time">
                      {new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span>{e.payload?.text ?? e.type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {appMode === 'online' && membership && (
          <button
            className="cam-fab"
            onClick={() => (camOpen ? closeCam() : openCam('gallery'))}
            aria-label="Party Cam — the photo album and drink checks"
          >
            📸{photos.length > 0 && <span className="cam-count">{photos.length}</span>}
          </button>
        )}
        {gpsPopup && (
          <div className="wag-scrim wag-scrim--top" onClick={() => setGpsPopup(null)}>
            <div className="wag-pop">
              <div className="wag-head">{gpsPopup.title}</div>
              <div className="wag-body">
                <div className="wag-finger">{gpsPopup.emoji}</div>
                <p className="wag-text">{gpsPopup.body}</p>
              </div>
            </div>
          </div>
        )}
        {appMode === 'online' && myShowdown && !showdownOpen && (
          <button className="showdown-banner" onClick={() => setShowdownOpen(true)}>
            🪤 Ambush showdown — tap to report the result
          </button>
        )}
        {appMode === 'online' && membership && camOpen && (
          <div className="msg-scrim msg-scrim--cam" onClick={closeCam}>
            <div className="msg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                <span className="msg-head__pad" />
                <span>📸 Party Cam</span>
                <button onClick={closeCam} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="cam-tabs">
                <button className={camTab === 'gallery' ? 'is-on' : ''} onClick={() => setCamTab('gallery')}>
                  🖼️ Album
                </button>
                <button className={camTab === 'post' ? 'is-on' : ''} onClick={() => setCamTab('post')}>
                  ＋ Post
                </button>
              </div>
              {camNote && <p className="cam-note">{camNote}</p>}
              {camTab === 'gallery' ? (
                photos.length === 0 ? (
                  <p className="msg-empty">No pictures yet — tap ＋ Post and start the album.</p>
                ) : (
                  <div className="cam-grid">
                    {photos.map((p) => (
                      <button key={p.id} className="cam-cell" onClick={() => setLightbox(p)}>
                        <img src={p.url} alt={p.caption || 'party photo'} loading="lazy" />
                        <span className="cam-who">{p.team_emoji}</span>
                        {p.drinks > 0 && !p.vetoed && <span className="cam-tag">🍻{p.drinks}</span>}
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="cam-post">
                  <label className="cam-drop">
                    {camPreview ? (
                      <img src={camPreview} alt="Your photo" />
                    ) : (
                      <span>📷 Tap to take a photo — or pick one from your roll</span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => pickCamFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <input
                    className="cam-caption"
                    value={camCaption}
                    onChange={(e) => setCamCaption(e.target.value)}
                    placeholder="Say something…"
                    maxLength={140}
                  />
                  <div className="cam-drinks">
                    <span>🍻 Drinks in this shot</span>
                    <div className="cam-step">
                      <button onClick={() => setCamDrinks((n) => Math.max(0, n - 1))} aria-label="One fewer">
                        −
                      </button>
                      <b>{camDrinks}</b>
                      <button onClick={() => setCamDrinks((n) => Math.min(20, n + 1))} aria-label="One more">
                        ＋
                      </button>
                    </div>
                  </div>
                  <p className="hint">
                    {camDrinks > 0
                      ? `Pays ${camDrinks * drinkCoins} 🪙 the moment you post — any drink counts. Get them in the shot with you: a host can veto a photo that isn't what it claims.`
                      : 'Leave it at 0 for a plain photo. Holding drinks? Count them and get paid.'}
                  </p>
                  <button className="btn btn--go" disabled={!camFile || camBusy} onClick={() => void postPhoto()}>
                    {camBusy ? '…' : camDrinks > 0 ? `🍻 Post & claim ${camDrinks * drinkCoins} 🪙` : '📸 Post photo'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {myDuel && !duelOpen && (
          <button className="showdown-banner" onClick={() => setDuelOpen(true)}>
            ⚔️ Challenge running — tap to report who won
          </button>
        )}
        {myDuel && duelOpen && (() => {
          const ch = teams.find((t) => t.id === myDuel.challenger);
          const op = teams.find((t) => t.id === myDuel.opponent);
          // (both sides may now call a duel off, so who started it no longer matters)
          return (
            <div className="msg-scrim msg-scrim--cam">
              <div className="msg-panel duel-panel">
                <div className="msg-head">
                  <span className="msg-head__pad" />
                  <span>⚔️ Challenge</span>
                  <span className="msg-head__pad" />
                </div>
                <div className="duel-body">
                  <p className="duel-vs">
                    {ch?.emoji} {ch?.name} <em>vs</em> {op?.emoji} {op?.name}
                  </p>
                  <div className="duel-prompt">{myDuel.prompt}</div>
                  {duelByName(myDuel.prompt) && (
                    <p className="duel-rule">{duelByName(myDuel.prompt)!.rule}</p>
                  )}
                  {(() => {
                    const mat = duelMaterial(myDuel.id, myDuel.prompt);
                    if (!mat) return null;
                    return (
                      <div className="duel-material">
                        <div className="duel-material__label">{mat.label}</div>
                        <ol className="duel-material__list">
                          {mat.items.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ol>
                      </div>
                    );
                  })()}

                  {myDuel.stake > 0 && (
                    <p className="hint duel-stake">
                      {myDuel.stake} 🪙 on the line{myDuel.kind === 'camp' ? ' from the camp' : ''}.
                    </p>
                  )}
                  <p className="hint">
                    Play it right there, then either phone taps the winner. Both of you see the same thing.
                  </p>
                  <button className="btn btn--go" style={{ width: '100%' }} disabled={duelBusy} onClick={() => void doResolveDuel(myDuel, myDuel.challenger)}>
                    {ch?.emoji} {ch?.name} won
                  </button>
                  <button className="btn btn--go" style={{ width: '100%', marginTop: 8 }} disabled={duelBusy} onClick={() => void doResolveDuel(myDuel, myDuel.opponent)}>
                    {op?.emoji} {op?.name} won
                  </button>
                  <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setDuelOpen(false)}>
                    Not yet — hide this
                  </button>
                  <button
                    className="btn btn--ghost"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={() => void doCallOffDuel(myDuel.id)}
                  >
                    Call it off
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {questPhoto && myQuest?.kind === 'explorer' && (
          <div className="cam-light" onClick={() => setQuestPhoto(false)}>
            <div className="cam-light__inner" onClick={(e) => e.stopPropagation()}>
              <img src={`/art/explorer/${myQuest.target_spot}.jpg`} alt="Somewhere on the board" />
              <div className="cam-light__meta">Where is this? Check in there — and nowhere else.</div>
              <button className="btn btn--ghost" onClick={() => setQuestPhoto(false)}>
                Close
              </button>
            </div>
          </div>
        )}
        {questOffer && (

          <div className="msg-scrim msg-scrim--cam" onClick={() => setQuestOffer(null)}>
            <div className="msg-panel quest-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                <span className="msg-head__pad" />
                <span>🎯 Side quest</span>
                <span className="msg-head__pad" />
              </div>
              <div className="quest-body">
                <div className="quest-kind">{questKindFor(questOffer.spotId).toUpperCase()}</div>
                {questKindFor(questOffer.spotId) === 'tag' ? (
                  <>
                    <p className="quest-brief">
                      You'll be given a rival to hunt — find them on the map, shadow them, and check in
                      where they check in within{' '}
                      <b>{Math.round(cfg.tagWindowSec(onlineConfig) / 60)} minutes</b> of them.
                    </p>
                    <p className="hint">
                      Land it and you lift <b>{cfg.tagSteal(onlineConfig)} 🪙</b> off them. Let the clock
                      run out and they pocket <b>{cfg.tagEvade(onlineConfig)} 🪙</b> for losing you. They
                      are never told they're being followed.
                    </p>
                  </>
                ) : questKindFor(questOffer.spotId) === 'explorer' ? (
                  <>
                    <img
                      className="quest-photo"
                      src={`/art/explorer/${explorerTargetFrom(questOffer.spotId)?.id}.jpg`}
                      alt="Somewhere on the board"
                    />
                    <p className="quest-brief">
                      Somewhere on this board looks like that. Work out where, walk to it, and check in
                      — <b>and nowhere else on the way</b>.
                    </p>
                    <p className="hint">
                      <b>{cfg.explorerReward(onlineConfig)} 🪙</b> if you read it right, within{' '}
                      {Math.round(cfg.explorerSec(onlineConfig) / 60)} minutes. Check in anywhere else and
                      the job's off — you'll be walking past corners you'd normally take.
                    </p>
                  </>
                ) : questKindFor(questOffer.spotId) === 'recon' ? (

                  <>
                    <p className="quest-brief">
                      Hold this spot for <b>{Math.round(cfg.reconSec(onlineConfig) / 60)} minutes</b>.
                      Everyone will know you're here, and anyone who turns up can challenge you.
                    </p>
                    <p className="hint">
                      Beat them, or last it out unchallenged, and you'll learn where the next two stars
                      land. Lose and they take <b>{cfg.reconSteal(onlineConfig)} 🪙</b> off you.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="quest-brief">
                      Set a trap here and wait <b>{Math.round(cfg.ambushSec(onlineConfig) / 60)} minutes</b>.
                      The next team to check in walks straight into it — no warning, no way out.
                    </p>
                    <p className="hint">
                      Win the scrap and you take <b>{cfg.ambushTake(onlineConfig)} 🪙</b>. Lose and it
                      backfires for <b>{cfg.ambushBackfire(onlineConfig)} 🪙</b>. Nobody comes, nothing
                      happens.
                    </p>
                    <p className="hint" style={{ marginBottom: 4 }}>
                      <b>You pick the game</b> — you're the one lying in wait.
                    </p>
                    <div className="ambush-picks">
                      {AMBUSH_DUELS.map((d) => (
                        <button
                          key={d.key}
                          className={`ambush-pick${ambushPick === d.name ? ' is-on' : ''}`}
                          onClick={() => setAmbushPick(d.name)}
                          title={d.rule}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>

                  </>
                )}
                <p className="hint">
                  You keep playing as normal — you just can't take another job until this one's done.
                </p>
                <button
                  className="btn btn--go"
                  style={{ width: '100%' }}
                  disabled={questBusy}
                  onClick={() => void doAcceptQuest(questKindFor(questOffer.spotId), questOffer.spotId, questOffer.name)}
                >
                  Take the job
                </button>
                <button
                  className="btn btn--ghost"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => setQuestOffer(null)}
                >
                  Walk away
                </button>
              </div>
            </div>
          </div>
        )}
        {lightbox && (
          <div className="cam-light" onClick={() => setLightbox(null)}>
            <div className="cam-light__inner" onClick={(e) => e.stopPropagation()}>
              <img src={lightbox.url} alt={lightbox.caption || 'party photo'} />
              <div className="cam-light__meta">
                <b>
                  {lightbox.team_emoji} {lightbox.team_name}
                </b>
                {lightbox.drinks > 0 &&
                  (lightbox.vetoed ? (
                    <span className="cam-vetoed"> · 🚫 vetoed</span>
                  ) : (
                    <span> · 🍻 {lightbox.drinks} · +{lightbox.coins} 🪙</span>
                  ))}
                {lightbox.caption && <p>{lightbox.caption}</p>}
              </div>
              <button className="btn btn--ghost" onClick={() => setLightbox(null)}>
                Close
              </button>
            </div>
          </div>
        )}
        {appMode === 'online' && membership && msgOpen && (
          <div className="msg-scrim" onClick={() => setMsgOpen(false)}>
            <div className="msg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                {msgThread != null || msgPick ? (
                  <button onClick={() => { setMsgThread(null); setMsgPick(false); }} aria-label="Back">
                    ‹
                  </button>
                ) : (
                  <span className="msg-head__pad" />
                )}
                <span>{msgPick ? 'Message a team' : msgThread != null ? threadLabel(msgThread) : '💬 Messages'}</span>
                <button onClick={() => setMsgOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              {msgPick ? (
                // Start a team-to-team chat: pick who to talk to.
                <div className="msg-threads">
                  {teams
                    .filter((t) => t.id !== membership.teamId)
                    .map((t) => (
                      <button
                        key={t.id}
                        className="msg-thread"
                        onClick={() => { setMsgThread(chanDm(membership.teamId, t.id)); setMsgPick(false); }}
                      >
                        <span className="msg-thread__name">{t.emoji} {t.name}</span>
                        <span className="msg-thread__go">›</span>
                      </button>
                    ))}
                </div>
              ) : msgThread == null ? (
                // Thread list: Party + Hosts always; team DMs as they exist.
                <div className="msg-threads">
                  {[...myThreads.keys()]
                    .sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.startsWith('host:') ? -1 : b.startsWith('host:') ? 1 : 0))
                    .map((ch) => {
                      const rows = myThreads.get(ch) ?? [];
                      const last = rows[rows.length - 1];
                      const unread = threadUnread(ch);
                      return (
                        <button key={ch} className="msg-thread" onClick={() => setMsgThread(ch)}>
                          <span className="msg-thread__name">
                            {threadLabel(ch)}
                            {unread > 0 && <span className="msg-badge msg-badge--inline">{unread}</span>}
                          </span>
                          <span className="msg-thread__last">
                            {last
                              ? `${last.from_team === membership.teamId ? 'You: ' : ''}${last.text}`
                              : ch === 'all'
                                ? 'The whole party (hosts included)'
                                : 'Your private line to the hosts'}
                          </span>
                        </button>
                      );
                    })}
                  <button className="msg-thread msg-thread--new" onClick={() => setMsgPick(true)}>
                    <span className="msg-thread__name">＋ Message a team…</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="msg-list">
                    {(myThreads.get(msgThread) ?? []).length === 0 ? (
                      <p className="msg-empty">
                        {msgThread === 'all'
                          ? 'Nothing in the Party room yet — say hi!'
                          : msgThread.startsWith('host:')
                            ? 'Need a hand or a ruling? The hosts read this.'
                            : 'No messages yet. Propose an alliance — or talk trash.'}
                      </p>
                    ) : (
                      (myThreads.get(msgThread) ?? []).map((m) => {
                        const mine = m.from_team === membership.teamId;
                        return (
                          <div key={m.id} className={`msg-row ${mine ? 'msg-row--mine' : ''}`}>
                            {msgThread === 'all' && !mine && (
                              <div className="msg-meta">{m.from_team == null ? '🎩 Host' : msgName(m.from_team)}</div>
                            )}
                            <div className={`msg-bubble${m.from_team == null ? ' msg-bubble--host' : ''}`}>{m.text}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="msg-compose">
                    <div className="msg-compose-row">
                      <input
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void sendTeamMsg()}
                        placeholder={msgThread === 'all' ? 'Message the whole party…' : 'Type a message…'}
                      />
                      <button className="msg-send" disabled={!msgText.trim()} onClick={() => void sendTeamMsg()} aria-label="Send">
                        ➤
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <BoardCanvas
          board={appMode === 'online' && onlineBoard ? onlineBoard : board}
          mode={mode}
          selectedId={selectedId}
          selectedVertex={selectedVertex}
          selectedEdgeId={selectedEdgeId}
          recage={recage}
          onMapClick={onMapClick}
          onSelectSquare={selectSquare}
          onMoveSquare={moveSquare}
          onSelectVertex={setSelectedVertex}
          onMoveVertex={moveVertex}
          onDeleteVertex={deleteVertex}
          onSelectEdge={(id) => {
            setSelectedEdgeId(id);
            setSelectedId(null);
          }}
          playActive={appMode === 'play' || appMode === 'online'}
          cleared={appMode === 'online' ? onlineCleared : play.cleared}
          onCheckIn={appMode === 'online' ? openSpotSheet : checkIn}
          nodeType={appMode === 'play' ? nodeType : appMode === 'online' ? onlineNodeType : undefined}
          starBars={appMode === 'online' ? [] : play.starBars}
          starDrops={appMode === 'online' ? Object.keys(starAvailable).filter((id) => starAvailable[id] > 0) : undefined}
          spawns={appMode === 'online' ? activeSpawns : appMode === 'play' ? spawns : []}
          onClaimSpawn={appMode === 'online' ? onlineClaimSpawn : claimSpawn}
          starClaims={
            appMode === 'online'
              ? onlineStarClaims
              : claim
                ? [
                    {
                      barSpotId: claim.barId,
                      pct: Math.min(1, Math.max(0, (CLAIM_MS / 1000 - claimLeft) / (CLAIM_MS / 1000))),
                      mine: true,
                      color: '#f0c33c',
                      secs: Math.max(0, Math.ceil(claimLeft)),
                    },
                  ]
                : []
          }
          tokens={appMode === 'online' ? tokens : undefined}
          flat={variant === 'player' && !classicMap}
          turf={appMode === 'online' ? turfPaint : undefined}
          runEdges={appMode === 'online' ? runEdges : undefined}
          campGlow={appMode === 'online' ? campGlow : undefined}
        />
        {((phase === 'area' && mode === 'boundary') || (phase === 'squares' && mode === 'add')) && (
          <div className="add-banner">
            {mode === 'boundary' ? (
              <>Click to outline the play area · right-click a point to delete</>
            ) : (
              <>Placing <b>{SQUARE_TYPES[addType].label}</b> — click the map</>
            )}
            <button onClick={() => setMode('select')}>done</button>
          </div>
        )}

        {modal &&
          (() => {
            // 'quest' only ever comes out of the online pool; offline can't
            // land on one, and the palette has no entry for it.
            const meta = SQUARE_TYPES[modal.type === 'quest' ? 'coin' : modal.type];
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  animation: 'scrim-in 0.15s ease-out',
                }}
                onClick={closeModal}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      background: meta.color,
                      color: '#fff',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>{meta.emoji}</span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: '1.05rem',
                          textShadow: '0 1px 2px rgba(0,0,0,0.25)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {modal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                        {meta.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {rolling ? (
                      <div className="die">{dieFace}</div>
                    ) : rollResult ? (
                      <>
                        <p
                          style={{
                            fontSize: '1.35rem',
                            fontWeight: 800,
                            textAlign: 'center',
                            margin: '10px 0 18px',
                            animation: 'result-pop 0.4s ease-out',
                          }}
                        >
                          {rollResult}
                        </p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={closeModal}>
                          Continue
                        </button>
                      </>
                    ) : modal.type === 'challenge' ? (
                      (() => {
                        const sq = board.squares.find((s) => s.id === modal.id);
                        const qs = sq?.questions ?? [];
                        if (!sq || qs.length === 0) {
                          return (
                            <>
                              <p className="hint" style={{ marginTop: 0 }}>
                                {spotNotes(modal.id) || 'Answer the trivia / do the dare, then rate how it went.'}
                              </p>
                              <div className="row">
                                <button className="btn btn--go" style={{ flex: 1 }} onClick={() => resolveChallenge(modal.id, true)}>
                                  Nailed it
                                </button>
                                <button className="btn" style={{ flex: 1 }} onClick={() => resolveChallenge(modal.id, false)}>
                                  Meh
                                </button>
                              </div>
                            </>
                          );
                        }
                        const answeredAll = qs.every((_, i) => quizPick[i] != null);
                        const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
                        return (
                          <>
                            {sq.notes && (
                              <p className="hint" style={{ marginTop: 0 }}>
                                {sq.notes}
                              </p>
                            )}
                            {qs.map((q, qi) => (
                              <div className="quiz-q" key={qi}>
                                <div className="quiz-qtext">
                                  {qi + 1}. {q.q || '(question)'}
                                </div>
                                {q.image && <img src={q.image} alt="" className="quiz-photo" />}
                                {q.choices.map((c, ci) => {
                                  const picked = quizPick[qi] === ci;
                                  const isRight = q.correct === ci;
                                  let cls = 'quiz-choice';
                                  if (quizDone) {
                                    if (isRight) cls += ' quiz-choice--correct';
                                    else if (picked) cls += ' quiz-choice--wrong';
                                  } else if (picked) cls += ' quiz-choice--picked';
                                  return (
                                    <button
                                      key={ci}
                                      className={cls}
                                      disabled={quizDone}
                                      onClick={() => setQuizPick((p) => ({ ...p, [qi]: ci }))}
                                    >
                                      <span>{c || `Choice ${ci + 1}`}</span>
                                      {quizDone && isRight && <span className="quiz-mark">✓</span>}
                                      {quizDone && picked && !isRight && <span className="quiz-mark">✗</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                            {!quizDone ? (
                              <button
                                className="btn btn--go"
                                style={{ width: '100%' }}
                                disabled={!answeredAll}
                                onClick={() => resolveQuiz(sq)}
                              >
                                Submit answers
                              </button>
                            ) : (
                              <>
                                <p className="quiz-score">
                                  {correct} / {qs.length} correct
                                </p>
                                <button className="btn btn--go" style={{ width: '100%' }} onClick={closeModal}>
                                  Continue
                                </button>
                              </>
                            )}
                          </>
                        );
                      })()
                    ) : modal.type === 'bowser' ? (
                      (() => {
                        const sq = board.squares.find((s) => s.id === modal.id);
                        const qs = sq?.questions ?? [];
                        const answeredAll = qs.every((_, i) => quizPick[i] != null);
                        if (!sq) return null;
                        if (quizDone) {
                          return (
                            <>
                              <p style={{ fontSize: '1.2rem', fontWeight: 800, textAlign: 'center', margin: '8px 0 16px' }}>
                                {bowserLoss ? `You lost ${bowserLoss} 🪙!` : 'Escaped! 0 🪙 lost.'}
                              </p>
                              <button className="btn btn--go" style={{ width: '100%' }} onClick={closeModal}>
                                Continue
                              </button>
                            </>
                          );
                        }
                        if (qs.length > 0) {
                          return (
                            <>
                              <p className="hint" style={{ marginTop: 0 }}>Answer to escape — every wrong answer costs coins.</p>
                              {qs.map((q, qi) => (
                                <div className="quiz-q" key={qi}>
                                  <div className="quiz-qtext">
                                    {qi + 1}. {q.q}
                                  </div>
                                  {q.image && <img src={q.image} alt="" className="quiz-photo" />}
                                  {q.choices.map((c, ci) => (
                                    <button
                                      key={ci}
                                      className={`quiz-choice ${quizPick[qi] === ci ? 'quiz-choice--picked' : ''}`}
                                      onClick={() => setQuizPick((p) => ({ ...p, [qi]: ci }))}
                                    >
                                      <span>{c}</span>
                                    </button>
                                  ))}
                                </div>
                              ))}
                              <button className="btn btn--go" style={{ width: '100%' }} disabled={!answeredAll} onClick={() => resolveBowserPlay(sq)}>
                                Submit answers
                              </button>
                            </>
                          );
                        }
                        return (
                          <>
                            <p className="hint" style={{ marginTop: 0 }}>{sq.notes || 'Do the challenge, then report how it went.'}</p>
                            <button className="btn btn--go" style={{ width: '100%' }} onClick={() => resolveBowserPlay(sq, 'nailed')}>
                              Nailed it (lose 0)
                            </button>
                            <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => resolveBowserPlay(sq, 'struggled')}>
                              Struggled (lose half)
                            </button>
                            <button className="btn btn--danger" style={{ width: '100%', marginTop: 6 }} onClick={() => resolveBowserPlay(sq, 'failed')}>
                              Failed (lose it all)
                            </button>
                          </>
                        );
                      })()
                    ) : modal.type === 'chance' ? (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>Roll your luck — 🪙, an item, nothing, or a mugging.</p>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%', fontSize: '1.05rem' }}
                          onClick={() => rollChance(modal.id)}
                        >
                          🎲 Roll the dice
                        </button>
                      </>
                    ) : modal.type === 'bar' ? (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          Buy a round to claim a ⭐ (cost {STAR_COST} 🪙). The meter runs while you're contestable.
                        </p>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%' }}
                          disabled={play.coins < STAR_COST || !!claim}
                          onClick={() => buyRound(modal.id, modal.name)}
                        >
                          Buy a round ({STAR_COST} 🪙)
                        </button>
                      </>
                    ) : null}
                    {!rollResult && !rolling && (
                      <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={closeModal}>
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        {myCornerModal &&
          (() => {
            const myColor = membership ? teamColorOf(teams, membership.teamId) : '#2fa05a';
            const fortified = reinforcedSet.has(myCornerModal.spotId);
            const charges = myTeam?.reinforcements ?? 0;
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => !cornerBusy && setMyCornerModal(null)}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: myColor, color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>{fortified ? '🧱' : '🏴'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {myCornerModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                        Your corner{fortified ? ' · reinforced' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {fortified ? (
                      <p className="hint" style={{ marginTop: 0 }}>
                        🧱 Fortified — a thief here faces a 2-question gauntlet and forfeits{' '}
                        {cfg.reinforceForfeit(onlineConfig)} 🪙 to you if they miss.
                      </p>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          Your paint holds this corner in your run. Anyone can take it off you by
                          answering a question here — keep an eye on it.
                        </p>
                      </>
                    )}
                    <button
                      className="btn"
                      style={{ width: '100%', marginTop: 8 }}
                      onClick={() => {
                        const spotId = myCornerModal.spotId;
                        const sq = onlineBoard?.squares.find((s) => s.id === spotId);
                        setMyCornerModal(null);
                        if (sq) openArmOnCleared(spotId, sq);
                      }}
                    >
                      🪤 Set a trap here
                    </button>
                    <button className="btn btn--ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setMyCornerModal(null)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        {stealModal &&
          (() => {
            const defName = teams.find((t) => t.id === stealModal.defenderId)?.name ?? 'a rival';
            const defColor = teamColorOf(teams, stealModal.defenderId);
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => !stealBusy && setStealModal(null)}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: defColor, color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>🏴</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stealModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                        {defName}'s corner
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {stealResult === 'won' ? (
                      <>
                        <p className="chance-card-text" style={{ fontSize: '1.15rem', fontWeight: 800, textAlign: 'center', margin: '8px 0 14px' }}>
                          🏴 Corner stolen! It's painted your color — {defName}'s run just took the hit.
                        </p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={() => setStealModal(null)}>
                          Nice
                        </button>
                      </>
                    ) : stealResult === 'lost' ? (
                      <>
                        <p className="chance-card-text" style={{ fontSize: '1.15rem', fontWeight: 800, textAlign: 'center', margin: '8px 0 14px' }}>
                          🛡 Blew it! {defName} holds the corner — you can't hit them again for{' '}
                          {Math.ceil(cfg.stealLockSec(onlineConfig) / 60)} min
                          {stealForfeited > 0 && (
                            <>
                              {' '}
                              — and the 🧱 wall cost you <b>{stealForfeited} 🪙</b>, paid to {defName}
                            </>
                          )}
                          .
                        </p>
                        <button className="btn" style={{ width: '100%' }} onClick={() => setStealModal(null)}>
                          Walk it off
                        </button>
                      </>
                    ) : stealResult === 'gone' ? (
                      <>
                        <p className="chance-card-text" style={{ fontWeight: 800, textAlign: 'center', margin: '8px 0 14px' }}>
                          🤔 This corner just changed hands — someone beat you to it.
                        </p>
                        <button className="btn" style={{ width: '100%' }} onClick={() => setStealModal(null)}>
                          Close
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          Steal this corner from <b>{defName}</b> — answer{' '}
                          {stealModal.questions.length > 1 ? <b>all {stealModal.questions.length} right</b> : 'right'} to
                          flip it. Miss, and you're locked out of hitting them for{' '}
                          {Math.ceil(cfg.stealLockSec(onlineConfig) / 60)} min.
                        </p>
                        {stealModal.defenderNear && (
                          <p className="hint" style={{ background: '#3b1d1d', color: '#fecaca', borderRadius: 8, padding: '7px 10px' }}>
                            ⚔️ <b>{defName} is right there</b> — home-turf defense makes this play harder.
                          </p>
                        )}
                        {stealModal.questions.map((sq2, qi) => (
                          <div key={qi} style={{ marginTop: qi ? 12 : 4 }}>
                            <div className="quiz-q" style={{ fontWeight: 700, margin: '6px 0' }}>
                              {stealModal.questions.length > 1 ? `${qi + 1}. ` : ''}
                              {sq2.q}
                            </div>
                            {sq2.image && <img src={sq2.image} alt="" className="quiz-photo" />}
                            {sq2.choices.map((c, ci) => (
                              <button
                                key={ci}
                                className={`quiz-choice ${stealPicks[qi] === ci ? 'quiz-choice--picked' : ''}`}
                                onClick={() => setStealPicks((p) => ({ ...p, [qi]: ci }))}
                              >
                                <span>{c}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                        <button
                          className="btn btn--go"
                          style={{ width: '100%', marginTop: 8 }}
                          disabled={stealBusy || stealModal.questions.some((_, i) => stealPicks[i] == null)}
                          onClick={resolveSteal}
                        >
                          {stealBusy ? '…' : 'Make the play'}
                        </button>
                        <button className="btn btn--ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setStealModal(null)}>
                          Back away
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        {spotSheet &&
          membership &&
          onlineBoard &&
          (() => {
            const spotId = spotSheet.spotId;
            const sq = onlineBoard.squares.find((s) => s.id === spotId);
            if (!sq) return null;
            // start/finish/poi are waypoint types on the square itself; play
            // types come from the resolved node map.
            const type: string =
              sq.type === 'start' || sq.type === 'finish' || sq.type === 'poi' ? sq.type : (onlineNodeType[spotId] ?? 'coin');
            const meta =
              type === 'bar'
                ? { emoji: '🍺', label: 'Star hub', color: '#f97316', blurb: `Buy a round here (${onlineConfig.starCost} 🪙) to claim a ⭐ for your team.` }
                : type === 'poi'
                  ? sq.poi?.encounter === 'h2h'
                    ? { emoji: '⚔️', label: 'Head-to-head', color: '#e0533a', blurb: 'Challenge another team to a showdown here.' }
                    : sq.poi?.encounter === 'challenge'
                      ? { emoji: '🎯', label: 'Challenge site', color: '#2f7fe0', blurb: 'A specific task to take on at this spot.' }
                      : sq.poi?.encounter === 'boss'
                        ? { emoji: '🔥', label: 'Boss', color: '#dc2626', blurb: 'A set-piece showdown.' }
                        : { emoji: '📍', label: 'Point of interest', color: '#e05fa0', blurb: 'A neighborhood landmark.' }
                : type === 'chance'
                  ? { emoji: '🎲', label: 'Chance', color: '#9a5fe0', blurb: 'Draw a card — anything can happen.' }
                  : type === 'challenge'
                    ? { emoji: '🧠', label: 'Challenge', color: '#2f7fe0', blurb: 'Answer trivia to earn coins.' }
                    : type === 'bowser'
                      ? { emoji: '🔥', label: 'Bowser', color: '#dc2626', blurb: 'A forced gauntlet — beat the challenge or lose coins.' }
                      : type === 'start'
                        ? { emoji: '🚩', label: 'Start', color: '#2fa05a', blurb: 'Where it all begins.' }
                        : type === 'finish'
                          ? { emoji: '🏁', label: 'Finish', color: '#2fa05a', blurb: 'The finish line.' }
                          : { emoji: '🪙', label: 'Corner', color: '#b98a2f', blurb: 'Check in to collect coins and paint this corner your color.' };
            const owner = territoryMap[spotId] && turfIds.has(spotId) ? territoryMap[spotId] : null;
            const ownerTeam = owner ? teams.find((t) => t.id === owner) : null;
            const ownerMine = owner === membership.teamId;
            const reinforced = owner ? reinforcedSet.has(spotId) : false;
            const claim = type === 'bar' ? starClaimRows.find((c) => c.bar_spot_id === spotId && c.status !== 'lost') : undefined;
            const claimTeam = claim ? teams.find((t) => t.id === claim.team_id) : null;
            const claimMine = claim?.team_id === membership.teamId;
            const claimSecs = claim?.status === 'claiming' ? Math.max(0, Math.ceil((Date.parse(claim.ends_at) - nowTs) / 1000)) : 0;
            const cleared = onlineCleared.includes(spotId);
            const live = onlineStatus === 'live';
            // Nomad is on the map from the first minute on purpose — you can
            // see where the night ends, you just can't go cash in there yet.
            // Tapping it has to say so, or an visible-but-dead marker reads as
            // a bug rather than as the finish line.
            const isNomad = sq.poi?.artRef === 'nomad' || /nomad/i.test(sq.title ?? '');
            const nomadLocked = isNomad && !lastCallOpen;
            const gated = cfg.gpsRequired(onlineConfig);
            const actionLabel =
              type === 'bar'
                ? claim && claim.status === 'claiming' && !claimMine
                  ? "⚔️ I'm here — contest it"
                  : "🍺 I'm here — open the bar"
                : owner && !ownerMine
                  ? "⚔️ I'm here — make the steal"
                  : owner && ownerMine
                    ? "🧱 I'm here — corner options"
                    : type === 'chance'
                      ? "🎲 I'm here — draw a card"
                      : type === 'challenge'
                        ? "🧠 I'm here — take it on"
                        : type === 'bowser'
                          ? "🔥 I'm here — face Bowser"
                          : "✅ I'm here — check in";
            const goHere = () => {
              setSheetGps({ checking: true });
              withProximity(
                sq,
                () => {
                  setSpotSheet(null);
                  setSheetGps(null);
                  runSpotAction(spotId);
                },
                { fail: (msg) => setSheetGps({ msg }) },
              );
            };
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => setSpotSheet(null)}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: meta.color, color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>{meta.emoji}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sq.title || meta.label}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>{meta.label}</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    <p className="hint" style={{ marginTop: 0 }}>{sq.poi?.blurb || meta.blurb}</p>
                    {nomadLocked && (
                      <p className="hint" style={{ fontWeight: 700, color: '#b45309' }}>
                        🔒 There's nothing here until last call.
                      </p>
                    )}
                    {sq.poi && (sq.poi.encounter === 'h2h' || sq.poi.encounter === 'challenge' || sq.poi.encounter === 'boss') && (
                      sq.poi.task ? (
                        <p className="hint">
                          🎯 <b>The play here:</b> {sq.poi.task}
                          {sq.poi.reward ? ` (+${sq.poi.reward} 🪙)` : ''}
                        </p>
                      ) : (
                        <p className="hint">
                          🕶️ <b>The game here is a secret</b> — the referee reveals it when you show up.
                          {sq.poi.reward ? ` (+${sq.poi.reward} 🪙)` : ''}
                        </p>
                      )
                    )}
                    {ownerTeam && (
                      <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 4,
                            background: teamColorOf(teams, ownerTeam.id),
                            border: '1.5px solid #3f3b36',
                            flex: '0 0 auto',
                          }}
                        />
                        <span>
                          Held by <b>{ownerTeam.name}</b>
                          {ownerMine ? ' — that’s you!' : ''}
                          {reinforced ? ' · 🧱 reinforced' : ''}
                        </span>
                      </p>
                    )}
                    {claim &&
                      (claim.status === 'locked' ? (
                        <p className="hint">
                          ⭐ Star claimed by <b>{claimTeam?.name ?? 'another team'}</b> — locked in.
                        </p>
                      ) : (
                        <p className="hint">
                          ⭐ <b>{claimTeam?.name ?? 'A team'}</b> is buying a star — that ring is their meter, <b>{claimSecs}s</b> left.
                          {claimMine ? ' Hold on!' : ' Get there and contest it before it locks!'}
                        </p>
                      ))}
                    {type === 'bar' &&
                      !claim &&
                      ((starAvailable[spotId] ?? 0) > 0 ? (
                        <p className="hint">
                          ⭐ <b>A star is sitting here, unclaimed</b> — first team to buy a round starts claiming it!
                        </p>
                      ) : (
                        <p className="hint">😴 No star here right now — stars land at bars as the game goes on.</p>
                      ))}
                    {cleared && !owner && <p className="hint">✅ Already cleared this game.</p>}
                    {sheetGps?.checking && <p className="hint">📡 Checking your location…</p>}
                    {sheetGps?.msg && <p className="hint" style={{ color: '#b45309', fontWeight: 600 }}>☝️ {sheetGps.msg}</p>}
                    {nomadLocked ? (
                      <button className="btn btn--go" style={{ width: '100%' }} disabled>
                        🔒 There's nothing here until last call
                      </button>
                    ) : live ? (
                      <button className="btn btn--go" style={{ width: '100%' }} disabled={!!sheetGps?.checking} onClick={goHere}>
                        {actionLabel}
                      </button>
                    ) : (
                      <button className="btn btn--go" style={{ width: '100%' }} disabled>
                        Game hasn't started yet
                      </button>
                    )}
                    {gated && live && !nomadLocked && (
                      <p className="hint" style={{ marginBottom: 0, fontSize: '0.72rem', opacity: 0.75 }}>
                        📍 Checks your GPS — you need to be within {onlineConfig.radiusM}m.
                      </p>
                    )}
                    {/* Camping: the slow game. Sit still, coins pile up faster
                        the longer you stay, and you carry them out by checking
                        in somewhere else. Anyone who finds you can take half. */}
                    {/* Someone is holding this spot for a recon job. You can let
                        them have it, or take them on — beat them and you lift
                        coins, and they lose the intel they were waiting for. */}
                    {live && !nomadLocked && (() => {
                      const q = questHere(spotId);
                      if (!q || q.kind !== 'recon') return null;
                      const holder = teams.find((t) => t.id === q.team_id);
                      return (
                        <div className="camp-call">
                          <b>
                            🔭 {holder?.emoji} {holder?.name} is holding this spot
                          </b>
                          <span className="hint">
                            Challenge them and the winner takes {cfg.reconSteal(onlineConfig)} 🪙
                          </span>
                          <button
                            className="btn btn--danger"
                            style={{ width: '100%' }}
                            disabled={questBusy || !membership}
                            onClick={() =>
                              void startDuel({
                                gameId: membership!.gameId,
                                challenger: membership!.teamId,
                                opponent: q.team_id,
                                kind: 'quest',
                                prompt: pickRound(),
                                stake: cfg.reconSteal(onlineConfig),
                                spotId,
                              }).then(() => setSpotSheet(null))
                            }
                          >
                            ⚔️ Challenge the watch
                          </button>
                        </div>
                      );
                    })()}
                    {live && !nomadLocked && (type === 'bar' || type === 'poi') && (() => {
                      const here = campBySpot[spotId];
                      if (here && here.team_id !== membership.teamId) {
                        const camper = teams.find((t) => t.id === here.team_id);
                        const stake = Math.floor((here.banked * cfg.campRaidPct(onlineConfig)) / 100);
                        return (
                          <div className="camp-call">
                            <b>
                              🏕️ {camper?.emoji} {camper?.name} is camped here
                            </b>
                            <span className="hint">
                              🪙{here.banked} banked · challenge them for {stake}
                            </span>
                            <button
                              className="btn btn--danger"
                              style={{ width: '100%' }}
                              disabled={campBusy || stake <= 0}
                              onClick={() => void doRaidCamp(here, sq.title || 'this spot')}
                            >
                              ⚔️ Challenge for {stake} 🪙
                            </button>
                          </div>
                        );
                      }
                      if (here) return <p className="hint">🏕️ Your camp is here — 🪙{here.banked} banked.</p>;
                      if (myCamp) return null; // one camp at a time
                      return (
                        <button
                          className="btn"
                          style={{ width: '100%', marginTop: 6 }}
                          disabled={campBusy}
                          onClick={() => void doStartCamp(spotId, sq.title || 'this spot')}
                        >
                          🏕️ Camp here
                        </button>
                      );
                    })()}
                    <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setSpotSheet(null)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        {onlineBarModal &&
          (() => {
            const claim = starClaimRows.find((c) => c.bar_spot_id === onlineBarModal.spotId && c.status !== 'lost');
            const claimTeam = claim ? teams.find((t) => t.id === claim.team_id) : null;
            const mine = claim?.team_id === membership?.teamId;
            const secsLeft = claim && claim.status === 'claiming' ? Math.max(0, Math.ceil((Date.parse(claim.ends_at) - nowTs) / 1000)) : 0;
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => setOnlineBarModal(null)}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: '#f97316', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>🍺</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onlineBarModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>Star hub</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {!claim ? (
                      (starAvailable[onlineBarModal.spotId] ?? 0) > 0 ? (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          ⭐ A star is HERE! Buy a round to claim it ({onlineConfig.starCost} 🪙). The meter runs{' '}
                          {onlineConfig.meterSec}s while you're contestable.
                        </p>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%' }}
                          disabled={(myTeam?.coins ?? 0) < onlineConfig.starCost}
                          onClick={doBuyRound}
                        >
                          Buy a round ({onlineConfig.starCost} 🪙)
                        </button>
                      </>
                      ) : (
                        <p className="hint" style={{ marginTop: 0 }}>
                          😴 No star here right now. Stars land at bars as the game goes on — watch the feed for{' '}
                          <b>"a star just landed"</b> and get there first.
                        </p>
                      )
                    ) : claim.status === 'locked' ? (
                      <p className="hint" style={{ marginTop: 0 }}>
                        ⭐ Claimed by <b>{claimTeam?.name ?? 'another team'}</b> — this star is locked.
                      </p>
                    ) : mine ? (
                      <p className="hint" style={{ marginTop: 0 }}>
                        You're claiming this — <b>{secsLeft}s</b> left. Hold on!
                      </p>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          <b>{claimTeam?.name ?? 'A rival'}</b> is claiming it ({secsLeft}s left). Contest to steal it.
                        </p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={openBattle}>
                          ⚔️ Contest
                        </button>
                      </>
                    )}
                    <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setOnlineBarModal(null)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        {onlineQuizModal &&
          (() => {
            const sq = onlineBoard?.squares.find((s) => s.id === onlineQuizModal.spotId);
            const qs = onlineQuizModal.questions;
            const answeredAll = qs.every((_, i) => quizPick[i] != null);
            const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
            const base = sq && sq.reward > 0 ? sq.reward : onlineConfig.coinReward;
            const award = qs.length ? Math.round((base * correct) / qs.length) : base;
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => setOnlineQuizModal(null)}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    maxHeight: '86%',
                    overflowY: 'auto',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: '#3b82f6', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>🧩</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onlineQuizModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>Trivia</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {sq?.notes && (
                      <p className="hint" style={{ marginTop: 0 }}>
                        {sq.notes}
                      </p>
                    )}
                    {qs.map((q, qi) => (
                      <div className="quiz-q" key={qi}>
                        <div className="quiz-qtext">
                          {qi + 1}. {q.q || '(question)'}
                        </div>
                        {q.image && <img src={q.image} alt="" className="quiz-photo" />}
                        {q.choices.map((c, ci) => {
                          const picked = quizPick[qi] === ci;
                          const isRight = q.correct === ci;
                          let cls = 'quiz-choice';
                          if (quizDone) {
                            if (isRight) cls += ' quiz-choice--correct';
                            else if (picked) cls += ' quiz-choice--wrong';
                          } else if (picked) cls += ' quiz-choice--picked';
                          return (
                            <button
                              key={ci}
                              className={cls}
                              disabled={quizDone}
                              onClick={() => setQuizPick((p) => ({ ...p, [qi]: ci }))}
                            >
                              <span>{c || `Choice ${ci + 1}`}</span>
                              {quizDone && isRight && <span className="quiz-mark">✓</span>}
                              {quizDone && picked && !isRight && <span className="quiz-mark">✗</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {!quizDone ? (
                      <button
                        className="btn btn--go"
                        style={{ width: '100%' }}
                        disabled={!answeredAll}
                        onClick={resolveOnlineQuiz}
                      >
                        Submit answers
                      </button>
                    ) : (
                      <>
                        <p className="quiz-score">
                          {award ? `+${award} 🪙 · ` : ''}
                          {correct} / {qs.length} correct
                        </p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={() => setOnlineQuizModal(null)}>
                          Continue
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {onlineChanceModal &&
          (() => {
            const others = teams.filter((t) => t.id !== membership?.teamId);
            const robAmt = cfg.robAmount(onlineConfig);
            const close = () => {
              setOnlineChanceModal(null);
              setChanceOutcome(null);
              setChanceText('');
              setChanceBusy(false);
              setChanceDrawing(false);
              setChanceCardText('');
            };
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(20,16,12,0.42)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                }}
                onClick={() => chanceText && close()}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    maxHeight: '86%',
                    overflowY: 'auto',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: '#a855f7', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>❓</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onlineChanceModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>Chance</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {chanceDrawing ? (
                      <>
                        <div className="chance-card">❓</div>
                        <p className="hint" style={{ textAlign: 'center' }}>Drawing a card…</p>
                      </>
                    ) : chanceText ? (
                      <>
                        <p className="chance-card-text" style={{ fontSize: '1.25rem', fontWeight: 800, textAlign: 'center', margin: '10px 0 18px' }}>{chanceText}</p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={close}>
                          Continue
                        </button>
                      </>
                    ) : chanceOutcome === 'rob' ? (
                      <>
                        <p className="chance-card-text" style={{ fontWeight: 800, marginTop: 0 }}>{chanceCardText || '🦹 A robbery!'}</p>
                        <p className="hint" style={{ marginTop: 4 }}>
                          Pick a team to steal {robAmt} 🪙 from:
                        </p>
                        {others.map((t) => (
                          <button
                            key={t.id}
                            className="btn"
                            style={{ width: '100%', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}
                            disabled={chanceBusy}
                            onClick={() => void robPick(t)}
                          >
                            <span>
                              {t.emoji} {t.name}
                            </span>
                            <span>🪙 {t.coins}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>Draw from the deck — coins, a robbery, a 🧱 reinforcement, or a bust.</p>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%', fontSize: '1.05rem' }}
                          disabled={chanceBusy}
                          onClick={() => void rollOnlineChance()}
                        >
                          ❓ Draw a card
                        </button>
                      </>
                    )}
                    {!chanceText && !chanceDrawing && (
                      <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={close}>
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {onlineBowserModal &&
          (() => {
            const sq = onlineBoard?.squares.find((s) => s.id === onlineBowserModal.spotId);
            const qs = resolvePinnedQuestions(sq, onlineBoard?.triviaBank ?? []);
            const answeredAll = qs.every((_, i) => quizPick[i] != null);
            return (
              <div
                style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
              >
                <div
                  style={{
                    width: 340,
                    maxWidth: '90%',
                    maxHeight: '86%',
                    overflowY: 'auto',
                    background: '#fdfaf2',
                    border: '2px solid #3f3b36',
                    borderRadius: 14,
                    boxShadow: '0 14px 44px rgba(0,0,0,0.45)',
                    animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
                  }}
                >
                  <div style={{ background: '#166534', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>👹</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onlineBowserModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>Bowser · no escape</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {quizDone ? (
                      <>
                        <p style={{ fontSize: '1.2rem', fontWeight: 800, textAlign: 'center', margin: '8px 0 16px' }}>
                          {bowserLoss ? `You lost ${bowserLoss} 🪙!` : 'You escaped unscathed! 0 🪙 lost.'}
                        </p>
                        {qs.map((q, qi) => (
                          <div className="quiz-q" key={qi}>
                            <div className="quiz-qtext">
                              {qi + 1}. {q.q}
                            </div>
                            {q.image && <img src={q.image} alt="" className="quiz-photo" />}
                            {q.choices.map((c, ci) => {
                              const picked = quizPick[qi] === ci;
                              const isRight = q.correct === ci;
                              let cls = 'quiz-choice';
                              if (isRight) cls += ' quiz-choice--correct';
                              else if (picked) cls += ' quiz-choice--wrong';
                              return (
                                <div key={ci} className={cls}>
                                  <span>{c}</span>
                                  {isRight ? <span className="quiz-mark">✓</span> : picked ? <span className="quiz-mark">✗</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={() => setOnlineBowserModal(null)}>
                          Continue
                        </button>
                      </>
                    ) : qs.length > 0 ? (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>Answer to escape — every wrong answer costs you coins.</p>
                        {qs.map((q, qi) => (
                          <div className="quiz-q" key={qi}>
                            <div className="quiz-qtext">
                              {qi + 1}. {q.q}
                            </div>
                            {q.image && <img src={q.image} alt="" className="quiz-photo" />}
                            {q.choices.map((c, ci) => {
                              const picked = quizPick[qi] === ci;
                              return (
                                <button
                                  key={ci}
                                  className={`quiz-choice ${picked ? 'quiz-choice--picked' : ''}`}
                                  onClick={() => setQuizPick((p) => ({ ...p, [qi]: ci }))}
                                >
                                  <span>{c}</span>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                        <button className="btn btn--go" style={{ width: '100%' }} disabled={!answeredAll} onClick={() => void resolveOnlineBowser()}>
                          Submit answers
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>{sq?.notes || 'Complete the challenge, then report how it went.'}</p>
                        <button className="btn btn--go" style={{ width: '100%' }} onClick={() => void resolveOnlineBowser('nailed')}>
                          Nailed it (lose 0)
                        </button>
                        <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => void resolveOnlineBowser('struggled')}>
                          Struggled (lose half)
                        </button>
                        <button className="btn btn--danger" style={{ width: '100%', marginTop: 6 }} onClick={() => void resolveOnlineBowser('failed')}>
                          Failed (lose it all)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {ambushArmModal &&
          membership &&
          (() => {
            const trap = spotAmbush[ambushArmModal.spotId];
            const stake = cfg.ambushStake(onlineConfig);
            const reward = cfg.ambushReward(onlineConfig);
            const mineProposed = trap && trap.status === 'proposed' && trap.initiator === membership.teamId;
            const mineArmed =
              trap && trap.status === 'armed' && (trap.initiator === membership.teamId || trap.ally === membership.teamId);
            const others = teams.filter((t) => t.id !== membership.teamId);
            const close = () => setAmbushArmModal(null);
            return (
              <div
                style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                onClick={close}
              >
                <div
                  style={{ width: 340, maxWidth: '90%', background: '#fdfaf2', border: '2px solid #3f3b36', borderRadius: 14, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.38)', animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ background: '#7c3aed', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>🪤</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ambushArmModal.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>Set an ambush</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    {mineProposed ? (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          ⏳ Waiting for <b>{teams.find((t) => t.id === trap.ally)?.name ?? 'your ally'}</b> to accept…
                        </p>
                        <button className="btn" style={{ width: '100%' }} onClick={() => void doCancelAmbush(trap)}>
                          Cancel & refund {stake} 🪙
                        </button>
                      </>
                    ) : mineArmed ? (
                      <p className="hint" style={{ marginTop: 0 }}>
                        🤫 Your trap is armed here. First rival team to land on it triggers the showdown.
                      </p>
                    ) : trap ? (
                      <p className="hint" style={{ marginTop: 0 }}>Someone is already plotting at this spot…</p>
                    ) : others.length === 0 ? (
                      <p className="hint" style={{ marginTop: 0 }}>No other teams to ally with yet.</p>
                    ) : (
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          Team up to trap this spot: you and an ally each stake {stake} 🪙. A rival landing here triggers a 2-v-1
                          showdown — win and you each steal {reward} 🪙 from them; lose and they take the whole pot.
                        </p>
                        <select
                          value={armAllyId}
                          onChange={(e) => setArmAllyId(e.target.value)}
                          style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid #cfc7b5', marginBottom: 8 }}
                        >
                          <option value="">— pick your ally —</option>
                          {others.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.emoji} {t.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%' }}
                          disabled={!armAllyId || (myTeam?.coins ?? 0) < stake}
                          onClick={() => void doProposeAmbush()}
                        >
                          {(myTeam?.coins ?? 0) < stake ? `Need ${stake} 🪙` : `🪤 Propose ambush (stake ${stake} 🪙)`}
                        </button>
                      </>
                    )}
                    <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={close}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        {appMode === 'online' &&
          allyProposal &&
          (() => {
            const stake = cfg.ambushStake(onlineConfig);
            const from = teams.find((t) => t.id === allyProposal.initiator);
            const spotName = onlineBoard?.squares.find((s) => s.id === allyProposal.spot_id)?.title || 'a spot';
            return (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                <div
                  style={{ width: 340, maxWidth: '90%', background: '#fdfaf2', border: '2px solid #3f3b36', borderRadius: 14, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.38)', animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)' }}
                >
                  <div style={{ background: '#7c3aed', color: '#fff', padding: '14px 18px', fontWeight: 800 }}>🪤 Ambush proposal</div>
                  <div style={{ padding: '16px 18px' }}>
                    <p className="hint" style={{ marginTop: 0 }}>
                      <b>{from?.name ?? 'A team'}</b> wants to set a trap with you at <b>{spotName}</b>. Accepting stakes{' '}
                      {stake} 🪙 of your coins into the pot.
                    </p>
                    <div className="row">
                      <button
                        className="btn btn--go"
                        style={{ flex: 1 }}
                        disabled={(myTeam?.coins ?? 0) < stake}
                        onClick={() => void doRespondAmbush(true)}
                      >
                        {(myTeam?.coins ?? 0) < stake ? `Need ${stake} 🪙` : `Accept (${stake} 🪙)`}
                      </button>
                      <button className="btn btn--danger" style={{ flex: 1 }} onClick={() => void doRespondAmbush(false)}>
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        {ambushedName && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div
              style={{ width: 340, maxWidth: '90%', background: '#fdfaf2', border: '2px solid #3f3b36', borderRadius: 14, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.45)', animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)' }}
            >
              <div style={{ background: '#b91c1c', color: '#fff', padding: '14px 18px', fontWeight: 800, fontSize: '1.15rem' }}>🪤 AMBUSHED!</div>
              <div style={{ padding: '16px 18px' }}>
                <p className="hint" style={{ marginTop: 0 }}>
                  Two teams set a trap at <b>{ambushedName}</b> — and you walked right into it. They're on their way for a
                  2-v-1 showdown. Win it and you take their whole pot; lose and they rob you.
                </p>
                <button className="btn btn--go" style={{ width: '100%' }} onClick={() => setAmbushedName(null)}>
                  Bring it on
                </button>
              </div>
            </div>
          </div>
        )}

        {appMode === 'online' && myShowdown && showdownOpen && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowdownOpen(false)}>
            <div
              style={{ width: 340, maxWidth: '90%', background: '#fdfaf2', border: '2px solid #3f3b36', borderRadius: 14, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.38)', animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ background: '#7c3aed', color: '#fff', padding: '14px 18px', fontWeight: 800 }}>🪤 Showdown</div>
              <div style={{ padding: '16px 18px' }}>
                <p className="hint" style={{ marginTop: 0 }}>
                  <b>{teams.find((t) => t.id === myShowdown.initiator)?.name ?? '?'}</b> &{' '}
                  <b>{teams.find((t) => t.id === myShowdown.ally)?.name ?? '?'}</b> vs{' '}
                  <b>{teams.find((t) => t.id === myShowdown.victim)?.name ?? '?'}</b> at{' '}
                  <b>{onlineBoard?.squares.find((s) => s.id === myShowdown.spot_id)?.title || 'the spot'}</b>. Meet up, play a
                  physical challenge (defender's pick), then report the result — once, on any phone.
                </p>
                <div className="row">
                  <button className="btn btn--go" style={{ flex: 1 }} onClick={() => void doResolveAmbush(true)}>
                    🪤 Ambushers won
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => void doResolveAmbush(false)}>
                    🛡 Defender won
                  </button>
                </div>
                <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowdownOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {battleModal && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(20,16,12,0.42)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setBattleModal(null)}
          >
            <div
              style={{
                width: 340,
                maxWidth: '90%',
                background: '#fdfaf2',
                border: '2px solid #3f3b36',
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 14px 44px rgba(0,0,0,0.38)',
                animation: 'pop-in 0.24s cubic-bezier(0.2,0.85,0.35,1.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ background: '#b23b3b', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>⚔️</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Battle vs {battleModal.defenderName}
                  </div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.92, textTransform: 'uppercase', letterSpacing: 1.5 }}>{battleModal.barName}</div>
                </div>
              </div>
              <div style={{ padding: '16px 18px' }}>
                <p className="hint" style={{ marginTop: 0 }}>
                  Round: <b>{battleModal.round}</b>. Play it head-to-head, then tap who won.
                </p>
                <div className="row">
                  <button className="btn btn--go" style={{ flex: 1 }} onClick={() => resolveBattle(true)}>
                    We won
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => resolveBattle(false)}>
                    They won
                  </button>
                </div>
                <button className="btn btn--ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setBattleModal(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {appMode === 'online' && onlineStatus === 'ended' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(20,16,12,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
          >
            <div
              style={{
                width: 360,
                maxWidth: '92%',
                background: '#fdfaf2',
                border: '2px solid #3f3b36',
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 14px 44px rgba(0,0,0,0.4)',
                animation: 'pop-in 0.3s cubic-bezier(0.2,0.85,0.35,1.2)',
              }}
            >
              <div style={{ background: '#111827', color: '#fff', padding: '16px 18px', fontWeight: 800, fontSize: '1.2rem' }}>
                🏁 Game over
              </div>
              <div style={{ padding: '16px 18px' }}>
                <p className="hint" style={{ marginTop: 0 }}>Final standings — most ⭐, then 🪙:</p>
                {[...teams]
                  .sort((a, b) => b.stars - a.stars || b.coins - a.coins)
                  .map((t, i) => (
                    <div
                      key={t.id}
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: i === 0 ? 800 : 400 }}
                    >
                      <span>
                        {i === 0 ? '🏆 ' : `${i + 1}. `}
                        {t.emoji} {t.name}
                        {t.id === membership?.teamId ? ' (you)' : ''}
                      </span>
                      <span>⭐ {t.stars} · 🪙 {t.coins}</span>
                    </div>
                  ))}
                {/* The album is the keepsake — and the end of the game is when
                    people actually want to scroll it. This overlay sits above
                    the 📸 FAB, so it needs its own way in. */}
                <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={() => openCam('gallery')}>
                  📸 Look back at the album
                </button>
                <button className="btn btn--ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setAppMode('design')}>
                  Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {burst && (
          <div key={burst.key} className="reward-burst">
            {burst.text}
          </div>
        )}
      </main>

      {/* Player bottom bar: the HUD essentials always in view, and Menu/Chat
          where thumbs actually are - instead of buttons floating over the map. */}
      {variant === 'player' &&
        membership &&
        (() => {
          const tick = cfg.territoryTickSec(onlineConfig);
          const tickLabel = tick >= 120 ? `${Math.round(tick / 60)}m` : `${tick}s`;
          const myClaim = starClaimRows.find((c) => c.team_id === membership.teamId && c.status === 'claiming');
          const meterSecs = myClaim ? Math.max(0, Math.ceil((Date.parse(myClaim.ends_at) - nowTs) / 1000)) : 0;
          const clock = `${Math.floor(meterSecs / 60)}:${String(meterSecs % 60).padStart(2, '0')}`;
          return (
            <footer className="player-bar">
              {/* Everything the player reads lives in this bar. Splitting it
                  across the top and bottom of the board made you hunt. */}
              <div className="hud-strip">
                <button className="hud-row" onClick={() => setStandOpen(true)}>
                  {standings.length === 0 ? (
                    <span className="hud-dim">Waiting for teams…</span>
                  ) : (
                    (() => {
                      const t = standings[Math.min(rotIdx, standings.length - 1)];
                      const place = standings.indexOf(t) + 1;
                      return (
                        <>
                          <span className="hud-place">{place === 1 ? '🏆' : `${place}.`}</span>
                          <span className="hud-name">
                            {t.emoji} {t.name}
                            {t.id === membership.teamId && <em className="hud-you">you</em>}
                          </span>
                          <span className="hud-stats">
                            ⭐{t.stars} 🪙{t.coins} 🔗{allRuns[t.id] ?? 0}
                          </span>
                        </>
                      );
                    })()
                  )}
                  <span className="hud-more">▾</span>
                </button>
                <button className="hud-row hud-row--feed" onClick={() => setFeedOpen(true)}>
                  <span className="hud-feed">
                    {feed.length
                      ? feed[Math.min(tickIdx, feed.length - 1)]?.payload?.text ?? '…'
                      : 'Nothing worth reporting yet.'}
                  </span>
                  <span className="hud-more">▾</span>
                </button>
              </div>
              {myQuest && myQuest.kind === 'explorer' && (
                <button className="quest-photo-btn" onClick={() => setQuestPhoto(true)}>
                  🧭 Show me the photo again
                </button>
              )}
              {myQuest && (

                <div className="quest-row">
                  <span className="quest-row__what">
                    {myQuest.kind === 'tag' ? (
                      <>
                        🎯 Hunting <b>{questMark?.emoji} {questMark?.name ?? 'someone'}</b>
                      </>
                    ) : myQuest.kind === 'explorer' ? (
                      <>🧭 Find the place in the photo</>
                    ) : myQuest.kind === 'recon' ? (

                      <>🔭 Holding <b>{questSpotName}</b> — stay put</>
                    ) : (
                      <>🪤 Trap armed at <b>{questSpotName}</b></>
                    )}
                  </span>
                  <span className="quest-row__clock">
                    {Math.floor(questLeft / 60)}:{String(questLeft % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
              {myCamp && (
                <div className={`camp-row${campDue === 0 ? ' is-due' : ''}`}>
                  <span className="camp-row__what">
                    🏕️ <b>🪙{myCamp.banked}</b> banked
                    {campFull && <em className="camp-row__full">FULL</em>}
                    {campLapsed && !campFull && <em className="camp-row__lapsed">streak lost</em>}
                  </span>
                  <button
                    className="camp-row__btn"
                    disabled={campBusy || campDue > 0 || campFull}
                    onClick={doPingCamp}
                  >
                    {campFull
                      ? 'Go cash out'
                      : campDue > 0
                        ? `${Math.floor(campDue / 60)}:${String(campDue % 60).padStart(2, '0')}`
                        : `Still here +${campNext}`}
                  </button>
                </div>
              )}
              <div className="player-bar__info">
                <div className="player-bar__team">
                  <span className="player-bar__emoji">{myTeam?.emoji ?? '🎲'}</span>
                  <span className="player-bar__name">{myTeam?.name ?? membership.teamName}</span>
                  {myClaim && <span className="player-bar__meter">⭐ {clock}</span>}
                  {onlineStatus !== 'live' && <span className="player-bar__paused">⏸ {onlineStatus}</span>}
                </div>
                <div className="player-bar__stats">
                  <span>🪙 {myTeam?.coins ?? 0}</span>
                  <span>⭐ {myTeam?.stars ?? 0}</span>
                  <span>
                    🔗 {myRun}
                    {myRun > 0 && (
                      <em className="player-bar__rate">
                        +{myRun * cfg.chainMultiplier(onlineConfig)}/{tickLabel}
                      </em>
                    )}
                  </span>
                  {(myTeam?.reinforcements ?? 0) > 0 && <span>🧱 {myTeam?.reinforcements}</span>}
                </div>
              </div>
              <div className="player-bar__acts">
                {/* Beers is its own button, not a tab inside the album: it's the
                    one you tap with a drink already in your other hand. */}
                <button className="player-bar__btn player-bar__btn--beer" onClick={() => openCam('post', 1)}>
                  🍻<em>Beers</em>
                </button>
                <button className="player-bar__btn" onClick={() => (camOpen ? closeCam() : openCam('gallery'))}>
                  📸<em>Album</em>
                  {photos.length > 0 && <span className="cam-count">{photos.length}</span>}
                </button>
                <button className="player-bar__btn" onClick={() => (msgOpen ? setMsgOpen(false) : openMsgPanel())}>
                  💬<em>Chat</em>
                  {msgUnread > 0 && <span className="msg-badge">{msgUnread}</span>}
                </button>
                <button className="player-bar__btn player-bar__btn--menu" onClick={() => setPanelOpen((o) => !o)}>
                  {panelOpen ? '✕' : '☰'}
                  <em>{panelOpen ? 'Close' : 'Menu'}</em>
                </button>
              </div>
            </footer>
          );
        })()}
    </div>
  );
}