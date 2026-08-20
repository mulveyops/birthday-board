import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import BoardCanvas, { type Mode } from './BoardCanvas';
import type { Board, ChanceCard, Edge, LatLng, Phase, Square, SquareType, TriviaQuestion } from './types';
import { SQUARE_TYPES, TYPE_ORDER } from './squareTypes';
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
  hostCancelStarClaims,
  hostReleaseTurf,
  hostUnclearSpot,
  savedHostGame,
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
  type EventRow,
  type GameConfig,
} from './net';
import { territoryIds, territoryAdjacency, longestRun, computeRuns } from './territory';
import { navigate } from './Root';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'area', label: 'Area' },
  { key: 'frame', label: 'Frame' },
  { key: 'squares', label: 'Board' },
];
const phaseIndex = (p: Phase) => PHASES.findIndex((s) => s.key === p);

// --- Play-mode model -------------------------------------------------------
type SpotType = 'coin' | 'challenge' | 'chance' | 'bar' | 'bowser';
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
const ROUND_TYPES = ['Charades', 'Fishbowl', 'Couple Trivia', 'Speed Puzzle'];
function pickRound() {
  return ROUND_TYPES[Math.floor(Math.random() * ROUND_TYPES.length)];
}
/** Turf paint per team — assigned by join order (listTeams sorts by created_at),
 * so every phone derives the same colors without storing them. */
