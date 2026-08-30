import { describe, it, expect } from "vitest";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { isSchemaValidationError, VALIDATION_MESSAGE } from "./trpc";
import { mutationErrorMessage, GENERIC_MUTATION_ERROR } from "@/lib/mutationErrors";

/**
 * A validation payload must never reach a person.
 *
 * ── What went wrong ────────────────────────────────────────────────────────
 *
 * tRPC builds an input-validation failure into a `TRPCError` whose `message` is
 * `JSON.stringify(zodError.issues)`. Nothing replaced it, so the ISSUE ARRAY was
 * the message every surface received — and ~20 of them set an inline error from
 * `e.message` directly. Saving a pick'em sheet with nothing picked put this on
 * screen, above the app's own "Your sheet is still here":
 *
 *     [ { "origin": "array", "code": "too_small", "minimum": 1,
 *         "inclusive": true, "path": [ "picks" ], "message": "Too small: …" } ]
 *
 * That was one call site noticing a gap every mutation in the app has.
 *
 * ── The two layers, and what each is worth ─────────────────────────────────
 *
 * `errorFormatter` (server) replaces the message before it leaves. It is the
 * real fix, because it covers every router and every surface at once.
 *
 * `mutationErrorMessage` (client) refuses to render a JSON-shaped message. It is
 * the backstop, and it earns its place because it also sees errors that never
 * came through tRPC — by then the `cause` the formatter keys on is gone.
 *
 * ── What this file can and cannot prove, stated rather than implied ────────
 *
 * `createCaller` does NOT run `errorFormatter` — measured below, not assumed —
 * so the HTTP-boundary wiring itself is out of reach of a node suite. What is
 * pinned here is everything that decision rests on: the code and cause tRPC
 * actually produces, the predicate over them, and the client backstop. If tRPC
 * changed either fact, this fails rather than the payload quietly returning.
 */

const t = initTRPC.create();
const router = t.router({
  save: t.procedure
    .input(z.object({ picks: z.array(z.string()).min(1) }))
    .mutation(() => "ok"),
});
const caller = t.createCallerFactory(router)({});

async function rejection(): Promise<TRPCError> {
  try {
    await caller.save({ picks: [] });
  } catch (e) {
    return e as TRPCError;
  }
  throw new Error("the schema accepted an input it should have refused");
}

describe("what tRPC actually produces for a schema rejection", () => {
  it("is a BAD_REQUEST carrying the ZodError as its cause", async () => {
    // The two facts `isSchemaValidationError` keys on, measured against a real
    // procedure rather than restated from the docs.
    const err = await rejection();
    expect(err.code).toBe("BAD_REQUEST");
    expect((err.cause as { name?: string } | undefined)?.name).toBe("ZodError");
  });

  it("has the ISSUE ARRAY as its message — the thing that reached the screen", async () => {
    const err = await rejection();
    expect(err.message.trimStart().startsWith("[")).toBe(true);
    expect(err.message).toContain("too_small");
    expect(JSON.parse(err.message)).toBeInstanceOf(Array);
  });

  it("is NOT formatted by a direct caller — errorFormatter is the HTTP boundary", async () => {
    /**
     * Measured, and it is why the client backstop exists rather than being
     * belt-and-braces. A test that asserted the friendly message here would be
     * asserting something no code path provides, and would have to be deleted
     * the first time somebody checked.
     */
    const err = await rejection();
    expect(err.message).not.toBe(VALIDATION_MESSAGE);
  });
});

describe("isSchemaValidationError", () => {
  it("recognises the real thing", async () => {
    expect(isSchemaValidationError(await rejection())).toBe(true);
  });

  it("leaves a procedure's OWN rejection alone", () => {
    /**
     * The case that decides whether this is safe at all. Server messages are
     * written for people — "Close picking before finalizing", "Use Correct
     * scores to change a result" — and replacing those with a generic sentence
     * would be a much worse bug than the one being fixed.
     */
    const real = new TRPCError({
      code: "CONFLICT",
      message: "This game is finalized. Use Correct scores to change a result.",
    });
    expect(isSchemaValidationError(real)).toBe(false);
  });

  it("leaves a BAD_REQUEST that is not a schema failure alone", () => {
    // Procedures throw BAD_REQUEST deliberately, with real sentences. The code
    // alone must not be the trigger.
    const manual = new TRPCError({
      code: "BAD_REQUEST",
      message: "A manual game posts a finishing order.",
    });
    expect(isSchemaValidationError(manual)).toBe(false);
  });

  it("is not fooled by a cause that merely exists", () => {
    const wrapped = new TRPCError({
      code: "BAD_REQUEST",
      message: "Something else",
      cause: new Error("boom"),
    });
    expect(isSchemaValidationError(wrapped)).toBe(false);
  });
});

describe("the client backstop, on the real payload", () => {
  it("refuses to render what a direct caller hands back", async () => {
    /**
     * End to end for the layer that IS reachable here: the exact message tRPC
     * produced, through the exact function every surface's toast calls.
     */
    const err = await rejection();
    expect(mutationErrorMessage(err)).toBe(GENERIC_MUTATION_ERROR);
    expect(mutationErrorMessage(err)).not.toContain("too_small");
  });
});
