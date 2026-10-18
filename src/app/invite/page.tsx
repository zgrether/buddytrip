export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_TIMEOUT_MS,
  authProbeLine,
  errorKindOf,
  resolveWithTimeout,
} from "@/lib/middlewareAuthTimeout";
import { createClient } from "@/lib/supabase-server";
import { resolveAccessRoute } from "@/lib/accessRoute";
import { resolveInviteLink, viewerCanSeeTrip } from "@/server/lib/inviteLink";
import { QueryFailedError } from "@/server/lib/rowOrThrow";
import IdentityChoice from "./IdentityChoice";
import InviteMessage from "./InviteMessage";
import { buildAuthHandoff } from "./authHandoff";
import { spentLinkRefusal } from "./spentLink";

/**
 * Invite landing — ROUTING ONLY.
 *
 * ── There is no accept step, and building one would have been wrong ────────
 * An invited person is already on the roster: `tripMembers.inviteByEmail`
 * inserts their `trip_members` row BEFORE the email is sent.
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

  // A FAILED read says it couldn't load, with Try again on this same link —
  // never "This invite link isn't valid" (#1611). That sentence used to greet a
  // network blip, often for someone who had never used the app.
  const failed = (
    <InviteMessage
      title="Couldn't load this invite"
      // The cause can't be known (a network blip or the server having a bad
      // moment look the same from here), so the body says the one thing that is
      // true either way, which is the one that keeps a new person from giving up
      // or asking for a fresh link (Zach, on #1612's look).
      body="Your invite is fine — try again in a moment."
      action={{ href: `/invite?token=${encodeURIComponent(token ?? "")}`, label: "Try again" }}
    />
  );

  let invite: Awaited<ReturnType<typeof resolveInviteLink>>;
  try {
    invite = await resolveInviteLink(token);
  } catch (e) {
    if (e instanceof QueryFailedError) return failed;
    throw e;
  }

  const supabase = await createClient();
  /**
   * Guarded for the same reason the home page is, and found by sweeping every
   * `getUser()` rather than by it failing: two were fixed because two were
   * looked at, and this was the third.
   *
   * A stall here is the worst-placed of the four — this is the page somebody
   * lands on from an invite email, so the hang would greet a person who has
   * never used the app.
   *
   * On timeout they are treated as a signed-out viewer, which is what
   * `resolveAccessRoute` already handles: they are offered the sign-in path
   * instead of the "you already have access" path. Nobody is signed out, and
   * the worst case is one extra hop for someone who was already logged in —
   * the same trade the home page documents.
   */
  const resolved = await resolveWithTimeout(
    () => supabase.auth.getUser(),
    AUTH_TIMEOUT_MS
  );
  if (resolved.timedOut) {
    console.warn(
      authProbeLine({
        cookieNames: (await cookies()).getAll().map((c) => c.name),
        surface: "invite",
        pathname: "/invite",
        method: "GET",
        elapsedMs: resolved.elapsedMs,
        outcome: resolved.cause,
        errorKind: errorKindOf(resolved.error),
      })
    );
  }
  const user = resolved.timedOut ? null : resolved.value.data.user;

  const viewer = user ? { id: user.id, email: user.email ?? null } : null;
  // Same rule: a failed membership read is not "not a member", which can route
  // to "You're not on this trip".
  let viewerCanSeeTarget = false;
  try {
    viewerCanSeeTarget = viewer && invite ? await viewerCanSeeTrip(viewer.id, invite.tripId) : false;
  } catch (e) {
    if (e instanceof QueryFailedError) return failed;
    throw e;
  }

  const route = resolveAccessRoute({
    target: invite?.target ?? null,
    viewer,
    viewerCanSeeTarget,
    addressee: invite?.addressee ?? null,
  });

  // A SPENT link with nothing left that can work says so on the first screen
  // (#1041): with no session, and for a signed-in account that cannot see the
  // trip, where the only button used to be "Sign out" into this same message.
  // A member's "Continue as" and a fresh invite's account switch are untouched;
  // see spentLink.ts for why the condition is `spent` and not "no placeholder".
  const spent = invite
    ? spentLinkRefusal(route, { spent: invite.spent, tripName: invite.target.resourceName })
    : null;
  if (spent) return <InviteMessage title={spent.title} body={spent.body} />;

  switch (route.kind) {
    // Branch 1 — an active session that IS the invited person. Straight to the
    // trip, no interstitial. Nothing to confirm and nobody to confirm it to.
    case "go":
      redirect(route.path);

    // Branches 3 & 4 — no session. `mode` is already the right one (sign in if
    // the address has an account, sign up if it doesn't), and `invite` rides
    // along so the auth page can name the trip and prefill the address without
    // any of that being readable — or writable — in the URL.
    //
    // The return path comes back HERE, not to the trip — see `authHandoff.ts`.
    // Someone who takes the "Already have an account? Sign in" escape from the
    // sign-up form arrives as a DIFFERENT account than the invite names, and
    // sending them onward to the trip lands them on its no-access state with
    // the claim never offered.
    case "authenticate":
      // …unless the link no longer names anyone. A CLAIM merges the placeholder
      // away, so the invited address ends up held by nobody: `hasAccount` is
      // false and the route below would send this visitor to SIGN UP with it
      // prefilled, minting an empty account that lands straight on "You're not
      // on this trip". Handled here rather than in `resolveAccessRoute` because
      // it is a fact about the CAPABILITY, not about the viewer — the same
      // class of answer as the token resolving to nothing at all, which is why
      // `resolveInviteLink` is the layer that decides it. That case returns
      // above the switch now (`spentLinkRefusal`), shared with identity-choice.
      redirect(buildAuthHandoff({ mode: route.mode, token: invite!.token }));

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
          // The claim offer is SUPPRESSED when this account is already on the
          // trip, because `claim_placeholder_by_invite` refuses exactly that
          // case — merging there resolves the `trip_members` collision by
          // deleting the placeholder's row, which is the row carrying its
          // nickname and role. Rendering the offer anyway would be a button
          // whose only outcome is a refusal, which is the same reason
          // "Continue as …" is gated on `viewerCanSee` in the first place.
          claimable={route.viewerCanSee ? null : invite!.placeholder}
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