const TEAM_COLORS = ['#e0533a', '#2f7fe0', '#2fa05a', '#e6a817', '#9a5fe0', '#e05fa0', '#17b0b8', '#8a6d3b'];
function teamColorOf(teams: { id: string }[], teamId: string): string {
  const i = teams.findIndex((t) => t.id === teamId);
  return TEAM_COLORS[(i >= 0 ? i : 0) % TEAM_COLORS.length];
}
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
function deriveSpots(board: Board): Square[] {
  const deg = new Map<string, number>();
  for (const e of board.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank');
}
/** Explicit type wins; blank intersections get a deterministic coin/chance mix. */
function deriveNodeType(spots: Square[]): Record<string, SpotType> {
  const SPOT: string[] = ['coin', 'challenge', 'chance', 'bar', 'bowser'];
  const m: Record<string, SpotType> = {};
  for (const sq of spots) {
    if (SPOT.includes(sq.type)) m[sq.id] = sq.type as SpotType;
    else m[sq.id] = strHash01(sq.id) < 0.35 ? 'chance' : 'coin';
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
  { id: 'd-claim1', text: '🧱 Sandbags! Fortify your turf.', effect: 'claim', amount: 0 },
  { id: 'd-claim2', text: '🧱 Brick delivery! Fortify your turf.', effect: 'claim', amount: 0 },
  { id: 'd-claim3', text: '🧱 Construction crew! Fortify your turf.', effect: 'claim', amount: 0 },
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
  const [addType, setAddType] = useState<SquareType>('bar');
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
  const nodeType = useMemo(() => deriveNodeType(spots), [spots]);

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
    loadEv();
    loadGame();
    loadMsgs();
    const u1 = subscribeEvents(gid, loadEv);
    const u2 = subscribeGame(gid, loadGame);
    const u3 = subscribeMessages(gid, loadMsgs);
    return () => {
      alive = false;
      u1();
      u2();
      u3();
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
  const cfgField = (label: string, key: keyof GameConfig) => (
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
  const [events, setEvents] = useState<EventRow[]>([]);
  // Messaging: shared row store + composer state for whichever surface is active.
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgTo, setMsgTo] = useState<string>('admin'); // 'admin' or a team id
  const [msgText, setMsgText] = useState('');
  const [msgSeen, setMsgSeen] = useState(0); // how many of my messages I've seen (unread badge)

  /** Display name for a message party (null = the host). */
  const msgName = (id: string | null) =>
    id == null ? 'Host' : teams.find((t) => t.id === id)?.name ?? 'a team';
  // Messages this team can see: host broadcasts + anything to/from us.
  const myMsgs = useMemo(() => {
    const tid = membership?.teamId;
    if (!tid) return [];
    return messages.filter(
      (m) => (m.from_team == null && m.to_team == null) || m.from_team === tid || m.to_team === tid,
    );
  }, [messages, membership]);
  const msgUnread = Math.max(0, myMsgs.length - msgSeen);
  function openMsgPanel() {
    setMsgOpen(true);
    setMsgSeen(myMsgs.length);
  }
  async function sendTeamMsg() {
    if (!membership || !msgText.trim()) return;
    const to = msgTo === 'admin' ? null : msgTo;
    try {
      await sendMessage(membership.gameId, membership.teamId, to, msgText.trim());
      setMsgText('');
      setMsgSeen((n) => n + 1); // don't badge our own message
    } catch (e) {
      alert('Send failed: ' + (e as Error).message);
    }
  }
  // Host composer: 'all' broadcasts (message + banner event); a team id DMs them.
  const [hostMsgTo, setHostMsgTo] = useState<string>('all');
  async function sendHostMsg() {
    if (!hostGame || !msgText.trim()) return;
    const text = msgText.trim();
    try {
      if (hostMsgTo === 'all') {
        await sendMessage(hostGame.id, null, null, text);
        await logEvent(hostGame.id, 'announce', `📣 ${text}`);
      } else {
        await sendMessage(hostGame.id, null, hostMsgTo, text);
      }
      setMsgText('');
    } catch (e) {
      alert('Send failed: ' + (e as Error).message);
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
  const reinforcedSet = useMemo(
    () => new Set(territoryRows.filter((r) => r.reinforced).map((r) => r.spot_id)),
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
  const [gpsOn, setGpsOn] = useState(false);
  // Temporary: report what the view actually resolved to on a real device,
  // so a mis-centred board can be diagnosed instead of guessed at.
  const [viewDebug, setViewDebug] = useState('');
  useEffect(() => {
    if (appMode !== 'online') return;
    const sample = () => {
      const m = (window as unknown as { __mkeMap?: L.Map }).__mkeMap;
      const wrap = document.querySelector('.map-wrap') as HTMLElement | null;
      const art = [...document.querySelectorAll('svg image')].find((i) =>
        (i.getAttribute('href') || '').includes('backdrops'),
      ) as SVGImageElement | undefined;
      if (!wrap) return;
      const w = wrap.getBoundingClientRect();
      const a2 = art?.getBoundingClientRect();
      const vv = window.visualViewport;
      setViewDebug(
        [
          `scr ${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)} dpr${window.devicePixelRatio}`,
          vv ? `vv ${Math.round(vv.width)}x${Math.round(vv.height)}@${vv.scale.toFixed(2)} off${Math.round(vv.offsetLeft)}` : 'vv -',
          `map ${Math.round(w.width)}x${Math.round(w.height)}`,
          m ? `z ${m.getZoom().toFixed(2)}/${m.getMinZoom().toFixed(2)}` : 'z -',
          a2 ? `art L${Math.round(a2.left - w.left)} R${Math.round(w.right - a2.right)} w${Math.round(a2.width)}` : 'art -',
        ].join(' · '),
      );
    };
    const t = window.setInterval(sample, 1000);
    sample();
    return () => window.clearInterval(t);
  }, [appMode, recage]);
  const lockTried = useRef<Set<string>>(new Set());

  // Timestamp-driven: a spawn is live once now is past spawn_at, before expires_at.
  const activeSpawns = useMemo(
    () =>
      allSpawns
        .filter((s) => !s.claimed_by && Date.parse(s.spawn_at) <= nowTs && nowTs < Date.parse(s.expires_at))
        .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
    [allSpawns, nowTs],
  );

  // Star-meter rings for bars under an active claim (gold = mine, red = a rival's).
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
          };
        }),
    [starClaimRows, nowTs, membership, onlineConfig],
  );

  const myTeam = useMemo(() => teams.find((t) => t.id === membership?.teamId) ?? null, [teams, membership]);
  const onlineNodeType = useMemo(() => (onlineBoard ? deriveNodeType(deriveSpots(onlineBoard)) : {}), [onlineBoard]);
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
  // Corner paint for the map: spot → team color (thicker ring for our own,
  // 🧱 badge when reinforced).
  const turfPaint = useMemo(() => {
    const out: Record<string, { color: string; mine: boolean; reinforced?: boolean }> = {};
    for (const r of territoryRows) {
      out[r.spot_id] = {
        color: teamColorOf(teams, r.team_id),
        mine: r.team_id === membership?.teamId,
        reinforced: !!r.reinforced,
      };
    }
    return out;
  }, [territoryRows, teams, membership]);
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
    const loadEvents = () => listEvents(gid).then((e) => alive && setEvents(e)).catch(() => {});
    const loadMsgs = () => listMessages(gid).then((m) => alive && setMessages(m)).catch(() => {});
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
    loadEvents();
    loadMsgs();
    loadAmbushes();
    loadTurf();
    loadRaids();
    loadGame();
    const u1 = subscribeClaims(gid, loadClaims);
    const u2 = subscribePositions(gid, loadPos);
    const u3 = subscribeSpawns(gid, loadSpawns);
    const u4 = subscribeStars(gid, loadStars);
    const u5 = subscribeEvents(gid, loadEvents);
    const u6 = subscribeGame(gid, loadGame);
    const u8 = subscribeMessages(gid, loadMsgs);
    const u9 = subscribeAmbushes(gid, loadAmbushes);
    const u10 = subscribeTerritory(gid, loadTurf);
    const u11 = subscribeRaidLocks(gid, loadRaids);
    return () => {
      alive = false;
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u8();
      u9();
      u10();
      u11();
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
            await adjustCoins(t.id, n);
            parts.push(`${t.emoji} +${n}`);
          }
        }
        if (parts.length) {
          logEvent(membership.gameId, 'star', `🔗 Turf income paid: ${parts.join(' · ')} 🪙`).catch(() => {});
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
  function withProximity(target: { lat: number; lng: number }, cb: () => void) {
    if (!gpsOn) return cb();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = metersBetween({ lat: pos.coords.latitude, lng: pos.coords.longitude }, target);
        if (d <= onlineConfig.radiusM) cb();
        else alert(`Too far — you're ${Math.round(d)}m away (need within ${onlineConfig.radiusM}m).`);
      },
      () => alert('Could not read your location.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }
  function onlineCheckIn(spotId: string) {
    if (!membership || !onlineBoard || onlineStatus !== 'live') return;
    const sq = onlineBoard.squares.find((s) => s.id === spotId);
    if (!sq) return;
    const type = onlineNodeType[spotId] ?? 'coin';
    withProximity(sq, () => {
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
    });
  }
  // --- Turf steal handlers ---------------------------------------------------
  /** Deal n distinct bank questions; no bank published → coin-flip calls. */
  function dealStealQuestions(n: number): TriviaQuestion[] {
    const bank = onlineBoard?.triviaBank ?? [];
    if (bank.length) {
      const shuffled = [...bank].sort(() => Math.random() - 0.5);
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
      questions: dealStealQuestions(reinforced || defenderNear ? 2 : 1),
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
    setStealBusy(true);
    try {
      if (allRight) {
        const ok = await stealTerritory(membership.gameId, spotId, membership.teamId, defenderId);
        if (ok) {
          setStealResult('won');
          const sq = onlineBoard?.squares.find((s) => s.id === spotId);
          if (sq) checkInSpot(membership.gameId, membership.teamId, spotId, sq.lat, sq.lng, 0).catch(() => {});
          logEvent(membership.gameId, 'battle', `🏴 ${myTeam?.name ?? 'A team'} stole ${name} from ${defName}!`).catch(() => {});
          sendMessage(membership.gameId, null, defenderId, `🏴 ${myTeam?.name ?? 'A team'} took your corner at ${name} — your run may be cut!`).catch(() => {});
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
        await logEvent(membership.gameId, 'star', `🍀 ${myTeam?.name ?? 'A team'} drew a lucky card (+${card.amount} 🪙)`);
      } else if (card.effect === 'lose') {
        await adjustCoins(membership.teamId, -card.amount);
        setChanceText(`${card.text} −${card.amount} 🪙`);
        setChanceOutcome('lose');
        await logEvent(membership.gameId, 'star', `💸 ${myTeam?.name ?? 'A team'} drew an unlucky card (−${card.amount} 🪙)`);
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
              {(myTeam?.reinforcements ?? 0) > 0 && (
                <>
                  {' '}· 🧱 <b>{myTeam?.reinforcements}</b> charge{(myTeam?.reinforcements ?? 0) > 1 ? 's' : ''} — check in
                  at a corner you own to fortify it
                </>
              )}
            </p>
            <label className="toggle">
              <input type="checkbox" checked={gpsOn} onChange={(e) => setGpsOn(e.target.checked)} />
              Require GPS proximity (turn on at the party)
            </label>
            <button className="btn" onClick={bumpCage}>
              🎯 Recenter board
            </button>
            <p className="hint" style={{ fontFamily: 'monospace', fontSize: '0.68rem', opacity: 0.75 }}>
              {viewDebug}
            </p>
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
            <p className="hint" style={{ marginTop: 8 }}>Activity</p>
            <div style={{ maxHeight: 128, overflowY: 'auto' }}>
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
                {TYPE_ORDER.map((t) => (
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
                    {TYPE_ORDER.map((t) => (
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
                <p className="hint">📍 Drag the spot on the map to fine-tune where it sits — mid-block is fine for a bar or point of interest.</p>
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
                  <p className="hint" style={{ marginTop: 8 }}>💬 Message teams ("everyone" also banners)</p>
                  <select
                    value={hostMsgTo}
                    onChange={(e) => setHostMsgTo(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, marginBottom: 4 }}
                  >
                    <option value="all">📣 To: everyone</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        To: {t.emoji} {t.name}
                      </option>
                    ))}
                  </select>
                  <div className="row">
                    <input
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void sendHostMsg()}
                      placeholder="e.g. Final 30 minutes!"
                      style={{ flex: 1, padding: '6px 8px', border: '1px solid #cfc7b5', borderRadius: 6 }}
                    />
                    <button className="btn" style={{ flex: 'none' }} onClick={() => void sendHostMsg()} disabled={netBusy || !msgText.trim()}>
                      Send
                    </button>
                  </div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', margin: '4px 0' }}>
                    {[...messages].reverse().map((m) => (
                      <div key={m.id} className="hint" style={{ margin: '2px 0' }}>
                        <b>{msgName(m.from_team)}</b> → {m.to_team ? msgName(m.to_team) : m.from_team ? 'Host' : 'everyone'}: {m.text}
                      </div>
                    ))}
                    {messages.length === 0 && <div className="hint">No messages yet.</div>}
                  </div>
                  <button className="btn" onClick={doDropSpawn} disabled={netBusy}>
                    🎁 Drop a bonus spawn now
                  </button>
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
              {cfgField('Rob amount (🪙)', 'robAmount')}
              {cfgField('Ambush stake (🪙)', 'ambushStake')}
              {cfgField('Ambush reward (🪙)', 'ambushReward')}
              {cfgField('Turf income tick (sec)', 'territoryTickSec')}
              {cfgField('Failed-steal lockout (sec)', 'stealLockSec')}
              {cfgField('🧱 fail forfeit (🪙)', 'reinforceForfeit')}
              {cfgField('Home-turf radius (m)', 'defendRadiusM')}
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
        {appMode === 'online' && myShowdown && !showdownOpen && (
          <button className="showdown-banner" onClick={() => setShowdownOpen(true)}>
            🪤 Ambush showdown — tap to report the result
          </button>
        )}
        {appMode === 'online' && membership && msgOpen && (
          <div className="msg-scrim" onClick={() => setMsgOpen(false)}>
            <div className="msg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="msg-head">
                <span>💬 Messages</span>
                <button onClick={() => setMsgOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="msg-list">
                {myMsgs.length === 0 ? (
                  <p className="msg-empty">No messages yet. Rally another team — or ask the host for help.</p>
                ) : (
                  myMsgs.map((m) => {
                    const mine = m.from_team === membership.teamId;
                    return (
                      <div key={m.id} className={`msg-row ${mine ? 'msg-row--mine' : ''}`}>
                        <div className="msg-meta">
                          {mine ? 'You' : msgName(m.from_team)} →{' '}
                          {m.to_team ? (m.to_team === membership.teamId ? 'you' : msgName(m.to_team)) : m.from_team ? 'Host' : 'everyone'}
                        </div>
                        <div className="msg-bubble">{m.text}</div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="msg-compose">
                <select value={msgTo} onChange={(e) => setMsgTo(e.target.value)}>
                  <option value="admin">To: Host</option>
                  {teams
                    .filter((t) => t.id !== membership.teamId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        To: {t.emoji} {t.name}
                      </option>
                    ))}
                </select>
                <div className="msg-compose-row">
                  <input
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void sendTeamMsg()}
                    placeholder="Type a message…"
                  />
                  <button className="btn btn--go" disabled={!msgText.trim()} onClick={() => void sendTeamMsg()}>
                    Send
                  </button>
                </div>
              </div>
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
          onCheckIn={appMode === 'online' ? onlineCheckIn : checkIn}
          nodeType={appMode === 'play' ? nodeType : appMode === 'online' ? onlineNodeType : undefined}
          starBars={appMode === 'online' ? [] : play.starBars}
          spawns={appMode === 'online' ? activeSpawns : appMode === 'play' ? spawns : []}
          onClaimSpawn={appMode === 'online' ? onlineClaimSpawn : claimSpawn}
          starClaims={
            appMode === 'online'
              ? onlineStarClaims
              : claim
                ? [{ barSpotId: claim.barId, pct: Math.min(1, Math.max(0, (CLAIM_MS / 1000 - claimLeft) / (CLAIM_MS / 1000))), mine: true }]
                : []
          }
          tokens={appMode === 'online' ? tokens : undefined}
          flat={variant === 'player' && !classicMap}
          turf={appMode === 'online' ? turfPaint : undefined}
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
            const meta = SQUARE_TYPES[modal.type];
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
                          Your paint holds this corner in your run. Fortify it with a 🧱 charge
                          {charges > 0 ? ` (you have ${charges})` : ' — win one from a chance card'}.
                        </p>
                        <button
                          className="btn btn--go"
                          style={{ width: '100%' }}
                          disabled={cornerBusy || charges < 1}
                          onClick={() => void doReinforce()}
                        >
                          {cornerBusy ? '…' : charges < 1 ? 'No 🧱 charges yet' : '🧱 Reinforce this corner'}
                        </button>
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
                        {stealModal.reinforced && (
                          <p className="hint" style={{ background: '#3b2a1d', color: '#fcd9a8', borderRadius: 8, padding: '7px 10px' }}>
                            🧱 <b>Reinforced!</b> Miss and you also forfeit {cfg.reinforceForfeit(onlineConfig)} 🪙 to {defName}.
                          </p>
                        )}
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
                      <>
                        <p className="hint" style={{ marginTop: 0 }}>
                          Buy a round to claim a ⭐ ({onlineConfig.starCost} 🪙). The meter runs {onlineConfig.meterSec}s while
                          you're contestable.
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
                <button className="btn btn--ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => setAppMode('design')}>
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
          where thumbs actually are — instead of buttons floating over the map. */}
      {variant === 'player' && membership && (
        <footer className="player-bar">
          <div className="player-bar__stats">
            <span>🪙 {myTeam?.coins ?? 0}</span>
            <span>⭐ {myTeam?.stars ?? 0}</span>
            <span>🔗 {myRun}</span>
            {(myTeam?.reinforcements ?? 0) > 0 && <span>🧱 {myTeam?.reinforcements}</span>}
          </div>
          <button className="player-bar__btn" onClick={() => (msgOpen ? setMsgOpen(false) : openMsgPanel())}>
            💬{msgUnread > 0 && <span className="msg-badge">{msgUnread}</span>}
          </button>
          <button className="player-bar__btn player-bar__btn--menu" onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? '✕ Close' : '☰ Menu'}
          </button>
        </footer>
      )}
    </div>
  );
}
