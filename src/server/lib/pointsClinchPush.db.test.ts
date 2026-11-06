import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { claimClinchNotification, formatClinchMargin, notifyCupClinchedIfDecided, reconcileClinchClaim, releaseClinchClaim } from "./gameFinishNotify";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { fmtPts } from "@/lib/vocabulary";

/**
 * The clinch push on a points cup (docs/CLINCH_AND_PODIUM.md §4), against the real
 * database: the clincher comes from §1, never `pointsToClinch`, and a person is
 * claimed exactly as a team is.
 */

let ctx: TestContext;
const comps: string[] = [];

async function pointsCup(name: string, teams: string[] | undefined) {
  const made = await ctx.createCupTrip({ title: name, name, scoringModel: "points", teams });
  comps.push(made.competitionId);
  return made;
}

/** A manual game paying `values`, finished in the order given. */
async function game(cup: { tripId: string; competitionId: string }, name: string, values: number[], order?: string[]) {
  const g = (await ctx.caller().games.create({ tripId: cup.tripId, gameTypeId: "gtt_generic_yard", name, competitionId: cup.competitionId })) as { id: string };
  await ctx.admin.from("games").update({ points_total: values.reduce((a, b) => a + b, 0), points_distribution: { type: "placement", values } }).eq("id", g.id);
  if (order) await ctx.caller().games.finish({ tripId: cup.tripId, gameId: g.id, placements: order.map((entityId, i) => ({ entityId, position: i + 1 })) });
  return g.id;
}

/** `games.finish` runs the clinch check itself, so a cup's games are made before
 *  any of them finishes. */
const notify = (cup: { tripId: string; competitionId: string }) =>
  notifyCupClinchedIfDecided({ tripId: cup.tripId, competitionId: cup.competitionId, actorUserId: ctx.user.id, admin: ctx.admin });

async function claim(competitionId: string) {
  const { data } = await ctx.admin.from("competitions").select("clinch_notified_team_id, clinch_notified_user_id").eq("id", competitionId).single();
  return data as { clinch_notified_team_id: string | null; clinch_notified_user_id: string | null };
}

async function outcomes(competitionId: string) {
  const { data } = await ctx.admin.from("push_send_log").select("outcome, trigger, recipients").eq("competition_id", competitionId).eq("trigger", "cup_clinched").order("created_at");
  return (data ?? []) as { outcome: string; recipients: number }[];
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  if (comps.length) await ctx.admin.from("push_send_log").delete().in("competition_id", comps);
  await ctx.cleanup();
}, 60_000);

describe("a points cup's clinch comes from the place locks", () => {
  it("clinches on §1 where the more-than-half rule says no: the mechanism, not the outcome", async () => {
    const cup = await pointsCup("Early clinch", ["A", "B", "C"]);
    const [a, b, c] = cup.teamIds;
    await game(cup, "Left", [2]);
    await game(cup, "First", [6, 3, 2], [a, b, c]);

    const board = await computeCompetitionLeaderboard(ctx.admin, cup.competitionId);
    expect((board.pointsToClinch as Record<string, number>)[a]).toBeGreaterThan(0); // not "decided" by that rule
    expect(board.clinch?.clincherId).toBe(a);

    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBe(a);
    expect((await outcomes(cup.competitionId)).map((o) => o.outcome)).not.toContain("no_clincher");
  });

  it("no lock, no push", async () => {
    const cup = await pointsCup("Open cup", ["A", "B", "C"]);
    const [a, b, c] = cup.teamIds;
    await game(cup, "Left", [4]);
    await game(cup, "First", [6, 3, 2], [a, b, c]);

    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBeNull();
    expect(new Set((await outcomes(cup.competitionId)).map((o) => o.outcome))).toEqual(new Set(["no_clincher"]));
  });

  it("places 2+ send nothing: a locked 3rd with 1st open claims nobody", async () => {
    const cup = await pointsCup("Third locks", ["A", "B", "C"]);
    const [a, b, c] = cup.teamIds;
    await game(cup, "Left", [4]);
    await game(cup, "First", [10, 9, 1], [a, b, c]);

    const board = await computeCompetitionLeaderboard(ctx.admin, cup.competitionId);
    expect(board.clinch?.lockedUnitIds).toContain(c);
    expect(board.clinch?.clincherId).toBeNull();

    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBeNull();
  });

  it("one push per clinch: a second finalize is suppressed", async () => {
    const cup = await pointsCup("Once", ["A", "B"]);
    const [a, b] = cup.teamIds;
    await game(cup, "Left", [2]);
    await game(cup, "First", [10, 1], [a, b]);

    await notify(cup);
    await notify(cup);
    expect((await outcomes(cup.competitionId)).map((o) => o.outcome)).toContain("already_claimed");
  });

  it("adding a game un-clinches and releases the claim, so a re-clinch announces itself", async () => {
    const cup = await pointsCup("Reclinch", ["A", "B"]);
    const [a, b] = cup.teamIds;
    await game(cup, "First", [10, 1], [a, b]);
    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBe(a);

    const added = await game(cup, "Added", [20]);
    await reconcileClinchClaim(cup.competitionId, ctx.admin);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBeNull();

    await ctx.admin.from("games").delete().eq("id", added);
    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBe(a);
  });

  it("reconcile leaves a clincher who is still clinched alone", async () => {
    const cup = await pointsCup("Still clinched", ["A", "B"]);
    const [a, b] = cup.teamIds;
    await game(cup, "First", [10, 1], [a, b]);
    await notify(cup);
    await game(cup, "Small", [2]);
    await reconcileClinchClaim(cup.competitionId, ctx.admin);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBe(a);
  });

  it("a live game's lead claims nothing: it is an unbanked game", async () => {
    const cup = await pointsCup("Live lead", ["A", "B"]);
    const [a, b] = cup.teamIds;
    const live = await game(cup, "Live", [10]);
    await game(cup, "First", [3, 1], [a, b]);
    await ctx.admin.from("games").update({ status: "active" }).eq("id", live);
    // Rows on a live game, as a mid-round recompute writes them. They bank nothing.
    await ctx.admin.from("game_results").insert({ id: genId("gr"), game_id: live, entity_id: a, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 });

    await notify(cup);
    expect((await claim(cup.competitionId)).clinch_notified_team_id).toBeNull();
  });
});

