import { createAdminClient } from "@/lib/supabase-admin";
import type { LinkAddressee, LinkTarget } from "@/lib/accessRoute";

/**
 * Turns an invite token into the generic facts `resolveAccessRoute` needs.
 *
 * SERVER-ONLY — it reads through the service-role client, deliberately. The
 * `invites` SELECT policy is "trip members can view invites for their trip",
 * so the anon client sees NOTHING for an unauthenticated visitor: the one
 * person the invite was written for is exactly the person RLS can't identify
 * yet. Resolving server-side is what lets the landing page name the trip and
 * the inviter before there is a session to check.
 *
 * What the token actually is: an unguessable identifier (32 random bytes hex-
 * encoded, DB-unique — `invites.token`) that reveals a trip title, an inviter's
 * name, and the address it was sent to. It GRANTS NOTHING. The invited person
 * is already on the roster — `tripMembers.inviteByEmail` writes their
 * `trip_members` row (status `invited`) before the email is even sent — so
 * there is no membership to hand out here and no accept step to perform.
 *
 * ── Why `expires_at` is not consulted ──────────────────────────────────────
 * Because there is nothing to expire. `expires_at` guards an OFFER; this token
 * carries none. Refusing an 8-day-old link strands someone who IS a member with
 * no self-serve recovery (they have to ask the organizer to re-invite), while
 * honoring it discloses nothing a fresh token wouldn't — the token is equally
 * unguessable on day 8. The old accept-flow page refused on expiry because it
 * used the invite to authorize a client-side `trip_members` insert; that write
 * is gone, and the reason for the check went with it. Reinstating it is one
 * `.gt("expires_at", …)` here if that judgement is ever reversed.
 */

export type ResolvedInviteLink = {
  token: string;
  /** The trip the link points at. Carried alongside `target.path` so callers
   *  that need the id (a membership check) don't parse it back out of a URL. */
  tripId: string;
  target: LinkTarget;
  addressee: LinkAddressee;
  /** Who sent it, for the copy that names them. Null if the row lost its author. */
  inviterName: string | null;
  /**
   * The placeholder this token was addressed to, when one is still standing on
   * this trip and can be claimed. `null` once it has been merged away — by
   * signup, by an owner's link, or by a claim.
   *
   * The NAME is the point: the claim screen has to say whose history it is
   * about to attach, because that sentence is the entire narrowing on a
   * forwardable token (migration 141). A forwardee reads a name that isn't
   * theirs and stops.
   */
  placeholder: { name: string } | null;
  /**
   * The link named someone, and no longer names anyone reachable: the invite is
   * accepted AND no `users` row holds the address — neither an account nor a
   * placeholder.
   *
   * This exists because a CLAIM creates that state and nothing else describes
   * it. After a claim the address belongs to nobody: `hasAccount` is false, so
   * an unauthenticated visitor to the same link would be routed to SIGN UP with
   * it prefilled, producing a brand-new empty account that lands on "You're not
   * on this trip". A dead end manufactured by the fix.
   *
   * Deliberately NOT the same thing as `accepted_at`, and resolution is NOT
   * gated on it. Signup stamps `accepted_at` for every invite to an address the
   * moment that address signs up, including for people who went on to join
   * perfectly well — refusing those links would break the re-click that branch
   * 1 exists to serve.
   */
  spent: boolean;
};

/**
 * Cheap shape guard before the round-trip. Tokens are `encode(gen_random_bytes(32),
 * 'hex')` — 64 lowercase hex chars — but this only rejects the obviously-not-a-token
 * (empty, absurd length, whitespace) rather than pinning the current generator's
 * exact format, so changing how tokens are minted can't silently 404 every link.
 */
function looksLikeToken(raw: string | null | undefined): raw is string {
  if (typeof raw !== "string") return false;
  const t = raw.trim();
  return t.length > 0 && t.length <= 256 && !/\s/.test(t);
}

/**
 * Resolves an invite token, or `null` if it names nothing (unknown token, or a
 * trip deleted out from under it). `null` is the caller's `unresolvable`.
 */
