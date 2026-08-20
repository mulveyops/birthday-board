import { useEffect, useRef, useState } from 'react';
import type { ChanceCard, TriviaQuestion } from '../types';
import type { ContentRow } from '../net';
import {
  addContent,
  deleteContent,
  isNoTableError,
  listContent,
  subscribeContent,
  updateContent,
  uploadTriviaPhoto,
} from '../net';
import { isConfigured } from '../supabase';

// Phone-first editor for the shared trivia bank + chance deck. Every question/
// card is its own DB row, saved on a short debounce — so Abby can write on her
// phone while the designer is open elsewhere without either clobbering the other.

const EFFECT_META: Record<ChanceCard['effect'], { label: string; hint: string }> = {
  gain: { label: '🍀 Gain coins', hint: 'The team gets the amount below.' },
  lose: { label: '💸 Lose coins', hint: 'The team loses the amount below (floored at 0).' },
  rob: { label: '🦹 Rob a team', hint: 'Steal from a rival — amount comes from game settings.' },
  claim: { label: '🧱 Reinforcement', hint: 'Awards a 🧱 charge — spend it at a corner you own to fortify it against steals.' },
  nothing: { label: '😐 Nothing', hint: 'A dud — just the flavor text.' },
};

function newQuestion(): TriviaQuestion {
  return { q: '', choices: ['', ''], correct: 0 };
}
function newCard(): ChanceCard {
  return { id: crypto.randomUUID(), text: '', effect: 'gain', amount: 20 };
}

