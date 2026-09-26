import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { throwIfUnrostered } from "./unrosteredRefusal";

/**
 * Migration 193's refusal reaches the reader as its sentence and a 412, not as
 * a 500 carrying a code. Everything else is left to the writer's own branch —
 * a helper that swallowed or rewrote other errors would hide real faults.
 */

const SENTENCE = "Frank isn't on either team in this cup. Add them to a team in Rosters first.";

describe("throwIfUnrostered", () => {
  it("throws the sentence as PRECONDITION_FAILED, code stripped", () => {
    let thrown: unknown;
    try {
      throwIfUnrostered({ message: `UNROSTERED: ${SENTENCE}` });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect(thrown).toMatchObject({ code: "PRECONDITION_FAILED", message: SENTENCE });
  });

  it.each([
    ["another coded refusal", { message: "HAS_SCORES: this game already has scores." }],
    ["a plain database error", { message: 'duplicate key value violates unique constraint "x"' }],
    ["the code mid-message, which is not the trigger's shape", { message: `Failed: UNROSTERED: ${SENTENCE}` }],
    ["no error", null],
  ])("leaves %s alone", (_label, error) => {
    expect(() => throwIfUnrostered(error)).not.toThrow();
  });
});
