import { describe, it, expect } from "vitest";
import {
  isTerminalRefusal,
  refusalMessage,
  retryUnlessRefused,
  TERMINAL_REFUSAL_CODES,
} from "./terminalRefusal";

/**
 * Which score-write failures are worth retrying (#1230).
 *
 * The bug was that NOTHING was terminal: a 403 got the same exponential backoff
 * as a network blip, then sat in the durable outbox and was re-sent on every
 * mount forever, under a banner offering a "Retry" that could not work.
 *
 * The asymmetry to hold on to while reading these cases: calling something
 * terminal when it is not COSTS A SCORE — the outbox entry is dropped and the
 * value stops being re-sent. Calling something transient when it is not costs a
 * few seconds of backoff. So the default for anything unrecognised is
 * retryable, and the cases below check that direction hardest.
 */

/** The shape a tRPC client error actually arrives in (`data.code` + message). */
const trpcError = (code: string, message = "nope") => ({
  data: { code, httpStatus: 400 },
  message,
});

describe("isTerminalRefusal", () => {
  it("is TRUE for the three codes a retry cannot change", () => {
    // Asserted per-code rather than by iterating the exported set: iterating it
    // would pass against a set someone had emptied or widened.
    expect(isTerminalRefusal(trpcError("FORBIDDEN"))).toBe(true);
    expect(isTerminalRefusal(trpcError("NOT_FOUND"))).toBe(true);
    expect(isTerminalRefusal(trpcError("BAD_REQUEST"))).toBe(true);
  });

  it("is FALSE for the recoverable ones, which is the expensive direction", () => {
    // UNAUTHORIZED — `authExpiry` (#689) can refresh or re-auth, and the write
    // should still be in the outbox when it does.
    expect(isTerminalRefusal(trpcError("UNAUTHORIZED"))).toBe(false);
    // TIMEOUT — `createTRPCContext` returns exactly this for a stalled auth call
    // so the client retries THROUGH it (#1140). Treating it as terminal would
    // discard a score every time the auth server hiccuped.
    expect(isTerminalRefusal(trpcError("TIMEOUT"))).toBe(false);
    expect(isTerminalRefusal(trpcError("CONFLICT"))).toBe(false);
    expect(isTerminalRefusal(trpcError("TOO_MANY_REQUESTS"))).toBe(false);
    expect(isTerminalRefusal(trpcError("INTERNAL_SERVER_ERROR"))).toBe(false);
  });

  it("is FALSE for anything that is not a recognisable tRPC error", () => {
    // A fetch that never landed has no `data` at all — the commonest failure on
    // a golf course, and the one that MUST keep retrying.
    expect(isTerminalRefusal(new TypeError("Failed to fetch"))).toBe(false);
    expect(isTerminalRefusal(null)).toBe(false);
    expect(isTerminalRefusal(undefined)).toBe(false);
    expect(isTerminalRefusal("FORBIDDEN")).toBe(false); // a bare string is not a code
    expect(isTerminalRefusal({ data: null })).toBe(false);
    expect(isTerminalRefusal({ data: { code: 403 } })).toBe(false); // number, not string
  });

  it("does not treat an unknown FUTURE code as terminal", () => {
    // The set is a closed allowlist, not a denylist. A code tRPC adds later must
    // default to retryable rather than silently start dropping scores.
    expect(isTerminalRefusal(trpcError("PAYLOAD_TOO_LARGE"))).toBe(false);
    expect(TERMINAL_REFUSAL_CODES.has("PAYLOAD_TOO_LARGE")).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("returns the server's own sentence for a terminal refusal", () => {
    // The whole point: these are written for a human and already name an action.
    expect(
      refusalMessage(
        trpcError("FORBIDDEN", "This round is posted — tap 'Correct a score' on the scoreboard to reopen it.")
      )
    ).toBe("This round is posted — tap 'Correct a score' on the scoreboard to reopen it.");
  });

  it("returns NULL for a transient failure, so the generic Retry stands", () => {
    // A raw transport message ("Failed to fetch") is worse than none, and the
    // retry advice is correct there.
    expect(refusalMessage(trpcError("TIMEOUT", "Could not confirm your session just now."))).toBeNull();
    expect(refusalMessage(new TypeError("Failed to fetch"))).toBeNull();
  });

  it("returns NULL rather than an empty or non-string message", () => {
    // An empty string would render as a blank line under the banner heading —
    // an explanation that explains nothing, which is the defect being fixed.
    expect(refusalMessage(trpcError("FORBIDDEN", "   "))).toBeNull();
    expect(refusalMessage({ data: { code: "FORBIDDEN" }, message: 42 })).toBeNull();
    expect(refusalMessage({ data: { code: "FORBIDDEN" } })).toBeNull();
  });

  it("trims, so layout whitespace never reaches the banner", () => {
    expect(refusalMessage(trpcError("FORBIDDEN", "  Not your match.  "))).toBe("Not your match.");
  });
});

describe("retryUnlessRefused — the predicate both savers use", () => {
  const retry = retryUnlessRefused(4);

  it("STOPS IMMEDIATELY on a refusal — attempt 0, not after the backoff", () => {
    // The user-visible half: ~15s of exponential backoff spent on an answer the
    // server already gave, watched by someone standing on a tee.
    expect(retry(0, trpcError("FORBIDDEN"))).toBe(false);
  });

  it("retries a transient failure up to the budget, then stops", () => {
    const net = new TypeError("Failed to fetch");
    expect(retry(0, net)).toBe(true);
    expect(retry(3, net)).toBe(true);
    // Budget exhausted — the pre-existing behaviour, unchanged.
    expect(retry(4, net)).toBe(false);
    expect(retry(9, net)).toBe(false);
  });

  it("is the SAME predicate for both savers — one budget in, one rule out", () => {
    // CLAUDE.md #24: `useScoreSaver` and `useOutcomeSaver` are the pair this
    // codebase has already watched drift, so the rule is imported, not copied.
    // A different budget must not change WHICH errors are terminal.
    const strict = retryUnlessRefused(0);
    expect(strict(0, trpcError("FORBIDDEN"))).toBe(false);
    expect(strict(0, new TypeError("Failed to fetch"))).toBe(false); // budget, not terminality
    const generous = retryUnlessRefused(99);
    expect(generous(50, new TypeError("Failed to fetch"))).toBe(true);
    expect(generous(0, trpcError("NOT_FOUND"))).toBe(false);
  });
});
