export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { resolveAccessRoute } from "@/lib/accessRoute";
import { resolveInviteLink, viewerCanSeeTrip } from "@/server/lib/inviteLink";
import IdentityChoice from "./IdentityChoice";
import InviteMessage from "./InviteMessage";

/**
 * Invite landing — ROUTING ONLY.
 *
 * ── There is no accept step, and building one would have been wrong ────────
 * An invited person is already on the roster: `tripMembers.inviteByEmail`
 * inserts their `trip_members` row (status `invited`) BEFORE the email is sent.
 * The invite is a notification that you've been added, not an offer. So this
 * page has exactly one job — work out the shortest path from wherever this
 * person is to the trip, and put them on it.
 *
 * This REPLACES a client-side accept flow that stamped `invites.accepted_at`
 * and self-inserted into `trip_members` from the browser. That flow was dead in
 * practice as well as wrong in principle: `invites` SELECT is gated on
 * `is_trip_member`, so the only session that could read the invite was one that
 * was already a member — which is exactly the case where the insert was
 * skipped. The arm never ran for anyone it was written for. (It also meant the
 * only greeting an unauthenticated invitee ever saw was a bare `/login` saying
 * "Welcome back" — #980.)
 *
 * Server-rendered on purpose. The decision needs the session AND a
 * service-role read of `invites`, and doing it here means no spinner, no
 * client waterfall, and no flash of the wrong screen before the redirect.
 *
 * The branching itself lives in `resolveAccessRoute` (client-safe, pure) so it
 * is not invite-specific: this file supplies facts, that one decides.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const invite = await resolveInviteLink(token);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewer = user ? { id: user.id, email: user.email ?? null } : null;
  const viewerCanSeeTarget =
    viewer && invite ? await viewerCanSeeTrip(viewer.id, invite.tripId) : false;

  const route = resolveAccessRoute({
    target: invite?.target ?? null,
    viewer,
    viewerCanSeeTarget,
    addressee: invite?.addressee ?? null,
  });

  switch (route.kind) {
    // Branch 1 — an active session that IS the invited person. Straight to the
    // trip, no interstitial. Nothing to confirm and nobody to confirm it to.
    case "go":
      redirect(route.path);

    // Branches 3 & 4 — no session. `mode` is already the right one (sign in if
    // the address has an account, sign up if it doesn't), and `invite` rides
    // along so the auth page can name the trip and prefill the address without
    // any of that being readable — or writable — in the URL.
    case "authenticate":
      redirect(
        `/login?mode=${route.mode}&next=${encodeURIComponent(route.next)}` +
          `&invite=${encodeURIComponent(invite!.token)}`
      );

    // Branch 2 — a session, but a different account. Never resolved silently:
    // signing someone out without asking is hostile, and guessing they meant
    // the account they're in is how scores get entered under the wrong name.
    case "identity-choice":
      return (
        <IdentityChoice
          tripName={invite!.target.resourceName}
          inviterName={invite!.inviterName}
          invitedEmail={route.invitedEmail}
          next={route.next}
          token={invite!.token}
          viewerEmail={viewer!.email}
          viewerCanSee={route.viewerCanSee}
        />
      );

    // Signed in as the invited person, but not on the roster — removed after
    // the invite went out, most likely. Say so plainly rather than bouncing
    // them into a trip page that will refuse them without explanation.
    case "no-access":
      return (
        <InviteMessage
          title="You're not on this trip"
          body={
            "Your invite to " +
            (invite?.target.resourceName ?? "this trip") +
            " is no longer active. Ask whoever invited you to add you again."
          }
        />
      );

    case "unresolvable":
      return (
        <InviteMessage
          title="This invite link isn't valid"
          body="The link may have been mistyped, or the trip may have been deleted. Ask whoever invited you for a fresh link."
        />
      );
  }
}