describe("people behave exactly like teams", () => {
  async function teamlessRace(name: string) {
    const cup = await pointsCup(name, undefined);
    const member = ctx.getUser("member").id;
    await ctx.addTripMember(cup.tripId, "member", "Member");
    const finished = (await ctx.caller().games.create({ tripId: cup.tripId, gameTypeId: "gtt_stroke_play", name: "Round", competitionId: cup.competitionId })) as { id: string };
    await ctx.admin.from("games").update({ status: "complete", points_total: 11, points_distribution: { type: "placement", values: [10, 1] } }).eq("id", finished.id);
    await ctx.admin.from("game_participants").delete().eq("game_id", finished.id);
    for (const [i, userId] of [ctx.user.id, member].entries()) {
      await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: finished.id, user_id: userId, scoring_enabled: true });
      await ctx.admin.from("game_results").insert({ id: genId("gr"), game_id: finished.id, entity_id: userId, entity_type: "user", value_kind: "rank", position: i + 1, raw_score: 70 + i });
    }
    return { ...cup, leader: ctx.user.id, member };
  }

  it("a person's clinch claims the person column, tells the race, and names them", async () => {
    const race = await teamlessRace("Solo race");
    const board = await computeCompetitionLeaderboard(ctx.admin, race.competitionId);
    expect(board.teamless).toBe(true);
    expect(board.clinch?.clincherId).toBe(race.leader);

    await notify(race);
    const held = await claim(race.competitionId);
    expect(held.clinch_notified_user_id).toBe(race.leader);
    expect(held.clinch_notified_team_id).toBeNull();
  });

  it("the audience is the race: an empty roster does not mean nobody", async () => {
    const race = await teamlessRace("Solo audience");
    await notify(race);
    const sent = (await outcomes(race.competitionId)).at(-1);
    expect(sent?.outcome).not.toBe("claim_error");
    expect(sent?.recipients).toBeGreaterThan(0);
  });

  it("a person's un-clinch releases, and a second finalize is suppressed the same way", async () => {
    const race = await teamlessRace("Solo reclinch");
    await notify(race);
    await notify(race);
    expect((await outcomes(race.competitionId)).map((o) => o.outcome)).toContain("already_claimed");

    const added = (await ctx.caller().games.create({ tripId: race.tripId, gameTypeId: "gtt_stroke_play", name: "Added", competitionId: race.competitionId })) as { id: string };
    await ctx.admin.from("games").update({ points_total: 40, points_distribution: { type: "placement", values: [40] } }).eq("id", added.id);
    await reconcileClinchClaim(race.competitionId, ctx.admin);
    expect((await claim(race.competitionId)).clinch_notified_user_id).toBeNull();
  });
});

