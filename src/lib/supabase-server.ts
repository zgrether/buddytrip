import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { CALLER_FETCH_TIMEOUT_MS, fetchWithTimeout } from "./fetchWithTimeout";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // #1258: nothing bounded a Supabase call, so a stalled connection could
      // hold a function to its ceiling — 09-11 had 1,592 reads take 25–55s, none
      // of them stopped by Postgres's own `statement_timeout`. 8s is above the
      // slowest legitimate request measured (5.7s); see the helper for the
      // corridor and for why it sits at the database's number rather than below.
      global: { fetch: fetchWithTimeout(CALLER_FETCH_TIMEOUT_MS) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}
