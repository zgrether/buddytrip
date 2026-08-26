/**
 * Pick'em's clock — the ONE definition of "are picks open" that the app reads.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 * There are necessarily TWO implementations of this rule: these functions, and
 * the SQL bodies of `pickem_picks_open` / `pickem_picks_revealed` (migrations
 * 146/147) that the RLS policies call. SQL cannot import TypeScript, so the
 * duplication is real and permanent.
 *
 * What is NOT permanent is the two agreeing by coincidence. If the UI decides
 * picks are open by one rule and the policy decides by another, the symptom is
 * a runner who opens picks and sees nothing change on the member-facing page —
 * which reads like a caching bug and is not one. Nobody would look at a policy.
 *
 * So `pickemLifecycleParity.rls.test.ts` drives BOTH over the same table of
 * clock states and asserts they agree case by case, including the boundary
 * where the two predicates hand over. That is the same instrument CLAUDE.md #20
 * prescribes for the broadcast topic string: a two-sided contract whose mismatch
 * would otherwise fail silently gets a test that exercises both sides for real.
 *
 * **Change a rule here and you must change the SQL in the same PR**, or that
 * test fails — which is the point.
 *
 * ── Boundary semantics, stated because they are easy to get subtly wrong ────
 * At EXACTLY the deadline instant, picks are open and not yet revealed:
 * `open` uses `now <= deadline`, `revealed` uses `now > deadline`. The two are
 * complements at that instant, so there is no moment where a sheet is both
 * editable and readable by other people, and none where it is neither.
 *
 * ── Why these two are not inverses ──────────────────────────────────────────
 * Before picks open, BOTH are false: nothing is writable and nothing is
 * revealed. That is state 1, and an inverse pair could not express it — which
 * is why the app asks `pickemPhase` rather than a boolean.
 *
 * Pure and client-safe: no tRPC, no DB, no React. The lock is evaluated lazily
 * from `now` at every call, because nothing in this stack can fire a timed
 * event (spec §7.1) — there is no "the deadline passed" event, only readers who
 * notice.
 */

/** The three lifecycle timestamps, exactly as `pickem_games` stores them. */
export interface PickemClock {
  /** State 1 → 2. Null means the slate has never been published. */
  picksOpenedAt: string | null | undefined;
  /** Optional. Absent means picks stay open until the runner locks by hand. */
  picksDeadline: string | null | undefined;
  /** The manual "Lock picks now" — the only EXPLICIT transition. */
  picksLockedAt: string | null | undefined;
}

/**
 * Where the game sits on the CLOCK axis.
 *
 * Deliberately not the spec's full state list: "running" and "final" are facts
 * about RESULTS and `games.status`, a separate axis that moves on its own. A
 * game can be locked and have no results for days. Conflating the two is how
 * `status` and the go-live triple got described as moving together when they
 * do not (CLAUDE.md #25).
 */
export type PickemPhase =
  /** 1a/1b — the runner is building. Members see "picks open soon" and cannot
   *  tell an empty slate from a finished one (enforced in RLS, not here). */
  | "building"
  /** 2 — participants are writing. Nobody sees another sheet, staff included. */
  | "picks_open"
  /** 3 — sheets are frozen and revealed. Pairing becomes legal here. */
  | "locked";

const at = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const t = new Date(v).getTime();
  // An unparseable timestamp is treated as ABSENT rather than as 0 (1970),
  // which would read as "opened long ago" and silently publish a slate.
  return Number.isNaN(t) ? null : t;
};

/** Has the runner published the slate at all? */
export function picksEverOpened(clock: PickemClock): boolean {
  return at(clock.picksOpenedAt) != null;
}

/**
 * Are picks being accepted right now?
 *
 * Mirrors `public.pickem_picks_open(text)`. Opened, not hand-locked, and either
 * no deadline or the deadline has not passed.
 */
export function picksOpen(clock: PickemClock, now: number = Date.now()): boolean {
  if (!picksEverOpened(clock)) return false;
  if (at(clock.picksLockedAt) != null) return false;
  const deadline = at(clock.picksDeadline);
  return deadline == null || now <= deadline;
}

/**
 * Are everyone's sheets readable by the rest of the trip?
 *
 * Mirrors `public.pickem_picks_revealed(text)`. Opened AND (hand-locked OR past
 * the deadline).
 */
export function picksRevealed(clock: PickemClock, now: number = Date.now()): boolean {
  if (!picksEverOpened(clock)) return false;
  if (at(clock.picksLockedAt) != null) return true;
  const deadline = at(clock.picksDeadline);
  return deadline != null && now > deadline;
}

/** The clock phase — what every surface should branch on. */
export function pickemPhase(clock: PickemClock, now: number = Date.now()): PickemPhase {
  if (!picksEverOpened(clock)) return "building";
  return picksOpen(clock, now) ? "picks_open" : "locked";
}

/**
 * Is the SLATE editable — its games, order, spreads, times, notes and
 * multipliers?
 *
 * Spec §4 lock point 1: picks opening freezes the slate, because adding a
 * seventeenth game would invalidate every 1–16 ranking already submitted. The
 * runner's escape hatch is Reopen the slate, which returns the game to
 * `building` and makes everyone re-rank.
 *
 * Lock point 2 — the first RESULT freezing the slate against the runner — is a
 * separate trigger on a separate axis and is NOT expressible here: results do
 * not exist until Phase 5, and this module deliberately knows nothing about
 * them. When it lands it ANDs with this; it does not replace it.
 */
export function slateEditable(clock: PickemClock, now: number = Date.now()): boolean {
  return pickemPhase(clock, now) === "building";
}

/**
 * Are the settings that change what a pick is WORTH still editable?
 *
 * `roll_up` and `use_confidence` ride the slate's lock for the same reason it
 * has one: both change the meaning of a sheet that has already been filled in.
 * Kept as its own named function rather than a second call to `slateEditable`
 * so that a future divergence is a code change here, visible in a diff, rather
 * than a call site quietly meaning something different from its neighbours.
 */
export function scoringSettingsEditable(clock: PickemClock, now: number = Date.now()): boolean {
  return slateEditable(clock, now);
}

/**
 * Milliseconds until the deadline, or null when there is nothing to count down
 * to (no deadline, already locked, or not yet open).
 *
 * The countdown is client-local from the raw timestamp, because there is no
 * timezone column anywhere in this schema — so a countdown is both the right
 * display and the only one currently buildable (spec §7).
 */
export function msUntilDeadline(clock: PickemClock, now: number = Date.now()): number | null {
  if (!picksOpen(clock, now)) return null;
  const deadline = at(clock.picksDeadline);
  if (deadline == null) return null;
  return Math.max(0, deadline - now);
}
