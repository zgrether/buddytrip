import { TRPCError } from "@trpc/server";

/**
 * Pick'em's tagged RPC exceptions, as a TABLE rather than a chain of ifs.
 *
 * ── Why this stopped being a chain of `message.includes(...)` ──────────────
 *
 * Twice a migration renamed a code and the router went QUIET rather than loud:
 *
 *   - 166 replaced the completeness gate with `DUPLICATE_PICK`, which had no
 *     arm at all — so the new refusal fell through to "Pick'em save failed:
 *     <raw postgres text>".
 *   - 167 replaced `GAME_FINAL` with `GAME_LOCKED`, leaving an arm that pointed
 *     at Reset — the sledgehammer — and could never fire again.
 *
 * Neither failed to compile and neither failed a test. A string match that
 * stops matching produces no signal at all, which is the worst property an
 * error path can have: the arm is still there, still readable, still wrong.
 *
 * ── Two mechanisms, because one is not enough ─────────────────────────────
 *
 * **The union + `Record` makes it exhaustive by TYPE.** Adding a member to
 * `PickemErrorCode` without adding a row here fails to compile. That catches
 * the direction where somebody edits this file.
 *
 * **`pickemErrors.coverage.test.ts` makes it exhaustive against REALITY.** It
 * reads every `RAISE EXCEPTION '<CODE>:` out of the live pick'em functions and
 * asserts both directions — every code the database raises has a row, and every
 * row names a code the database still raises. That is what catches a MIGRATION
 * changing a code, which is where both incidents actually came from and which
 * no amount of TypeScript can see.
 *
 * It is the same instrument `configHash.coverage.test.ts` uses for the hash:
 * derive the expected set from the source of truth rather than from a list
 * somebody has to remember to update.
 */

export type PickemErrorCode =
  | "BAD_ACTION"
  | "BAD_CONFIDENCE"
  | "BAD_MULTIPLIER"
  | "BAD_RESULT"
  | "BAD_TOTAL"
  | "DUPLICATE_PICK"
  | "DUPLICATE_PLAYER"
  | "EMPTY_SLATE"
  | "GAME_LOCKED"
  | "GAME_NOT_FOUND"
  | "MATCH_DECIDED"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "NOT_A_MEMBER"
  | "PICKEM_SCORED"
  | "PICKS_CLOSED"
  | "RESULTS_RECORDED"
  | "SLATE_RANKED"
  | "SLATE_CONTEST_SCORED"
  | "SLATE_GAME_NOT_FOUND"
  | "SLATE_LOCKED"
  | "UNKNOWN_SLATE_GAME";

type Arm = {
  code: TRPCError["code"];
  /** Static message, or one built from the exception's tail. */
  message: string | ((detail: string | null) => string);
};

/**
 * Every code the pick'em RPCs raise, and what a person should read.
 *
 * Each message names the thing to DO, not just what went wrong — a generic
 * "couldn't be saved" is a FALLTHROUGH, and the specific arms are what keep the
 * raw Postgres text out of the UI while still saying something true.
 */
