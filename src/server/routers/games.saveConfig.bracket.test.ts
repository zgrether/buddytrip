import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";

/**
 * save_game_config — the bracket POOL and DRAW (migration 115).
 *
 * The bracket is the first list slice whose rebuild destroys a RESULT rather
 * than a score, and the first whose dirty check is computed server-side instead
 * of taken from a client flag. Both of those are behaviours a type can't hold,
 * so they're pinned here.
 *
 * Note what these tests do NOT cover: the draft slice that would let a client
 * emit these keys. That lands with the setup UI in phase 2c — the same ordering
 * 113 used for `bracket_config`, where the server contract shipped and was
 * tested a phase before anything could drive it. So the payloads here are built
 * directly rather than through `nonGolfDraftToPayload`.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

interface BracketEntrant {
  seed: number;
  /** Nullable since 116 — a standalone bracket has no teams. Refused by the
   *  front door for now, not by the column. */
  teamId: string | null;
  userIds: string[];
}
interface DrawMatch {
  bracket: "main" | "consolation";
  round: number;
  slot: number;
  aSeed: number | null;
  bSeed: number | null;
}

async function newBracketGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

async function hashOf(gameId: string): Promise<string> {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

/** The full non-golf payload plus whichever bracket slices the case is about.
 *  Echoes the game's current scalars so a save changes ONLY what's overridden. */
async function payloadFor(
  gameId: string,
  slice: {
    name?: string;
    entrants?: BracketEntrant[];
    draw?: DrawMatch[];
    scoringEnabled?: boolean;
    omitEntrants?: boolean;
    pointsTotal?: number;
    distribution?: { type: "placement"; values: number[] };
  }
) {
  const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  return {
    name: slice.name ?? ((g.name as string) ?? "Bracket"),
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: slice.scoringEnabled ?? ((g.scoring_enabled as boolean) ?? false),
    pointsTotal: slice.pointsTotal ?? (g.points_total as number | null) ?? 4,
    pointsDistribution: slice.distribution ?? g.points_distribution ?? null,
    courseId: null,
    backCourseId: null,
    scorecardSchema: null,
    delegates: [],
    competitionFormat: "bracket" as const,
    bracketConfig: { elimination: "single" as const, entrants: "singles" as const, seeding: "manual" as const, consolation: false },
    ...(slice.omitEntrants ? {} : slice.entrants !== undefined ? { bracketEntrants: slice.entrants } : {}),
    ...(slice.draw !== undefined ? { bracketDraw: slice.draw } : {}),
  };
}

async function save(gameId: string, slice: Parameters<typeof payloadFor>[1]) {
  await ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: await hashOf(gameId),
    payload: await payloadFor(gameId, slice),
  });
}

/** Three entrants — a 4-seat draw, so every fixture carries a bye. */
function threeEntrants(): BracketEntrant[] {
  return [
    { seed: 1, teamId, userIds: [owner] },
    { seed: 2, teamId, userIds: [planner] },
    { seed: 3, teamId, userIds: [member] },
  ];
}

async function entrantsOf(gameId: string) {
  const { data } = await ctx.admin
    .from("bracket_entrants")
    .select("id, seed, team_id, created_at")
    .eq("game_id", gameId)
    .order("seed");
  return data ?? [];
}

async function drawOf(gameId: string) {
  const { data } = await ctx.admin
    .from("bracket_matches")
    .select("id, bracket, round, slot, entrant_a_id, entrant_b_id, winner_entrant_id")
    .eq("game_id", gameId)
    .order("bracket")
    .order("round")
    .order("slot");
  return data ?? [];
}

