import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * save_game_config — the P2 additive branches (migration 085): rack GROUPINGS
 * (`groups[]`, the structure unit) + standalone PARTICIPANT strokes (`participants[]`,
 * the field unit). Match play is unaffected (its tests live in the sibling file); this
 * exercises the two new payload keys directly against the RPC contract — the client
 * drafts that will EMIT these keys land in later P2 phases.
 *
 * The headline is the **hash-invariant guard** (`describe` at the bottom): the
 * mechanical generalization of the delegate paired test — for every field the RPC
 * writes, the hash MOVES on a real change and does NOT churn on an idempotent re-write.
 * The table IS the checklist: a field added to save_game_config without a row here
 * fails the intent. This closes the class that went silent four times (`.from("matches")`,
 * game_delegates, point_value/handicap_strokes, and now play_groups.tee_time).
 */

const RACK = "gtt_rack_n_stack";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

interface Scalars {
  name: string;
  rulesForToday: string | null;
  scoringEnabled: boolean;
  entryMode: string;
  modifiers: Record<string, Record<string, unknown>>;
  pointsTotal: number | null;
  pointsDistribution: unknown;
  courseId: string | null;
  backCourseId: string | null;
  scorecardSchema: unknown;
  delegates: string[];
}

async function newRackGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: RACK, name, competitionId })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

async function hashOf(gameId: string): Promise<string> {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

/** Echo the game's current scalars so a save changes ONLY the groups/participants
 *  passed in overrides — the RPC's scalar UPDATE writes the full set every time. */
async function scalars(gameId: string): Promise<Scalars> {
  const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  const orgs = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  return {
    name: (g.name as string) ?? "Game",
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: (g.scoring_enabled as boolean) ?? false,
    entryMode: (g.entry_mode as string) ?? "score",
    modifiers: (g.modifiers as Record<string, Record<string, unknown>>) ?? {},
    pointsTotal: (g.points_total as number | null) ?? null,
    pointsDistribution: g.points_distribution ?? null,
    courseId: (g.course_id as string | null) ?? null,
    backCourseId: (g.back_course_id as string | null) ?? null,
    scorecardSchema: g.scorecard_schema ?? null,
    delegates: orgs.map((d) => d.user_id),
  };
}

type RackGroup = { name?: string; teeTime?: string | null; userIds: string[] };
type RackParticipant = { userId: string; strokes: number };

/** Build a full rack payload from the current scalars + the groups/participants slice. */
async function rackPayload(
  gameId: string,
  slice: { groups?: RackGroup[]; groupsStructureDirty?: boolean; participants?: RackParticipant[]; scoringEnabled?: boolean },
) {
  const s = await scalars(gameId);
  return {
    ...s,
    scoringEnabled: slice.scoringEnabled ?? s.scoringEnabled,
    ...(slice.groups !== undefined ? { groups: slice.groups, groupsStructureDirty: slice.groupsStructureDirty ?? true } : {}),
    ...(slice.participants !== undefined ? { participants: slice.participants } : {}),
  };
}

async function save(gameId: string, slice: Parameters<typeof rackPayload>[1]) {
  const payload = await rackPayload(gameId, slice);
  await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig P2 Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig P2 Cup");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("play_groups").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("save_game_config — rack GROUPINGS (structure) + PARTICIPANT strokes (field)", () => {
  it("writes groups + roster + play_group assignment from the payload (no more setFoursomes)", async () => {
    const gameId = await newRackGame("Rack groups write");
    await save(gameId, {
      groups: [
        { name: "Front", teeTime: "08:30", userIds: [owner, planner] },
        { name: "Back", teeTime: "08:40", userIds: [member, outsider] },
      ],
      participants: [{ userId: owner, strokes: 4 }, { userId: member, strokes: 2 }],
    });

    const { groups, participants } = (await ctx.caller().playGroups.listByGame({ tripId, gameId })) as {
      groups: { display_name: string; tee_time: string | null }[];
      participants: { user_id: string; play_group_id: string | null; handicap_strokes: number | null }[];
    };
    expect(groups.map((g) => g.display_name).sort()).toEqual(["Back", "Front"]);
    expect(groups.map((g) => g.tee_time).sort()).toEqual(["08:30", "08:40"]);
    // Roster = the union; each grouped player got a play_group_id.
    expect(participants).toHaveLength(4);
    expect(participants.every((p) => p.play_group_id != null)).toBe(true);
    const strokesOf = new Map(participants.map((p) => [p.user_id, p.handicap_strokes]));
    expect(strokesOf.get(owner)).toBe(4);
    expect(strokesOf.get(member)).toBe(2);
  });

  it("a GROUPINGS change on a scored game is REFUSED (HAS_SCORES, #594) — names 'groupings'", async () => {
    const gameId = await newRackGame("Rack groups locked");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }], participants: [] });
    // Go live (rack readiness = participants with a play_group) + enter a score.
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }], groupsStructureDirty: false, scoringEnabled: true });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 5 });

    // A different membership → structure dirty → refused, with the groupings noun.
    await expect(
      save(gameId, { groups: [{ name: "G1", userIds: [owner, planner] }], groupsStructureDirty: true, scoringEnabled: true }),
    ).rejects.toThrow(/groupings/i);
  });

  it("a per-participant STROKE edit on a scored game SUCCEEDS in place (warned, not refused)", async () => {
    const gameId = await newRackGame("Rack strokes warned");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }], participants: [{ userId: owner, strokes: 0 }] });
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }], groupsStructureDirty: false, scoringEnabled: true });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 5 });

    // Same groupings (structure clean) + a stroke change → the in-place field path.
    await save(gameId, {
      groups: [{ name: "G1", userIds: [owner, member] }],
      groupsStructureDirty: false,
      participants: [{ userId: owner, strokes: 7 }],
      scoringEnabled: true,
    });
    const { data } = await ctx.admin.from("game_participants").select("user_id, handicap_strokes").eq("game_id", gameId);
    expect(new Map((data ?? []).map((p) => [p.user_id as string, p.handicap_strokes])).get(owner)).toBe(7);
  });

  it("no-op Save is byte-identical — the faithless-mirror guard for rack", async () => {
    const gameId = await newRackGame("Rack no-op");
    await save(gameId, {
      groups: [{ name: "Alpha", teeTime: "09:00", userIds: [owner, planner] }],
      participants: [{ userId: owner, strokes: 3 }, { userId: planner, strokes: 1 }],
    });
    const before = await hashOf(gameId);
    // Re-send the SAME config, structure clean → nothing rebuilds, hash unchanged.
    await save(gameId, {
      groups: [{ name: "Alpha", teeTime: "09:00", userIds: [owner, planner] }],
      groupsStructureDirty: false,
      participants: [{ userId: owner, strokes: 3 }, { userId: planner, strokes: 1 }],
    });
    expect(await hashOf(gameId)).toBe(before);
  });
});

