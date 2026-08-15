import { useState } from 'react';
import { navigate } from '../Root';
import { submitRsvp, type RsvpInput } from '../net';
import { isConfigured } from '../supabase';

const BLANK: RsvpInput = {
  name: '',
  coming: 'yes',
  guests: [],
  drinking: false,
  duration: 'whole',
  group_pref: 'dontcare',
  note: '',
};

export default function Rsvp() {
  const [form, setForm] = useState<RsvpInput>(BLANK);
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const set = <K extends keyof RsvpInput>(k: K, v: RsvpInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const addGuest = () => setForm((f) => ({ ...f, guests: [...f.guests, { first: '', last: '' }] }));
  const removeGuest = (i: number) => setForm((f) => ({ ...f, guests: f.guests.filter((_, j) => j !== i) }));
  const setGuest = (i: number, k: 'first' | 'last', v: string) =>
    setForm((f) => ({ ...f, guests: f.guests.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));

  async function submit() {
    if (!form.name.trim()) {
      alert('Please add your name.');
      return;
    }
    const guests = form.guests
      .map((g) => ({ first: g.first.trim(), last: g.last.trim() }))
      .filter((g) => g.first || g.last);
    setStatus('sending');
    try {
      await submitRsvp({ ...form, name: form.name.trim(), guests });
      setStatus('done');
    } catch (e) {
      setStatus('error');
      alert('Could not submit: ' + (e as Error).message);
    }
  }

  if (status === 'done') {
    return (
      <div className="site">
        <div className="site-card site-card--narrow">
          <h1>Thank you{form.name ? `, ${form.name.split(' ')[0]}` : ''}</h1>
          <p className="site-lead">Your RSVP is in. We can't wait to see you on August 22.</p>
          <div className="site-actions">
            <button className="site-btn" onClick={() => navigate('/')}>
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="site">
      <div className="site-card site-card--narrow">
        <button className="site-back" onClick={() => navigate('/')}>
          ← Home
        </button>
        <h1>RSVP</h1>
        <p className="site-lead">Abby &amp; Steven's Birthday · August 22, 2:00 PM</p>

        {!isConfigured && <p className="site-error">Form isn't connected yet — check back shortly.</p>}

        <label className="rsvp-field">
          <span>Your name</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="First and last" />
        </label>

        <div className="rsvp-field">
          <span>Are you coming?</span>
          <div className="rsvp-choices">
            {([
              ['yes', 'Yes'],
              ['no', "Can't make it"],
              ['maybe', 'Maybe'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`rsvp-chip ${form.coming === v ? 'rsvp-chip--on' : ''}`}
                onClick={() => set('coming', v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {form.coming !== 'no' && (
          <>
            <div className="rsvp-field">
              <span>Bringing anyone? Add each guest's name.</span>
              {form.guests.map((g, i) => (
                <div className="guest-row" key={i}>
                  <input placeholder="First name" value={g.first} onChange={(e) => setGuest(i, 'first', e.target.value)} />
                  <input placeholder="Last name" value={g.last} onChange={(e) => setGuest(i, 'last', e.target.value)} />
                  <button type="button" className="guest-remove" onClick={() => removeGuest(i)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="guest-add" onClick={addGuest}>
                + Add a guest
              </button>
            </div>

            <div className="rsvp-field">
              <span>Will you be drinking?</span>
              <div className="rsvp-choices">
                <button
                  type="button"
                  className={`rsvp-chip ${form.drinking ? 'rsvp-chip--on' : ''}`}
                  onClick={() => set('drinking', true)}
                >
                  Drinking
                </button>
                <button
                  type="button"
                  className={`rsvp-chip ${!form.drinking ? 'rsvp-chip--on' : ''}`}
                  onClick={() => set('drinking', false)}
                >
                  Not drinking
                </button>
              </div>
            </div>

            <div className="rsvp-field">
              <span>How much can you make it for?</span>
              <div className="rsvp-choices">
                {([
                  ['whole', 'Whole game'],
                  ['mid', 'Arrive midgame'],
                  ['post', 'Arrive post-game'],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`rsvp-chip ${form.duration === v ? 'rsvp-chip--on' : ''}`}
                    onClick={() => set('duration', v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rsvp-field">
              <span>Group preference</span>
              <div className="rsvp-choices">
                {([
                  ['know', 'People I know'],
                  ['meet', 'Meet new people'],
                  ['dontcare', "Don't care"],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`rsvp-chip ${form.group_pref === v ? 'rsvp-chip--on' : ''}`}
                    onClick={() => set('group_pref', v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <label className="rsvp-field">
          <span>Any suggestions? (optional)</span>
          <textarea rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Leave us a suggestion…" />
        </label>

        <button className="site-btn site-btn--primary" style={{ width: '100%' }} disabled={status === 'sending'} onClick={submit}>
          {status === 'sending' ? 'Sending…' : 'Send RSVP'}
        </button>
      </div>
    </div>
  );
}
