import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * matchOutcomes router. B3 widened the write permission to the SCOPED model
 * (matching `scores.ts` exactly): owner/organizer/delegate → any match; a
 * plain member → only the match they're playing in (`canWriteOutcome` →
 * `memberCanScoreUnit`); a non-participant member → nothing. Landed together
 * with migration 076's `can_score_match` RLS policy (see that migration's
 * comment for why the two layers can't ship separately).
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Outcome Router Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

/** owner (side A) vs member (side B) — outsider is a trip member but plays no
 *  part in this match, the genuine "not authorized" case. */
async function freshOutcomeMatch(name: string): Promise<{ gameId: string; matchId: string }> {
  const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name });
  const gameId = game.id as string;
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
  const matches = await ctx.caller().matches.setPairings({
    tripId, gameId,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
  });
  const matchId = (matches as { id: string }[])[0].id;
  await ctx.caller().games.enableScoring({ tripId, gameId });
  return { gameId, matchId };
}

describe("matchOutcomes.upsertOutcome — scoped permissions (B3)", () => {
  it("Owner records a hole outcome; it persists and round-trips via listByGame", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Owner Writes");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_a" }]);
  });

  it("Organizer (delegate-equivalent elevated tier) may also write", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Organizer Writes");
    await ctx.callerAs("planner").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 2, result: "halved" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 2, result: "halved" }]);
  });

  it("B3: a member IN the match may record its outcome (their own match)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Member In Match");
    // member is side B of this match — now authorized to decide its holes.
    await ctx.callerAs("member").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_b" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_b" }]);
  });

  it("a member NOT in the match is still REJECTED (genuine non-participant)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Outsider Blocked");
    await expect(
      ctx.callerAs("outsider").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" })
    ).rejects.toThrow();
  });

  it("is idempotent on (match_id, hole_number) — a re-tap UPDATES the same row, not a duplicate", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Idempotent");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "halved" });
    const { data } = await ctx.admin.from("match_hole_outcomes").select("result").eq("match_id", matchId).eq("hole_number", 1);
    expect(data).toHaveLength(1);
    expect((data as { result: string }[])[0].result).toBe("halved");
  });

  it("rejects a write once scoring hasn't been enabled yet", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Not Enabled" });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await expect(
      ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" })
    ).rejects.toThrow(/enable scoring/i);
  });
});

describe("matchOutcomes.deleteOutcome — Reset hole (same scoped permissions)", () => {
  it("clears a recorded outcome back to undecided", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Hole");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });

  it("B3: a member IN the match may reset its own hole", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Own Match");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.callerAs("member").matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });

  it("a member NOT in the match is still REJECTED", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Outsider Blocked");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await expect(
      ctx.callerAs("outsider").matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 })
    ).rejects.toThrow();
  });
});

describe("matchOutcomes.listByGame — read parity with scores.listByGame", () => {
  it("a plain Member CAN read (read is not the elevated-tier concern)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Member Reads");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    const rows = await ctx.callerAs("member").matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_a" }]);
  });

  it("a Member sees nothing for a SETUP-mode (pending) game they can't edit", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Still Pending" });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const rows = await ctx.callerAs("member").matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });
});

/**
 * Clearing a hole is only half the feature; the other half is that the RESULT
 * follows. Nothing about a decided match is snapshotted while it is being
 * played — `game_matches.result/margin/status` and `game_results` are written
 * at `games.finish` — so these assert the seam where a cleared hole becomes
 * cup points, which is the failure that would matter.
 */
