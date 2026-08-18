import { useState } from 'react';
import App from '../App';
import Content from './Content';
import RsvpResponses from './RsvpResponses';
import { navigate } from '../Root';

// Curtain only — a static site can't keep a real secret. Keeps casual guests out;
// not real security (the Supabase key can read/write regardless). See game-roadmap.
const ADMIN_PASSWORD = 'steven<3abby';
const UNLOCK_KEY = 'mke-admin-unlocked';

export default function Admin({ initialTab = 'builder' }: { initialTab?: 'builder' | 'content' | 'rsvps' }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === '1');
  const [pw, setPw] = useState('');
  const [tab, setTab] = useState<'builder' | 'content' | 'rsvps'>(initialTab);

  if (!unlocked) {
    return (
      <div className="site">
        <div className="site-card site-card--narrow">
          <button className="site-back" onClick={() => navigate('/')}>
            ← Home
          </button>
          <h1>Admin</h1>
          <label className="rsvp-field">
            <span>Password</span>
            <input
              type="password"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pw === ADMIN_PASSWORD) {
                  sessionStorage.setItem(UNLOCK_KEY, '1');
                  setUnlocked(true);
                }
              }}
            />
          </label>
          <button
            className="site-btn site-btn--primary"
            style={{ width: '100%' }}
            onClick={() => {
              if (pw === ADMIN_PASSWORD) {
                sessionStorage.setItem(UNLOCK_KEY, '1');
                setUnlocked(true);
              } else {
                alert('Nope.');
              }
            }}
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <div className="admin-bar">
        <span className="admin-title">Admin</span>
        <button className={`admin-tab ${tab === 'builder' ? 'admin-tab--on' : ''}`} onClick={() => setTab('builder')}>
          Board builder
        </button>
        <button className={`admin-tab ${tab === 'content' ? 'admin-tab--on' : ''}`} onClick={() => setTab('content')}>
          Questions & cards
        </button>
        <button className={`admin-tab ${tab === 'rsvps' ? 'admin-tab--on' : ''}`} onClick={() => setTab('rsvps')}>
          RSVPs
        </button>
        <button className="admin-tab" onClick={() => navigate('/')}>
          ← Site
        </button>
      </div>
      <div className="admin-body">
        {tab === 'builder' ? <App variant="admin" /> : tab === 'content' ? <Content /> : <RsvpResponses />}
      </div>
    </div>
  );
}
