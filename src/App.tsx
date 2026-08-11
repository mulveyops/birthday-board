import { useEffect, useMemo, useRef, useState } from 'react';
import BoardCanvas, { type Mode } from './BoardCanvas';
import type { Board, Edge, LatLng, Phase, Square, SquareType, TriviaQuestion } from './types';
import { SQUARE_TYPES, TYPE_ORDER } from './squareTypes';
import { loadBoard, saveBoard, makeSquare, defaultBoard } from './boardStore';
import { metersBetween, simplify, snapToStreetsFollowing } from './snap';
import { generateStreetBoard, buildScenery, shiftPathEnd } from './generate';
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
  type GameRow,
  type TeamRow,
  type Position,
  type SpawnRow,
  type StarClaimRow,
  type EventRow,
  type GameConfig,
} from './net';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'area', label: 'Area' },
  { key: 'frame', label: 'Frame' },
  { key: 'squares', label: 'Board' },
];
const phaseIndex = (p: Phase) => PHASES.findIndex((s) => s.key === p);

// --- Play-mode model -------------------------------------------------------
type SpotType = 'coin' | 'challenge' | 'chance' | 'bar';
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
  const SPOT: string[] = ['coin', 'challenge', 'chance', 'bar'];
  const m: Record<string, SpotType> = {};
  for (const sq of spots) {
    if (SPOT.includes(sq.type)) m[sq.id] = sq.type as SpotType;
    else m[sq.id] = strHash01(sq.id) < 0.35 ? 'chance' : 'coin';
  }
  return m;
}

