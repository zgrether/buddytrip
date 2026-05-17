import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/**
 * OAuth + magic-link callback.
 *
 * After successfully exchanging the auth code, decide where to send
 * the user:
 *
 *   1. `?next=` query param — explicit override, used by invite flows
 *      that need to land the user on a specific trip after the
 *      guest→member merge completes.
 *   2. New user (no trip memberships, no invite token) → /trips/new.
 *      Skip the empty state — the most useful next step on a trip
 *      planning app is creating a trip.
 *   3. Returning user → "/" — the smart-redirect logic on the home
 *      page picks their most relevant trip.
 *
 * If `?next=` is supplied we honor it without doing the trip-count
 * lookup, so invite redirects stay fast.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Explicit destination wins (invite flows, deep links).
  if (next) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Look up trip memberships to decide between organic-signup (no trips
  // yet → /trips/new) and returning-user paths.
  const userId = sessionData?.user?.id;
  if (userId) {
    const { data: memberships, error: memErr } = await supabase
      .from("trip_members")
      .select("trip_id")
      .eq("user_id", userId)
      .limit(1);

    if (!memErr && (!memberships || memberships.length === 0)) {
      return NextResponse.redirect(`${origin}/trips/new`);
    }
  }

  // Returning user — let the home-page smart redirect pick the
  // most-relevant trip (or show the empty state).
  return NextResponse.redirect(`${origin}/`);
}
