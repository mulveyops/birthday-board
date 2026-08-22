// Referee console — the whole game, run from one screen.
//
// This began as "declare a winner at a POI" and has become the operations desk:
// land stars, watch duels and overrule them, check drink photos, see where
// everyone is, fix a team's numbers, call last orders, hand out the ceremony
// awards, end the night. One scrolling page and no board builder attached — the
// person holding this is standing in a bar, not designing anything.
import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../Root';
import {
  getGameByCode,
  getBoard,
  listTeams,
  listPositions,
  listAllClaims,
  adjustCoins,
  adjustStars,
  transferCoins,
  logEvent,
  sendMessage,
  updateGameStatus,
  dropStar,
  listStarSpawns,
  subscribeStarSpawns,
  listStarClaims,
  listDuels,
  subscribeDuels,
  overrideDuel,
  listPhotos,
  subscribePhotos,
  vetoPhoto,
  unvetoPhoto,
  deletePhoto,
  type PhotoRow,
  type TeamRow,
  type Position,
  type StarSpawnRow,
  type StarClaimRow,
  type DuelRow,
} from '../net';
import type { Board, Square } from '../types';

const REF_PASSWORD = 'iclosedwolskis';

interface RefSession {
  gameId: string;
  code: string;
}

/** "4 min ago" — this gets read while somebody talks at you. */
function ago(ts: string | undefined | null, now: number): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Referee() {
  const [sess, setSess] = useState<RefSession | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('mke-ref-v1') || 'null') as RefSession | null;
    } catch {
      return null;
    }
  });
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [board, setBoard] = useState<Board | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [allClaims, setAllClaims] = useState<{ spot_id: string; team_id: string }[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [duels, setDuels] = useState<DuelRow[]>([]);
  const [spawns, setSpawns] = useState<StarSpawnRow[]>([]);
  const [claims, setClaims] = useState<StarClaimRow[]>([]);
  const [starBusy, setStarBusy] = useState('');
  const [showWhere, setShowWhere] = useState(false);
  const [endArmed, setEndArmed] = useState(false);
  const [note, setNote] = useState('');
  const [awarded, setAwarded] = useState<Record<string, boolean>>({});

  async function enter() {
    setErr('');
    if (pw !== REF_PASSWORD) {
      setErr('Wrong referee password — ask Steven or Abby.');
      return;
    }
    setBusy(true);
    try {
      const game = await getGameByCode(code);
      if (!game) {
        setErr('No game with that code.');
        return;
      }
      const s = { gameId: game.id, code: game.code };
      localStorage.setItem('mke-ref-v1', JSON.stringify(s));
      setSess(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!sess) return;
    let alive = true;
    const gid = sess.gameId;
    getBoard(gid)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setErr('Could not load the board — check your connection.'));
    const load = () => {
      listTeams(gid).then((t) => alive && setTeams(t)).catch(() => {});
      listPositions(gid).then((p) => alive && setPositions(p)).catch(() => {});
      listAllClaims(gid).then((c) => alive && setAllClaims(c)).catch(() => {});
      listStarSpawns(gid).then((r) => alive && setSpawns(r)).catch(() => {});
      listStarClaims(gid).then((r) => alive && setClaims(r)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 10000);
    const loadPhotos = () => listPhotos(gid).then((p) => alive && setPhotos(p)).catch(() => {});
    const loadDuels = () => listDuels(gid).then((d) => alive && setDuels(d)).catch(() => {});
    loadPhotos();
    loadDuels();
    const unsubPhotos = subscribePhotos(gid, loadPhotos);
    const unsubDuels = subscribeDuels(gid, loadDuels);
    const unsubStars = subscribeStarSpawns(gid, load);
    return () => {
      alive = false;
      clearInterval(iv);
      unsubPhotos();
      unsubDuels();
      unsubStars();
    };
  }, [sess]);

  const bars = useMemo(
    () =>
      (board?.squares ?? [])
        .filter((s) => s.type === 'bar')
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [board],
  );
  const teamName = (id: string | null | undefined) => teams.find((t) => t.id === id)?.name ?? 'a team';
  const teamEmoji = (id: string | null | undefined) => teams.find((t) => t.id === id)?.emoji ?? '🎲';
  const spotName = (id: string | null | undefined) =>
    board?.squares.find((s) => s.id === id)?.title || 'somewhere';

  /**
   * A place name a ref can actually walk to. Bars name themselves, but most of
   * the board is squares titled "Space", and "the duel is at Space" tells
   * nobody anything.
   *
   * So an unnamed square is described by the nearest bar. Not by street name:
   * the board's street labels carry two anchor points each — enough to draw a
   * label along, nowhere near enough to tell which corner you're on — whereas
   * every bar is a real point at a real address, and a ref already knows where
   * the bars are because that's where they've been standing all night.
   */
  function whereIs(spotId: string | null | undefined): string | null {
    const sq = board?.squares.find((s) => s.id === spotId);
    if (!sq) return null;
    if (sq.title && sq.title.toLowerCase() !== 'space') return sq.title;
    // Rough metres — flat-earth is fine across three city blocks.
    const mLat = 111_320;
    const mLng = 111_320 * Math.cos((sq.lat * Math.PI) / 180);
    let best: { name: string; d: number } | null = null;
    for (const b of bars) {
      const d = Math.hypot((b.lng - sq.lng) * mLng, (b.lat - sq.lat) * mLat);
      if (!best || d < best.d) best = { name: b.title || 'a bar', d };
    }
    if (!best) return sq.title || 'a space';
    if (best.d < 60) return `outside ${best.name}`;
    return `a space ${Math.round(best.d / 10) * 10}m from ${best.name}`;
  }

  /**
   * Where a duel is being fought. A duel usually carries the square it was
   * started on, but a challenge thrown from a quest may not have recorded one
   * — so fall back to whichever of the two teams checked in most recently,
   * which is the best guess anyone has and beats printing "somewhere".
   */
  function duelWhere(d: DuelRow): { place: string; guessed: boolean } {
    const named = whereIs(d.spot_id);
    if (named) return { place: named, guessed: false };
    const last = [d.challenger, d.opponent]
      .map((t) => positions.find((p) => p.team_id === t))
      .filter((p): p is Position => !!p && !!p.spot_id)
      .sort((a, b) => Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0];
    const guess = last ? whereIs(last.spot_id) : null;
    if (guess) return { place: guess, guessed: true };
    return { place: 'no location recorded', guessed: false };
  }

  function starsWaiting(spotId: string): number {
    const landed = spawns.filter((s) => s.bar_spot_id === spotId).length;
    const taken = claims.filter((c) => c.bar_spot_id === spotId && c.status !== 'lost').length;
    return Math.max(0, landed - taken);
  }

  /** Where an unprompted drop would land next. Same rule the game itself uses. */
  function nextStarBars(n: number): string[] {
    const out: string[] = [];
    for (const p of [...bars].sort((a, b) => a.id.localeCompare(b.id))) {
      if (out.length >= n) break;
      if (starsWaiting(p.id) === 0) out.push(p.title || 'a bar');
    }
    return out;
  }

  async function landStar(spot: Square) {
    if (!sess || starBusy) return;
    setStarBusy(spot.id);
    setErr('');
    try {
      const ok = await dropStar(sess.gameId, spot.id, null);
      if (!ok) {
        setErr('That one did not take — try again.');
        return;
      }
      const name = spot.title || 'a bar';
      await logEvent(sess.gameId, 'star', `⭐ A star just landed at ${name} — first team to buy a round claims it!`);
      setDone(`⭐ Star landed at ${name}.`);
    } catch (e) {
      setErr('Could not land it: ' + (e as Error).message);
    } finally {
      setStarBusy('');
    }
  }

  /**
   * Overrule a duel, including one already settled — which is the whole point.
   * If coins moved on the wrong call, move TWICE the stake: the team that was
   * paid gives back what they took and hands over what they owed.
   */
  async function overrule(d: DuelRow, winner: string) {
    if (!sess || busy) return;
    setBusy(true);
    setErr('');
    try {
      const wasPaid = d.status === 'done' && !!d.winner && d.winner !== winner && d.stake > 0;
      await overrideDuel(d.id, winner);
      if (wasPaid) await transferCoins(d.winner as string, winner, d.stake * 2);
      await logEvent(
        sess.gameId,
        'battle',
        `🧑‍⚖️ Referee call: ${teamName(winner)} takes the ${d.prompt}${wasPaid ? ` — ${d.stake} 🪙 moved` : ''}`,
      );
      setDone(`Called for ${teamName(winner)}.`);
    } catch (e) {
      setErr('Could not overrule: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function nudge(teamId: string, coins: number, stars: number) {
    if (!sess || busy) return;
    setBusy(true);
    try {
      if (coins) await adjustCoins(teamId, coins);
      if (stars) await adjustStars(teamId, stars);
      listTeams(sess.gameId).then(setTeams).catch(() => {});
      setDone(
        `${teamName(teamId)}: ${coins ? `${coins > 0 ? '+' : ''}${coins} 🪙 ` : ''}${stars ? `${stars > 0 ? '+' : ''}${stars} ⭐` : ''}`,
      );
    } catch (e) {
      setErr('Failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function announce(text: string) {
    if (!sess || !text.trim()) return;
    setBusy(true);
    try {
      await sendMessage(sess.gameId, null, null, text.trim(), 'all');
      await logEvent(sess.gameId, 'announce', `📣 ${text.trim()}`);
      setDone('Sent to every phone.');
      setNote('');
    } catch (e) {
      setErr('Could not send: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    if (!sess) return;
    setBusy(true);
    try {
      await updateGameStatus(sess.gameId, 'ended');
      await logEvent(sess.gameId, 'star', '🏁 Game over!');
      setDone('Game ended — every phone is showing final standings.');
      setEndArmed(false);
    } catch (e) {
      setErr('Could not end it: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refVeto(p: PhotoRow) {
    setErr('');
    try {
      await (p.vetoed ? unvetoPhoto(p) : vetoPhoto(p));
    } catch (e) {
      setErr('Veto failed: ' + (e as Error).message);
    }
  }
  async function refDelete(p: PhotoRow) {
    if (!confirm('Delete this photo from the album?')) return;
    try {
      await deletePhoto(p.id);
      setPhotos((rows) => rows.filter((r) => r.id !== p.id));
    } catch (e) {
      setErr('Delete failed: ' + (e as Error).message);
    }
  }

  // --- the three ceremony awards -------------------------------------------
  // Each is counted from what the game already recorded, so nobody has to have
  // kept score all afternoon.
  const wolskis = useMemo(
    () => (board?.squares ?? []).find((s) => /wolski/i.test(s.title || '') || s.poi?.artRef === 'wolskis'),
    [board],
  );
  const hosed = useMemo(
    () => (board?.squares ?? []).find((s) => /hosed/i.test(s.title || '') || s.poi?.artRef === 'hosed'),
    [board],
  );
  const nomad = useMemo(
    () => (board?.squares ?? []).find((s) => /nomad/i.test(s.title || '') || s.poi?.artRef === 'nomad'),
    [board],
  );

  const awards = useMemo(() => {
    const spaces = new Map<string, number>();
    for (const c of allClaims) spaces.set(c.team_id, (spaces.get(c.team_id) ?? 0) + 1);
    const drinks = new Map<string, number>();
    for (const p of photos) {
      if (p.vetoed || p.drinks <= 0 || !p.team_id) continue;
      drinks.set(p.team_id, (drinks.get(p.team_id) ?? 0) + p.drinks);
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    // "I closed Wolski's" — whoever checked in there most recently. A team's
    // position row is its LAST check-in, so this is only true while they're
    // still sitting there, which is exactly the award.
    const atWolskis = wolskis
      ? [...positions]
          .filter((p) => p.spot_id === wolskis.id)
          .sort((a, b) => Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0] ?? null
      : null;

    return [
      {
        key: 'nomad',
        // "Nomad", not "Nomad World Pub" — the joke is the word itself, a
        // wanderer, for whoever covered the most ground. That it also happens
        // to be where the ceremony is held is a bonus, not the name.
        title: 'Nomad award',
        forWhat: 'most spaces claimed',
        winner: top(spaces)?.[0] ?? null,
        detail: top(spaces) ? `${top(spaces)![1]} spaces` : 'nobody has claimed anything',
      },
      {
        key: 'hosed',
        title: `${hosed?.title ?? 'Hosed on Brady'} award`,
        forWhat: 'most drinks put away',
        winner: top(drinks)?.[0] ?? null,
        detail: top(drinks) ? `${top(drinks)![1]} drinks` : 'nobody has posted a drink',
      },
      {
        key: 'wolskis',
        title: "I closed Wolski's award",
        forWhat: 'last team to check in at Wolski’s',
        winner: atWolskis?.team_id ?? null,
        detail: atWolskis ? `checked in ${ago(atWolskis.updated_at, now)}` : 'nobody has been in yet',
      },
    ];
  }, [allClaims, photos, positions, wolskis, hosed, nomad, now]);

  async function giveAward(key: string, teamId: string, title: string) {
    if (!sess || busy) return;
    setBusy(true);
    try {
      await adjustStars(teamId, 1);
      await logEvent(sess.gameId, 'star', `🏅 ${title}: ${teamEmoji(teamId)} ${teamName(teamId)} — +⭐`);
      await sendMessage(sess.gameId, null, null, `🏅 ${title} goes to ${teamName(teamId)}!`, 'all');
      setAwarded((a) => ({ ...a, [key]: true }));
      listTeams(sess.gameId).then(setTeams).catch(() => {});
      setDone(`🏅 ${title} → ${teamName(teamId)}`);
    } catch (e) {
      setErr('Could not award it: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sess) {
    return (
      <div className="site">
        <div className="site-card">
          <div className="site-hero">
            <h1>🧑‍⚖️ Referee</h1>
            <p className="site-date">Run the game from here.</p>
          </div>
          <div className="join-form">
            <label className="field">
              <span>Game code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="GAME CODE"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </label>
            <label className="field">
              <span>Referee password</span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void enter()}
              />
            </label>
            {err && <p className="hint" style={{ color: '#e0533a', fontWeight: 700 }}>{err}</p>}
            <button className="site-btn site-btn--primary" disabled={busy || !code.trim() || !pw} onClick={() => void enter()}>
              Enter
            </button>
          </div>
        </div>
        <button className="site-admin-link" onClick={() => navigate('/')}>
          ← back
        </button>
      </div>
    );
  }

  const openDuels = duels.filter((d) => d.status === 'open');
  const recentDuels = duels.filter((d) => d.status !== 'open').slice(0, 6);
  const standings = [...teams].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const liveDrinkClaims = photos.filter((p) => p.drinks > 0 && !p.vetoed).length;

  return (
    <div className="site">
      <div className="site-card ref-card">
        <div className="site-hero">
          <h1>🧑‍⚖️ Referee</h1>
          <p className="site-date">
            Game {sess.code} ·{' '}
            <button
              className="linkbtn"
              onClick={() => {
                localStorage.removeItem('mke-ref-v1');
                setSess(null);
                setBoard(null);
              }}
            >
              switch game
            </button>
          </p>
        </div>

        {err && <p className="ref-flash ref-flash--bad">{err}</p>}
        {done && <p className="ref-flash">{done}</p>}

        {/* ---- duels ------------------------------------------------------ */}
        <section className="ref-block">
          <h2 className="ref-h">
            ⚔️ Duels {openDuels.length > 0 && <em className="ref-count">{openDuels.length} live</em>}
          </h2>
          {openDuels.length === 0 && recentDuels.length === 0 && (
            <p className="hint">Nothing running. They appear here the moment one starts.</p>
          )}
          {openDuels.map((d) => (
            <div key={d.id} className="ref-duel is-live">
              <div className="ref-duel__head">
                <b>{d.prompt}</b>
                <span className="ref-duel__age">{ago(d.created_at, now)}</span>
              </div>
              <div className="ref-duel__where">
                📍 <b>{duelWhere(d).place}</b>
                {duelWhere(d).guessed && <em> · last seen there</em>}
              </div>
              <div className="hint">
                {teamEmoji(d.challenger)} {teamName(d.challenger)} vs {teamEmoji(d.opponent)} {teamName(d.opponent)}
                {d.stake > 0 ? ` · ${d.stake} 🪙` : ''}
              </div>
              <div className="ref-duel__acts">
                <button className="site-btn" disabled={busy} onClick={() => void overrule(d, d.challenger)}>
                  {teamName(d.challenger)} won
                </button>
                <button className="site-btn" disabled={busy} onClick={() => void overrule(d, d.opponent)}>
                  {teamName(d.opponent)} won
                </button>
              </div>
            </div>
          ))}
          {recentDuels.map((d) => (
            <div key={d.id} className="ref-duel">
              <div className="ref-duel__head">
                <b>{d.prompt}</b>
                <span className="ref-duel__age">{ago(d.resolved_at ?? d.created_at, now)}</span>
              </div>
              <div className="ref-duel__where">
                📍 <b>{duelWhere(d).place}</b>
                {duelWhere(d).guessed && <em> · last seen there</em>}
              </div>
              <div className="hint">
                {d.status === 'cancelled'
                  ? 'called off'
                  : `${teamEmoji(d.winner)} ${teamName(d.winner)} took it${d.stake > 0 ? ` · ${d.stake} 🪙` : ''}`}
              </div>
              <div className="ref-duel__acts">
                <button className="site-btn" disabled={busy || d.winner === d.challenger} onClick={() => void overrule(d, d.challenger)}>
                  Overrule → {teamName(d.challenger)}
                </button>
                <button className="site-btn" disabled={busy || d.winner === d.opponent} onClick={() => void overrule(d, d.opponent)}>
                  Overrule → {teamName(d.opponent)}
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* ---- stars ------------------------------------------------------ */}
        <section className="ref-block">
          <h2 className="ref-h">⭐ Land a star</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Drop one on the bar you're sitting in and watch them come to you. Left alone, the next
            lands at <b>{nextStarBars(1)[0] ?? 'nowhere — every bar has one'}</b>
            {nextStarBars(2)[1] ? <>, then <b>{nextStarBars(2)[1]}</b></> : null}. Keep that to yourself.
          </p>
          <div className="ref-bars">
            {bars.map((p) => {
              const waiting = starsWaiting(p.id);
              return (
                <button
                  key={p.id}
                  className="site-btn"
                  style={{ opacity: waiting ? 0.55 : 1 }}
                  disabled={!!starBusy}
                  onClick={() => void landStar(p)}
                >
                  ⭐ {p.title || '(untitled)'}
                  {waiting > 0 && <span style={{ opacity: 0.7, fontSize: '0.8em' }}> · {waiting} waiting</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ---- where everyone is ------------------------------------------ */}
        <section className="ref-block">
          <h2 className="ref-h">
            📍 Where everyone is{' '}
            <button className="linkbtn" onClick={() => setShowWhere((v) => !v)}>
              {showWhere ? 'hide' : 'show'}
            </button>
          </h2>
          {showWhere &&
            (positions.length === 0 ? (
              <p className="hint">Nobody has checked in yet.</p>
            ) : (
              <div className="ref-where">
                {[...positions]
                  .sort((a, b) => Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))
                  .map((p) => (
                    <div key={p.team_id} className="ref-where__row">
                      <span className="ref-where__team">
                        {teamEmoji(p.team_id)} {teamName(p.team_id)}
                      </span>
                      <span className="ref-where__spot">{whereIs(p.spot_id) ?? 'somewhere'}</span>
                      <span className="ref-where__age">{ago(p.updated_at, now)}</span>
                    </div>
                  ))}
                <p className="hint" style={{ margin: '6px 0 0' }}>
                  That's each team's last check-in, not a live position — a team sitting still goes stale.
                </p>
              </div>
            ))}
        </section>

        {/* ---- drink checks ------------------------------------------------ */}
        <section className="ref-block">
          <h2 className="ref-h">
            📸 Drink checks {liveDrinkClaims > 0 && <em className="ref-count">{liveDrinkClaims}</em>}
          </h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Teams are paid the moment they post. Veto anything that isn't what it claimed and the coins
            come straight back off.
          </p>
          {photos.length === 0 && <p className="hint">Nothing posted yet.</p>}
          {photos.map((p) => (
            <div key={p.id} className={`ref-photo${p.vetoed ? ' is-vetoed' : ''}`}>
              <a href={p.url} target="_blank" rel="noreferrer" className="ref-photo__thumb">
                <img src={p.url} alt={p.caption || 'party photo'} loading="lazy" />
              </a>
              <div className="ref-photo__body">
                <b>
                  {p.team_emoji} {p.team_name}
                </b>
                <span className="hint" style={{ margin: 0 }}>
                  {p.drinks > 0
                    ? `🍻 ${p.drinks} · ${p.vetoed ? `−${p.coins} taken back` : `+${p.coins} 🪙`}`
                    : '📸 just a photo'}
                </span>
                {p.caption && <span className="ref-photo__cap">{p.caption}</span>}
                <div className="ref-photo__acts">
                  {p.drinks > 0 && (
                    <button className="site-btn" onClick={() => void refVeto(p)}>
                      {p.vetoed ? '↩ Undo' : '🚫 Veto'}
                    </button>
                  )}
                  <button className="site-btn" onClick={() => void refDelete(p)}>
                    🗑 Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ---- teams ------------------------------------------------------- */}
        <section className="ref-block">
          <h2 className="ref-h">🏆 Teams</h2>
          {standings.map((t, i) => (
            <div key={t.id} className="ref-team">
              <span className="ref-team__name">
                {i === 0 ? '🏆' : `${i + 1}.`} {t.emoji} {t.name}
              </span>
              <span className="ref-team__score">
                ⭐{t.stars} 🪙{t.coins}
              </span>
              <span className="ref-team__acts">
                <button className="site-btn" disabled={busy} onClick={() => void nudge(t.id, 0, 1)}>+⭐</button>
                <button className="site-btn" disabled={busy} onClick={() => void nudge(t.id, 0, -1)}>−⭐</button>
                <button className="site-btn" disabled={busy} onClick={() => void nudge(t.id, 25, 0)}>+25</button>
                <button className="site-btn" disabled={busy} onClick={() => void nudge(t.id, -25, 0)}>−25</button>
              </span>
            </div>
          ))}
        </section>

        {/* ---- the ceremony ------------------------------------------------ */}
        <section className="ref-block">
          <h2 className="ref-h">🏅 Star ceremony</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Three final stars, counted from what the game already recorded. Read them out at Nomad.
          </p>
          {awards.map((a) => (
            <div key={a.key} className="ref-award">
              <div className="ref-award__title">{a.title}</div>
              <div className="hint" style={{ margin: 0 }}>{a.forWhat}</div>
              <div className="ref-award__winner">
                {a.winner ? (
                  <>
                    {teamEmoji(a.winner)} <b>{teamName(a.winner)}</b> — {a.detail}
                  </>
                ) : (
                  <em>{a.detail}</em>
                )}
              </div>
              <button
                className="site-btn site-btn--primary"
                style={{ width: '100%' }}
                disabled={busy || !a.winner || awarded[a.key]}
                onClick={() => a.winner && void giveAward(a.key, a.winner, a.title)}
              >
                {awarded[a.key] ? '🏅 Awarded' : `Award ⭐ to ${a.winner ? teamName(a.winner) : '—'}`}
              </button>
            </div>
          ))}
        </section>

        {/* ---- announce, last call, and the end ---------------------------- */}
        <section className="ref-block">
          <h2 className="ref-h">📣 Tell everyone</h2>
          <div className="row">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Say something to every phone…"
              onKeyDown={(e) => e.key === 'Enter' && void announce(note)}
              style={{ flex: 1 }}
            />
            <button
              className="site-btn"
              style={{ flex: 'none' }}
              disabled={busy || !note.trim()}
              onClick={() => void announce(note)}
            >
              Send
            </button>
          </div>
          <button
            className="site-btn site-btn--primary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={busy}
            onClick={() =>
              void announce(
                `🏁 LAST CALL — ${nomad?.title ?? 'Nomad World Pub'} is open. Twenty minutes to get there for the final stars!`,
              )
            }
          >
            🏁 Last call — send everyone to Nomad
          </button>

          {!endArmed ? (
            <button className="ref-end" disabled={busy} onClick={() => setEndArmed(true)}>
              🛑 End the game
            </button>
          ) : (
            <div className="ref-end-confirm">
              <p>Are you sure you want to end the game?</p>
              <p className="hint">
                Every phone flips to final standings and nothing more can be earned. There is no undo.
              </p>
              <button className="ref-end" disabled={busy} onClick={() => void endGame()}>
                Yes — end it now
              </button>
              <button className="site-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setEndArmed(false)}>
                No, keep playing
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