/**
 * The mechanical hash-invariant guard. Each row is an RPC-written field: applying its
 * `change` must MOVE the hash; re-applying the SAME value must NOT churn it. Adding a
 * field to save_game_config without a row here is the omission this catches.
 * (Match-play fields — name/rules/entryMode/modifiers/points/course/delegates/matches/
 * point_value — are covered by the sibling suite; these are the 085 additions plus the
 * previously-accidental ones the structure/field split unmasked.)
 */
describe("save_game_config — hash invariant: every RPC-written field moves, none churns", () => {
  const baseGroups: RackGroup[] = [{ name: "One", teeTime: "07:00", userIds: [owner, member] }];

  // Each row's `change` is a real edit to that field. The no-churn re-write is the SAME
  // resulting config sent structure-CLEAN (`groupsStructureDirty: false`) — the client's
  // unchanged-save shape. That distinction is the whole point: a structure clean-replace
  // legitimately re-mints play_groups.id (so it MOVES the hash on a real change), and the
  // no-churn guarantee applies to re-sending that state without rebuilding.
  const cases: { field: string; change: () => Parameters<typeof rackPayload>[1] }[] = [
    { field: "play_groups.display_name", change: () => ({ groups: [{ ...baseGroups[0], name: "Renamed" }], groupsStructureDirty: true }) },
    { field: "play_groups.tee_time", change: () => ({ groups: [{ ...baseGroups[0], teeTime: "07:30" }], groupsStructureDirty: true }) },
    { field: "game_participants.play_group_id (membership)", change: () => ({ groups: [{ ...baseGroups[0], userIds: [owner, planner] }], groupsStructureDirty: true }) },
    { field: "game_participants.handicap_strokes", change: () => ({ groups: baseGroups, groupsStructureDirty: false, participants: [{ userId: owner, strokes: 9 }] }) },
  ];

  it.each(cases)("$field — moves on change, no churn on re-write", async ({ change }) => {
    const gameId = await newRackGame("Hash guard");
    await save(gameId, { groups: baseGroups, participants: [{ userId: owner, strokes: 0 }, { userId: member, strokes: 0 }] });

    // (1) MOVES — a real change to this field changes the hash.
    const before = await hashOf(gameId);
    const slice = change();
    await save(gameId, slice);
    const afterChange = await hashOf(gameId);
    expect(afterChange).not.toBe(before);

    // (2) NO CHURN — re-send the SAME resulting config structure-clean → byte-identical.
    await save(gameId, { ...slice, groupsStructureDirty: false });
    expect(await hashOf(gameId)).toBe(afterChange);
  });
});
