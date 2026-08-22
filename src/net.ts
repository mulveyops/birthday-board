import type { Board, ChanceCard, TriviaQuestion } from './types';
import { supabase, assertConfigured, isConfigured } from './supabase';

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
  /** 🧱 unspent reinforcement charges (reinforce.sql; absent pre-upgrade). */
  reinforcements?: number;
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
// Content: the shared trivia bank + chance deck (each entry its own row, so
// two people can author at once). Snapshotted into the board at publish.
// ---------------------------------------------------------------------------

export type ContentKind = 'trivia' | 'chance';
export interface ContentRow<T = TriviaQuestion | ChanceCard> {
  id: string;
  kind: ContentKind;
  data: T;
  pos: number;
  updated_at: string;
}

export async function listContent<T = TriviaQuestion | ChanceCard>(kind: ContentKind): Promise<ContentRow<T>[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('content')
    .select('id, kind, data, pos, updated_at')
    .eq('kind', kind)
    .order('pos', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ContentRow<T>[];
}

export async function addContent(kind: ContentKind, data: TriviaQuestion | ChanceCard, pos: number): Promise<ContentRow> {
  assertConfigured();
  const { data: row, error } = await supabase
    .from('content')
    .insert({ kind, data, pos })
    .select('id, kind, data, pos, updated_at')
    .single();
  if (error) throw error;
  return row as ContentRow;
}

export async function updateContent(id: string, data: TriviaQuestion | ChanceCard): Promise<void> {
  assertConfigured();
  const { error } = await supabase
    .from('content')
    .update({ data, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteContent(id: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('content').delete().eq('id', id);
  if (error) throw error;
}

/** Realtime: content added/edited/removed on another device. */
export function subscribeContent(onChange: () => void) {
  const ch = supabase
    .channel('content')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'content' }, onChange)
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

/** Release every corner a team has painted (host fix-it: wipes their turf). */
export async function hostReleaseTurf(gameId: string, teamId: string): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase
    .from('territory')
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
  /** 'all' | 'host:<teamId>' | 'dm:<a>:<b>' - null on pre-channel rows. */
  channel: string | null;
  text: string;
  created_at: string;
}

export async function sendMessage(
  gameId: string,
  fromTeam: string | null,
  toTeam: string | null,
  text: string,
  channel?: string,
): Promise<void> {
  assertConfigured();
  // channel arrives with channels.sql; fall back for a pre-upgrade DB (a team's
  // Party post then lands in its host thread - degraded but not lost).
  const { error } = await supabase
    .from('messages')
    .insert({ game_id: gameId, from_team: fromTeam, to_team: toTeam, text, channel: channel ?? null });
  if (!error) return;
  const { error: e2 } = await supabase
    .from('messages')
    .insert({ game_id: gameId, from_team: fromTeam, to_team: toTeam, text });
  if (e2) throw e2;
}

export async function listMessages(gameId: string): Promise<MessageRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('messages')
    .select('id, from_team, to_team, channel, text, created_at')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (!error) return (data ?? []) as MessageRow[];
  const { data: legacy, error: e2 } = await supabase
    .from('messages')
    .select('id, from_team, to_team, text, created_at')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (e2) throw e2;
  return ((legacy ?? []) as Omit<MessageRow, 'channel'>[]).map((m) => ({ ...m, channel: null }));
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

// ---------------------------------------------------------------------------
// Ambushes: two allied teams escrow coins on a spot; a third team springs it.
// ---------------------------------------------------------------------------

export interface AmbushRow {
  id: string;
  spot_id: string;
  initiator: string;
  ally: string;
  victim: string | null;
  status: string; // proposed | armed | sprung | won | lost | cancelled
}

/** Active-ish ambushes for a game (proposed/armed/sprung). */
export async function listAmbushes(gameId: string): Promise<AmbushRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('ambushes')
    .select('id, spot_id, initiator, ally, victim, status')
    .eq('game_id', gameId)
    .in('status', ['proposed', 'armed', 'sprung']);
  if (error) throw error;
  return (data ?? []) as AmbushRow[];
}

export function subscribeAmbushes(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`ambush:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ambushes', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Propose a trap: escrow the initiator's stake. The partial-unique index makes
 *  at most one active trap per spot → 'taken' if someone beat you to it. */
export async function proposeAmbush(
  gameId: string,
  spotId: string,
  initiatorId: string,
  allyId: string,
  stake: number,
): Promise<'ok' | 'taken' | 'nocoins'> {
  assertConfigured();
  const { data: team } = await supabase.from('teams').select('coins').eq('id', initiatorId).single();
  if (((team as { coins: number } | null)?.coins ?? 0) < stake) return 'nocoins';
  const { error } = await supabase
    .from('ambushes')
    .insert({ game_id: gameId, spot_id: spotId, initiator: initiatorId, ally: allyId, status: 'proposed' });
  if (error) {
    if (error.code === '23505') return 'taken';
    throw error;
  }
  await adjustCoins(initiatorId, -stake);
  return 'ok';
}

/** Ally answers a proposal. Accept escrows their stake; decline refunds the
 *  initiator. Guarded on status so it happens exactly once. */
export async function respondAmbush(
  a: AmbushRow,
  accept: boolean,
  stake: number,
): Promise<'ok' | 'nocoins' | 'gone'> {
  assertConfigured();
  if (accept) {
    const { data: team } = await supabase.from('teams').select('coins').eq('id', a.ally).single();
    if (((team as { coins: number } | null)?.coins ?? 0) < stake) return 'nocoins';
  }
  const { data, error } = await supabase
    .from('ambushes')
    .update({ status: accept ? 'armed' : 'cancelled' })
    .eq('id', a.id)
    .eq('status', 'proposed')
    .select('id');
  if (error) throw error;
  if (!(data?.length ?? 0)) return 'gone';
  if (accept) await adjustCoins(a.ally, -stake);
  else await adjustCoins(a.initiator, stake); // refund
  return 'ok';
}

/** Initiator withdraws an unanswered proposal (refunds their stake). */
export async function cancelAmbush(a: AmbushRow, stake: number): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('ambushes')
    .update({ status: 'cancelled' })
    .eq('id', a.id)
    .eq('status', 'proposed')
    .select('id');
  if (error) throw error;
  const ok = (data?.length ?? 0) > 0;
  if (ok) await adjustCoins(a.initiator, stake);
  return ok;
}

/** A victim steps on an armed trap. Guarded → exactly one springer. */
export async function springAmbush(ambushId: string, victimId: string): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('ambushes')
    .update({ status: 'sprung', victim: victimId, sprung_at: new Date().toISOString() })
    .eq('id', ambushId)
    .eq('status', 'armed')
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Report the showdown result (guarded → exactly one reporter pays out).
 *  Ambushers win: pot back + each steals `reward` from the victim.
 *  Victim wins: they take the whole pot. */
export async function resolveAmbush(
  a: AmbushRow,
  ambushersWon: boolean,
  stake: number,
  reward: number,
): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('ambushes')
    .update({ status: ambushersWon ? 'won' : 'lost' })
    .eq('id', a.id)
    .eq('status', 'sprung')
    .select('id');
  if (error) throw error;
  if (!(data?.length ?? 0)) return false;
  if (ambushersWon) {
    await adjustCoins(a.initiator, stake);
    await adjustCoins(a.ally, stake);
    if (a.victim) {
      await transferCoins(a.victim, a.initiator, reward);
      await transferCoins(a.victim, a.ally, reward);
    }
  } else if (a.victim) {
    await adjustCoins(a.victim, stake * 2);
  }
  return true;
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
// (The own-a-space toll mechanic retired 2026-08-19 — turf reinforcement
// replaced it. space_owners.sql's table is dormant; nothing reads it.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Territory (turf) — territory.sql. Corners a team paints by clearing them;
// runs of consecutive owned corners pay coins per tick; steals flip a row.
// ---------------------------------------------------------------------------

export interface TerritoryRow {
  spot_id: string;
  team_id: string;
  /** 🧱 fortified — steals here are a gauntlet and a miss forfeits coins. */
  reinforced?: boolean;
}

export async function listTerritory(gameId: string): Promise<TerritoryRow[]> {
  assertConfigured();
  // `reinforced` arrives with reinforce.sql; fall back for a pre-upgrade DB.
  const { data, error } = await supabase
    .from('territory')
    .select('spot_id, team_id, reinforced')
    .eq('game_id', gameId);
  if (!error) return (data ?? []) as TerritoryRow[];
  const { data: legacy, error: e2 } = await supabase.from('territory').select('spot_id, team_id').eq('game_id', gameId);
  if (e2) throw e2;
  return (legacy ?? []) as TerritoryRow[];
}

export function subscribeTerritory(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`territory:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'territory', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Paint an unowned corner. 'taken' when any team (maybe us) already owns it. */
export async function claimTerritory(gameId: string, spotId: string, teamId: string): Promise<'ok' | 'taken'> {
  assertConfigured();
  const { error } = await supabase.from('territory').insert({ game_id: gameId, spot_id: spotId, team_id: teamId });
  if (error) {
    if (error.code === '23505') return 'taken';
    throw error;
  }
  return 'ok';
}

/** Flip a rival's corner after a won steal play. Guarded on the expected old
 * owner → exactly one simultaneous steal wins; false = it already changed hands. */
export async function stealTerritory(
  gameId: string,
  spotId: string,
  attackerId: string,
  defenderId: string,
): Promise<boolean> {
  assertConfigured();
  // A stolen corner loses its reinforcement (fall back pre-reinforce.sql).
  const patch = { team_id: attackerId, claimed_at: new Date().toISOString() };
  const flip = (extra: Record<string, unknown>) =>
    supabase
      .from('territory')
      .update({ ...patch, ...extra })
      .eq('game_id', gameId)
      .eq('spot_id', spotId)
      .eq('team_id', defenderId)
      .select('id');
  let { data, error } = await flip({ reinforced: false });
  if (error) ({ data, error } = await flip({}));
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Spend one 🧱 charge to fortify a corner you own. Read-modify-write on the
 * charge count matches the existing lockStar pattern (atomic enough at party
 * scale); the corner flag itself is a guarded update. */
export async function reinforceCorner(
  gameId: string,
  spotId: string,
  teamId: string,
): Promise<'ok' | 'nocharge' | 'gone'> {
  assertConfigured();
  const { data: team, error: e0 } = await supabase.from('teams').select('reinforcements').eq('id', teamId).single();
  if (e0) throw e0;
  const have = (team as { reinforcements?: number } | null)?.reinforcements ?? 0;
  if (have < 1) return 'nocharge';
  const { data, error } = await supabase
    .from('territory')
    .update({ reinforced: true })
    .eq('game_id', gameId)
    .eq('spot_id', spotId)
    .eq('team_id', teamId)
    .eq('reinforced', false)
    .select('id');
  if (error) throw error;
  if (!(data?.length ?? 0)) return 'gone'; // already reinforced, or just stolen
  await supabase.from('teams').update({ reinforcements: have - 1 }).eq('id', teamId);
  return 'ok';
}

/** Award a 🧱 charge (chance-card prize). */
export async function grantReinforcement(teamId: string): Promise<number> {
  assertConfigured();
  const { data: team, error: e0 } = await supabase.from('teams').select('reinforcements').eq('id', teamId).single();
  if (e0) throw e0;
  const next = ((team as { reinforcements?: number } | null)?.reinforcements ?? 0) + 1;
  const { error } = await supabase.from('teams').update({ reinforcements: next }).eq('id', teamId);
  if (error) throw error;
  return next;
}

export interface RaidLockRow {
  attacker: string;
  defender: string;
  until_ts: string;
}

export async function listRaidLocks(gameId: string): Promise<RaidLockRow[]> {
  assertConfigured();
  const { data, error } = await supabase.from('raid_locks').select('attacker, defender, until_ts').eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as RaidLockRow[];
}

export function subscribeRaidLocks(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`raids:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'raid_locks', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Record a failed steal: this attacker can't hit that defender until `until`. */
export async function setRaidLock(gameId: string, attacker: string, defender: string, untilIso: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase
    .from('raid_locks')
    .upsert(
      { game_id: gameId, attacker, defender, until_ts: untilIso },
      { onConflict: 'game_id,attacker,defender' },
    );
  if (error) throw error;
}

/** Win the right to pay out one income tick (guarded insert → exactly one payer). */
export async function claimTerritoryTick(gameId: string, tickNo: number, teamId: string | null): Promise<boolean> {
  assertConfigured();
  const { error } = await supabase
    .from('territory_ticks')
    .insert({ game_id: gameId, tick_no: tickNo, paid_by: teamId });
  if (error) {
    if (error.code === '23505') return false; // someone else is paying this tick
    throw error;
  }
  return true;
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

// ---------------------------------------------------------------------------
// Party Cam: the shared photo album, and the drink check that pays for it.
// A photo with drinks > 0 is a claim ("here's my team holding 3 drinks") and
// pays on submit — no queue, no waiting. A host or ref vetoes a bogus one and
// the coins come straight back off. See supabase/photos.sql.
// ---------------------------------------------------------------------------

export interface PhotoRow {
  id: string;
  game_id: string;
  team_id: string | null;
  team_name: string;
  team_emoji: string;
  url: string;
  caption: string;
  drinks: number;
  coins: number;
  vetoed: boolean;
  created_at: string;
}

/** Keepsake quality: big enough to see who's who, small enough for bar wifi. */
export async function uploadPartyPhoto(gameId: string, file: File): Promise<string> {
  assertConfigured();
  const blob = await resizeImage(file, 1600, 0.85);
  const path = `${gameId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('party-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('party-photos').getPublicUrl(path).data.publicUrl;
}

/**
 * Post a photo, paying the drink bounty immediately when one is claimed.
 * The coins are paid FIRST: if the award fails we'd rather drop the post than
 * leave a row claiming coins that never landed. Returns the coins paid.
 */
export async function submitPhoto(args: {
  gameId: string;
  teamId: string;
  teamName: string;
  teamEmoji: string;
  url: string;
  caption: string;
  drinks: number;
  perDrink: number;
}): Promise<number> {
  assertConfigured();
  const drinks = Math.max(0, Math.round(args.drinks));
  const coins = drinks * Math.max(0, Math.round(args.perDrink));
  if (coins > 0) await adjustCoins(args.teamId, coins);
  const { error } = await supabase.from('photos').insert({
    game_id: args.gameId,
    team_id: args.teamId,
    team_name: args.teamName,
    team_emoji: args.teamEmoji,
    url: args.url,
    caption: args.caption,
    drinks,
    coins,
  });
  if (error) {
    // Paid but not recorded: hand the coins back. Otherwise the team is up N
    // coins with nothing in the album for anyone to veto.
    if (coins > 0) await adjustCoins(args.teamId, -coins).catch(() => {});
    throw error;
  }
  return coins;
}

export async function listPhotos(gameId: string): Promise<PhotoRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) throw error;
  return (data ?? []) as PhotoRow[];
}

export function subscribePhotos(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`photos:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photos', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/**
 * Veto a drink check: guarded flip (only an un-vetoed row flips) so two admin
 * phones can't refund the same photo twice. Returns false if it was already
 * vetoed. The picture stays in the gallery — only the coins go away.
 */
export async function vetoPhoto(photo: PhotoRow): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('photos')
    .update({ vetoed: true })
    .eq('id', photo.id)
    .eq('vetoed', false)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  if (photo.coins > 0 && photo.team_id) await adjustCoins(photo.team_id, -photo.coins);
  return true;
}

/** Undo a veto (fat fingers happen on a phone) — pays the coins back. */
export async function unvetoPhoto(photo: PhotoRow): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('photos')
    .update({ vetoed: false })
    .eq('id', photo.id)
    .eq('vetoed', true)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  if (photo.coins > 0 && photo.team_id) await adjustCoins(photo.team_id, photo.coins);
  return true;
}

/** Pull a photo out of the album entirely (the file itself stays in storage). */
export async function deletePhoto(id: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('photos').delete().eq('id', id);
  if (error) throw error;
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
  ambushStake: number; // coins each ambusher escrows to arm a trap
  ambushReward: number; // coins each ambusher steals from the victim on a win
  territoryTickSec: number; // turf income interval; each tick pays longest-run coins
  stealLockSec: number; // failed steal → can't hit that team again for this long
  reinforceForfeit: number; // retired with 🧱; kept so older games still load
  defendRadiusM: number; // defender's fresh check-in within this → home-turf defense
  gpsRequired: boolean; // check-ins demand physical presence (HOST setting, not the player's)
  starIntervalSec: number; // a star lands at a bar this often (0 = admin drops only)
  drinkCoins: number; // coins per drink on a photo-verified drink check
  chainMultiplier: number; // turf income = longest chain x this, per tick
  stealBounty: number; // coins a successful turf steal takes off the loser
  campTickSec: number; // how often a camper must ping "still here"
  campStep: number; // first interval pays this, and each one pays this much more
  campMaxStep: number; // ...until an interval is worth this much
  campBankCap: number; // the bank stops growing here, so a quiet corner can't win it
  campRaidPct: number; // share of the bank a successful raider takes
  questChance: number; // 0-100 share of a plain space's outcomes that are a side quest
  chanceShare: number; // 0-100 share that draws a chance card. Retired to 0: a card
                        // was a side quest you didn't get to play.
  tagWindowSec: number; // how close behind your mark you have to check in
  tagQuestSec: number; // how long a hunt stays open before they've evaded you
  tagSteal: number; // coins taken off the mark when you land it
  tagEvade: number; // coins the mark collects for never being caught
  reconSec: number; // how long you must hold a spot for the intel
  reconSteal: number; // coins a challenger takes if they beat you at it
  ambushSec: number; // how long a trap stays armed
  ambushTake: number; // coins taken off whoever walks into it
  ambushBackfire: number; // coins you forfeit if they beat you instead
  duelTimeoutSec: number; // an unanswered duel gives up rather than haunting two phones
  explorerSec: number; // how long you get to reach the place in the photo
  explorerReward: number; // coins for getting there clean
  explorerMinM: number; // never send someone somewhere they can already see
}

/** Config value with a fallback (older published games lack newer fields). */
export const cfg = {
  robAmount: (c: Partial<GameConfig> | undefined) => c?.robAmount ?? 20,
  claimCost: (c: Partial<GameConfig> | undefined) => c?.claimCost ?? 20,
  tollAmount: (c: Partial<GameConfig> | undefined) => c?.tollAmount ?? 10,
  ambushStake: (c: Partial<GameConfig> | undefined) => c?.ambushStake ?? 20,
  ambushReward: (c: Partial<GameConfig> | undefined) => c?.ambushReward ?? 25,
  territoryTickSec: (c: Partial<GameConfig> | undefined) => c?.territoryTickSec ?? 600,
  stealLockSec: (c: Partial<GameConfig> | undefined) => c?.stealLockSec ?? 600,
  reinforceForfeit: (c: Partial<GameConfig> | undefined) => c?.reinforceForfeit ?? 50,
  defendRadiusM: (c: Partial<GameConfig> | undefined) => c?.defendRadiusM ?? 75,
  // Default TRUE: an older published game must fail toward "you have to be there".
  gpsRequired: (c: Partial<GameConfig> | undefined) => c?.gpsRequired ?? true,
  starIntervalSec: (c: Partial<GameConfig> | undefined) => c?.starIntervalSec ?? 1200,
  drinkCoins: (c: Partial<GameConfig> | undefined) => c?.drinkCoins ?? 5,
  chainMultiplier: (c: Partial<GameConfig> | undefined) => c?.chainMultiplier ?? 2,
  stealBounty: (c: Partial<GameConfig> | undefined) => c?.stealBounty ?? 10,
  campTickSec: (c: Partial<GameConfig> | undefined) => c?.campTickSec ?? 300,
  campStep: (c: Partial<GameConfig> | undefined) => c?.campStep ?? 5,
  campMaxStep: (c: Partial<GameConfig> | undefined) => c?.campMaxStep ?? 20,
  campBankCap: (c: Partial<GameConfig> | undefined) => c?.campBankCap ?? 100,
  campRaidPct: (c: Partial<GameConfig> | undefined) => c?.campRaidPct ?? 50,
  questChance: (c: Partial<GameConfig> | undefined) => c?.questChance ?? 25,
  chanceShare: (c: Partial<GameConfig> | undefined) => c?.chanceShare ?? 0,
  tagWindowSec: (c: Partial<GameConfig> | undefined) => c?.tagWindowSec ?? 120,
  tagQuestSec: (c: Partial<GameConfig> | undefined) => c?.tagQuestSec ?? 900,
  tagSteal: (c: Partial<GameConfig> | undefined) => c?.tagSteal ?? 50,
  tagEvade: (c: Partial<GameConfig> | undefined) => c?.tagEvade ?? 25,
  reconSec: (c: Partial<GameConfig> | undefined) => c?.reconSec ?? 600,
  reconSteal: (c: Partial<GameConfig> | undefined) => c?.reconSteal ?? 50,
  ambushSec: (c: Partial<GameConfig> | undefined) => c?.ambushSec ?? 600,
  ambushTake: (c: Partial<GameConfig> | undefined) => c?.ambushTake ?? 75,
  ambushBackfire: (c: Partial<GameConfig> | undefined) => c?.ambushBackfire ?? 25,
  duelTimeoutSec: (c: Partial<GameConfig> | undefined) => c?.duelTimeoutSec ?? 600,
  explorerSec: (c: Partial<GameConfig> | undefined) => c?.explorerSec ?? 900,
  explorerReward: (c: Partial<GameConfig> | undefined) => c?.explorerReward ?? 50,
  explorerMinM: (c: Partial<GameConfig> | undefined) => c?.explorerMinM ?? 250,
};

export const PARTY_CONFIG: GameConfig = {
  // 100, not 150: a star is the win condition and it should be reachable from a
  // good hour rather than a whole afternoon of saving.
  starCost: 100,
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
  ambushStake: 20,
  ambushReward: 25,
  territoryTickSec: 600,
  stealLockSec: 600,
  reinforceForfeit: 50,
  defendRadiusM: 75,
  gpsRequired: true,
  starIntervalSec: 1200,
  drinkCoins: 5,
  chainMultiplier: 2,
  stealBounty: 10,
  campTickSec: 300,
  campStep: 5,
  campMaxStep: 20,
  campBankCap: 100,
  campRaidPct: 50,
  questChance: 25,
  chanceShare: 0,
  tagWindowSec: 120,
  tagQuestSec: 900,
  tagSteal: 50,
  tagEvade: 25,
  reconSec: 600,
  reconSteal: 50,
  ambushSec: 600,
  ambushTake: 75,
  ambushBackfire: 25,
  duelTimeoutSec: 600,
  explorerSec: 900,
  explorerReward: 50,
  explorerMinM: 250,
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
  ambushStake: 20,
  ambushReward: 25,
  territoryTickSec: 20,
  stealLockSec: 30,
  reinforceForfeit: 50,
  defendRadiusM: 75,
  gpsRequired: false,
  starIntervalSec: 90,
  drinkCoins: 5,
  chainMultiplier: 2,
  stealBounty: 10,
  campTickSec: 20,
  campStep: 5,
  campMaxStep: 20,
  campBankCap: 100,
  campRaidPct: 50,
  questChance: 25,
  chanceShare: 0,
  tagWindowSec: 120,
  tagQuestSec: 900,
  tagSteal: 50,
  tagEvade: 25,
  reconSec: 600,
  reconSteal: 50,
  ambushSec: 600,
  ambushTake: 75,
  ambushBackfire: 25,
  duelTimeoutSec: 600,
  explorerSec: 900,
  explorerReward: 50,
  explorerMinM: 250,
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
  // Freeze the shared trivia bank + chance deck into the game so mid-party
  // content edits can't shift what's live. Tolerate a missing content table.
  try {
    const [bank, deck] = await Promise.all([listContent<TriviaQuestion>('trivia'), listContent<ChanceCard>('chance')]);
    // The content-row id becomes the canonical id, so Square.questionIds/cardIds resolve.
    payload.triviaBank = bank.map((r) => ({ ...r.data, id: r.id }));
    payload.chanceDeck = deck.map((r) => ({ ...r.data, id: r.id }));
  } catch {
    /* content table not set up yet → publish without a bank/deck */
  }
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
  // `reinforcements` arrives with reinforce.sql; fall back for a pre-upgrade DB.
  const { data, error } = await supabase
    .from('teams')
    .select('id, game_id, name, emoji, coins, stars, items, reinforcements')
    .eq('game_id', gameId)
    .order('created_at');
  if (!error) return (data as TeamRow[]) ?? [];
  const { data: legacy, error: e2 } = await supabase
    .from('teams')
    .select('id, game_id, name, emoji, coins, stars, items')
    .eq('game_id', gameId)
    .order('created_at');
  if (e2) throw e2;
  return (legacy as TeamRow[]) ?? [];
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
  /** When this last check-in happened — home-turf defense needs freshness. */
  updated_at?: string;
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
  const { data, error } = await supabase.from('positions').select('team_id, lat, lng, spot_id, updated_at').eq('game_id', gameId);
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

// Placed on purpose and allowed to sit mid-block: landmarks are real
// buildings, and start/finish/Bowser are authored one-offs. Everything else
// - the generated coin/chance/challenge spaces - has to be at a junction.
const OFF_JUNCTION_OK = new Set(['poi', 'bar', 'start', 'finish', 'bowser']);
function boardSpots(board: Board) {
  const deg = new Map<string, number>();
  for (const e of board.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  // Same rule as deriveSpots/intersections: crossings only.
  return board.squares.filter((s) => (deg.get(s.id) ?? 0) >= 3 || OFF_JUNCTION_OK.has(s.type));
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
// Star spawns: stars LAND at bars over time; buy-a-round needs a landed star.
// ---------------------------------------------------------------------------

export interface StarSpawnRow {
  id: string;
  bar_spot_id: string;
  tick_no: number | null;
  created_at: string;
}

export async function listStarSpawns(gameId: string): Promise<StarSpawnRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('star_spawns')
    .select('id, bar_spot_id, tick_no, created_at')
    .eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as StarSpawnRow[];
}

export function subscribeStarSpawns(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`star_spawns:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'star_spawns', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Land a star at a bar. For auto drops pass the star tick number — the partial
 * unique index elects exactly one client (23505 → someone else landed it).
 * Admin-forced drops pass null and always land. */
export async function dropStar(gameId: string, barSpotId: string, tickNo: number | null): Promise<boolean> {
  assertConfigured();
  const { error } = await supabase.from('star_spawns').insert({ game_id: gameId, bar_spot_id: barSpotId, tick_no: tickNo });
  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
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

// Trivia answer log (supabase/trivia_answers.sql): analytics only — which
// questions turned out hard, and how each team did. Nothing in the game reads
// it back, so callers fire and forget.

/** Where a question was asked. Steals are the high-pressure ones. */
export type TriviaContext = 'spot' | 'bowser' | 'steal';

/**
 * Record one row per answered question. Unanswered questions (a modal closed
 * early) are skipped. Never throws: a stats write must not interrupt play.
 */
export async function logTriviaAnswers(
  gameId: string,
  teamId: string,
  context: TriviaContext,
  spotId: string | null,
  questions: TriviaQuestion[],
  picks: Record<number, number>,
): Promise<void> {
  if (!isConfigured) return;
  const rows = questions
    .map((q, i) => ({ q, pick: picks[i] }))
    .filter((r) => r.pick != null)
    .map(({ q, pick }) => ({
      game_id: gameId,
      team_id: teamId,
      context,
      spot_id: spotId,
      question_id: q.id ?? null,
      question: q.q,
      choices: q.choices,
      pick,
      correct: q.correct,
      is_correct: pick === q.correct,
    }));
  if (!rows.length) return;
  const { error } = await supabase.from('trivia_answers').insert(rows);
  if (error) console.warn('trivia_answers insert failed', error.message);
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

// ---------------------------------------------------------------------------
// Duels: any head-to-head real life decides. Both phones show the same prompt
// and the same two buttons; the first tap resolves it, guarded, so a race
// can't pay out twice. See supabase/duels_camps.sql.
// ---------------------------------------------------------------------------

export type DuelKind = 'camp' | 'quest' | 'battle';

export interface DuelRow {
  id: string;
  game_id: string;
  challenger: string;
  opponent: string;
  kind: DuelKind;
  prompt: string;
  stake: number;
  spot_id: string | null;
  status: 'open' | 'done' | 'cancelled';
  winner: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Throw down. Returns null if a duel between these two is already open here. */
export async function startDuel(args: {
  gameId: string;
  challenger: string;
  opponent: string;
  kind: DuelKind;
  prompt: string;
  stake: number;
  spotId?: string | null;
}): Promise<DuelRow | null> {
  assertConfigured();
  const { data, error } = await supabase
    .from('duels')
    .insert({
      game_id: args.gameId,
      challenger: args.challenger,
      opponent: args.opponent,
      kind: args.kind,
      prompt: args.prompt,
      stake: args.stake,
      spot_id: args.spotId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return null; // one's already running
    throw error;
  }
  return data as DuelRow;
}

export async function listDuels(gameId: string): Promise<DuelRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as DuelRow[];
}

export function subscribeDuels(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`duels:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'duels', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/**
 * Call it: guarded so only the first phone to report wins the race and the
 * caller knows whether IT is the one that should pay out.
 */
export async function resolveDuel(id: string, winner: string): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('duels')
    .update({ status: 'done', winner, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open')
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

export async function cancelDuel(id: string): Promise<void> {
  assertConfigured();
  await supabase.from('duels').update({ status: 'cancelled' }).eq('id', id).eq('status', 'open');
}

// ---------------------------------------------------------------------------
// Camps: sit still and coins pile up, faster the longer you stay — but they
// only pay out when you leave and check in somewhere else, and anyone who
// finds you can challenge for half. Timestamp-driven like everything else
// here: the camper's own phone pings, and the ping IS the accrual.
// ---------------------------------------------------------------------------

export interface CampRow {
  id: string;
  game_id: string;
  team_id: string;
  spot_id: string;
  started_at: string;
  last_ping: string;
  ticks: number;
  banked: number;
  status: 'active' | 'collected' | 'raided' | 'lapsed';
}

/** What the next interval pays: grows by `step` each time, up to `maxStep`. */
export function campIncrement(ticks: number, step: number, maxStep: number): number {
  return Math.min(step * (ticks + 1), maxStep);
}

/** Pitch up. Returns null if this team is already camped somewhere. */
export async function startCamp(gameId: string, teamId: string, spotId: string): Promise<CampRow | null> {
  assertConfigured();
  const { data, error } = await supabase
    .from('camps')
    .insert({ game_id: gameId, team_id: teamId, spot_id: spotId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return null; // already camping
    throw error;
  }
  return data as CampRow;
}

/**
 * "Still here." Guarded on the tick count we think we're on, so two phones
 * sharing a team can't double-bank the same interval. `ticks` resets to 0 when
 * a ping is missed — the bank survives, but the escalation starts over.
 */
export async function pingCamp(
  camp: CampRow,
  opts: { step: number; maxStep: number; cap: number; lapsed: boolean },
): Promise<CampRow | null> {
  assertConfigured();
  // A lapse rewinds the streak to zero, but the ping still pays what a fresh
  // camp's first interval pays — losing the escalation is the penalty, and a
  // ping that visibly banks nothing just reads as broken.
  const ticks = opts.lapsed ? 0 : camp.ticks;
  const gain = campIncrement(ticks, opts.step, opts.maxStep);
  const { data, error } = await supabase
    .from('camps')
    .update({
      ticks: ticks + 1,
      banked: Math.min(camp.banked + gain, opts.cap),
      last_ping: new Date().toISOString(),
    })
    .eq('id', camp.id)
    .eq('status', 'active')
    .eq('ticks', camp.ticks)
    .select('*');
  if (error) throw error;
  return data && data.length ? (data[0] as CampRow) : null;
}

/** Break camp and carry the coins out. Returns what to pay, or 0 if beaten. */
export async function collectCamp(campId: string): Promise<number> {
  assertConfigured();
  const { data, error } = await supabase
    .from('camps')
    .update({ status: 'collected' })
    .eq('id', campId)
    .eq('status', 'active')
    .select('banked');
  if (error) throw error;
  return data && data.length ? (data[0] as { banked: number }).banked : 0;
}

/**
 * A raid took `amount` off the bank. Guarded on the balance we saw, so the
 * raider can't take half twice. The escalation resets — that's the real sting.
 */
export async function raidCamp(camp: CampRow, amount: number): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('camps')
    .update({ banked: Math.max(0, camp.banked - amount), ticks: 0 })
    .eq('id', camp.id)
    .eq('status', 'active')
    .eq('banked', camp.banked)
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

export async function listCamps(gameId: string): Promise<CampRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('camps')
    .select('*')
    .eq('game_id', gameId)
    .eq('status', 'active');
  if (error) throw error;
  return (data ?? []) as CampRow[];
}

export function subscribeCamps(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`camps:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'camps', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ---------------------------------------------------------------------------
// Side quests. One per team at a time — see supabase/quests.sql. A quest runs
// alongside normal play rather than blocking it: TAG can't work otherwise,
// since tagging someone IS a check-in.
// ---------------------------------------------------------------------------

export type QuestKind = 'tag' | 'explorer' | 'ambush' | 'recon' | 'wanted';

export interface QuestRow {
  id: string;
  game_id: string;
  team_id: string;
  kind: QuestKind;
  target_team: string | null;
  target_spot: string | null;
  from_spot: string | null;
  /** Ambush only: the game the trapper picked, read by the victim's phone. */
  choice: string | null;
  status: 'active' | 'done' | 'failed';
  reward: number;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
}

/** Take the job. Returns null if this team already has one running. */
export async function acceptQuest(args: {
  gameId: string;
  teamId: string;
  kind: QuestKind;
  targetTeam?: string | null;
  targetSpot?: string | null;
  fromSpot?: string | null;
  choice?: string | null;
  reward: number;
  seconds: number;
}): Promise<QuestRow | null> {
  assertConfigured();
  const { data, error } = await supabase
    .from('quests')
    .insert({
      game_id: args.gameId,
      team_id: args.teamId,
      kind: args.kind,
      target_team: args.targetTeam ?? null,
      target_spot: args.targetSpot ?? null,
      from_spot: args.fromSpot ?? null,
      choice: args.choice ?? null,
      reward: args.reward,
      expires_at: new Date(Date.now() + args.seconds * 1000).toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return null; // the slot's taken
    throw error;
  }
  return data as QuestRow;
}

export async function listQuests(gameId: string): Promise<QuestRow[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []) as QuestRow[];
}

export function subscribeQuests(gameId: string, onChange: () => void) {
  const ch = supabase
    .channel(`quests:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quests', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/**
 * Close a quest out. Guarded on it still being active, so the hunter's phone
 * and the target's can both notice the clock ran out without paying twice.
 * Returns false if someone else got there first.
 */
export async function closeQuest(id: string, status: 'done' | 'failed'): Promise<boolean> {
  assertConfigured();
  const { data, error } = await supabase
    .from('quests')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

/** Where a team last checked in, read fresh — a tag turns on seconds. */
export async function getPosition(gameId: string, teamId: string): Promise<Position | null> {
  assertConfigured();
  const { data, error } = await supabase
    .from('positions')
    .select('team_id, lat, lng, spot_id, updated_at')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  return (data as Position) ?? null;
}

/** Question ids this team has already been asked, so a steal can prefer ones
 * they haven't seen. A repeat is a free correct answer, and steals draw two. */
export async function seenQuestionIds(gameId: string, teamId: string): Promise<string[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('trivia_answers')
    .select('question_id')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .not('question_id', 'is', null);
  if (error) return []; // analytics table; never block a play on it
  return [...new Set((data ?? []).map((r) => (r as { question_id: string }).question_id))];
}
