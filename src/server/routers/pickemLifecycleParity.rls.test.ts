import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { picksOpen, picksRevealed, type PickemClock } from "../../lib/pickemLifecycle";

/**
 * The two-sided contract: `src/lib/pickemLifecycle.ts` and the SQL bodies of
 * `pickem_picks_open` / `pickem_picks_revealed` must answer identically.
 *
 * ── Why this test is the whole point ────────────────────────────────────────
 * SQL cannot import TypeScript, so there are necessarily two implementations of
 * "are picks open". The policies enforce one; the UI renders the other. **They
 * agree today by construction, and nothing but this file stops them agreeing
 * only by coincidence tomorrow.**
 *
 * The drift is silent and does not look like what it is. A runner opens picks;
 * the member-facing page does not change, or changes while the policy still
 * refuses the write. That reads as a caching bug — the tempting fix is an
 * invalidation somewhere — and nobody goes and reads a policy. Same shape as
 * CLAUDE.md #20's topic string, where a mismatch between the SQL trigger and
 * `scoreEventsTopic()` fails silently and scores simply stop arriving.
 *
 * So: one table of clock states, driven through BOTH sides for real. Not a
 * transcription of the SQL into TypeScript assertions — that would only prove
 * the transcription matches itself.
 *
 * **Change either side and this fails.** That is the intended cost.
 *
 * ── Called as a MEMBER, deliberately ────────────────────────────────────────
 * Migration 147 made both predicates require trip membership, so a non-member
 * gets `false` for everything and every case here would agree vacuously with a
 * TypeScript function that had been broken in any direction. The membership
 * behaviour has its own coverage in `pickemPicksPolicy.rls.test.ts`; this file
 * is about the CLOCK, so it always asks from inside the trip.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;

const HOUR = 3_600_000;

/**
 * Every clock state that means something, including both sides of the deadline
 * boundary and the states where the two predicates are NOT inverses.
 *
 * Offsets are relative to the moment each case runs; the SQL reads its own
 * `now()` and the TypeScript reads `Date.now()`, so the two clocks differ by
 * the round-trip. Offsets are kept at ±1 hour so that difference cannot flip an
 * answer — the one case that genuinely turns on sub-second timing (exactly AT
 * the deadline) is unassertable across a network boundary and is covered
 * against a frozen clock in `pickemLifecycle.test.ts` instead.
 */
const CASES: {
  name: string;
  openedAt: number | null;
  deadline: number | null;
  lockedAt: number | null;
}[] = [
  { name: "building — nothing set", openedAt: null, deadline: null, lockedAt: null },
  { name: "building with a FUTURE deadline", openedAt: null, deadline: +HOUR, lockedAt: null },
  { name: "building with a PASSED deadline", openedAt: null, deadline: -HOUR, lockedAt: null },
  { name: "open, no deadline", openedAt: -HOUR, deadline: null, lockedAt: null },
  { name: "open, future deadline", openedAt: -HOUR, deadline: +HOUR, lockedAt: null },
  { name: "past the deadline (the lazy lock)", openedAt: -2 * HOUR, deadline: -HOUR, lockedAt: null },
  { name: "hand-locked, no deadline", openedAt: -2 * HOUR, deadline: null, lockedAt: -HOUR },
  { name: "hand-locked with a future deadline", openedAt: -2 * HOUR, deadline: +HOUR, lockedAt: -HOUR },
  { name: "hand-locked AND past the deadline", openedAt: -3 * HOUR, deadline: -HOUR, lockedAt: -2 * HOUR },
  // Pathological but reachable by hand: locked before it opened. Both sides
  // must agree on SOMETHING rather than one throwing and the other guessing.
  { name: "locked_at BEFORE opened_at", openedAt: -HOUR, deadline: null, lockedAt: -2 * HOUR },
];

describe("pick'em clock — TypeScript and SQL answer identically", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Parity Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    gameId = genId("paritygame");
    await ctx.admin.from("games").insert({ id: gameId, trip_id: tripId, name: "Parity" });
    await ctx.admin.from("pickem_games").insert({ game_id: gameId });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  /** Write a clock state and PROVE it landed — a silently-failed update would
   *  make every case below compare two answers about the previous state, which
   *  would still "agree". */
  const applyClock = async (c: (typeof CASES)[number]): Promise<PickemClock> => {
    const now = Date.now();
    const next = {
      picks_opened_at: c.openedAt == null ? null : new Date(now + c.openedAt).toISOString(),
      picks_deadline: c.deadline == null ? null : new Date(now + c.deadline).toISOString(),
      picks_locked_at: c.lockedAt == null ? null : new Date(now + c.lockedAt).toISOString(),
    };
    const { error } = await ctx.admin.from("pickem_games").update(next).eq("game_id", gameId);
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("pickem_games")
      .select("picks_opened_at, picks_deadline, picks_locked_at")
      .eq("game_id", gameId)
      .maybeSingle();
    expect(data).not.toBeNull();

    // The clock handed to the TypeScript side is the one the DATABASE now holds,
    // read back — not the object just constructed. Comparing SQL against the
    // value we hoped we wrote would hide a write that landed differently
    // (a truncated precision, a timezone slip) by feeding both sides a lie.
    return {
      picksOpenedAt: data!.picks_opened_at as string | null,
      picksDeadline: data!.picks_deadline as string | null,
      picksLockedAt: data!.picks_locked_at as string | null,
    };
  };

  for (const c of CASES) {
    it(`agrees on: ${c.name}`, async () => {
      const stored = await applyClock(c);

      const sqlOpen = await ctx.authedClient("member").rpc("pickem_picks_open", { p_game_id: gameId });
      const sqlRevealed = await ctx
        .authedClient("member").rpc("pickem_picks_revealed", { p_game_id: gameId });
      expect(sqlOpen.error).toBeNull();
      expect(sqlRevealed.error).toBeNull();

      expect(
        { open: picksOpen(stored), revealed: picksRevealed(stored) },
        `TypeScript and SQL disagree for "${c.name}" — clock ${JSON.stringify(stored)}`
      ).toEqual({ open: sqlOpen.data, revealed: sqlRevealed.data });
    });
  }

  it("the case table actually covers all four open/revealed combinations", () => {
    // A premise assertion. Ten cases that all happened to be `building` would
    // agree perfectly and prove nothing — the same vacuity trap as a
    // "must not contain" check over an empty document.
    const seen = new Set(
      CASES.map((c) => {
        const now = Date.now();
        const clock: PickemClock = {
          picksOpenedAt: c.openedAt == null ? null : new Date(now + c.openedAt).toISOString(),
          picksDeadline: c.deadline == null ? null : new Date(now + c.deadline).toISOString(),
          picksLockedAt: c.lockedAt == null ? null : new Date(now + c.lockedAt).toISOString(),
        };
        return `${picksOpen(clock, now)}/${picksRevealed(clock, now)}`;
      })
    );
    // false/false = building · true/false = open · false/true = locked.
    // true/true is unreachable by construction and its ABSENCE is the assertion:
    // no clock state may leave a sheet both editable and publicly readable.
    expect(seen).toEqual(new Set(["false/false", "true/false", "false/true"]));
  });
});
