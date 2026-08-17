import type { Board } from './types';
import { supabase, assertConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Slice-1 data access: publish a board → game, join a game by code.
// ---------------------------------------------------------------------------

export interface GameRow {
  id: string;
  code: string;
  name: string;
  status: string;
}
export interface TeamRow {
  id: string;
  game_id: string;
  name: string;
  emoji: string;
  coins: number;
  stars: number;
  items: number;
}
/** What a phone remembers so it can rejoin its team after a refresh. */
export interface Membership {
  gameId: string;
  code: string;
  teamId: string;
  teamName: string;
}

const MEMBER_KEY = 'mke-membership-v1';
const DEVICE_KEY = 'mke-device-v1';
const HOST_KEY = 'mke-hostgame-v1';

/** Persist the hosted game so the dashboard survives a phone refresh mid-party. */
export function savedHostGame(): GameRow | null {
  try {
    return JSON.parse(localStorage.getItem(HOST_KEY) || 'null');
  } catch {
    return null;
  }
}
export function saveHostGame(g: GameRow | null) {
  if (g) localStorage.setItem(HOST_KEY, JSON.stringify(g));
  else localStorage.removeItem(HOST_KEY);
}

/** A stable per-phone secret proving ownership of a team. */
export function deviceId(): string {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) {
    d = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, d);
  }
  return d;
}

export function savedMembership(): Membership | null {
  try {
    return JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function saveMembership(m: Membership | null) {
  if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m));
  else localStorage.removeItem(MEMBER_KEY);
}

// ---------------------------------------------------------------------------
// Designer: shared, named board layouts. Steven & Abby edit the same boards
// from any device, and keep several named versions to switch between.
// ---------------------------------------------------------------------------

export interface LayoutMeta {
  id: string;
  name: string;
  updated_at: string;
  updated_by: string | null;
}

/** True when an error means the board_layouts table hasn't been created yet.
 * PostgREST surfaces a schema-cache miss as PGRST205; raw Postgres uses 42P01. */
export function isNoTableError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === 'PGRST205' || code === '42P01';
}

export async function listLayouts(): Promise<LayoutMeta[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('board_layouts')
    .select('id, name, updated_at, updated_by')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LayoutMeta[];
}

