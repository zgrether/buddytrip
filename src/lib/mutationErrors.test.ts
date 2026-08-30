import { describe, it, expect } from "vitest";
import {
  isConnectivityError,
  mutationErrorMessage,
  GENERIC_MUTATION_ERROR,
} from "./mutationErrors";

/**
 * The regression: a server-rejected mutation was surfaced NOWHERE. The global
 * handler toasted only connectivity failures and said server rejections were
 * "handled at their call sites"; the call sites were empty `catch {}` blocks
 * saying the global toast handled it. A failed finalize looked exactly like a
 * success that didn't navigate.
 *
 * The predicate below is the one that decided that, so it gets tests.
 */

/** A tRPC rejection that reached the server carries `data.httpStatus`. */
function serverError(message: string, httpStatus = 500) {
  return Object.assign(new Error(message), { data: { httpStatus } });
}

describe("isConnectivityError", () => {
  it("is false for anything the server answered — the case that was silent", () => {
    // 500 is what `games.finish` throws when its results write fails (#784).
    expect(isConnectivityError(serverError("Failed to write results", 500))).toBe(false);
    expect(isConnectivityError(serverError("Game not found", 404))).toBe(false);
    expect(isConnectivityError(serverError("Not allowed", 403))).toBe(false);
    expect(isConnectivityError(serverError("Session expired", 401))).toBe(false);
  });

  it("is true when the request never got an answer", () => {
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectivityError(new Error("network error"))).toBe(true);
    // No status and no recognisable wording is STILL a transport failure — the
    // absence of a status is the signal, not the message text.
    expect(isConnectivityError(new Error("something odd"))).toBe(true);
    expect(isConnectivityError(undefined)).toBe(true);
    expect(isConnectivityError(null)).toBe(true);
  });

  it("treats a zero/absent status as no answer, not as a server response", () => {
    expect(isConnectivityError(Object.assign(new Error("x"), { data: { httpStatus: 0 } }))).toBe(true);
    expect(isConnectivityError(Object.assign(new Error("x"), { data: {} }))).toBe(true);
  });
});

describe("mutationErrorMessage", () => {
  it("prefers the server's own message — they are written for people", () => {
    expect(mutationErrorMessage(serverError("That idea isn't in your archive", 404))).toBe(
      "That idea isn't in your archive"
    );
  });

  it("falls back only when there is nothing readable", () => {
    expect(mutationErrorMessage(serverError("", 500))).toBe(GENERIC_MUTATION_ERROR);
    expect(mutationErrorMessage(serverError("   ", 500))).toBe(GENERIC_MUTATION_ERROR);
    expect(mutationErrorMessage(undefined)).toBe(GENERIC_MUTATION_ERROR);
    expect(mutationErrorMessage({})).toBe(GENERIC_MUTATION_ERROR);
  });

  it("suppresses stack traces and bare object stringification", () => {
    expect(mutationErrorMessage(new Error("boom\n    at foo (bar.js:1:1)"))).toBe(
      GENERIC_MUTATION_ERROR
    );
    expect(mutationErrorMessage("[object Object]")).toBe(GENERIC_MUTATION_ERROR);
  });

  it("does NOT filter merely technical-sounding messages", () => {
    // Deliberate: a raw message is recoverable, silence is not. Anything that
    // starts trimming "looks internal" text re-opens the gap by degrees.
    expect(mutationErrorMessage(serverError("Failed to save results: 23505", 500))).toBe(
      "Failed to save results: 23505"
    );
  });
});

/**
 * ── A SERIALIZED PAYLOAD IS NOT A MESSAGE ──────────────────────────────────
 *
 * tRPC makes an input-validation failure's `message` the zod issue array, so
 * without a filter the payload is what a surface renders. It reached a screen:
 * saving a pick'em sheet with nothing picked printed the issue list above the
 * app's own "Your sheet is still here".
 *
 * The primary fix is the server's `errorFormatter` (`server/trpc.ts`), which
 * replaces the message before it leaves. This is the client-side backstop, and
 * it earns its place because this function also sees errors that never came
 * through tRPC — by which point the `cause` the formatter keys on is gone.
 */
describe("mutationErrorMessage — payloads", () => {
  const ZOD_ISSUES = JSON.stringify(
    [
      {
        origin: "array",
        code: "too_small",
        minimum: 1,
        inclusive: true,
        path: ["picks"],
        message: "Too small: expected array to have >=1 items",
      },
    ],
    null,
    2
  );

  it("does not render a zod issue ARRAY", () => {
    expect(mutationErrorMessage(new Error(ZOD_ISSUES))).toBe(GENERIC_MUTATION_ERROR);
  });

  it("does not render a JSON OBJECT either — the rule is JSON, not zod", () => {
    // Keyed on JSON-ness so the next payload shape is covered without anyone
    // noticing it. Sniffing for "too_small" would fix one instance.
    expect(mutationErrorMessage(new Error('{"code":"23514","details":null}'))).toBe(
      GENERIC_MUTATION_ERROR
    );
  });

  it("KEEPS a real sentence that merely starts with a bracket", () => {
    /**
     * The case that stops this over-reaching. A message can legitimately open
     * with a bracket, and it is not JSON — so it parses as a failure and is
     * kept. Without this the filter would be "looks technical", which is the
     * judgement this module's header explicitly refuses to make.
     */
    const sentence = "[Rack] Still saving scores — try again in a moment.";
    expect(mutationErrorMessage(new Error(sentence))).toBe(sentence);
  });

  it("KEEPS every ordinary server sentence — the filter must not widen", () => {
    for (const msg of [
      "This game is finalized. Use Correct scores to change a result.",
      "Close picking before finalizing — sheets are still being entered.",
      "That idea isn't in your archive.",
    ]) {
      expect(mutationErrorMessage(new Error(msg))).toBe(msg);
    }
  });

  it("does not swallow a bare JSON scalar — those are not payloads", () => {
    // "null", "42" and a quoted string all parse, and none of them starts with
    // a bracket or a brace, so the shape check keeps them out of scope.
    expect(mutationErrorMessage(new Error("42"))).toBe("42");
    expect(mutationErrorMessage(new Error("null"))).toBe("null");
  });
});
