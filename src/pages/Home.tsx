import { navigate } from '../Root';

export default function Home() {
  return (
    <div className="site">
      <div className="site-card">
        <div className="site-hero">
          <div className="site-emoji">🎉</div>
          <h1>Abby &amp; Steven's Birthday</h1>
          <p className="site-date">Saturday, August 22 · 2:00 PM · Milwaukee</p>
        </div>
        <p className="site-lead">A city-wide birthday bash &amp; scavenger game. Let us know you're coming — the game unlocks the day of.</p>
        <div className="site-actions">
          <button className="site-btn site-btn--primary" onClick={() => navigate('/rsvp')}>
            ✉️ RSVP
          </button>
          <button className="site-btn" onClick={() => navigate('/play')}>
            🎲 Play the game
          </button>
        </div>
        <p className="site-note">Playing won't work until the host takes the game live at the party.</p>
      </div>
      <button className="site-admin-link" onClick={() => navigate('/admin')}>
        admin
      </button>
    </div>
  );
}
