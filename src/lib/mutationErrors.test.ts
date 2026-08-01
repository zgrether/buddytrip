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
