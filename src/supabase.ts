import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Remains null in local-only builds so the current offline MVP works without
 * developer credentials. Features that require an account must call
 * requireSupabase() and surface a configuration error rather than silently
 * discarding a player's data.
 */
export const supabase: SupabaseClient | null = url && publishableKey
  ? createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Cloud sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  return supabase;
}
