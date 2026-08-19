/**
 * Deep-link routing — "a link to a resource takes you to the resource".
 *
 * The rule this module encodes, in one sentence: **a link to a resource takes
 * you to the resource if you can see it; if you can't, it takes you to the
 * shortest path to being able to, and then to the resource.**
 *
 * It is deliberately NOT invite-specific. The inputs are the four facts any
 * deep link can supply — where it points, who is looking, whether that viewer
 * can see the target, and (optionally) who the link was addressed to — so a
 * link to a league, a game, or a competition can reuse this the day one exists.
 * Invites are simply the first producer of those facts
 * (`src/server/lib/inviteLink.ts` turns a token into them).
 *
 * Pure and client-safe: no DB, no auth, no `next/navigation`. Every caller
 * resolves the facts, calls this, and acts on the verdict — so the branching
 * is testable without a browser, a session, or a database.
 */

/** Where the link points, and what to call it in copy. */
export type LinkTarget = {
  /** Same-origin path of the resource, e.g. `/trips/{uuid}`. */
  path: string;
  /** Human name of the resource, e.g. the trip title. Shown on auth screens. */
  resourceName: string;
};

/**
 * Who the link was addressed to, when the link carries a capability that knows.
 * `null` for a plain deep link (someone forwarded a URL) — routing still works,
 * it just can't prefill or tell "has an account" from "doesn't".
 */
export type LinkAddressee = {
  email: string;
  /** Whether that address already has a real (non-guest) account. */
  hasAccount: boolean;
};

/** The signed-in user, or `null` for an unauthenticated visitor. */
export type LinkViewer = {
  id: string;
  email: string | null;
};

export type AccessRoute =
  /** Branch 1 — go straight there, no interstitial. */
  | { kind: "go"; path: string }
  /**
   * Branches 3 & 4 — no session. `mode` is the shortest path to being able to
   * see it: sign in if the invited address already has an account, sign up if
   * it doesn't. `prefillEmail` is a PREFILL, never a lock (#981).
   */
  | {
      kind: "authenticate";
      mode: "signin" | "signup";
      next: string;
      prefillEmail: string | null;
    }
  /**
   * Branch 2 — a session, but not the account the link was addressed to. Never
   * resolved silently: signing someone out without asking is a hostile act, and
   * so is dropping them on a "no access" page when the account they are already
   * in can see the thing. `viewerCanSee` decides which of those two offers the
   * page can make.
   */
  | {
      kind: "identity-choice";
      next: string;
      invitedEmail: string;
      viewerCanSee: boolean;
    }
  /** A session whose account simply cannot see the target, and no other identity to offer. */
  | { kind: "no-access" }
  /** The link resolved to nothing — bad, revoked, or deleted-out-from-under. */
  | { kind: "unresolvable" };

export type AccessRouteInput = {
  /** `null` when the capability didn't resolve (unknown token, deleted trip). */
  target: LinkTarget | null;
  viewer: LinkViewer | null;
  /** Whether THIS viewer can see the target. Meaningless when `viewer` is null. */
  viewerCanSeeTarget: boolean;
  addressee: LinkAddressee | null;
};

/** Case- and whitespace-insensitive address comparison. */
function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveAccessRoute(input: AccessRouteInput): AccessRoute {
  const { target, viewer, viewerCanSeeTarget, addressee } = input;

  if (!target) return { kind: "unresolvable" };

  // ── No session — route to the shortest path to having one ───────────────
  if (!viewer) {
    // No addressee (a forwarded plain link): we can't tell "has an account"
    // from "doesn't", so sign-in is the safe default — it is one tap from
    // sign-up, and the reverse is a worse guess for someone who already has an
    // account and would then hit "email already registered".
    if (!addressee) {
      return { kind: "authenticate", mode: "signin", next: target.path, prefillEmail: null };
    }
    return {
      kind: "authenticate",
      mode: addressee.hasAccount ? "signin" : "signup",
      next: target.path,
      prefillEmail: addressee.email,
    };
  }

  // ── A session that is NOT the addressee ─────────────────────────────────
  // Note the ordering: identity is checked BEFORE access. Someone signed in as
  // a different account who happens to be a member of the same trip still gets
  // the choice — they may well be on a shared device, and "it just worked" is
  // how the wrong person ends up entering scores as someone else.
  if (addressee && !sameAddress(viewer.email, addressee.email)) {
    return {
      kind: "identity-choice",
      next: target.path,
      invitedEmail: addressee.email,
      viewerCanSee: viewerCanSeeTarget,
    };
  }

  // ── A session that IS the addressee (or a plain link) ───────────────────
  if (!viewerCanSeeTarget) return { kind: "no-access" };
  return { kind: "go", path: target.path };
}
