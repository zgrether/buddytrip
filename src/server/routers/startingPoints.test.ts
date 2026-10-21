import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { STARTING_POINTS, STARTING_POINT_IDS, startingPointFits, suggestedGames, type StartingPointId } from "@/lib/startingPoints";
import { MAX_SEED_TEAMS } from "@/lib/teamColors";

/**
 * Starting points, end to end (roadmap Next item 1). Every suggestion of every
 * starting point is created through the REAL `games.create`, on a competition
 * the REAL `competitions.create` made for it, with the catalog's own values:
 * the fixture is the app's builder, so a suggestion the server would refuse
 * fails here. Then the new doors: `games.create` taking a format, and
 * `competitions.skipSuggestion`.
 *
 * Each case builds its own trip (a trip holds one competition, and the suite
 * runs shuffled).
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function startFrom(id: StartingPointId, teamCount: number, label: string) {
  const tripId = await ctx.createTrip(`sp ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const sp = STARTING_POINTS[id];
  const comp = (await ctx.caller().competitions.create({
    tripId,
    name: `SP ${label}`,
    scoringModel: sp.scoringModel,
    teamCount,
    startingPoint: id,
  })) as { id: string };
  return { tripId, competitionId: comp.id };
}

const teamCounts = (id: StartingPointId) =>
  [0, ...Array.from({ length: MAX_SEED_TEAMS - 1 }, (_, i) => i + 2)].filter((n) =>
    startingPointFits(id, STARTING_POINTS[id].scoringModel, n)
  );

describe("every suggestion can be created as it is suggested", () => {
  for (const id of STARTING_POINT_IDS) {
    for (const teams of teamCounts(id)) {
      it(`${id}, ${teams === 0 ? "individuals" : `${teams} teams`}`, async () => {
        const { tripId, competitionId } = await startFrom(id, teams, `${id} ${teams}`);
        const { data: comp } = await ctx.admin.from("competitions").select("starting_point").eq("id", competitionId).single();
        expect(comp?.starting_point).toBe(id);
        for (const s of suggestedGames(id, teams)) {
          const game = (await ctx.caller().games.create({
            tripId,
            competitionId,
            gameTypeId: s.gameTypeId,
            name: s.name,
            pointsTotal: s.pointsTotal,
            pointsDistribution: s.pointsDistribution,
            competitionFormat: s.competitionFormat,
          })) as { id: string };
          const { data: row } = await ctx.admin
            .from("games")
            .select("game_type_id, competition_format, points_total, points_distribution")
            .eq("id", game.id)
            .single();
          expect(row).toEqual({
            game_type_id: s.gameTypeId,
            competition_format: s.competitionFormat,
            points_total: s.pointsTotal,
            points_distribution: s.pointsDistribution,
          });
        }
      }, 120_000);
    }
  }
});

describe("competitions.create refuses a starting point its setup can't hold", () => {
  it("Golf week as a Head-to-Head Cup is refused, and nothing is created", async () => {
    const tripId = await ctx.createTrip("sp mismatch");
    await expect(
      ctx.caller().competitions.create({ tripId, name: "Mismatch", scoringModel: "match_play", startingPoint: "golf_week" })
    ).rejects.toThrow("This setup doesn't match the starting point. Pick the starting point again, or use Build your own.");
    const { count } = await ctx.admin.from("competitions").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
    expect(count).toBe(0);
  });

  it("CONTROL: Build your own stores no starting point", async () => {
    const tripId = await ctx.createTrip("sp none");
    const comp = (await ctx.caller().competitions.create({ tripId, name: "Own", scoringModel: "points", teamCount: 0 })) as { id: string };
    const { data } = await ctx.admin.from("competitions").select("starting_point").eq("id", comp.id).single();
    expect(data?.starting_point).toBeNull();
  });
});

describe("games.create takes a format, judged as the settings save judges it", () => {
  it("a bracket in a Head-to-Head Cup is refused", async () => {
    const { tripId, competitionId } = await startFrom("team_cup_weekend", 2, "h2h bracket");
    await expect(
      ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_generic_bar", name: "B", competitionFormat: "bracket" })
    ).rejects.toThrow("A Cup is head to head, and a bracket awards points by placement.");
  });

  it("a format on a game that scores itself is refused", async () => {
    const { tripId, competitionId } = await startFrom("golf_week", 0, "engine format");
    await expect(
      ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_stroke_play", name: "S", competitionFormat: "bracket" })
    ).rejects.toThrow("Stroke Play scores itself, so it takes no format.");
  });

  it("a match-by-match format with a split by place is refused", async () => {
    const { tripId, competitionId } = await startFrom("bar_night_bracket", 2, "matches split");
    await expect(
      ctx.caller().games.create({
        tripId,
        competitionId,
        gameTypeId: "gtt_generic_bar",
        name: "M",
        competitionFormat: "matches",
        pointsTotal: 10,
        pointsDistribution: { type: "placement", values: [7, 3] },
      })
    ).rejects.toThrow("This game awards points match by match, so its points can't be split by place.");
  });

  it("CONTROL: no format is stored as none", async () => {
    const { tripId, competitionId } = await startFrom("bar_night_bracket", 2, "no format");
    const game = (await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_generic_bar", name: "Plain" })) as { id: string };
    const { data } = await ctx.admin.from("games").select("competition_format").eq("id", game.id).single();
    expect(data?.competition_format).toBeNull();
  });
});

describe("competitions.skipSuggestion", () => {
  it("stores a skip once, however often it is sent", async () => {
    const { tripId, competitionId } = await startFrom("team_cup_weekend", 2, "skip");
    await ctx.caller().competitions.skipSuggestion({ tripId, competitionId, key: "gtt_rack_n_stack" });
    const again = await ctx.caller().competitions.skipSuggestion({ tripId, competitionId, key: "gtt_rack_n_stack" });
    expect(again.skippedSuggestions).toEqual(["gtt_rack_n_stack"]);
    const { data } = await ctx.admin.from("competitions").select("skipped_suggestions").eq("id", competitionId).single();
    expect(data?.skipped_suggestions).toEqual(["gtt_rack_n_stack"]);
  });

  it("refuses a key that is not one of the starting point's suggestions", async () => {
    const { tripId, competitionId } = await startFrom("team_cup_weekend", 2, "skip unknown");
    await expect(ctx.caller().competitions.skipSuggestion({ tripId, competitionId, key: "gtt_skins" })).rejects.toThrow(
      "That isn't one of this game list's suggestions."
    );
  });

  it("Golf week's Scramble can be skipped (a teams-only suggestion)", async () => {
    const { tripId, competitionId } = await startFrom("golf_week", 2, "skip scramble");
    const out = await ctx.caller().competitions.skipSuggestion({ tripId, competitionId, key: "gtt_scramble" });
    expect(out.skippedSuggestions).toEqual(["gtt_scramble"]);
  });

  it("a member cannot skip", async () => {
    const { tripId, competitionId } = await startFrom("team_cup_weekend", 2, "skip member");
    await expect(ctx.callerAs("member").competitions.skipSuggestion({ tripId, competitionId, key: "gtt_match_play" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { data } = await ctx.admin.from("competitions").select("skipped_suggestions").eq("id", competitionId).single();
    expect(data?.skipped_suggestions).toEqual([]);
  });
});
