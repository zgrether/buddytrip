import { describe, it, expect } from "vitest";
import { shouldNotifyMatchesNotDrawn, gameRunnerIds, matchesNotDrawnPayload } from "./pickemMatchesNotify";

/**
 * The organizer push's pure parts (results-first PR). The end-to-end — the real
 * `pickem.setResult` leaving a real `push_send_log` row — is in
 * `src/server/routers/pickemMatchesNotify.test.ts`, which needs the database.
 */

describe("shouldNotifyMatchesNotDrawn — the none-to-some transition, and only it", () => {
  const d = (over: Partial<Parameters<typeof shouldNotifyMatchesNotDrawn>[0]> = {}) =>
    shouldNotifyMatchesNotDrawn({ priorResults: 0, newResult: "home", individualMatches: true, pairedMatches: 0, ...over });

  it("the FIRST result on an individual-matches game with nothing paired → notify", () => {
    expect(d()).toBe(true);
    // A push or a cancellation is a result too.
    expect(d({ newResult: "push" })).toBe(true);
    expect(d({ newResult: "cancelled" })).toBe(true);
  });

  it("a result that was not the first → no (one push per game, not per result)", () => {
    expect(d({ priorResults: 1 })).toBe(false);
  });

  it("clearing a result → no: an unplayed contest is never a first result", () => {
    expect(d({ newResult: null })).toBe(false);
  });

  it("team totals or a points cup (resolved flag false) → no: nothing to draw", () => {
    expect(d({ individualMatches: false })).toBe(false);
  });

  it("a match already paired → no: the runner has drawn", () => {
    expect(d({ pairedMatches: 1 })).toBe(false);
  });
});

/** A PostgREST-shaped fake whose `.eq` and `.in` really filter, so a query that
 *  names the wrong column or forgets the role filter cannot pass. */
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from: (name: string) => {
      let cur = [...(tables[name] ?? [])];
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
        in: (k: string, vals: unknown[]) => { cur = cur.filter((r) => vals.includes(r[k])); return api; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: cur, error: null }).then(res, rej),
      };
      return api;
    },
  };
}

describe("gameRunnerIds — the people who can act", () => {
  const admin = fakeAdmin({
    trip_members: [
      { trip_id: "t1", user_id: "owner", role: "Owner" },
      { trip_id: "t1", user_id: "org", role: "Organizer" },
      { trip_id: "t1", user_id: "mem", role: "Member" },
      { trip_id: "t2", user_id: "elsewhere", role: "Owner" },
    ],
    game_delegates: [
      { game_id: "g1", user_id: "del" },
      { game_id: "g1", user_id: "org" }, // an organizer who is ALSO a delegate
      { game_id: "g2", user_id: "other-del" },
    ],
  });

  it("is Owners + Organizers of THIS trip and delegates of THIS game — once each, never a Member", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = await gameRunnerIds(admin as any, "t1", "g1");
    expect(ids.sort()).toEqual(["del", "org", "owner"]);
  });
});

describe("matchesNotDrawnPayload", () => {
  it("deep-links a cup game to its panel over the board, via the shared gameUrl", () => {
    const p = matchesNotDrawnPayload({
      tripId: "t1", gameId: "g1", gameName: "Picks 2", gameTypeId: "gtt_pickem", competitionId: "c1",
    });
    expect(p.url).toBe("/trips/t1?view=cup&game=g1");
    expect(p.title).toBe("Picks 2: draw the matches");
    // The reassurance matters: drawing after results is fine, and the runner
    // should not think the late draw loses anything.
    expect(p.body).toContain("scored from the results already in");
    expect(p.tag).toBe("pickem-matches-g1");
  });
});