describe("the claim's guarantees (migration 224)", () => {
  it("the person claim is a compare-and-swap: once, and a stale release loses", async () => {
    const cup = await pointsCup("CAS", undefined);
    const owner = ctx.user.id;
    const member = ctx.getUser("member").id;
    expect((await claimClinchNotification(ctx.admin, cup.competitionId, owner, "person")).outcome).toBe("claimed");
    expect((await claimClinchNotification(ctx.admin, cup.competitionId, owner, "person")).outcome).toBe("already_claimed");
    expect(await releaseClinchClaim(ctx.admin, cup.competitionId, member, "person")).toBe(false);
    expect((await claim(cup.competitionId)).clinch_notified_user_id).toBe(owner);
    expect(await releaseClinchClaim(ctx.admin, cup.competitionId, owner, "person")).toBe(true);
    expect((await claim(cup.competitionId)).clinch_notified_user_id).toBeNull();
  });

  it("at most one of team and person: the database refuses both", async () => {
    const cup = await pointsCup("One unit", ["A", "B"]);
    const { error } = await ctx.admin
      .from("competitions")
      .update({ clinch_notified_team_id: cup.teamIds[0], clinch_notified_user_id: ctx.user.id })
      .eq("id", cup.competitionId);
    expect(error?.message).toContain("competitions_clinch_notified_one_unit");
  });

  it("CONTROL: either one alone is fine", async () => {
    const cup = await pointsCup("One alone", ["A", "B"]);
    const { error } = await ctx.admin.from("competitions").update({ clinch_notified_user_id: ctx.user.id }).eq("id", cup.competitionId);
    expect(error).toBeNull();
  });

  it("a team claim takes over from a person's rather than tripping the CHECK", async () => {
    const cup = await pointsCup("Takeover", ["A", "B"]);
    await ctx.admin.from("competitions").update({ clinch_notified_user_id: ctx.user.id }).eq("id", cup.competitionId);
    expect((await claimClinchNotification(ctx.admin, cup.competitionId, cup.teamIds[0])).outcome).toBe("claimed");
    expect(await claim(cup.competitionId)).toEqual({ clinch_notified_team_id: cup.teamIds[0], clinch_notified_user_id: null });
  });

  it("the person column points at a real person", async () => {
    const cup = await pointsCup("FK", undefined);
    const { error } = await ctx.admin.from("competitions").update({ clinch_notified_user_id: "nobody-at-all" }).eq("id", cup.competitionId);
    expect(error?.code).toBe("23503");
  });
});

describe("the guest merge (migration 224)", () => {
  async function guest(label: string) {
    const id = genId(`guest-${label}`);
    const { error } = await ctx.admin.from("users").insert({ id, name: `Guest ${label}`, is_guest: true });
    if (error) throw new Error(error.message);
    return id;
  }

  it("moves a guest's clinch claim and tiebreak place to the real account", async () => {
    const cup = await pointsCup("Merge claim", undefined);
    const ghost = await guest("a");
    const real = (await ctx.createAccount("merge-claim")).id;
    await ctx.admin.from("competitions").update({ clinch_notified_user_id: ghost, tiebreak_order: ["x", ghost, "y"] }).eq("id", cup.competitionId);

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghost, p_real_id: real });
    expect(error).toBeNull();

    const { data } = await ctx.admin.from("competitions").select("clinch_notified_user_id, tiebreak_order").eq("id", cup.competitionId).single();
    expect(data).toEqual({ clinch_notified_user_id: real, tiebreak_order: ["x", real, "y"] });
  });

  it("both in the order: the real account's place stands, and nobody holds two", async () => {
    const cup = await pointsCup("Merge both", undefined);
    const ghost = await guest("b");
    const real = (await ctx.createAccount("merge-both")).id;
    await ctx.admin.from("competitions").update({ tiebreak_order: [ghost, "y", real] }).eq("id", cup.competitionId);

    await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghost, p_real_id: real });

    const { data } = await ctx.admin.from("competitions").select("tiebreak_order").eq("id", cup.competitionId).single();
    expect(data?.tiebreak_order).toEqual(["y", real]);
  });

  it("CONTROL: a competition the guest is not in stays exactly as it was", async () => {
    const cup = await pointsCup("Merge none", undefined);
    const ghost = await guest("c");
    const real = (await ctx.createAccount("merge-none")).id;
    await ctx.admin.from("competitions").update({ tiebreak_order: ["x", "y"] }).eq("id", cup.competitionId);

    await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghost, p_real_id: real });

    const { data } = await ctx.admin.from("competitions").select("tiebreak_order").eq("id", cup.competitionId).single();
    expect(data?.tiebreak_order).toEqual(["x", "y"]);
  });
});

describe("the push's numbers", () => {
  it("a points cup's margin is decimals", () => {
    expect(formatClinchMargin([25.5, 20.5, 3], fmtPts)).toBe("25.5 – 20.5");
  });
  it("CONTROL: a head-to-head Cup's stays as it was, until #1695", () => {
    expect(formatClinchMargin([25.5, 20.5])).toBe("25½ – 20½");
  });
});