export async function getLayout(id: string): Promise<{ board: Board; name: string; updated_at: string }> {
  assertConfigured();
  const { data, error } = await supabase
    .from('board_layouts')
    .select('board, name, updated_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as { board: Board; name: string; updated_at: string };
}

/** Save the given board as a brand-new named layout. */
export async function createLayout(name: string, board: Board): Promise<LayoutMeta> {
  assertConfigured();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('board_layouts')
    .insert({ name, board, updated_by: deviceId(), updated_at: now })
    .select('id, name, updated_at, updated_by')
    .single();
  if (error) throw error;
  return data as LayoutMeta;
}

/** Overwrite a layout's board. Returns the timestamp we stamped (for echo suppression). */
export async function saveLayout(id: string, board: Board): Promise<string> {
  assertConfigured();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('board_layouts')
    .update({ board, updated_by: deviceId(), updated_at: now })
    .eq('id', id);
  if (error) throw error;
  return now;
}

export async function renameLayout(id: string, name: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('board_layouts').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteLayout(id: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('board_layouts').delete().eq('id', id);
  if (error) throw error;
}

export interface LayoutChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: (Partial<LayoutMeta> & { id?: string }) | null;
  old: { id?: string } | null;
}
/** Realtime: any layout added/edited/removed on another device. */
export function subscribeLayouts(onChange: (c: LayoutChange) => void) {
  const ch = supabase
    .channel('board_layouts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_layouts' }, (payload) => {
      onChange({
        eventType: payload.eventType as LayoutChange['eventType'],
        new: (payload.new as Partial<LayoutMeta>) ?? null,
        old: (payload.old as { id?: string }) ?? null,
      });
    })
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ---------------------------------------------------------------------------
// RSVP: public guest form → collected submissions (admin reads them).
// ---------------------------------------------------------------------------

export interface RsvpGuest {
  name: string;
}
export interface RsvpInput {
  name: string;
  coming: 'yes' | 'no' | 'maybe';
  guests: RsvpGuest[];
  duration: 'whole' | 'mid' | 'post' | '';
  group_pref: 'know' | 'meet' | 'dontcare' | '';
  note: string;
}
export interface RsvpRow extends RsvpInput {
  id: string;
  created_at: string;
}

export async function submitRsvp(r: RsvpInput): Promise<void> {
  assertConfigured();
  // plus_ones is kept in sync with the guest list for at-a-glance tallies.
  const { error } = await supabase.from('rsvps').insert({ ...r, plus_ones: r.guests.length });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Atomic coin changes (robbing / tolls) — via SQL functions in coins.sql.
// ---------------------------------------------------------------------------

/** Add/remove coins from a team (floored at 0). Returns the new balance. */
export async function adjustCoins(teamId: string, delta: number): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase.rpc('adjust_coins', { p_team: teamId, p_delta: delta });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Move up to `amount` coins from one team to another (conserving, floored).
 *  Returns the amount actually moved. */
export async function transferCoins(fromId: string, toId: string, amount: number): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase.rpc('transfer_coins', { p_from: fromId, p_to: toId, p_amount: amount });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Add/remove stars from a team (floored at 0). Returns the new count. */
export async function adjustStars(teamId: string, delta: number): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase.rpc('adjust_stars', { p_team: teamId, p_delta: delta });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Host live console: instant spawns + per-team fix-it actions.
// ---------------------------------------------------------------------------

/** Drop one bonus spawn RIGHT NOW at a random spot (host "prompt an event"). */
export async function dropSpawnNow(gameId: string, board: Board, ttlSec: number): Promise<void> {
  assertConfigured();
  const spots = boardSpots(board);
  if (!spots.length) throw new Error('board has no spots to spawn on');
  const sq = spots[Math.floor(Math.random() * spots.length)];
  const now = Date.now();
  const { error } = await supabase.from('spawns').insert({
    game_id: gameId,
    spot_id: sq.id,
    lat: sq.lat,
    lng: sq.lng,
    reward: 35 + Math.floor(Math.random() * 26),
    spawn_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlSec * 1000).toISOString(),
  });
  if (error) throw error;
}

/** Cancel a team's in-progress star claim(s) (marks them lost, frees the bar). */
export async function hostCancelStarClaims(gameId: string, teamId: string): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase
    .from('star_claims')
    .update({ status: 'lost' })
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .eq('status', 'claiming')
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Release every space a team owns (removes their tolls). */
export async function hostReleaseSpaces(gameId: string, teamId: string): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase
    .from('space_owners')
    .delete()
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Messaging: host ↔ teams and team ↔ team. from_team null = host;
// to_team null = everyone (from host) or to-the-host (from a team).
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: string;
  from_team: string | null;
  to_team: string | null;
  text: string;
  created_at: string;
}

export async function sendMessage(
  gameId: string,
  fromTeam: string | null,
  toTeam: string | null,
  text: string,
): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('messages').insert({ game_id: gameId, from_team: fromTeam, to_team: toTeam, text });
  if (error) throw error;
}

