import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// These are PUBLIC values: the anon key is designed to live in frontend code,
// guarded by RLS (never the service_role secret). They ship in the bundle anyway,
// so we commit them as the source of truth — the app then works even if a hosting
// env var is missing or malformed. (Render's VITE_SUPABASE_ANON_KEY was once pasted
// as a MASKED value — "eyJhbGci••••" — whose • chars (U+2022) crash fetch's
// Headers.set. Hence: only trust an env override when it's clean ASCII.)
const DEFAULT_URL = 'https://cqvprcsdmhhdmfeqofew.supabase.co';
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdnByY3NkbWhoZG1mZXFvZmV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NjE4NDIsImV4cCI6MjEwMjAzNzg0Mn0.fS2FMU4rWiFHRmwqQBQYzTzghNJ8oT54LCiLu5P8tDo';

/** Accept an env override only if present and pure ASCII (a masked/garbled paste
 *  contains non-Latin1 chars that break request headers — ignore it). */
function cleanEnv(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && /^[\x20-\x7E]+$/.test(s) ? s : undefined;
}

const url = cleanEnv(import.meta.env.VITE_SUPABASE_URL) ?? DEFAULT_URL;
const anon = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ?? DEFAULT_ANON;

/** Always true now that public defaults are committed. */
export const isConfigured = Boolean(url && anon);

// A single shared client.
export const supabase: SupabaseClient = createClient(url, anon, {
  realtime: { params: { eventsPerSecond: 5 } },
});

export function assertConfigured() {
  if (!isConfigured) {
    throw new Error('Supabase is not configured');
  }
}