export default function Content() {
  const [qs, setQs] = useState<ContentRow<TriviaQuestion>[]>([]);
  const [cards, setCards] = useState<ContentRow<ChanceCard>[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'needs-setup' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);

  // The row being actively edited keeps its local (newer) copy on realtime refresh.
  const focusId = useRef<string | null>(null);
  const timers = useRef<Record<string, number>>({});
  const qsRef = useRef(qs);
  qsRef.current = qs;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  async function refresh() {
    const keep = focusId.current;
    const [t, c] = await Promise.all([listContent<TriviaQuestion>('trivia'), listContent<ChanceCard>('chance')]);
    setQs((prev) => t.map((r) => (r.id === keep ? prev.find((p) => p.id === keep) ?? r : r)));
    setCards((prev) => c.map((r) => (r.id === keep ? prev.find((p) => p.id === keep) ?? r : r)));
  }

  useEffect(() => {
    if (!isConfigured) {
      setStatus('error');
      return;
    }
    let cancelled = false;
    refresh()
      .then(() => !cancelled && setStatus('ready'))
      .catch((e) => !cancelled && setStatus(isNoTableError(e) ? 'needs-setup' : 'error'));
    const unsub = subscribeContent(() => {
      refresh().catch(() => {});
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDebounced(id: string, data: TriviaQuestion | ChanceCard) {
    setSaveState('saving');
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(() => {
      updateContent(id, data)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 600);
  }

  function patchQuestion(id: string, patch: Partial<TriviaQuestion>) {
    const row = qsRef.current.find((r) => r.id === id);
    if (!row) return;
    const data = { ...row.data, ...patch };
    setQs((rows) => rows.map((r) => (r.id === id ? { ...r, data } : r)));
    saveDebounced(id, data);
  }
  function patchCard(id: string, patch: Partial<ChanceCard>) {
    const row = cardsRef.current.find((r) => r.id === id);
    if (!row) return;
    const data = { ...row.data, ...patch };
    setCards((rows) => rows.map((r) => (r.id === id ? { ...r, data } : r)));
    saveDebounced(id, data);
  }

  async function addQuestion() {
    const pos = (qsRef.current[qsRef.current.length - 1]?.pos ?? 0) + 1;
    const row = (await addContent('trivia', newQuestion(), pos)) as ContentRow<TriviaQuestion>;
    setQs((rows) => [...rows, row]);
  }
  async function addCard() {
    const pos = (cardsRef.current[cardsRef.current.length - 1]?.pos ?? 0) + 1;
    const row = (await addContent('chance', newCard(), pos)) as ContentRow<ChanceCard>;
    setCards((rows) => [...rows, row]);
  }
  async function removeRow(kind: 'trivia' | 'chance', id: string) {
    if (!confirm('Delete this ' + (kind === 'trivia' ? 'question' : 'card') + '?')) return;
    await deleteContent(id).catch((e) => alert('Delete failed: ' + (e as Error).message));
    if (kind === 'trivia') setQs((rows) => rows.filter((r) => r.id !== id));
    else setCards((rows) => rows.filter((r) => r.id !== id));
  }

  async function addPhoto(id: string, file: File) {
    setPhotoBusy(id);
    try {
      const url = await uploadTriviaPhoto(file);
      patchQuestion(id, { image: url });
    } catch (e) {
      alert('Upload failed: ' + (e as Error).message);
    } finally {
      setPhotoBusy(null);
    }
  }

  if (status === 'loading') return <div className="content-page"><p className="hint">Loading…</p></div>;
  if (status === 'needs-setup')
    return (
      <div className="content-page">
        <div className="panel">
          <h2>One-time setup needed</h2>
          <p className="hint">
            The shared content table doesn't exist yet. Run <code>supabase/content.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
        </div>
      </div>
    );
  if (status === 'error')
    return (
      <div className="content-page">
        <p className="hint">Couldn't load content — check the connection and reload.</p>
      </div>
    );

  return (
    <div className="content-page">
      <div className="content-savebar">
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? '⚠️ Save failed — check connection' : ' '}
      </div>

      <section className="panel">
        <h2>❔ Trivia questions ({qs.length})</h2>
        <p className="hint">
          These are dealt out evenly across the challenge spots on the board — no need to assign
          them anywhere. (A spot with its own pinned questions in the designer uses those instead.)
        </p>
        {qs.map((row, i) => {
          const q = row.data;
          return (
            <div className="qedit" key={row.id} onFocus={() => (focusId.current = row.id)} onBlur={() => (focusId.current = null)}>
              <div className="qedit-head">
                <strong>Q{i + 1}</strong>
                <button className="linkbtn" onClick={() => void removeRow('trivia', row.id)}>
                  Delete
                </button>
              </div>
              <textarea
                className="qedit-q"
                rows={2}
                value={q.q}
                placeholder="Question — e.g. Where was our first date?"
                onChange={(e) => patchQuestion(row.id, { q: e.target.value })}
              />
              <div className="qedit-photo">
                {q.image ? (
                  <>
                    <img src={q.image} alt="" className="qedit-photo-thumb" />
                    <button className="linkbtn" onClick={() => patchQuestion(row.id, { image: undefined })}>
                      Remove photo
                    </button>
                  </>
                ) : (
                  <label className="linkbtn qedit-photo-add">
                    {photoBusy === row.id ? 'Uploading…' : '📷 Add photo'}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void addPhoto(row.id, f);
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
                    name={`correct-${row.id}`}
                    checked={q.correct === ci}
                    onChange={() => patchQuestion(row.id, { correct: ci })}
                    title="Mark as the correct answer"
                  />
                  <input
                    value={c}
                    placeholder={`Choice ${ci + 1}`}
                    onChange={(e) =>
                      patchQuestion(row.id, { choices: q.choices.map((x, j) => (j === ci ? e.target.value : x)) })
                    }
                  />
                  {q.choices.length > 2 && (
                    <button
                      className="linkbtn"
                      title="Remove choice"
                      onClick={() => {
                        const choices = q.choices.filter((_, j) => j !== ci);
                        const correct = ci === q.correct ? 0 : ci < q.correct ? q.correct - 1 : q.correct;
                        patchQuestion(row.id, { choices, correct });
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {q.choices.length < 4 && (
                <button className="linkbtn" onClick={() => patchQuestion(row.id, { choices: [...q.choices, ''] })}>
                  ＋ Add choice
                </button>
              )}
            </div>
          );
        })}
        <button className="btn btn--go" style={{ width: '100%', marginTop: 10 }} onClick={() => void addQuestion()}>
          ＋ Add question
        </button>
      </section>

      <section className="panel">
        <h2>❓ Chance deck ({cards.length})</h2>
        <p className="hint">
          Landing on a chance spot draws one card at random. Want an outcome to be more likely?
          Add more copies of it.
        </p>
        {cards.map((row, i) => {
          const c = row.data;
          return (
            <div className="qedit" key={row.id} onFocus={() => (focusId.current = row.id)} onBlur={() => (focusId.current = null)}>
              <div className="qedit-head">
                <strong>Card {i + 1}</strong>
                <button className="linkbtn" onClick={() => void removeRow('chance', row.id)}>
                  Delete
                </button>
              </div>
              <textarea
                className="qedit-q"
                rows={2}
                value={c.text}
                placeholder="Card text — e.g. You found a golden bratwurst!"
                onChange={(e) => patchCard(row.id, { text: e.target.value })}
              />
              <label className="field">
                <span>Effect</span>
                <select value={c.effect} onChange={(e) => patchCard(row.id, { effect: e.target.value as ChanceCard['effect'] })}>
                  {(Object.keys(EFFECT_META) as ChanceCard['effect'][]).map((k) => (
                    <option key={k} value={k}>
                      {EFFECT_META[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint" style={{ marginTop: 2 }}>{EFFECT_META[c.effect].hint}</p>
              {(c.effect === 'gain' || c.effect === 'lose') && (
                <label className="field">
                  <span>Amount (🪙)</span>
                  <input
                    type="number"
                    value={c.amount}
                    onChange={(e) => patchCard(row.id, { amount: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
              )}
            </div>
          );
        })}
        <button className="btn btn--go" style={{ width: '100%', marginTop: 10 }} onClick={() => void addCard()}>
          ＋ Add card
        </button>
      </section>
    </div>
  );
}