export default function App() {
  const [board, setBoard] = useState<Board>(() => loadBoard());
  const [mode, setMode] = useState<Mode>('select');
  const [addType, setAddType] = useState<SquareType>('bar');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sceneryLoading, setSceneryLoading] = useState(false);
  const [undoBoundary, setUndoBoundary] = useState<LatLng[] | null>(null);
  const [recage, setRecage] = useState(0);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // --- Cloud layouts (shared, named boards saved to Supabase) ----------------
  type CloudStatus = 'offline' | 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'needs-setup';
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [currentLayoutId, setCurrentLayoutId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(isConfigured ? 'idle' : 'offline');
  const [remoteNewer, setRemoteNewer] = useState(false);
  const currentLayoutIdRef = useRef<string | null>(null);
  const lastSavedAtRef = useRef<string | null>(null); // timestamp of our last write/load (echo suppression)
  const skipSaveRef = useRef(false); // set true right before a programmatic setBoard so it doesn't re-save
  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingSaveRef = useRef<{ id: string; board: Board } | null>(null);
  const CURRENT_KEY = 'mke-current-layout-v1';

  const phase = board.phase;
  const bumpCage = () => setRecage((n) => n + 1);

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

  // Debounced autosave of the working board to the open cloud layout.
  useEffect(() => {
    if (!isConfigured || !currentLayoutId) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    pendingSaveRef.current = { id: currentLayoutId, board };
    setCloudStatus('saving');
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, currentLayoutId]);

  // Load a layout into the working board. discardLocal=true skips flushing local
  // edits first (used by "Load latest" to take the remote version).
  async function openLayout(id: string, discardLocal = false) {
    if (discardLocal) {
      pendingSaveRef.current = null;
      window.clearTimeout(saveTimerRef.current);
    } else {
      await flushSave();
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

  // Create a fresh blank layout, or duplicate the current working board.
  async function newLayout(fromCurrent: boolean) {
    const suggested = fromCurrent
      ? `${layouts.find((l) => l.id === currentLayoutId)?.name ?? 'Layout'} copy`
      : `Version ${String.fromCharCode(65 + layouts.length)}`;
    const name = prompt(fromCurrent ? 'Name for the duplicate' : 'Name this new layout', suggested);
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
  const [panelOpen, setPanelOpen] = useState(true);
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
  const [hostConfig, setHostConfig] = useState<GameConfig>(PARTY_CONFIG);
  const [hostStatus, setHostStatus] = useState<'lobby' | 'live' | 'ended'>('lobby');
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [joinCode, setJoinCode] = useState('');
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
      setHostGame(await publishGame(board.name || 'Birthday Game', board, hostConfig));
      setHostStatus('lobby');
    } catch (e) {
      alert('Publish failed: ' + (e as Error).message);
    } finally {
      setNetBusy(false);
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
        disabled={hostStatus !== 'lobby'}
        onChange={(e) => setHostConfig((c) => ({ ...c, [key]: Number(e.target.value) }))}
        style={{ width: 72, padding: '3px 6px', border: '1px solid #cfc7b5', borderRadius: 5 }}
      />
    </label>
  );
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

  // --- Online play (slice 2: shared check-ins, coins, live board) ------------
  const [onlineBoard, setOnlineBoard] = useState<Board | null>(null);
  const [onlineConfig, setOnlineConfig] = useState<GameConfig>(PARTY_CONFIG);
  const [onlineStatus, setOnlineStatus] = useState<'lobby' | 'live' | 'ended'>('live');
  const [onlineCleared, setOnlineCleared] = useState<string[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [allSpawns, setAllSpawns] = useState<SpawnRow[]>([]);
  const [starClaimRows, setStarClaimRows] = useState<StarClaimRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [onlineBarModal, setOnlineBarModal] = useState<{ spotId: string; name: string } | null>(null);
  const [onlineQuizModal, setOnlineQuizModal] = useState<{ spotId: string; name: string } | null>(null);
  const [battleModal, setBattleModal] = useState<{
    claimId: string;
    barName: string;
    defenderName: string;
    round: string;
  } | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [gpsOn, setGpsOn] = useState(false);
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
    const loadGame = () =>
      getGameFull(gid)
        .then((g) => {
          if (!alive) return;
          if (g.config) setOnlineConfig(g.config);
          setOnlineStatus((g.status as 'lobby' | 'live' | 'ended') ?? 'live');
        })
        .catch(() => {});
    loadClaims();
    loadPos();
    loadSpawns();
    loadStars();
    loadEvents();
    loadGame();
    const u1 = subscribeClaims(gid, loadClaims);
    const u2 = subscribePositions(gid, loadPos);
    const u3 = subscribeSpawns(gid, loadSpawns);
    const u4 = subscribeStars(gid, loadStars);
    const u5 = subscribeEvents(gid, loadEvents);
    const u6 = subscribeGame(gid, loadGame);
    return () => {
      alive = false;
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
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
      if (type === 'bar') {
        setOnlineBarModal({ spotId, name: sq.title || 'Bar' });
        return;
      }
      if (onlineCleared.includes(spotId)) return;
      // A challenge with authored trivia → answer to earn scaled coins.
      if (type === 'challenge' && (sq.questions?.length ?? 0) > 0) {
        setQuizPick({});
        setQuizDone(false);
        setOnlineQuizModal({ spotId, name: sq.title || 'Challenge' });
        return;
      }
      setOnlineCleared((c) => [...c, spotId]); // optimistic; subscription confirms coins/pos
      checkInSpot(membership.gameId, membership.teamId, spotId, sq.lat, sq.lng, onlineConfig.coinReward).catch((e) =>
        alert('Check-in failed: ' + (e as Error).message),
      );
    });
  }
  // Score the online trivia, then clear the spot + award scaled coins via checkInSpot.
  function resolveOnlineQuiz() {
    if (!membership || !onlineBoard || !onlineQuizModal) return;
    const sq = onlineBoard.squares.find((s) => s.id === onlineQuizModal.spotId);
    if (!sq) return;
    const qs = sq.questions ?? [];
    const correct = qs.reduce((n, q, i) => n + (quizPick[i] === q.correct ? 1 : 0), 0);
    const base = sq.reward > 0 ? sq.reward : onlineConfig.coinReward;
    const award = qs.length ? Math.round((base * correct) / qs.length) : base;
    setOnlineCleared((c) => (c.includes(sq.id) ? c : [...c, sq.id]));
    checkInSpot(membership.gameId, membership.teamId, sq.id, sq.lat, sq.lng, award).catch((e) =>
      alert('Check-in failed: ' + (e as Error).message),
    );
    setQuizDone(true);
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
      setSelectedId(sq.id);
    }
  }

  function selectSquare(id: string) {
    setSelectedId(id || null);
    setSelectedVertex(null);
    setSelectedEdgeId(null);
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

  async function addSurroundings() {
    if (board.boundary.length < 3) {
      alert('Set the area first (Steps 1–2).');
      return;
    }
    setSceneryLoading(true);
    try {
      const scenery = await buildScenery(board.boundary, board.edges);
      setBoard((b) => ({ ...b, scenery }));
    } catch (err) {
      alert('Couldn’t load surroundings: ' + (err as Error).message + '\n(Overpass may be busy — try again.)');
    } finally {
      setSceneryLoading(false);
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

  return (
    <div className={`app${panelOpen ? '' : ' app--panel-collapsed'}`}>
      <aside className="sidebar">
        <header className="brand">
          <h1>🎲 Birthday Board</h1>
          <p className="sub">Lower East Side · Milwaukee</p>
        </header>

        <div className="stepper">
          <button
            className={`step ${appMode === 'design' ? 'step--on' : ''}`}
            onClick={() => setAppMode('design')}
          >
            ✎ Design
          </button>
          <button
            className={`step ${appMode === 'play' ? 'step--on' : ''}`}
            disabled={!spots.length}
            title={spots.length ? 'Play the board' : 'Draw a board first'}
            onClick={() => {
              setMode('select');
              setAppMode('play');
            }}
          >
            ▶ Play
          </button>
        </div>

        {appMode === 'play' ? (
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
            <p className="hint">{onlineCleared.length} spots cleared</p>
            <label className="toggle">
              <input type="checkbox" checked={gpsOn} onChange={(e) => setGpsOn(e.target.checked)} />
              Require GPS proximity (turn on at the party)
            </label>
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
            <button className="btn btn--ghost" onClick={() => setAppMode('design')}>
              Exit to design
            </button>
          </section>
        ) : (
        <>
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

        {/* STEP 3 · BOARD */}
        {phase === 'squares' && (
          <>
            <section className="panel">
              <h2>Step 3 · The board</h2>
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
              <button className="btn" onClick={addSurroundings} disabled={sceneryLoading}>
                {sceneryLoading
                  ? 'Loading surroundings…'
                  : board.scenery
                    ? '🎨 Refresh surroundings'
                    : '🎨 Add surroundings'}
              </button>
              <p className="hint">
                Draws the track along the streets; “surroundings” paints the river,
                parks, tree-lined streets, and real bars as stylized art.
              </p>
              <p className="hint">
                {mode === 'add'
                  ? `Click the map to place a ${SQUARE_TYPES[addType].label}.`
                  : 'Click a slab to retype / move / delete it · click a path to edit it.'}
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
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={board.enforceDirection}
                  onChange={(e) => setBoard((b) => ({ ...b, enforceDirection: e.target.checked }))}
                />
                Enforce one-way paths (order matters)
              </label>
              <button className="btn btn--ghost" onClick={() => goToPhase('area')}>← Edit the area</button>
              <p className="hint">{board.squares.length} spaces · {board.edges.length} paths</p>
            </section>

            {realBars.length > 0 ? (
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
                <h2>Real bars</h2>
                <p className="hint">Run “Add surroundings” to pull real bars from OSM — they’ll show up here to add with one click.</p>
              </section>
            )}

            {selectedEdge && (
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
              </section>
            )}

            {selected && (
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
                  <span>Reward (🪙 / magnitude)</span>
                  <input
                    type="number"
                    value={selected.reward}
                    onChange={(e) => updateSquare(selected.id, { reward: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>{selected.type === 'challenge' ? 'Notes / intro (shown above the questions)' : 'Notes / challenge details'}</span>
                  <textarea
                    rows={3}
                    value={selected.notes}
                    onChange={(e) => updateSquare(selected.id, { notes: e.target.value })}
                    placeholder="e.g. Count the ducks on the mural. More found = more 🪙."
                  />
                </label>
                {selected.type === 'challenge' && (
                  <div className="quiz-editor">
                    <span className="quiz-editor-label">Trivia questions (multiple choice)</span>
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
                <button className="btn btn--danger" onClick={() => removeSquare(selected.id)}>Delete space</button>
              </section>
            )}
          </>
        )}

        <section className="panel">
          <h2>☁ Board layouts</h2>
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
                <button className="btn" onClick={() => void newLayout(false)}>
                  ＋ New
                </button>
                <button className="btn" onClick={() => void newLayout(true)} disabled={!currentLayoutId}>
                  ⧉ Duplicate
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
              <p className="hint">
                {cloudStatus === 'saving'
                  ? 'Saving…'
                  : cloudStatus === 'loading'
                    ? 'Loading…'
                    : cloudStatus === 'error'
                      ? '⚠ Sync error — your next edit will retry.'
                      : currentLayoutId
                        ? 'All changes saved ✓'
                        : 'Pick or create a layout to sync.'}
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

        <section className="panel">
          <h2>Board file</h2>
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
        </>
        )}

        <section className="panel">
          <h2>
            🌐 Multiplayer <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 400 }}>beta</span>
          </h2>
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
              <p className="hint">
                Status: <b>{hostStatus}</b> · {teams.length} team{teams.length === 1 ? '' : 's'}
              </p>

              {hostStatus === 'lobby' && (
                <>
                  <div className="row">
                    <button className="btn" style={{ flex: 1 }} onClick={() => setHostConfig(PARTY_CONFIG)}>
                      Party preset
                    </button>
                    <button className="btn" style={{ flex: 1 }} onClick={() => setHostConfig(TEST_CONFIG)}>
                      Test (fast)
                    </button>
                  </div>
                  {cfgField('Star cost (🪙)', 'starCost')}
                  {cfgField('Star meter (sec)', 'meterSec')}
                  {cfgField('Spawn every ≥ (sec)', 'spawnMinSec')}
                  {cfgField('Spawn every ≤ (sec)', 'spawnMaxSec')}
                  {cfgField('Spawns total', 'spawnCount')}
                  {cfgField('Drop lasts (sec)', 'spawnTtlSec')}
                  {cfgField('Coins / check-in', 'coinReward')}
                  {cfgField('GPS radius (m)', 'radiusM')}
                  <button className="btn btn--go" onClick={doStart} disabled={netBusy}>
                    {netBusy ? '…' : '▶ Start game'}
                  </button>
                </>
              )}

              <p className="hint" style={{ marginTop: 6 }}>Standings</p>
              <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                {[...teams]
                  .sort((a, b) => b.stars - a.stars || b.coins - a.coins)
                  .map((t) => (
                    <div key={t.id} className="hint" style={{ margin: '2px 0' }}>
                      {t.emoji} {t.name} — 🪙 {t.coins} · ⭐ {t.stars}
                    </div>
                  ))}
              </div>

              {hostStatus === 'live' && (
                <button className="btn btn--danger" onClick={doEnd} disabled={netBusy}>
                  🏁 End game
                </button>
              )}
              {hostStatus === 'ended' && <p className="hint">Game ended — final standings above.</p>}
              <button className="btn btn--ghost" onClick={() => setHostGame(null)}>
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
      </aside>

      <main className="map-wrap">
        <button
          className="panel-toggle"
          onClick={() => setPanelOpen((o) => !o)}
          aria-label={panelOpen ? 'Hide the menu to expand the map' : 'Show the menu'}
        >
          {panelOpen ? '🗺️ Expand map' : '☰ Menu'}
        </button>
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
            const qs = sq?.questions ?? [];
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
    </div>
  );
}