export async function listMessages(gameId: string): Promise<MessageRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('messages')
    .select('id, from_team, to_team, text, created_at')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export function subscribeMessages(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`msgs:${gameId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Un-clear one spot for a team so they can do it again. */
export async function hostUnclearSpot(gameId: string, teamId: string, spotId: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase
    .from('spot_claims')
    .delete()
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .eq('spot_id', spotId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Space ownership (own-a-space toll) — space_owners.sql.
// ---------------------------------------------------------------------------

export interface SpaceOwner {
  spot_id: string;
  team_id: string;
}

export async function listSpaceOwners(gameId: string): Promise<SpaceOwner[]> {
  assertConfigured();
  const { data, error } = await supabase.from('space_owners').select('spot_id, team_id').eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as SpaceOwner[];
}

export function subscribeSpaceOwners(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`owners:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'space_owners', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Claim (buy) a space. First claimer wins via the unique index; deducts the
 *  cost only on a successful, affordable claim. */
export async function claimSpace(
  gameId: string,
  spotId: string,
  teamId: string,
  cost: number,
): Promise<'ok' | 'taken' | 'nocoins'> {
  assertConfigured();
  const { data: team } = await supabase.from('teams').select('coins').eq('id', teamId).single();
  if (((team as { coins: number } | null)?.coins ?? 0) < cost) return 'nocoins';
  const { error } = await supabase.from('space_owners').insert({ game_id: gameId, spot_id: spotId, team_id: teamId });
  if (error) {
    if (error.code === '23505') return 'taken'; // someone already owns it
    throw error;
  }
  await adjustCoins(teamId, -cost);
  return 'ok';
}

// ---------------------------------------------------------------------------
// Photo trivia: resize client-side + upload to the trivia-photos bucket.
// ---------------------------------------------------------------------------

/** Downscale to a max dimension and re-encode as JPEG to keep uploads small. */
async function resizeImage(file: File, max = 900, quality = 0.72): Promise<Blob> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image decode failed'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality),
  );
}

/** Resize + upload a trivia photo, returning its public URL. */
export async function uploadTriviaPhoto(file: File): Promise<string> {
  assertConfigured();
  const blob = await resizeImage(file);
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('trivia-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('trivia-photos').getPublicUrl(path).data.publicUrl;
}

export async function deleteRsvp(id: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('rsvps').delete().eq('id', id);
  if (error) throw error;
}

export async function listRsvps(): Promise<RsvpRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('rsvps')
    .select('id, name, coming, guests, duration, group_pref, note, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...(r as RsvpRow),
    guests: Array.isArray((r as RsvpRow).guests) ? (r as RsvpRow).guests : [],
  }));
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars
function randomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/** Tunables the organizer sets per game (stored in games.config). */
export interface GameConfig {
  starCost: number; // coins to buy a round
  meterSec: number; // star meter length (seconds)
  spawnCount: number; // total drops in the game
  spawnMinSec: number; // interval between drops (min)
  spawnMaxSec: number; // interval between drops (max)
  spawnTtlSec: number; // how long an unclaimed drop lasts
  coinReward: number; // coins per spot check-in
  radiusM: number; // GPS check-in radius
  robAmount: number; // coins stolen on a "rob a team" chance
  claimCost: number; // coins to buy (own) a space on a claim chance
  tollAmount: number; // coins a visitor pays the owner of a space
}

/** Config value with a fallback (older published games lack newer fields). */
export const cfg = {
  robAmount: (c: Partial<GameConfig> | undefined) => c?.robAmount ?? 20,
  claimCost: (c: Partial<GameConfig> | undefined) => c?.claimCost ?? 20,
  tollAmount: (c: Partial<GameConfig> | undefined) => c?.tollAmount ?? 10,
};

export const PARTY_CONFIG: GameConfig = {
  starCost: 150,
  meterSec: 780,
  spawnCount: 12,
  spawnMinSec: 900,
  spawnMaxSec: 1500,
  spawnTtlSec: 300,
  coinReward: 15,
  radiusM: 35,
  robAmount: 20,
  claimCost: 20,
  tollAmount: 10,
};
export const TEST_CONFIG: GameConfig = {
  starCost: 40,
  meterSec: 15,
  spawnCount: 12,
  spawnMinSec: 12,
  spawnMaxSec: 24,
  spawnTtlSec: 40,
  coinReward: 15,
  radiusM: 35,
  robAmount: 20,
  claimCost: 20,
  tollAmount: 10,
};