describe("matchOutcomes.deleteOutcome — the result follows the cleared hole", () => {
  /** A wins holes 1-3, halves 4-16 → 3 up with 2 to play, closed 3&2. */
  const decide = async (gameId: string, matchId: string, skip?: number) => {
    for (let hole = 1; hole <= 16; hole++) {
      if (hole === skip) continue;
      await ctx.caller().matchOutcomes.upsertOutcome({
        tripId, gameId, matchId, holeNumber: hole,
        result: hole <= 3 ? "side_a" : "halved",
      });
    }
  };

  /** A wins hole 1, halves 2-18 → 1 up through 18 (over). Clearing hole 1
   *  leaves 17 halves and one unplayed hole: all square, nobody trailing. */
  const decideOneUp = async (gameId: string, matchId: string) => {
    for (let hole = 1; hole <= 18; hole++) {
      await ctx.caller().matchOutcomes.upsertOutcome({
        tripId, gameId, matchId, holeNumber: hole,
        result: hole === 1 ? 'side_a' : 'halved',
      });
    }
  };

  const finishAndRead = async (gameId: string) => {
    await ctx.caller().games.finish({ tripId, gameId });
    const { data } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, points, position")
      .eq("game_id", gameId);
    return (data ?? []) as { entity_id: string; entity_type: string; points: number; position: number }[];
  };

  it("CUP POINTS: finishing after a clear scores from the CLEARED hole set", async () => {
    /**
     * The assertion the whole feature rests on: it fails against a build where
     * the row is deleted but the result is computed from a stale hole set.
     *
     * The fixture is chosen so the clear CHANGES WHO IS AHEAD, not just the
     * margin. A wins hole 1 and halves 2-18: 1 up through 18, a_win. Clear hole
     * 1 and it is 17 halved holes with one unplayed — all square, nobody
     * trailing. So B moves from position 2 to position 1, which is the points
     * difference an earlier draft of this test missed by picking a fixture
     * where A led either way.
     */
    const control = await freshOutcomeMatch("A wins by one");
    await decideOneUp(control.gameId, control.matchId);

    const cleared = await freshOutcomeMatch("...until the winning hole is cleared");
    await decideOneUp(cleared.gameId, cleared.matchId);
    await ctx.caller().matchOutcomes.deleteOutcome({
      tripId, gameId: cleared.gameId, matchId: cleared.matchId, holeNumber: 1,
    });

    const controlRows = await finishAndRead(control.gameId);
    const clearedRows = await finishAndRead(cleared.gameId);
    const posOf = (rows: { entity_id: string; position?: number }[], id: string) =>
      rows.find((r) => r.entity_id === id)?.position;

    // Control: A leads, B trails.
    expect(posOf(controlRows, owner)).toBe(1);
    expect(posOf(controlRows, member)).toBe(2);
    // Cleared: all square — BOTH share position 1. This is the number that
    // moves, and it moves only if finish read the post-clear rows.
    expect(posOf(clearedRows, owner)).toBe(1);
    expect(posOf(clearedRows, member)).toBe(1);

    const readMatch = async (matchId: string) => {
      const { data } = await ctx.admin
        .from('game_matches').select('result, margin, status').eq('id', matchId).maybeSingle();
      return data;
    };
    expect(await readMatch(control.matchId)).toMatchObject({ result: 'a_win', status: 'complete' });
    // Not over any more: an unplayed hole and nobody ahead.
    expect(await readMatch(cleared.matchId)).toMatchObject({ result: null, margin: null });
  });

  it("ROUND TRIP: clear then re-enter, and the finished result is the original", async () => {
    const a = await freshOutcomeMatch("Round trip control");
    await decide(a.gameId, a.matchId);

    const b = await freshOutcomeMatch("Round trip cleared and restored");
    await decide(b.gameId, b.matchId);
    await ctx.caller().matchOutcomes.deleteOutcome({
      tripId, gameId: b.gameId, matchId: b.matchId, holeNumber: 3,
    });
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId: b.gameId, matchId: b.matchId, holeNumber: 3, result: "side_a",
    });

    await ctx.caller().games.finish({ tripId, gameId: a.gameId });
    await ctx.caller().games.finish({ tripId, gameId: b.gameId });

    const read = async (matchId: string) => {
      const { data } = await ctx.admin
        .from("game_matches").select("result, margin").eq("id", matchId).maybeSingle();
      return data;
    };
    expect(await read(b.matchId)).toEqual(await read(a.matchId));
  });

  it("a cleared hole is ABSENT, never stored as halved", async () => {
    /**
     * The failure that would look correct forever. `result` is NOT NULL with a
     * three-value CHECK, so "cleared" has no representation as a value — it must
     * be the absence of the row. This pins that the delete removes it rather
     * than rewriting it to the nearest neutral outcome.
     */
    const { gameId, matchId } = await freshOutcomeMatch("Cleared is not halved");
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId, matchId, holeNumber: 7, result: "side_a",
    });
    await ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 7 });

    const { data } = await ctx.admin
      .from("match_hole_outcomes").select("hole_number, result").eq("match_id", matchId);
    expect(data ?? []).toEqual([]);
    // Explicitly NOT the halved row a wrong build would leave behind.
    expect((data ?? []).some((r) => (r as { result: string }).result === "halved")).toBe(false);
  });

  it("clearing a hole that was never entered is a no-op, not an error", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Clear an empty hole");
    await expect(
      ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 12 }),
    ).resolves.toBeTruthy();
  });

  it("clearing on a POSTED game is refused with the message that names the way back", async () => {
    /**
     * Reuses the boundary people have already met — the same guard and the same
     * string as `upsertOutcome`, not a second rule. Asserted on the MESSAGE
     * because that is what the reader acts on: it has to name a control that
     * exists ("Correct a score" on the scoreboard).
     */
    const { gameId, matchId } = await freshOutcomeMatch("Posted, clear refused");
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId, matchId, holeNumber: 1, result: "side_a",
    });
    await ctx.caller().games.finish({ tripId, gameId });

    await expect(
      ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 }),
    ).rejects.toThrow(/posted/i);
    await expect(
      ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 }),
    ).rejects.toThrow(/Correct a score/);
  });
});
