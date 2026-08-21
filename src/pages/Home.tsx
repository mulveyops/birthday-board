import { navigate } from '../Root';

export default function Home() {
  return (
    <div className="site">
      <div className="site-card">
        <div className="site-hero">
          <h1>Abby &amp; Steven's Birthday</h1>
          <p className="site-date">Saturday, August 22 · 1:30 PM · 811 East Pleasant Street</p>
        </div>
        <div className="site-actions">
          <button className="site-btn site-btn--primary" onClick={() => navigate('/rsvp')}>
            RSVP
          </button>
          {/* Straight to the join screen — it asks for the code the host hands
              out at the party, so there's nothing to gate here. */}
          <button className="site-btn" onClick={() => navigate('/play')}>
            Play
          </button>
        </div>
      </div>

      <div className="site-corner-links">
        <button className="site-admin-link" onClick={() => navigate('/ref')}>
          referee
        </button>
        <button className="site-admin-link" onClick={() => navigate('/admin')}>
          admin
        </button>
      </div>
    </div>
  );
}