export interface GameFull {
  id: string;
  code: string;
  name: string;
  status: string;
  config: GameConfig;
  started_at: string | null;
}

/** Organizer publishes the finished board → creates a game, returns its join code. */
export async function publishGame(name: string, board: Board, config: GameConfig): Promise<GameRow> {
  assertConfigured();
  // strip runtime-only state; the game only needs the layout + scenery
  const payload = { ...board, phase: 'squares' as const };
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const { data, error } = await supabase
      .from('games')
      .insert({ code, name, board: payload, status: 'lobby', config })
      .select('id, code, name, status')
      .single();
    if (!error && data) return data as GameRow;
    if (error && error.code !== '23505') throw error; // 23505 = unique violation → retry code
  }
  throw new Error('Could not allocate a game code — try again.');
}

export async function getGameFull(gameId: string): Promise<GameFull> {
  assertConfigured();
  const { data, error } = await supabase
    .from('games')
    .select('id, code, name, status, config, started_at')
    .eq('id', gameId)
    .single();
  if (error) throw error;
  return data as GameFull;
}

export function subscribeGame(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`game:${gameId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

export type GameStatus = 'lobby' | 'live' | 'paused' | 'ended';

export async function updateGameStatus(gameId: string, status: GameStatus): Promise<void> {
  assertConfigured();
  const patch: Record<string, unknown> = { status };
  if (status === 'live') patch.started_at = new Date().toISOString();
  const { error } = await supabase.from('games').update(patch).eq('id', gameId);
  if (error) throw error;
}

export async function updateGameConfig(gameId: string, config: GameConfig): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('games').update({ config }).eq('id', gameId);
  if (error) throw error;
}

export async function getGameByCode(code: string): Promise<GameRow | null> {
  assertConfigured();
  const { data, error } = await supabase
    .from('games')
    .select('id, code, name, status')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as GameRow) ?? null;
}

/** Fetch the full published board for a game (players load this to render). */
export async function getBoard(gameId: string): Promise<Board> {
  assertConfigured();
  const { data, error } = await supabase.from('games').select('board').eq('id', gameId).single();
  if (error) throw error;
  return (data as { board: Board }).board;
}

/** A player joins a game with a code + team name; creates the team, remembers it. */
export async function joinGame(code: string, teamName: string, emoji: string): Promise<Membership> {
  assertConfigured();
  const game = await getGameByCode(code);
  if (!game) throw new Error('No game with that code.');
  const { data, error } = await supabase
    .from('teams')
    .insert({ game_id: game.id, name: teamName.trim(), emoji, device: deviceId() })
    .select('id, name')
    .single();
  if (error) {
    // Name already exists → ATTACH this phone to that team (multi-phone teams:
    // several phones share one team + coin pot; joining by the same team name
    // is the "team code"). Safe because coin writes are atomic (adjust_coins).
    if (error.code === '23505') {
      const { data: existing, error: e2 } = await supabase
        .from('teams')
        .select('id, name')
        .eq('game_id', game.id)
        .eq('name', teamName.trim())
        .single();
      if (e2 || !existing) throw new Error('That team name is taken in this game.');
      const team = existing as { id: string; name: string };
      const m: Membership = { gameId: game.id, code: game.code, teamId: team.id, teamName: team.name };
      saveMembership(m);
      return m;
    }
    throw error;
  }
  const team = data as { id: string; name: string };
  const m: Membership = { gameId: game.id, code: game.code, teamId: team.id, teamName: team.name };
  saveMembership(m);
  return m;
}

export async function listTeams(gameId: string): Promise<TeamRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('teams')
    .select('id, game_id, name, emoji, coins, stars, items')
    .eq('game_id', gameId)
    .order('created_at');
  if (error) throw error;
  return (data as TeamRow[]) ?? [];
}

/** Subscribe to team changes in a game (join/leave/resource updates) → live lobby. */
export function subscribeTeams(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`teams:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ---------------------------------------------------------------------------
// Slice-2 data access: shared check-ins, coins, live positions.
// ---------------------------------------------------------------------------

export interface Position {
  team_id: string;
  lat: number;
  lng: number;
  spot_id: string | null;
}

/** Spot ids this team has already cleared (grays out for them). */
export async function myClaims(gameId: string, teamId: string): Promise<string[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('spot_claims')
    .select('spot_id')
    .eq('game_id', gameId)
    .eq('team_id', teamId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { spot_id: string }).spot_id);
}

