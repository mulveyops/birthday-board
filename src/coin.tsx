import type { ReactNode } from 'react';

/**
 * The coin, drawn by us.
 *
 * 🪙 is a gold coin on Apple and a flat grey disc on Android and Windows, so
 * the same number looked like a different currency depending on whose phone you
 * were holding — and the board itself paints a gold coin, which made the
 * mismatch worse. This renders the gold one everywhere (see `.coin` in
 * index.css) and sits on the text baseline, so it works mid-sentence as well
 * as on a button.
 */
export function Coin() {
  return <span className="coin" role="img" aria-label="coins" />;
}

/**
 * Swap the coin character for the drawn coin inside a run of text.
 *
 * Feed lines, chat and popups are composed as plain strings — they're written
 * to the database and read back, so they can't carry markup. They still carry
 * the character, and this turns it into the real coin at the moment it's
 * rendered. Pass any string that might mention coins.
 */
export function coinify(text: string | null | undefined): ReactNode {
  const s = text ?? '';
  if (!s.includes('🪙')) return s;
  const parts = s.split('🪙');
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<Coin key={i} />, part]));
}