/** Seed a game with the standard 3-entrant field + its draw. */
async function seeded(name: string): Promise<string> {
  const gameId = await newBracketGame(name);
  await save(gameId, { entrants: threeEntrants(), draw: buildDraw(3) as DrawMatch[] });
  return gameId;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig bracket Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig bracket Cup");
  teamId = await ctx.createTeam(competitionId, "Bracket Team");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("bracket_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("bracket_entrants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("saveConfig — the bracket pool and draw write through the one atomic save", () => {
  it("writes entrants, their members, and the draw", async () => {
    const gameId = await seeded("Writes");
    const ents = await entrantsOf(gameId);
    expect(ents.map((e) => e.seed)).toEqual([1, 2, 3]);
    expect(ents.every((e) => e.team_id === teamId)).toBe(true);

    const { data: members } = await ctx.admin
      .from("bracket_entrant_members")
      .select("entrant_id, user_id")
      .in("entrant_id", ents.map((e) => e.id as string));
    expect((members ?? []).map((m) => m.user_id).sort()).toEqual([owner, planner, member].sort());

    // 4-seat draw: 2 round-1 matches + 1 final.
    expect(await drawOf(gameId)).toHaveLength(3);
  });

  it("entrant ids are DETERMINISTIC — the config hash depends on it", async () => {
    // `<game_id>:e<seed>`. Not cosmetic: `bracket_matches.entrant_a_id` is hashed,
    // so a minted id would churn the fingerprint on every rebuild of an unchanged
    // draw (the game_delegates.granted_by trap).
    const gameId = await seeded("Deterministic ids");
    expect((await entrantsOf(gameId)).map((e) => e.id)).toEqual([
      `${gameId}:e1`,
      `${gameId}:e2`,
      `${gameId}:e3`,
    ]);
  });

  it("a BYE persists as a null opponent, with no winner", async () => {
    // Migration 112's model: nobody played, so there is nothing to record. An
    // auto-advanced match would invent a result that could then be mis-picked.
    const gameId = await seeded("Bye");
    const byes = (await drawOf(gameId)).filter((m) => m.round === 1 && m.entrant_b_id === null);
    expect(byes).toHaveLength(1);
    expect(byes[0].entrant_a_id).toBe(`${gameId}:e1`);
    expect(byes[0].winner_entrant_id).toBeNull();
  });

  it("later rounds carry no entrants — occupants derive from the winners below", async () => {
    const gameId = await seeded("Derived rounds");
    for (const m of (await drawOf(gameId)).filter((x) => x.round > 1)) {
      expect(m.entrant_a_id).toBeNull();
      expect(m.entrant_b_id).toBeNull();
    }
  });
});

describe("saveConfig — the dirty check is computed server-side", () => {
  it("a no-op re-save writes NOTHING — the rows are the same rows", async () => {
    // The whole reason the RPC compares against stored state instead of taking a
    // client flag. `created_at` is the proof: a rebuild would re-mint it, and a
    // hash comparison alone couldn't tell a skipped rebuild from an identical one.
    const gameId = await seeded("No-op");
    const before = await entrantsOf(gameId);
    const beforeHash = await hashOf(gameId);

    await save(gameId, { entrants: threeEntrants(), draw: buildDraw(3) as DrawMatch[] });

    expect((await entrantsOf(gameId)).map((e) => e.created_at)).toEqual(before.map((e) => e.created_at));
    expect(await hashOf(gameId)).toBe(beforeHash);
  });

  it("array ORDER is not a change — the comparison is set-shaped", async () => {
    const gameId = await seeded("Reorder");
    const before = await entrantsOf(gameId);
    await save(gameId, {
      entrants: [...threeEntrants()].reverse(),
      draw: [...(buildDraw(3) as DrawMatch[])].reverse(),
    });
    expect((await entrantsOf(gameId)).map((e) => e.created_at)).toEqual(before.map((e) => e.created_at));
  });

  it("a real change rebuilds — adding a fourth entrant fills the empty seat", async () => {
    const gameId = await seeded("Grow");
    const four = [...threeEntrants(), { seed: 4, teamId, userIds: [outsider] }];
    await save(gameId, { entrants: four, draw: buildDraw(4) as DrawMatch[] });

    expect((await entrantsOf(gameId)).map((e) => e.seed)).toEqual([1, 2, 3, 4]);
    expect((await drawOf(gameId)).filter((m) => m.round === 1 && m.entrant_b_id === null)).toHaveLength(0);
  });

  it("a DRAW-only change rebuilds even though the field is identical", async () => {
    // The two halves are checked independently; a re-seed changes who plays whom
    // without changing who is in the field.
    const gameId = await seeded("Redraw");
    const swapped = (buildDraw(3) as DrawMatch[]).map((m) =>
      m.round === 1 && m.slot === 1 ? { ...m, aSeed: 2 } : m.round === 1 && m.slot === 2 ? { ...m, aSeed: 1, bSeed: 3 } : m
    );
    await save(gameId, { entrants: threeEntrants(), draw: swapped });
    const r1 = (await drawOf(gameId)).filter((m) => m.round === 1);
    expect(r1[0].entrant_a_id).toBe(`${gameId}:e2`);
  });

  it("an omitted bracketEntrants key leaves the pool and draw alone", async () => {
    // Same COALESCE-preserve posture as bracket_config: only a bracket speaks for
    // these, so another format's save must not empty them.
    const gameId = await seeded("Omitted");
    const before = await entrantsOf(gameId);
    await save(gameId, { name: "Renamed", omitEntrants: true });
    expect((await entrantsOf(gameId)).map((e) => e.created_at)).toEqual(before.map((e) => e.created_at));
    expect(await drawOf(gameId)).toHaveLength(3);
  });
});

describe("saveConfig — HAS_PICKS, the bracket's destroys tier", () => {
  /** Record a result the way phase 3 will, so the guard sees a real pick. */
  async function recordWinner(gameId: string) {
    const first = (await drawOf(gameId)).find((m) => m.round === 1 && m.entrant_b_id !== null)!;
    await ctx.admin.from("bracket_matches").update({ winner_entrant_id: first.entrant_a_id }).eq("id", first.id as string);
  }

  it("refuses a structural change once a winner is recorded", async () => {
    const gameId = await seeded("Has picks");
    await recordWinner(gameId);
    await expect(
      save(gameId, { entrants: [...threeEntrants(), { seed: 4, teamId, userIds: [outsider] }], draw: buildDraw(4) as DrawMatch[] })
    ).rejects.toThrow(/already has results/i);
  });

  it("…but a NON-structural save still lands — the guard is dirty-gated, not key-gated", async () => {
    // The settings page re-sends its whole draft on every save, so a rename
    // carries an unchanged pool and draw with it. Refusing that would make a
    // bracket's settings editable in name only — the same trap 111 fixed for
    // finalized games.
    const gameId = await seeded("Rename with picks");
    await recordWinner(gameId);
    await save(gameId, { name: "Renamed mid-play", entrants: threeEntrants(), draw: buildDraw(3) as DrawMatch[] });
    const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
    expect(g.name).toBe("Renamed mid-play");
  });

  it("the refusal leaves the recorded result intact — the write is atomic", async () => {
    const gameId = await seeded("Atomic refusal");
    await recordWinner(gameId);
    const before = await drawOf(gameId);
    await expect(save(gameId, { entrants: threeEntrants().slice(0, 2), draw: buildDraw(2) as DrawMatch[] })).rejects.toThrow();
    expect(await drawOf(gameId)).toEqual(before);
  });
});

describe("saveConfig — the payload pre-flight refuses an inconsistent bracket", () => {
  it("a draw placing a seed that isn't in the field", async () => {
    const gameId = await seeded("Unknown seed");
    await expect(
      save(gameId, { entrants: threeEntrants(), draw: [{ bracket: "main", round: 1, slot: 1, aSeed: 1, bSeed: 9 }] })
    ).rejects.toThrow(/isn't in the field/i);
  });

  it("two entrants on one seed", async () => {
    const gameId = await seeded("Dup seed");
    await expect(
      save(gameId, { entrants: [{ seed: 1, teamId, userIds: [owner] }, { seed: 1, teamId, userIds: [planner] }], draw: [] })
    ).rejects.toThrow(/both seeded 1/i);
  });

  it("an entrant with no team — a standalone bracket, refused in the APP not the schema", async () => {
    // Migration 116 made `bracket_entrants.team_id` nullable on purpose: a
    // standalone bracket (no competition, so no teams) is a shape we intend to
    // support, just not yet. The refusal is therefore a product-scope rule in
    // the tRPC front door, not a NOT NULL column — one guard to delete later
    // instead of a migration against a table holding live brackets.
    //
    // This test is the pin on WHERE the refusal lives. If someone re-adds the
    // constraint to the schema it still passes, which is why the message is
    // asserted too: a DB-level failure would not carry this copy.
    const gameId = await seeded("Teamless");
    await expect(
      save(gameId, {
        entrants: [{ seed: 1, teamId: null, userIds: [owner] }, ...threeEntrants().slice(1)],
        draw: buildDraw(3) as DrawMatch[],
      })
    ).rejects.toThrow(/every entrant must belong to a team/i);
  });

  it("a draw sent without the field it draws from", async () => {
    // Would otherwise be accepted and then silently ignored — the RPC gates the
    // whole block on `bracketEntrants` — which is the worst of the three outcomes.
    const gameId = await seeded("Lone draw");
    await expect(save(gameId, { omitEntrants: true, draw: buildDraw(3) as DrawMatch[] })).rejects.toThrow(
      /without the field/i
    );
  });
});

describe("saveConfig — hash invariant: every bracket field moves, none churns", () => {
  // The behavioural half of #16, per the rule that a field added to
  // save_game_config gets a row here. The no-churn re-write is the SAME resulting
  // config sent again — which for a bracket is a genuine no-op write, since the
  // RPC skips the rebuild rather than repeating it.
  const cases: { field: string; change: () => { entrants: BracketEntrant[]; draw: DrawMatch[] } }[] = [
    {
      field: "bracket_entrants.seed (the field grows)",
      change: () => ({ entrants: [...threeEntrants(), { seed: 4, teamId, userIds: [outsider] }], draw: buildDraw(4) as DrawMatch[] }),
    },
    {
      field: "bracket_entrant_members.user_id (a substitution)",
      change: () => ({
        entrants: [{ seed: 1, teamId, userIds: [outsider] }, ...threeEntrants().slice(1)],
        draw: buildDraw(3) as DrawMatch[],
      }),
    },
    {
      field: "bracket_matches.entrant_a_id (a re-seed)",
      change: () => ({
        entrants: threeEntrants(),
        draw: (buildDraw(3) as DrawMatch[]).map((m) =>
          m.round === 1 && m.slot === 1 ? { ...m, aSeed: 2 } : m.round === 1 && m.slot === 2 ? { ...m, aSeed: 1, bSeed: 3 } : m
        ),
      }),
    },
    {
      field: "bracket_matches (bracket/round/slot — the consolation row appears)",
      change: () => ({ entrants: threeEntrants(), draw: buildDraw(3, { consolation: true }) as DrawMatch[] }),
    },
  ];

  it.each(cases)("$field — moves on change, no churn on re-write", async ({ change }) => {
    const gameId = await seeded("Hash guard");
    const before = await hashOf(gameId);

    const slice = change();
    await save(gameId, slice);
    const afterChange = await hashOf(gameId);
    expect(afterChange).not.toBe(before);

    await save(gameId, slice);
    expect(await hashOf(gameId)).toBe(afterChange);
  });

  it("a TEAM change moves the hash — it decides where the entrant's points land", async () => {
    const gameId = await seeded("Team hash");
    const other = await ctx.createTeam(competitionId, "Other Team");
    const before = await hashOf(gameId);
    await save(gameId, {
      entrants: [{ seed: 1, teamId: other, userIds: [owner] }, ...threeEntrants().slice(1)],
      draw: buildDraw(3) as DrawMatch[],
    });
    expect(await hashOf(gameId)).not.toBe(before);
  });

  it("repeated reads of one state hash identically, with MULTI-member entrants", async () => {
    // The embed's ordering contract, pinned at runtime rather than trusted.
    // `bracket_entrant_members` is folded into the hash as an embedded select
    // ordered by `user_id`; if PostgREST returned those rows in an arbitrary
    // order, two reads of identical state would hash differently and every
    // device would see a phantom "config changed" forever — while a no-op save
    // test would still pass, because a skipped rebuild never reorders anything.
    // Partners (two members per entrant) is the only shape where order exists to
    // get wrong, which is why this case uses it rather than the singles fixture.
    const gameId = await newBracketGame("Embed order");
    const pairs: BracketEntrant[] = [
      { seed: 1, teamId, userIds: [owner, planner] },
      { seed: 2, teamId, userIds: [member, outsider] },
    ];
    await save(gameId, { entrants: pairs, draw: buildDraw(2) as DrawMatch[] });
    const reads = await Promise.all([hashOf(gameId), hashOf(gameId), hashOf(gameId)]);
    expect(new Set(reads).size).toBe(1);
  });

  /**
   * The place ceiling is checked against the field THIS SAVE establishes, not
   * the one already on disk.
   *
   * The settings page commits the pool and the placement split in one atomic
   * call (#18), so reading the stored pool asks about a state that no longer
   * exists by the time the write lands — and the ceiling for a game with no
   * entrants yet falls through to the TEAM count, which for a bracket is both
   * smaller and the wrong question. Building the field and its payout together
   * is the ordinary first setup, so it must not be the one thing that can't be
   * saved.
   */
  describe("the places ceiling reads the INCOMING field", () => {
    /** Four singles entrants — one per shared test user, so the field is larger
     *  than the competition's team count and the two ceilings differ. */
    function fourEntrants(): BracketEntrant[] {
      return [
        { seed: 1, teamId, userIds: [owner] },
        { seed: 2, teamId, userIds: [planner] },
        { seed: 3, teamId, userIds: [member] },
        { seed: 4, teamId, userIds: [outsider] },
      ];
    }

    it("a field and a split sized to it save TOGETHER, from nothing", async () => {
      const gameId = await newBracketGame("Field and split together");
      await save(gameId, {
        entrants: fourEntrants(),
        draw: buildDraw(4) as DrawMatch[],
        pointsTotal: 10,
        distribution: { type: "placement", values: [4, 3, 2, 1] },
      });
      const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
      expect(g.points_distribution).toEqual({ type: "placement", values: [4, 3, 2, 1] });
      expect(await entrantsOf(gameId)).toHaveLength(4);
    });

    it("still refuses a split with more places than that field — and names ENTRANTS", async () => {
      const gameId = await newBracketGame("Split past the field");
      await expect(
        save(gameId, {
          entrants: fourEntrants(),
          draw: buildDraw(4) as DrawMatch[],
          pointsTotal: 10,
          distribution: { type: "placement", values: [4, 3, 1, 1, 1] },
        })
      ).rejects.toThrow(/4 entrants/);
    });

    it("an emptied pool falls back to the TEAM ceiling in the same breath", async () => {
      // Clearing the field means the game ranks teams again the moment this save
      // lands, so that is the ceiling to hold it to — not "a bracket with no
      // entrants", which has no ceiling at all and would wave anything through.
      const gameId = await seeded("Cleared falls back to teams");
      await expect(
        save(gameId, {
          entrants: [],
          draw: [],
          pointsTotal: 10,
          distribution: { type: "placement", values: [4, 3, 2, 1] },
        })
      ).rejects.toThrow(/competition/);
    });
  });

  it("a WINNER does NOT move the hash — a pick is a score, not config", async () => {
    // The deliberate exclusion, pinned so it isn't "fixed" later. Hashing a pick
    // would refetch every open device's whole config on each advance AND fail a
    // concurrent settings save — refusing a rename because of a result. Picks
    // propagate by broadcast (#20) in phase 3.
    const gameId = await seeded("Winner not hashed");
    const before = await hashOf(gameId);
    const first = (await drawOf(gameId)).find((m) => m.round === 1 && m.entrant_b_id !== null)!;
    await ctx.admin.from("bracket_matches").update({ winner_entrant_id: first.entrant_a_id }).eq("id", first.id as string);
    expect(await hashOf(gameId)).toBe(before);
  });
});
