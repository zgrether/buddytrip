/**
 * gameLifecycle — the ONE place the finalize / correct / re-lock affordances are
 * decided, for every golf format.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Rack and stroke had each grown their own copy of the same three conditions,
 * inline in their views. They were *equivalent* — both read `status`, both used
 * the shared `allUnitsComplete` helper — but they were not the SAME CODE, and
 * the drift that produces was already visible: rack read `corrections_open` and
 * offered "Correct a score" / "Re-lock result"; **stroke never read the column at
 * all**, so a finalized stroke game had no path back (#769). Two copies of one
 * rule, one of which had silently lost a third of it.
 *
 * The rule is small enough that a shared *component* alone wouldn't have caught
 * it — the divergence was in the predicate, not the markup. So the predicate is
 * its own pure function, with its own tests, and both views call it. There is
 * now no way for one format to answer "can this be finalized?" differently from
 * the other without changing this file.
 *
 * Pure and client-safe (no tRPC, no DB) so it can also be unit-tested directly —
 * the same split CLAUDE.md #8 prescribes for scoring computation.
 *
 * ── The state machine ────────────────────────────────────────────────────────
 *   pending/active ──finalize──▶ complete + corrections_open=false   (LOCKED)
 *   LOCKED ──openCorrection──▶ complete + corrections_open=true      (CORRECTING)
 *   CORRECTING ──finalize (re-lock)──▶ LOCKED
 *
 * `games.finish` serves both the first finalize and the re-lock — it clears
 * `corrections_open` either way, which is what makes re-locking the same call.
 */

export type GameLifecycleInput = {
  /** Role gate — owner/organizer/delegate. From `useGameEditAccess().canEdit`. */
  canEdit: boolean;
  /** `games.status`. Anything other than "complete" is pre-finalize. */
  status: string | null | undefined;
  /** `games.corrections_open`. Only meaningful once status is "complete". */
  correctionsOpen: boolean;
  /**
   * Every scoring unit of every live competitor is filled in — computed by the
   * caller with `allUnitsComplete`, over whatever "competitor" means for that
   * format (rack: both sides of every slot; stroke: every player in the field).
   * That part legitimately differs per format; what must NOT differ is how the
   * answer is then USED, which is this module's job.
   */
  allComplete: boolean;
};

export type GameLifecycleState = {
  /** status === "complete" — finalized, in either the locked or correcting sense. */
  isFinal: boolean;
  /** Finalized and closed. The terminal resting state. */
  isLocked: boolean;
  /** Finalized but reopened for a correction — scores are editable again. */
  isCorrecting: boolean;
  /** Show the primary finalize CTA (first time — never shown once complete). */
  canFinalize: boolean;
  /** Show the "Correct a score" CTA. */
  canCorrect: boolean;
  /** Show the "Re-lock result" CTA. */
  canRelock: boolean;
};

/**
 * The LOCK STATE alone — what phase of its life the game is in, with no reference
 * to who is looking or whether the round is complete.
 *
 * Split out from `gameLifecycle` because the views need it EARLY (a group tap is
 * gated on it, long before the finalize CTA's completeness input exists) and
 * because it is the piece that kept going missing. `gameLifecycle` builds on it,
 * so there is still one definition.
 *
 * Six divergences between the golf formats were found in one sitting — the
 * finalize gate, `openCorrection`, closing the panel, the invalidation set,
 * clearing scores on reset, and read-only-when-locked — and five were the same
 * failure: **a behaviour that depends on lifecycle state, which each view had to
 * remember to implement.** Rack and match usually had them because they were
 * built alongside each other; stroke consistently did not. That is not six bugs,
 * it is one missing abstraction observed six times, and this is where it lives.
 */
export function gameLockState({
  status,
  correctionsOpen,
}: Pick<GameLifecycleInput, "status" | "correctionsOpen">): Pick<
  GameLifecycleState,
  "isFinal" | "isLocked" | "isCorrecting"
> {
  const isFinal = status === "complete";
  return {
    isFinal,
    /** Posted and closed — scores are frozen. `scores.upsertEntry` refuses. */
    isLocked: isFinal && !correctionsOpen,
    /** Posted but reopened — scores are editable again until re-locked. */
    isCorrecting: isFinal && correctionsOpen,
  };
}

export function gameLifecycle({
  canEdit,
  status,
  correctionsOpen,
  allComplete,
}: GameLifecycleInput): GameLifecycleState {
  const { isFinal, isLocked, isCorrecting } = gameLockState({ status, correctionsOpen });

  return {
    isFinal,
    isLocked,
    isCorrecting,
    // Gated on completeness as well as role: a partially-scored game must not be
    // finalizable, because `finish` computes from the server rows it can see and
    // would quietly record a half-round as the result.
    canFinalize: canEdit && !isFinal && allComplete,
    // NOT gated on `allComplete`: the whole point of a correction is that the
    // recorded result is wrong, and a locked game is complete by construction.
    canCorrect: canEdit && isLocked,
    canRelock: canEdit && isCorrecting,
  };
}
