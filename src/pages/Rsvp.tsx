import { useState } from 'react';
import { navigate } from '../Root';
import { submitRsvp, type RsvpInput } from '../net';
import { isConfigured } from '../supabase';

const BLANK: RsvpInput = {
  name: '',
  coming: 'yes',
  plus_ones: 0,
  drinking: false,
  duration: 'whole',
  group_pref: 'dontcare',
  note: '',
};

export default function Rsvp() {
  const [form, setForm] = useState<RsvpInput>(BLANK);
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const set = <K extends keyof RsvpInput>(k: K, v: RsvpInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.name.trim()) {
      alert('Please add your name.');
      return;
    }
    setStatus('sending');
    try {
      await submitRsvp({ ...form, name: form.name.trim() });
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
          <div className="site-emoji">🥳</div>
          <h1>Thank you{form.name ? `, ${form.name.split(' ')[0]}` : ''}!</h1>
          <p className="site-lead">Your RSVP is in. We can't wait to see you on Aug 22.</p>
          <div className="site-actions">
            <button className="site-btn" onClick={() => navigate('/')}>
              ← Back home
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
        <p className="site-lead">Abby &amp; Steven's Birthday · Aug 22, 2:00 PM</p>

        {!isConfigured && <p className="site-error">Form isn't connected yet — check back shortly.</p>}

        <label className="rsvp-field">
          <span>Your name</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="First &amp; last" />
        </label>

        <div className="rsvp-field">
          <span>Are you coming?</span>
          <div className="rsvp-choices">
            {(['yes', 'no', 'maybe'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`rsvp-chip ${form.coming === v ? 'rsvp-chip--on' : ''}`}
                onClick={() => set('coming', v)}
              >
                {v === 'yes' ? "Yes! 🎉" : v === 'no' ? "Can't make it" : 'Maybe'}
              </button>
            ))}
          </div>
        </div>

        {form.coming !== 'no' && (
          <>
            <label className="rsvp-field">
              <span>Bringing anyone? (how many extra people)</span>
              <input
                type="number"
                min={0}
                max={10}
                value={form.plus_ones}
                onChange={(e) => set('plus_ones', Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
              />
            </label>

            <div className="rsvp-field">
              <span>Will you be drinking?</span>
              <div className="rsvp-choices">
                <button
                  type="button"
                  className={`rsvp-chip ${form.drinking ? 'rsvp-chip--on' : ''}`}
                  onClick={() => set('drinking', true)}
                >
                  🍺 Drinking
                </button>
                <button
                  type="button"
                  className={`rsvp-chip ${!form.drinking ? 'rsvp-chip--on' : ''}`}
                  onClick={() => set('drinking', false)}
                >
                  🚫 Nah
                </button>
              </div>
            </div>

            <div className="rsvp-field">
              <span>The whole time, or just part?</span>
              <div className="rsvp-choices">
                {(['whole', 'parts'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`rsvp-chip ${form.duration === v ? 'rsvp-chip--on' : ''}`}
                    onClick={() => set('duration', v)}
                  >
                    {v === 'whole' ? 'The whole time' : 'Just part of it'}
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
          <span>Anything else? (optional)</span>
          <textarea rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Song request, note, dietary needs…" />
        </label>

        <button className="site-btn site-btn--primary" style={{ width: '100%' }} disabled={status === 'sending'} onClick={submit}>
          {status === 'sending' ? 'Sending…' : 'Send RSVP'}
        </button>
      </div>
    </div>
  );
}
