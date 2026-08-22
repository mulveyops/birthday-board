// Referee console — a trusted friend runs a REAL-LIFE game at a POI (bags,
// relay, trivia bee, whatever the encounter says) and reports the result.
// The app can't see the game itself; the ref IS the sensor: they pick the
// POI they're standing at, declare the winner, and the app pays out and
// announces it. Deliberately lightweight — game code + a shared password,
// no team, no GPS.
import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../Root';
import {
  getGameByCode,
  getBoard,
  listTeams,
  adjustCoins,
  adjustStars,
  logEvent,
  listPhotos,
  subscribePhotos,
  vetoPhoto,
  unvetoPhoto,
  deletePhoto,
  type PhotoRow,
  type TeamRow,
} from '../net';
import type { Board, Square } from '../types';

const REF_PASSWORD = 'iclosedwolskis';

const ENC_META: Record<string, { emoji: string; label: string }> = {
  'star-bar': { emoji: '⭐', label: 'Star bar' },
  h2h: { emoji: '⚔️', label: 'Head-to-head' },
  challenge: { emoji: '🎯', label: 'Challenge' },
  boss: { emoji: '🔥', label: 'Boss' },
  landmark: { emoji: '📍', label: 'Landmark' },
};

interface RefSession {
  gameId: string;
  code: string;
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
  const [busy, setBusy] = useState(false);

