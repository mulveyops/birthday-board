import { useEffect, useState } from 'react';
import App from './App';
import Home from './pages/Home';
import Rsvp from './pages/Rsvp';
import Admin from './pages/Admin';

/**
 * Navigate client-side. We use HASH routing (#/rsvp) on purpose: the fragment
 * never reaches the server, so deep links / refreshes always serve index.html
 * and the app routes itself — no Render rewrite rule needed. Pass a path like
 * "/rsvp"; it's stored as "#/rsvp".
 */
export function navigate(to: string) {
  const target = to.startsWith('#') ? to : '#' + to;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

/**
 * Tiny hash router (no dependency):
 *   (none) / #/  → Home (choose Play or RSVP)
 *   #/rsvp       → public RSVP form
 *   #/play       → the game, player variant (join by code)
 *   #/admin      → password curtain → board builder + RSVP responses
 */
export default function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [pathRaw, queryRaw] = hash.replace(/^#/, '').split('?');
  const p = pathRaw.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(queryRaw || '');
  if (p === '/rsvp') return <Rsvp />;
  if (p === '/play')
    return (
      <App
        variant="player"
        initialCode={params.get('code') ?? undefined}
        // ?classic=1 falls back to the old Leaflet player view (escape hatch)
        classicMap={params.get('classic') != null}
      />
    );
  if (p === '/admin') return <Admin />;
  if (p === '/content') return <Admin initialTab="content" />;
  return <Home />;
}
