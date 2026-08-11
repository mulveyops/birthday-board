import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public anon key — designed to live in frontend code, guarded by RLS. Never the
// service_role secret. Fill these in .env.local (see .env.example).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True once the project URL + anon key are configured. */
export const isConfigured = Boolean(url && anon);

// A single shared client. If unconfigured, calls fail with a clear message rather
// than crashing the app at import time (so the local designer/sim still runs).
export const supabase: SupabaseClient = createClient(
  url ?? 'https://unconfigured.supabase.co',
  anon ?? 'unconfigured',
  { realtime: { params: { eventsPerSecond: 5 } } },
);

export function assertConfigured() {
  if (!isConfigured) {
    throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
  }
}