  const [board, setBoard] = useState<Board | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [poiId, setPoiId] = useState<string | null>(null);
  const [winnerId, setWinnerId] = useState('');
  const [loserId, setLoserId] = useState('');
  const [amount, setAmount] = useState(25);
  const [giveStar, setGiveStar] = useState(false);
  const [done, setDone] = useState('');
  // Drink checks pay on submit; the ref is the veto on a photo that clearly
  // isn't what it claimed. Same powers as the host console.
  const [photos, setPhotos] = useState<PhotoRow[]>([]);

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
    if (!sess) return;
    let alive = true;
    getBoard(sess.gameId)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setErr('Could not load the board — check your connection.'));
    const load = () => listTeams(sess.gameId).then((t) => alive && setTeams(t)).catch(() => {});
    load();
    const iv = setInterval(load, 15000);
    const loadPhotos = () => listPhotos(sess.gameId).then((p) => alive && setPhotos(p)).catch(() => {});
    loadPhotos();
    const unsubPhotos = subscribePhotos(sess.gameId, loadPhotos);
    return () => {
      alive = false;
      clearInterval(iv);
      unsubPhotos();
    };
  }, [sess]);

  const pois = useMemo(
    () =>
      (board?.squares ?? [])
        .filter((s) => s.type === 'poi' || s.type === 'bar')
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [board],
  );
  const poi: Square | null = pois.find((p) => p.id === poiId) ?? null;

  function pickPoi(p: Square) {
    setPoiId(p.id);
    setAmount(p.poi?.reward || 25);
    setWinnerId('');
    setLoserId('');
    setGiveStar((p.poi?.encounter ?? '') === 'boss');
    setDone('');
    setErr('');
  }

  async function declare() {
    if (!sess || !poi || !winnerId || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (amount > 0) await adjustCoins(winnerId, amount);
      if (giveStar) await adjustStars(winnerId, 1);
      const w = teams.find((t) => t.id === winnerId);
      const l = teams.find((t) => t.id === loserId);
      await logEvent(
        sess.gameId,
        'battle',
        `🧑‍⚖️ ${poi.title}: ${w?.emoji ?? ''} ${w?.name ?? 'A team'}${l ? ` defeated ${l.name}` : ' won the challenge'}!` +
          `${amount > 0 ? ` +${amount} 🪙` : ''}${giveStar ? ' +⭐' : ''}`,
      );
      setDone(`✅ Sent — ${w?.name ?? 'winner'} gets ${amount > 0 ? `+${amount} 🪙` : ''}${giveStar ? ' +⭐' : ''}`);
      setWinnerId('');
      setLoserId('');
      listTeams(sess.gameId).then(setTeams).catch(() => {});
    } catch (e) {
      setErr('Failed to send: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Veto (or un-veto) a drink check — the RPC does the coin math both ways. */
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
    setErr('');
    try {
      await deletePhoto(p.id);
      setPhotos((rows) => rows.filter((r) => r.id !== p.id));
    } catch (e) {
      setErr('Delete failed: ' + (e as Error).message);
    }
  }

  if (!sess) {
    return (
      <div className="site">
        <div className="site-card">
          <div className="site-hero">
            <h1>🧑‍⚖️ Referee</h1>
            <p className="site-date">Run a real-life game at a spot and report the winner.</p>
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

  return (
    <div className="site">
      <div className="site-card" style={{ maxWidth: 480 }}>
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
                setPoiId(null);
              }}
            >
              switch game
            </button>
          </p>
        </div>

        {!board ? (
          <p className="hint" style={{ textAlign: 'center' }}>Loading the board…</p>
        ) : !poi ? (
          <div className="join-form">
            <p className="hint" style={{ marginTop: 0 }}>
              <b>Where are you standing?</b> Pick the spot you're refereeing.
            </p>
            {pois.map((p) => {
              const em = ENC_META[p.poi?.encounter ?? (p.type === 'bar' ? 'star-bar' : 'landmark')] ?? ENC_META.landmark;
              return (
                <button key={p.id} className="site-btn" style={{ textAlign: 'left' }} onClick={() => pickPoi(p)}>
                  {em.emoji} {p.title || '(untitled)'} <span style={{ opacity: 0.65, fontSize: '0.8em' }}>· {em.label}</span>
                </button>
              );
            })}
            {pois.length === 0 && <p className="hint">This game's board has no points of interest.</p>}
          </div>
        ) : (
          <div className="join-form">
            <button className="linkbtn" onClick={() => setPoiId(null)}>
              ← all spots
            </button>
            <h2 style={{ margin: '6px 0 2px' }}>
              {(ENC_META[poi.poi?.encounter ?? 'landmark'] ?? ENC_META.landmark).emoji} {poi.title}
            </h2>
            {poi.poi?.blurb && <p className="hint" style={{ marginTop: 0 }}>{poi.poi.blurb}</p>}
            {poi.poi?.task ? (
              <p className="hint" style={{ background: 'rgba(240,195,60,0.14)', padding: '8px 10px', borderRadius: 8 }}>
                🎯 <b>The game to run:</b> {poi.poi.task}
              </p>
            ) : (
              <p className="hint" style={{ background: 'rgba(154,95,224,0.16)', padding: '8px 10px', borderRadius: 8 }}>
                🕶️ <b>Black box:</b> no scripted game here — you invent the contest on the spot. Anything fair and fun.
                When it's over, declare the winner below.
              </p>
            )}
            <label className="field">
              <span>Winner</span>
              <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
                <option value="">— pick the winning team —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.name} ({t.coins} 🪙 · {t.stars} ⭐)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Defeated team (optional — for the announcement)</span>
              <select value={loserId} onChange={(e) => setLoserId(e.target.value)}>
                <option value="">— none / open challenge —</option>
                {teams
                  .filter((t) => t.id !== winnerId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.emoji} {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Coin prize (🪙)</span>
              <input type="number" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={giveStar} onChange={(e) => setGiveStar(e.target.checked)} />
              <span>Also award a ⭐ (big set-piece wins)</span>
            </label>
            {err && <p className="hint" style={{ color: '#e0533a', fontWeight: 700 }}>{err}</p>}
            {done && <p className="hint" style={{ color: '#2fa05a', fontWeight: 700 }}>{done}</p>}
            <button className="site-btn site-btn--primary" disabled={busy || !winnerId} onClick={() => void declare()}>
              {busy ? 'Sending…' : '📣 Declare the winner'}
            </button>
            <p className="hint">
              This pays the prize and announces the result in every player's feed. Wrong tap? Declare a correction or
              grab Steven/Abby.
            </p>
          </div>
        )}

        {!poi && (
          <div style={{ marginTop: 12, borderTop: '2px solid rgba(0,0,0,0.12)', paddingTop: 10 }}>
            <p className="hint" style={{ marginTop: 0 }}>
              <b>📸 Drink checks</b> — teams get paid the second they post. Veto a photo that isn't what it claimed and
              the coins come straight back off. Any drink counts.
            </p>
            <div className="cam-review">
              {photos.length === 0 && <p className="hint">Nothing posted yet.</p>}
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
                      <button className="site-btn" onClick={() => void refVeto(p)}>
                        {p.vetoed ? '↩ Undo' : '🚫 Veto'}
                      </button>
                    )}
                    <button className="site-btn" onClick={() => void refDelete(p)} aria-label="Delete">
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