export async function resolveInviteLink(
  rawToken: string | null | undefined
): Promise<ResolvedInviteLink | null> {
  if (!looksLikeToken(rawToken)) return null;
  const token = rawToken.trim();

  const admin = createAdminClient();

  const { data: invite, error } = await admin
    .from("invites")
    .select(
      "token, trip_id, email, created_by, accepted_at, trips(title), inviter:users!invites_created_by_fkey(name)"
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) return null;

  // A trip deleted after the invite went out cascades the invite row away, so
  // this is belt-and-braces — but a null join here would render "join null",
  // and an unresolvable link is the honest answer.
  const trip = invite.trips as unknown as { title: string | null } | null;
  if (!invite.trip_id || !trip) return null;

  const inviter = invite.inviter as unknown as { name: string | null } | null;
  const email = (invite.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const addressee = await lookupAddressee(admin, email, invite.trip_id);

  return {
    token,
    tripId: invite.trip_id,
    target: {
      path: `/trips/${invite.trip_id}`,
      resourceName: trip.title ?? "the trip",
    },
    addressee: {
      email,
      hasAccount: addressee.hasAccount,
    },
    inviterName: inviter?.name ?? null,
    placeholder: addressee.placeholder,
    spent: Boolean(invite.accepted_at) && !addressee.exists,
  };
}

/**
 * Everything the address itself tells us, in one read.
 *
 * `hasAccount` is what picks sign-in over sign-up. A `users` row with
 * `is_guest = true` is a PLACEHOLDER, not an account — that is precisely the
 * invited-but-never-signed-up person, who needs sign-up. The row is replaced by
 * a real one at signup, when `handle_new_user` → `merge_guest_to_real_user`
 * converts it.
 *
 * `exists` is the same read's other half: whether ANY row holds the address.
 * It separates "already an account" from "nobody at all", which is the state a
 * claim leaves behind and the only way to tell a spent link from a fresh one.
 *
 * `placeholder` is offered ONLY when that guest is on THIS trip and carries no
 * `deleted_at`. Both conditions mirror guards `claim_placeholder_by_invite`
 * enforces itself — the DB is the authority, and this is the courtesy on top of
 * it, so the screen never renders an offer whose only outcome is a refusal.
 * (`users.email` is UNIQUE and `ghostCrew.create` reuses one guest row across
 * trips, so a placeholder for this address may well exist while belonging to
 * some other trip entirely.)
 */
async function lookupAddressee(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  tripId: string
): Promise<{
  exists: boolean;
  hasAccount: boolean;
  placeholder: { name: string } | null;
}> {
  const { data } = await admin
    .from("users")
    .select("id, name, is_guest, deleted_at")
    .eq("email", email)
    .maybeSingle();

  if (!data) return { exists: false, hasAccount: false, placeholder: null };
  if (data.is_guest === false) return { exists: true, hasAccount: true, placeholder: null };
  if (data.deleted_at) return { exists: true, hasAccount: false, placeholder: null };

  const { data: membership } = await admin
    .from("trip_members")
    .select("nickname")
    .eq("trip_id", tripId)
    .eq("user_id", data.id)
    .maybeSingle();

  return {
    exists: true,
    hasAccount: false,
    // Same COALESCE the RPC applies when it reads the name off the row it is
    // about to repoint: the trip nickname is what the crew recognises.
    placeholder: membership
      ? { name: membership.nickname || data.name || "this crew member" }
      : null,
  };
}

/**
 * Whether a viewer can see a trip. Membership IS visibility here: `is_trip_member`
 * (the RLS helper every trip-scoped policy funnels through) tests for a
 * `trip_members` row and nothing else — it does NOT filter on `status`, so a row
 * still sitting at `invited` counts, which is what makes branch 1 work for
 * someone who has never opened the app.
 *
 * Read through the admin client on purpose: this runs on a public page where the
 * caller may be a DIFFERENT account than the addressee, and the answer decides
 * which offer branch 2 can make. It returns a boolean about the CURRENT session's
 * own membership and discloses nothing else.
 */
export async function viewerCanSeeTrip(userId: string, tripId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("trip_members")
    .select("user_id")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
