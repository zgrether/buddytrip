import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Get-or-create the invite token for one address on one trip.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The app had TWO disjoint invite paths and only one of them minted a token:
 *
 *   A. `tripMembers.inviteByEmail` → writes an `invites` row → emails
 *      `/invite?token=…` → the auth-aware router (#988).
 *   B. `ghostCrew.create` (add a placeholder from the crew tab) → later
 *      `tripMembers.sendInvitationBlast` → emailed a raw `/trips/{uuid}`.
 *
 * #988 wired A. The crew tab does B, so every real invitation sent from the
 * roster bypassed the new router entirely and landed the recipient on
 * `/login` — a "Welcome back" sign-in wall shown to someone who has never had
 * an account. `src/middleware.ts` even names that dead end in a comment; the
 * gap was documented and still shipped, because the spec question ("is there
 * one invites row per invited person per trip?") was answered truthfully about
 * path A while path B was never in view.
 *
 * This helper is what lets B feed A's front door.
 *
 * ── The token is the security boundary, not a convenience ─────────────────
 *
 * The obvious-looking alternative — teach a signed-out `/trips/{uuid}` to
 * render "You've been invited to <trip>" — is the one thing NOT to do. It is
 * equally helpful to the intended reader and to anyone holding or guessing a
 * UUID, with nothing distinguishing them. An unguessable bearer capability is
 * exactly what separates "you were sent this" from "you found this", which is
 * why the invite link carries a token rather than a raw trip id.
 *
 * ── What a forwarded token does and does not do ───────────────────────────
 *
 * Widening the token to blast recipients means more invite emails now carry a
 * bearer capability, so it is worth stating what that capability is. `/invite`
 * has NO accept step: it never inserts a `trip_members` row, and the signup
 * merge is keyed on the email matching the placeholder. So someone forwarded
 * the email learns the trip TITLE and the inviter's NAME, and gets a signup
 * prompt — they cannot join the trip, and migration 128 already refuses a
 * self-insert. That disclosure is the deliberate trade behind a token link
 * (path A has shipped it since #988); it is the price of being able to say
 * "Zach invited you to BBMI Playground" to someone who is not signed in.
 *
 * ── This row GRANTS nothing ───────────────────────────────────────────────
 *
 * In the blast path the recipient is ALREADY a `trip_members` row (a
 * placeholder added from the crew tab). The `invites` row exists only to mint
 * an unguessable link for them; their membership and role live in
 * `trip_members` and are carried onto their real account by
 * `merge_guest_to_real_user` at signup. So:
 *
 *   - `role` is left at the table default (`'Member'`). It is NOT copied from
 *     their `trip_members` role, because nothing reads `invites.role` any more
 *     — `resolveInviteLink` does not select it, and the browser-side copy into
 *     `trip_members` was removed in #980 (recorded in migration 128). Copying
 *     it would also break the send outright: `invites_insert`'s WITH CHECK
 *     (migration 103) lets a non-Owner Organizer write `role = 'Member'` ONLY,
 *     so an Organizer blasting a placeholder who happens to be an Organizer
 *     would be refused by RLS.
 *   - `expires_at` keeps its 7-day default and is deliberately ignored by
 *     `resolveInviteLink` for the same reason — the token opens a door, it
 *     does not hold a key.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 *
 * The blast is re-sendable ("Resend invites"), so this MUST NOT mint a second
 * token per send. It reads first and reuses any existing row for the pair,
 * newest first, so one person on one trip keeps one token however many times
 * they are emailed — including a row minted earlier by path A.
 *
 * Read-then-insert rather than an upsert: `invites` has no UNIQUE on
 * `(trip_id, email)` (only on `token`), so there is no conflict target to
 * upsert onto. **Known and accepted:** two blasts racing in the same instant
 * could each insert, producing two live tokens for one person. That is
 * harmless — both resolve to the same trip and neither grants anything — and
 * the real re-send case (an owner clicking again minutes or days later) is
 * sequential, so it hits the read. Adding a partial UNIQUE index would be a
 * schema change for a case that costs nothing; it is not done here.
 *
 * Runs as the CALLING user, not service-role: minting is an authorized act and
 * stays behind `invites_insert`. The SELECT is permitted by "trip members can
 * view invites for their trip", which the sender satisfies.
 */
export async function ensureInviteToken(
  db: SupabaseClient,
  args: { tripId: string; email: string; createdBy: string }
): Promise<string | null> {
  const email = args.email.trim().toLowerCase();
  if (!email) return null;

  const { data: existing, error: readError } = await db
    .from("invites")
    .select("token")
    .eq("trip_id", args.tripId)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // CHECKED, not swallowed. A refused or failed read that fell through to the
  // insert below would mint a duplicate on every re-send — the exact thing
  // this helper exists to prevent — so a broken read must not look like
  // "no row yet". Returning null degrades to the old raw-trip-URL link, which
  // is the pre-#988 behaviour rather than a new failure.
  if (readError) return null;
  if (existing?.token) return existing.token;

  const { data: created, error: insertError } = await db
    .from("invites")
    .insert({
      trip_id: args.tripId,
      email,
      created_by: args.createdBy,
      // role intentionally omitted — see the doc comment above.
    })
    .select("token")
    .single();

  if (insertError || !created?.token) return null;
  return created.token;
}
