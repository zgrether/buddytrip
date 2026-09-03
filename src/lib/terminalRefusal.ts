/**
 * Is a failed score write ever going to succeed if we try again? (#1230)
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * `useScoreSaver` / `useOutcomeSaver` could not tell a TERMINAL refusal from a
 * TRANSIENT one. A 403 — "This round is posted", "You can only enter scores for
 * your own match" — was retried with the same exponential backoff as a network
 * blip, then kept on screen, kept in the localStorage outbox, and **re-sent on
 * every subsequent mount, forever**. Nothing ever cleared it, because nothing
 * ever would: the server's answer is not going to change on its own.
 *
 * It was not silent — the cell flagged, the banner said "N scores didn't save"
 * with a Retry button, and a remount fired a toast. That is #15 working as
 * designed. What was wrong is that **the remedy the banner named could not
 * work**, which is CLAUDE.md's "A REFUSAL MUST NAME AN ACTION THE READER CAN
 * TAKE" in its most literal form: the message was right about the fact and
 * wrong about the fix, and the reader had no way to tell which kind of failure
 * they had.
 *
 * ── Why these three codes and not others ────────────────────────────────────
 *
 * The test is not "did it fail" but "would the same request, unchanged, be
 * refused again". Retrying costs a little; NOT retrying something recoverable
 * costs a score, so anything ambiguous stays retryable.
 *
 *  - `FORBIDDEN` — a rights or lifecycle decision (posted round, not your
 *    match, scoring disabled). The server has already looked and said no.
 *  - `NOT_FOUND` — the game, participant or unit does not exist. Re-sending the
 *    same ids cannot conjure them.
 *  - `BAD_REQUEST` — the payload itself is rejected (zod, a range check). Byte
 *    for byte the same payload, so byte for byte the same answer.
 *
 * Deliberately NOT terminal:
 *
 *  - `UNAUTHORIZED` — the session can come back. `authExpiry` (#689) refreshes
 *    or re-auths, and the write should still be in the outbox when it does.
 *  - `TIMEOUT` — explicitly the retryable one. `createTRPCContext` returns it
 *    for a stalled auth call precisely so the client retries through it (#1140).
 *  - `CONFLICT`, `TOO_MANY_REQUESTS`, every 5xx, and anything with no code at
 *    all (a fetch that never landed) — all transient by nature or by doubt.
 *
 * ── What the caller must still do ───────────────────────────────────────────
 *
 * Terminal means STOP RETRYING, not "pretend it saved". The value stays on
 * screen, the cell stays flagged, and the gates that block Advance and Finish
 * keep blocking — a refused write is not on the server, and `games.finish`
 * computes standings from `score_entries`, so letting it through would trade a
 * visible failure for a silently wrong result. The only things that change are
 * that the retry loop stops and the outbox entry is dropped, so the value stops
 * being re-sent on every mount of a game that will never accept it.
 */

/** tRPC error codes for which an identical retry is certain to be refused. */
export const TERMINAL_REFUSAL_CODES = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
]);

type TRPCishError = {
  data?: { code?: string } | null;
  message?: unknown;
} | null;

/** The tRPC error code, if this looks like a tRPC client error at all. */
function codeOf(error: unknown): string | undefined {
  const code = (error as TRPCishError)?.data?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Will an identical retry be refused again?
 *
 * Returns false for anything unrecognised — a raw network failure has no `data`
 * at all, and the safe default for "I cannot tell" is to keep retrying.
 */
export function isTerminalRefusal(error: unknown): boolean {
  const code = codeOf(error);
  return code !== undefined && TERMINAL_REFUSAL_CODES.has(code);
}

/**
 * The server's OWN sentence for a terminal refusal, for showing to the person
 * who tapped.
 *
 * These messages are already written for a human and already name an action —
 * "tap 'Correct a score' on the scoreboard to reopen it" — and both hooks were
 * throwing them away with `.catch(() => mark(key, "error"))`, which discarded
 * the error object entirely. That discard is the whole reason the banner had
 * nothing better to say than "Retry".
 *
 * Null for a non-terminal error: a transient failure keeps the existing generic
 * treatment, because the retry advice is correct there and a raw transport
 * message ("Failed to fetch") is worse than none.
 */
export function refusalMessage(error: unknown): string | null {
  if (!isTerminalRefusal(error)) return null;
  const message = (error as TRPCishError)?.message;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The react-query `retry` predicate for a score write: retry a blip, never
 * retry a decision.
 *
 * Lives HERE rather than in each hook because `useScoreSaver` and
 * `useOutcomeSaver` need identical behaviour and are the pair this codebase has
 * already watched drift (CLAUDE.md #24). Two copies of a rule about when to stop
 * retrying is two chances for one of them to keep going.
 *
 * Ordering matters: the terminal check comes FIRST, so a refusal stops on
 * attempt 0 rather than after ~15s of backoff the user sits and watches.
 *
 * `maxRetries` is a parameter rather than a constant so each hook keeps stating
 * its own budget at its own call site, where the backoff schedule lives.
 */
export function retryUnlessRefused(maxRetries: number) {
  return (failureCount: number, error: unknown): boolean =>
    !isTerminalRefusal(error) && failureCount < maxRetries;
}
