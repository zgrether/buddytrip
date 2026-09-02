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

/**
 * Would clearing the hand lock leave picks CLOSED anyway?
 *
 * ── The hole this closes ───────────────────────────────────────────────────
 *
 * `unlock` clears `picks_locked_at` and nothing else — migration 151 said so,
 * 156 restated it and 165's body says it again. So on a game whose deadline has
 * already passed, pressing the runner's one action does nothing observable:
 * `picksOpen` still fails on `now <= deadline`, the phase stays `locked`, and
 * the page comes back looking exactly as it did.
 *
 * That is the refusal rule inverted. A refusal that names an impossible action
 * is bad; an ACTION that silently performs nothing is worse, because there is
 * no message to disbelieve — the runner concludes the app is broken, and they
 * are not wrong about the symptom.
 *
 * The deadline block underneath has always said this ("Unlocking won't reopen
 * picks until this moves"), which is honest and still not enough: the sentence
 * is below the button, in smaller type, and describes a second control the
 * reader has to connect to the first.
 *
 * ── Why it lives HERE ──────────────────────────────────────────────────────
 *
 * Two callers need it and they must not disagree: the strip, to say what Start
 * is about to do, and the view, to actually do it. The version where each
 * derives `deadline != null && now > deadline` for itself is the version where
 * one of them gets the boundary wrong — and this module already owns every
 * other reading of that comparison.
 */
export function deadlineBlocksReopen(clock: PickemClock, now: number = Date.now()): boolean {
  const deadline = at(clock.picksDeadline);
  return deadline != null && now > deadline;
}