/**
 * Check in at a spot: record the (per-team-unique) claim, award coins if it's
 * newly cleared, and update this team's live position. One phone per team, so the
 * read-modify-write on coins is safe without an RPC.
 */
export async function checkInSpot(
  gameId: string,
  teamId: string,
  spotId: string,
  lat: number,
  lng: number,
  reward: number,
): Promise<boolean> {
  assertConfigured();
  const { error } = await supabase.from('spot_claims').insert({ game_id: gameId, spot_id: spotId, team_id: teamId });
  const newly = !error;
  if (error && error.code !== '23505') throw error; // 23505 = already claimed by this team
  if (newly && reward) {
    await adjustCoins(teamId, reward); // atomic — safe when several phones share a team
  }
  await supabase
    .from('positions')
    .upsert({ team_id: teamId, game_id: gameId, lat, lng, spot_id: spotId, updated_at: new Date().toISOString() });
  return newly;
}

export async function listPositions(gameId: string): Promise<Position[]> {
  assertConfigured();
  const { data, error } = await supabase.from('positions').select('team_id, lat, lng, spot_id').eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as Position[];
}

export function subscribePositions(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`pos:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

export function subscribeClaims(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`claims:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spot_claims', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ---------------------------------------------------------------------------
// Slice-3 data access: shared first-come spawns (drops).
// ---------------------------------------------------------------------------

export interface SpawnRow {
  id: string;
  lat: number;
  lng: number;
  reward: number;
  spawn_at: string;
  expires_at: string;
  claimed_by: string | null;
}

function boardSpots(board: Board) {
  const deg = new Map<string, number>();
  for (const e of board.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || s.type !== 'blank');
}

/**
 * Pre-compute the whole spawn schedule for a game (organizer, once). Times are
 * absolute, so clients just show/claim by comparing to the clock — no live loop.
 * NOTE: test-speed intervals (seconds). At the real party, bump minSec/maxSec/ttl
 * to minutes.
 */
export async function seedSpawns(
  gameId: string,
  board: Board,
  count = 12,
  minSec = 12,
  maxSec = 24,
  ttlSec = 40,
): Promise<number> {
  assertConfigured();
  const spots = boardSpots(board);
  if (!spots.length) throw new Error('board has no spots to spawn on');
  const rows: Record<string, unknown>[] = [];
  let t = Date.now();
  for (let i = 0; i < count; i++) {
    t += (minSec + Math.random() * (maxSec - minSec)) * 1000;
    const sq = spots[Math.floor(Math.random() * spots.length)];
    rows.push({
      game_id: gameId,
      spot_id: sq.id,
      lat: sq.lat,
      lng: sq.lng,
      reward: 35 + Math.floor(Math.random() * 26),
      spawn_at: new Date(t).toISOString(),
      expires_at: new Date(t + ttlSec * 1000).toISOString(),
    });
  }
  const { error } = await supabase.from('spawns').insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function listSpawns(gameId: string): Promise<SpawnRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('spawns')
    .select('id, lat, lng, reward, spawn_at, expires_at, claimed_by')
    .eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as SpawnRow[];
}

export function subscribeSpawns(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`spawns:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spawns', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ---------------------------------------------------------------------------
// Slice-4 data access: shared star claims (buy-a-round meter, lock, contest).
// ---------------------------------------------------------------------------

export interface StarClaimRow {
  id: string;
  bar_spot_id: string;
  team_id: string;
  ends_at: string;
  status: string; // claiming | locked | lost
}

export async function listStarClaims(gameId: string): Promise<StarClaimRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('star_claims')
    .select('id, bar_spot_id, team_id, ends_at, status')
    .eq('game_id', gameId)
    .neq('status', 'lost');
  if (error) throw error;
  return (data ?? []) as StarClaimRow[];
}

export function subscribeStars(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`stars:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'star_claims', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Buy a round to start claiming a star. The partial-unique index makes at most
 * one active/locked claim per bar → 'taken' if someone's already on it. */
export async function buyRoundDb(
  gameId: string,
  teamId: string,
  barSpotId: string,
  cost: number,
  meterMs: number,
): Promise<'ok' | 'nocoins' | 'taken'> {
  assertConfigured();
  const { data: team } = await supabase.from('teams').select('coins').eq('id', teamId).single();
  const coins = (team as { coins: number } | null)?.coins ?? 0;
  if (coins < cost) return 'nocoins';
  const ends = new Date(Date.now() + meterMs).toISOString();
  const { error } = await supabase
    .from('star_claims')
    .insert({ game_id: gameId, bar_spot_id: barSpotId, team_id: teamId, ends_at: ends, status: 'claiming' });
  if (error) {
    if (error.code === '23505') return 'taken';
    throw error;
  }
  await adjustCoins(teamId, -cost); // atomic
  return 'ok';
}

/** Lock a finished meter → award the owning team a star. Guarded so exactly one
 * client (of the many that observe ends_at pass) actually locks it. */
export async function lockStar(claimId: string, ownerTeamId: string): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('star_claims')
    .update({ status: 'locked' })
    .eq('id', claimId)
    .eq('status', 'claiming')
    .select('id');
  if (error) throw error;
  const won = (data?.length ?? 0) > 0;
  if (won) {
    const { data: t } = await supabase.from('teams').select('stars').eq('id', ownerTeamId).single();
    await supabase
      .from('teams')
      .update({ stars: ((t as { stars: number } | null)?.stars ?? 0) + 1 })
      .eq('id', ownerTeamId);
  }
  return won;
}

/** On a won battle, the attacker takes over the meter (guarded on still-claiming). */
export async function stealStarClaim(claimId: string, attackerTeamId: string, meterMs: number): Promise<boolean> {
  assertConfigured();
  const ends = new Date(Date.now() + meterMs).toISOString();
  const { data, error } = await supabase
    .from('star_claims')
    .update({ team_id: attackerTeamId, ends_at: ends })
    .eq('id', claimId)
    .eq('status', 'claiming')
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Slice-5 data access: the shared activity feed (events table from slice 1).
// ---------------------------------------------------------------------------

export interface EventRow {
  id: string;
  ts: string;
  type: string; // star | spawn | battle | join
  payload: { text?: string };
}

export async function logEvent(gameId: string, type: string, text: string): Promise<void> {
  assertConfigured();
  await supabase.from('events').insert({ game_id: gameId, type, payload: { text } });
}

export async function listEvents(gameId: string, limit = 25): Promise<EventRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('events')
    .select('id, ts, type, payload')
    .eq('game_id', gameId)
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export function subscribeEvents(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`events:${gameId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** First-come claim: the guarded update lets exactly one team win the row. */
export async function claimSpawnDb(
  gameId: string,
  teamId: string,
  spawnId: string,
  reward: number,
  lat: number,
  lng: number,
): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('spawns')
    .update({ claimed_by: teamId })
    .eq('id', spawnId)
    .is('claimed_by', null) // atomic: only the first update sees it null
    .select('id');
  if (error) throw error;
  const won = (data?.length ?? 0) > 0;
  if (won) {
    await adjustCoins(teamId, reward); // atomic
    await supabase
      .from('positions')
      .upsert({ team_id: teamId, game_id: gameId, lat, lng, spot_id: null, updated_at: new Date().toISOString() });
  }
  return won;
}
