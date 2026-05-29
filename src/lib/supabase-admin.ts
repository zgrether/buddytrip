import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-authored privileged writes that RLS
 * intentionally blocks for end users.
 *
 * The messages_insert policy only permits a member inserting their OWN
 * (`user_id = auth.uid()`) `message_type='user'` rows, so server-emitted
 * system lifecycle lines (`message_type='system'`, `user_id=null`) can't go
 * through the user-scoped client — they need this one, which bypasses RLS.
 *
 * SERVER-ONLY. SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next
 * never inlines it into the client bundle; keep every import of this module
 * inside server code (tRPC routers, route handlers) so the key never leaks.
 */
let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return cached;
}