/**
 * The clock phase — what every surface should branch on.
 *
 * ── A DIFFERENT AXIS FROM `gameLifecycle`, AND BOTH ARE TRUE AT ONCE ────────
 *
 * This one is about PICKS: has the slate been published, and is it still taking
 * sheets. `gameLifecycle` / `gameLockState` (`src/lib/gameLifecycle.ts`) is about
 * RESULTS: has the game been finalized, and is it reopened for a correction.
 *
 * The normal state of a pick'em game on a Saturday afternoon is *picks locked,
 * results still open* — this axis at `locked` while the other has not started.
 * They are also entered by different people at different times: the runner
 * closes picking before kickoff and finalizes after the last whistle, possibly
 * days apart.
 *
 * So neither derives from the other and neither may be folded in. The one place
 * they MEET is the finalize gate — `computePickemResults` refuses while picks are
 * open, and the pick'em view feeds `picksRevealed` in as `gameLifecycle`'s
 * `allComplete` input, because "may this be finalized yet" is the question that
 * input exists to answer. That is one function reading both, which is the right
 * shape; a single combined enum would be the wrong one.
 *
 * CLAUDE.md #25 is the standing warning: the go-live triple was described as
 * moving together for months, was wrong, and was wrong in the confident
 * direction. Two axes that usually advance in the same order are not one axis.
 */
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
 * The consequence belongs to the EDIT, not to the mode. So `reopen` is gone
 * (migration 156), the slate is editable in `building` AND `locked`, and the
 * consequence lives inside `save_pickem_config`.
 *
 * WHICH edit, though, has since narrowed twice, and this comment said "adding
 * or removing" for both of them:
 *
 *   - 174 — an ADD costs nothing. Migration 166 made a partial sheet legal
 *     (ranks within 1..N and distinct; exactly-1..N only when complete), so
 *     growing the slate leaves every existing rank valid with nothing to
 *     invalidate. Only a REMOVE can strand a rank above the new N.
 *   - 175 — a REMOVE that would strand one is now REFUSED rather than
 *     absorbed, because picks are closed by then and nobody could re-rank
 *     (#1208). The clear survives for the confidence-off case, where stale
 *     ranks are cleaned up and no ranking is lost.
 *
 * The runner's route back into a live game is therefore `unlock`, which now
 * costs nothing on its own — and `picks_opened_at` and each pick's
 * `updated_at` survive, since neither was ever reopen's business.
 *
 * Lock point 2 — a RESULT freezing the slate against the runner — is a separate
 * trigger on a separate axis and is still NOT expressible here: this module
 * knows only the clock. It landed in migration 175 as a per-CONTEST rule (a
 * contest carrying a result cannot be removed) rather than as a whole-slate
 * mode, so it ANDs with this inside the RPC and does not replace it — which is
 * what makes it degrade correctly if results ever start arriving live.
 */
export function slateEditable(clock: PickemClock, now: number = Date.now()): boolean {
  return !picksOpen(clock, now);
}

/**
 * Are the settings that change what a pick is WORTH still editable?
 *
 * ── It is the first RESULT, not the clock (migration 157) ──────────────────
 *
 * This used to be `slateEditable` — frozen the moment picks opened, on the
 * reasoning that both settings change the meaning of a sheet already filled in.
 * True, but too early: until something has been SCORED, changing how scoring
 * works rewrites nothing. Every sheet is re-read through whatever the rules are.
 *
 * That earlier boundary is also what made one atomic save impossible.
 * `points_total` had been carved out of it (152) precisely so a 0-point game
 * could be fixed mid-trip, so the settings page had two freeze points and no
 * single Save could honour both. All three now share this one.
 *
 * Takes the ANSWER rather than computing it: `_pickem_has_results` is the
 * authority (it is what the RPC refuses on) and is REVOKEd from
 * `authenticated` as a container fact, so `pickem.get` mirrors it server-side
 * and hands the result down. Do NOT re-derive it from the clock here — that is
 * the divergence this signature exists to prevent.
 */
export function scoringSettingsEditable(hasResults: boolean): boolean {
  return !hasResults;
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
/**
 * The same clock, split into number/unit segments so the display can colour
 * them apart (STYLE_GUIDE §2c — the number is the value, the unit is its label).
 *
 * A SECOND function rather than changing formatCountdown's contract: that one
 * returns a string and a string is what a non-visual caller wants. Below the
 * hour this returns a single unit-less segment (12:34), because mm:ss has no
 * unit to separate — the colons carry it.
 */
export function formatCountdownParts(ms: number): { value: string; unit?: string }[] {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return [
      { value: String(h), unit: "h" },
      { value: String(m).padStart(2, "0"), unit: "m" },
    ];
  }
  return [{ value: `${m}:${String(s).padStart(2, "0")}` }];
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * How far off a deadline is, said coarsely: `2d 4h` · `4h 20m` · `12m`.
 *
 * NOT `formatCountdown`, and the difference is the point. That one is a live
 * clock a person watches tick toward zero, so it counts seconds once inside the
 * hour. This is a static lead time on a runner's strip — the answer to "is this
 * happening soon or not", read once and not watched — and at two days away
 * `52h 05m` is a worse answer than `2d 4h` for that question.
 *
 * Floors at `under a minute` rather than showing `0m`, which would read as a
 * deadline that has already passed.
 */
export function formatLeadTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return "under a minute";
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
export function scoringFrozenReason(hasResults: boolean): string | null {
  // The clock no longer freezes these AT ALL (migration 157) — picks opening,
  // and even locking, leave them editable. The only thing that closes them is a
  // recorded result, and at that point there is no way back: the reason names
  // the cause rather than offering an exit, because there isn't one.
  //
  // Two earlier versions of this sentence described a state the game was not in
  // — first claiming picks were open on a locked game, then warning about work
  // lost to a reopen that no longer exists. Derived from the one input now.
  if (hasResults) {
    return "Results are in, so how this game scores is frozen — changing it now would rescore what has already been recorded.";
  }
  return null;
}

/**
 * Did the lock just take an unsaved draft?
 *
 * The EDGE, not a state: editable going true→false while there were unsaved
 * changes. Extracted from the sheet so the condition is assertable — an effect
 * cannot be reached by `renderToStaticMarkup`, and this is the half worth
 * pinning.
 *
 * Why it is reported rather than prevented: the picks genuinely cannot be kept.
 * `pickem_picks_write` gates on `pickem_picks_open`, so the server refuses them
 * the instant the clock turns. What was wrong before was that it happened in
 * SILENCE — the sheet went read-only and the typing vanished with nothing said,
 * which reads as the app losing your work rather than the deadline arriving.
 *
 * That silence, not the Save button, was the actual complaint. Autosave would
 * have hidden the same moment differently.
 */
export function draftLostToLock(opts: {
  wasEditable: boolean;
  editable: boolean;
  dirty: boolean;
}): boolean {
  return opts.wasEditable && !opts.editable && opts.dirty;
}
