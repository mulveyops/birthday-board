import { useEffect, useState } from 'react';
import App from './App';
import Home from './pages/Home';
import Rsvp from './pages/Rsvp';
import Admin from './pages/Admin';

/** Navigate client-side and let <Root> re-render. */
export function navigate(to: string) {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Tiny path router (no dependency). Render targets:
 *   /        → Home (choose Play or RSVP)
 *   /rsvp    → public RSVP form
 *   /play    → the game, player variant (join by code)
 *   /admin   → password curtain → board builder + RSVP responses
 * Render's SPA rewrite (render.yaml) serves index.html for every path.
 */
export default function Root() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/rsvp') return <Rsvp />;
  if (p === '/play') return <App variant="player" />;
  if (p === '/admin') return <Admin />;
  return <Home />;
}
