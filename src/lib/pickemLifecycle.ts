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

/**
 * WHY picks are closed, and WHEN — for the one sentence §8.4 requires.
 *
 * "A control that stopped working with no explanation is the falsehood
 * pattern", same as the "Not live — scoring disabled" line Phase 2's look
 * removed. A sheet that silently goes read-only tells someone their app is
 * broken; "Picks closed at 11:00 AM" tells them what happened.
 *
 * ── Both can be true, so it reports whichever happened FIRST ───────────────
 *
 * A runner can hand-lock a game that also has a deadline, and a deadline can
 * pass on a game already hand-locked. Reporting the LATER one would name a
 * cause that arrived after the thing it supposedly caused — telling someone
 * picks closed at 11:00 when the runner had already closed them at 10:30, so
 * the half hour they remember being locked out is unexplained.
 *
 * Returns null while picks are still open, and while the game has never
 * opened: neither is "closed", and a caller rendering this must not invent a
 * closure for a game that has not started.
 */
export type PickemClosure = { at: number; reason: "deadline" | "locked" };

export function pickemClosure(
  clock: PickemClock,
  now: number = Date.now()
): PickemClosure | null {
  if (!picksEverOpened(clock)) return null;
  if (picksOpen(clock, now)) return null;

  const locked = at(clock.picksLockedAt);
  const deadline = at(clock.picksDeadline);
  const deadlinePassed = deadline != null && now > deadline;

  if (locked != null && deadlinePassed) {
    // Whichever actually ended it.
    return locked <= (deadline as number)
      ? { at: locked, reason: "locked" }
      : { at: deadline as number, reason: "deadline" };
  }
  if (locked != null) return { at: locked, reason: "locked" };
  if (deadlinePassed) return { at: deadline as number, reason: "deadline" };
  // Closed for a reason this function does not model — do not guess at one.
  return null;
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
 * seventeenth game would invalidate every 1–16 ranking already submitted.
 *
 * ── Editable whenever picks are NOT OPEN — including `locked` ──────────────
 *
 * This used to be `phase === "building"`, which froze the slate from the first
 * open onwards forever. The only way back was `reopen`, and `reopen` nulled
 * every participant's `confidence` — irreversibly, with no audit table — as a
 * side effect of an action whose stated purpose was making the slate editable.
 * Reopen and change nothing, and sixteen rankings were destroyed for nothing.
 *
 * The consequence belongs to the EDIT, not to the mode. Adding or removing a
 * game is what invalidates a ranking; opening the door is not. So `reopen` is
 * gone (migration 156), the slate is editable in `building` AND `locked`, and
 * the clear happens inside `save_pickem_config` when the slate's id SET
 * actually changes.
 *
 * The runner's route back into a live game is therefore `unlock`, which now
 * costs nothing on its own — and `picks_opened_at` and each pick's
 * `updated_at` survive, since neither was ever reopen's business.
 *
 * Lock point 2 — the first RESULT freezing the slate against the runner — is a
 * separate trigger on a separate axis and is NOT expressible here: results do
 * not exist until Phase 5, and this module deliberately knows nothing about
 * them. When it lands it ANDs with this; it does not replace it.
 */
export function slateEditable(clock: PickemClock, now: number = Date.now()): boolean {
  return !picksOpen(clock, now);
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

/**
 * The countdown string. Pure so the boundary cases are testable without a DOM.
 *
 * ── Why the format CHANGES under an hour ───────────────────────────────────
 *
 * The first version rendered whole minutes at every distance, so the last
 * fifty-nine seconds displayed a motionless "0m". That is the reported bug in
 * miniature — the clock is ticking, the screen is not — and it lands in exactly
 * the minute the countdown exists for.
 *
 * So: `3h 05m` while there is an hour or more (seconds there are noise), and
 * `12:34` counting seconds below that. The switch happens once, at a point
 * nobody is watching.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Why the scoring settings are frozen — or null while they are editable.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * The settings page rendered one static sentence whenever the controls were
 * disabled: "Picks are open, so scoring is frozen." But the controls are frozen
 * in TWO phases — `picks_open` and `locked` — and on a locked game that sentence
 * is simply false. The look caught it on screen next to a lock control and a
 * closed sheet: three statements about one game, one of them contradicting the
 * other two.
 *
 * Third time in this feature that copy has described a state the game was not
 * in, and all three had the same cause — a sentence written for the state the
 * author had in mind, rendered on a condition that covers more states than that
 * one. So this is DERIVED from the phase and returns the reason for the phase
 * the game is actually in.
 *
 * ── Why a reason at all, rather than hiding the controls ───────────────────
 *
 * Hiding them was the alternative the look offered. Saying why is better here
 * for two reasons: the freeze is REVERSIBLE (reopening the slate restores both
 * controls, so a mute disabled row hides an action that is actually available),
 * and a settings page that changes its shape between phases makes the runner
 * hunt for a row that was there yesterday. A disabled control with a reason and
 * a named way out is the honest version.
 */
export function scoringFrozenReason(
  clock: PickemClock,
  now: number = Date.now()
): string | null {
  // ONE frozen phase now, not two. Migration 156 made the slate editable
  // whenever picks are not open, which includes `locked` — so a locked game's
  // settings are no longer frozen and there is nothing to explain there.
  //
  // The way out is `unlock`, and it is worth saying that it costs nothing:
  // clearing rankings moved to the slate save, where it fires only if the slate
  // actually changes. The previous version of this sentence warned about losing
  // work for merely getting back in, which was true of `reopen` and is the
  // behaviour that was removed.
  if (picksOpen(clock, now)) {
    return "Picks are open, so scoring is frozen — people are filling in sheets under these rules. Lock picks to change them; nobody loses anything unless the slate itself changes.";
  }
  return null;
}

