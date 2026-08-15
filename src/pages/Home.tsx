import { useEffect, useState } from 'react';
import { navigate } from '../Root';

export default function Home() {
  const [wag, setWag] = useState(false);

  useEffect(() => {
    if (!wag) return;
    const t = setTimeout(() => setWag(false), 3000);
    return () => clearTimeout(t);
  }, [wag]);

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
          <button className="site-btn" onClick={() => setWag(true)}>
            Play
          </button>
        </div>
      </div>

      {wag && (
        <div className="wag-scrim" onClick={() => setWag(false)}>
          <div className="wag-pop" onClick={(e) => e.stopPropagation()}>
            <div className="wag-head">Nice try!</div>
            <div className="wag-body">
              <div className="wag-finger">☝️</div>
              <p className="wag-text">This isn't available until the party!</p>
            </div>
          </div>
        </div>
      )}

      <button className="site-admin-link" onClick={() => navigate('/admin')}>
        admin
      </button>
    </div>
  );
}
