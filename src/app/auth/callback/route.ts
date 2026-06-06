import { NextResponse } from "next/server";
import type {
  AuthError,
  EmailOtpType,
  Session,
  User,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";

/**
 * Auth callback — handles every email/OAuth flow that lands a user back in the
 * app and needs a session established: email confirmation (signup), magic link,
 * OAuth, and recovery. It supports BOTH link formats Supabase can send:
 *
 *   • `?code=…`                 → PKCE / OAuth → exchangeCodeForSession()
 *   • `?token_hash=…&type=…`    → email OTP (signup confirm, recovery, etc.)
 *                                 → verifyOtp({ token_hash, type })
 *
 * Either way we end up with a session whose cookies are written onto the
 * redirect response (route handlers allow cookie mutation), so the user is
 * fully signed in when they arrive.
 *
 * Destination, in order:
 *   1. `?next=` — explicit override (signup confirm passes `/dashboard`;
 *      invite flows pass a specific trip after the guest→member merge).
 *   2. New user (no trip memberships) → /trips/new — the most useful next step.
 *   3. Returning user → "/" — the home-page smart redirect picks their trip.
 *
 * If `?next=` is supplied we honor it without the trip-count lookup, so signup
 * and invite redirects stay fast.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  const supabase = await createClient();

  // Establish the session from whichever flow Supabase sent.
  let sessionData: { user: User | null; session: Session | null } | null = null;
  let authError: AuthError | null = null;
  if (tokenHash && type) {
    // Email OTP flow (signup confirmation, recovery, email change, …).
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    sessionData = data;
    authError = error;
  } else if (code) {
    // PKCE / OAuth / magic-link code flow.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    sessionData = data;
    authError = error;
  } else {
    // Nothing to verify — bounce to login.
    return NextResponse.redirect(`${origin}/login`);
  }

  if (authError) {
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