export const PICKEM_ERRORS: Record<PickemErrorCode, Arm> = {
  SLATE_LOCKED: {
    code: "CONFLICT",
    message:
      "Picks are open, so the slate and its scoring settings are frozen. Close picking first — nothing is lost unless the slate itself changes.",
  },
  SLATE_RANKED: {
    code: "CONFLICT",
    // Migration 175. Removing a contest would null every ranking, and picks are
    // closed by the time this can fire, so nobody could put them back.
    //
    // Names the exit IN ORDER, because the order is forced: 165 refuses `unlock`
    // while any result stands, so the results have to go first. "Reset scores"
    // is deliberately NOT named — clearing the results one by one is ungated
    // below a finalize (167) and does strictly less.
    message:
      "Game slate is locked, clear the results and reopen picking to unlock it.",
  },
  SLATE_CONTEST_SCORED: {
    code: "CONFLICT",
    // Migration 175's other arm, reachable with confidence OFF where there is no
    // ranking to protect. The remedy is that ONE contest's result, not the
    // game's — a narrower action than SLATE_RANKED's, which is why it is a
    // separate code rather than a shared vaguer string.
    message: "That contest has a result. Clear it before removing the contest.",
  },
  EMPTY_SLATE: {
    code: "BAD_REQUEST",
    message: "Add at least one game to the slate before opening picks.",
  },
  PICKS_CLOSED: {
    code: "CONFLICT",
    // Names the two ways it can be true, because the participant cannot tell
    // them apart and the difference decides whether waiting helps.
    message: "Picks are closed — the deadline passed or the runner closed them.",
  },
  GAME_LOCKED: {
    code: "CONFLICT",
    // Correct scores, NOT Reset. Reset clears every result in the game: an
    // instruction that works and costs everything, for somebody fixing a typo.
    message: "This game is finalized. Use Correct scores to change a result.",
  },
  RESULTS_RECORDED: {
    code: "CONFLICT",
    // Migration 165 refuses reopening picks once anything is scored. Reset IS
    // the exit here — unlike GAME_LOCKED, there is no lighter way back, because
    // re-picking a contest you have watched is not predicting.
    message:
      "Results are already in, so picks can't reopen. Clear them with Reset scores first.",
  },
  PICKEM_SCORED: {
    code: "CONFLICT",
    // Migration 157's freeze. Also genuinely terminal: changing how scoring
    // works after a result would rescore what is already recorded.
    message:
      "Results are in, so how this game scores is frozen. Reset its scores to change it.",
  },
  SLATE_GAME_NOT_FOUND: {
    code: "CONFLICT",
    message: "That game is no longer on the slate. Reload and try again.",
  },
  UNKNOWN_SLATE_GAME: {
    code: "CONFLICT",
    message: "The slate changed while you were picking. Reload and check your sheet before saving.",
  },
  DUPLICATE_PICK: {
    code: "CONFLICT",
    // Not something a person can do from a sheet holding one row per contest,
    // so this is a client bug or a stale payload. The message says the only
    // thing that helps rather than blaming the reader for a choice they did not
    // make.
    message: "That sheet had a game on it twice. Reload and save again.",
  },
  BAD_CONFIDENCE: {
    code: "BAD_REQUEST",
    // Covers three server messages (out of range, a shared rank, and a complete
    // sheet missing one) — all three are the same instruction.
    message: "Each pick needs its own rank, with no repeats.",
  },
  MATCH_DECIDED: {
    code: "CONFLICT",
    message: "A match already has a result. Clear it before changing the pairings.",
  },
  DUPLICATE_PLAYER: {
    code: "BAD_REQUEST",
    message: "Someone is in more than one match — a person plays once.",
  },
  BAD_TOTAL: { code: "BAD_REQUEST", message: "Points can't be negative." },
  BAD_MULTIPLIER: {
    code: "BAD_REQUEST",
    message: "A multiplier has to be greater than zero.",
  },
  BAD_RESULT: {
    code: "BAD_REQUEST",
    // The surface offers four buttons, so a fifth value is a client bug.
    message: "That isn't a result this game can record. Reload and try again.",
  },
  BAD_ACTION: {
    code: "BAD_REQUEST",
    message: "That isn't something this game can do. Reload and try again.",
  },
  NOT_AUTHORIZED: { code: "FORBIDDEN", message: "You can't edit this game." },
  NOT_A_MEMBER: {
    code: "CONFLICT",
    // Proxy entry for somebody who is not on the trip. Names the fix rather
    // than the rule: they have to be added before a sheet can exist for them.
    message: "That person isn't on this trip yet — add them to the crew first.",
  },
  NOT_AUTHENTICATED: {
    // UNAUTHORIZED deliberately: these run behind `authedProcedure`, so this
    // means the session died between the middleware and the RPC, and
    // `authExpiry` treating a 401 as a dead session is the correct outcome
    // rather than a hazard.
    code: "UNAUTHORIZED",
    message: "Your session expired. Sign in again to keep picking.",
  },
  GAME_NOT_FOUND: { code: "NOT_FOUND", message: "Game not found." },
};

/**
 * §6.1's rule, and the one arm that reads the exception's TAIL.
 *
 * A few RPCs put an actionable detail after the colon — a name, usually. The
 * codes listed here carry it through verbatim rather than replacing it with a
 * generic line, because "someone has no opponent" sends a person hunting
 * through a grid while "Bill has no opponent" does not.
 */
const CARRIES_DETAIL: ReadonlySet<PickemErrorCode> = new Set<PickemErrorCode>(["NOT_A_MEMBER"]);

/** The codes, for the coverage guard. Derived from the table so it cannot drift. */
export const PICKEM_ERROR_CODES = Object.keys(PICKEM_ERRORS) as PickemErrorCode[];

export function pickemError(message: string): TRPCError {
  for (const code of PICKEM_ERROR_CODES) {
    if (!message.includes(code)) continue;
    const arm = PICKEM_ERRORS[code];
    const detail = CARRIES_DETAIL.has(code)
      ? (message.split(`${code}:`)[1]?.trim() ?? null)
      : null;
    return new TRPCError({
      code: arm.code,
      message: typeof arm.message === "function" ? arm.message(detail) : arm.message,
    });
  }
  /**
   * The fallthrough still exists and still leaks the Postgres text, on purpose:
   * an unmapped code is a bug, and a silent generic message is how it stays one.
   * The coverage guard is what makes reaching this unlikely; this is what makes
   * it findable when it happens anyway.
   */
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Pick'em save failed: ${message}`,
  });
}
