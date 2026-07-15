import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToDraft, configDraftToPayload, type ConfigDraft, type SaveConfigPayload } from "../../lib/configDraft";

/**
 * games.saveConfig — the atomic Save front door (Game Settings: Draft-Then-Save P1).
 *
 * This is the ONE write path for the whole settings page, so these lock the
 * properties the refactor rides on and that nothing else can catch:
 *
 *  1. **Optimistic concurrency** — a save is judged against the config hash the
 *     client OPENED with. That's the guard against two devices clobbering each other,
 *     and it's the reason the client freezes its baseHash while the draft is dirty.
 *  2. **Atomicity** — a not-ready go-live RAISEs and the WHOLE tx rolls back. No
 *     half-configured live game, no config landing without the flip it came with.
 *  3. **The freeze boundaries** — matches and course both refuse to change once
 *     scores exist (they'd orphan/rescore them), but ONLY when actually changed, so a
 *     game that kept its scores through a disable is still editable.
 *  4. **Delegates** — the RPC REPLACES the list from the payload for an Organizer.
 *     That made a `[]` payload a silent revoke (the bug the flip surfaced), and it
 *     must stay untouched for a delegate's own save (a delegate can't sub-delegate).
 *
 * The payload is built via the SAME pure `configDraftToPayload` the client uses, so
 * these exercise the real contract rather than a hand-rolled shape that could drift.
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

async function newGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MATCH_PLAY,
    name,
    competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

/** The client's exact seed path: server snapshot → draft baseline. */
async function draftOf(gameId: string): Promise<ConfigDraft> {
  const game = await ctx.caller().games.getById({ tripId, gameId });
  const delegates = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  return configToDraft(
    game as Parameters<typeof configToDraft>[0],
    [],
    delegates.map((d) => d.user_id)
  );
}

async function hashOf(gameId: string): Promise<string> {
  const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
  return hash;
}

/** A 1v1 match between owner and member — the minimum a match game needs to go live. */
const onePairedMatch = (draft: ConfigDraft): ConfigDraft => ({
  ...draft,
  matches: [{ matchNumber: 1, playersPerSide: 1, a: [owner], b: [member], handicap: 0, pointValue: null }],
});

/**
 * Take a fresh game live: one paired match + a points total + the flip, in ONE save.
 *
 * NB the baseline threading, which is load-bearing and easy to get wrong: the payload
 * must be built against the SEEDED draft (no matches), not against the edited one.
 * `matchesDirty` is computed draft-vs-baseline, so passing the already-paired draft as
 * its own baseline reports `false`, the RPC SKIPS the match write entirely, and the
 * go-live then correctly fails NOT_READY on a game with no matches. That's the
 * contract working — a client that under-reports just gets its match edits ignored.
 */
async function goLive(gameId: string): Promise<void> {
  const seeded = await draftOf(gameId); // matches: [] — the honest pre-write baseline
  const edited = { ...onePairedMatch(seeded), pointsTotal: 2, scoringEnabled: true };
  await ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: await hashOf(gameId),
    payload: configDraftToPayload(edited, seeded),
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig Cup");
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("score_entries").delete().eq("game_id", id);
    await ctx.admin.from("game_matches").delete().eq("game_id", id);
    await ctx.admin.from("game_participants").delete().eq("game_id", id);
    await ctx.admin.from("game_delegates").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

describe("saveConfig — optimistic concurrency", () => {
  it("a save carrying the CURRENT hash lands; the same hash replayed is then stale", async () => {
    const gameId = await newGame("Concurrency");
    const base = await hashOf(gameId);
    const draft = await draftOf(gameId);

    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: base,
      payload: configDraftToPayload({ ...draft, name: "Renamed Once" }, draft),
    });
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect(after.name).toBe("Renamed Once");

    // The write moved the config, so the hash it was judged against is now stale.
    // This is the cross-device clobber guard: B opened before A saved, so B's save
    // must be refused rather than silently overwrite A's.
    expect(base).not.toBe(await hashOf(gameId));
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: base,
        payload: configDraftToPayload({ ...draft, name: "Clobbered" }, draft),
      })
    ).rejects.toThrow(/changed on another device/i);
    // ...and the refused save wrote NOTHING.
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Renamed Once");
  });

  it("scoring_enabled is part of the hash — a stale go-live is caught", async () => {
    const gameId = await newGame("Hash covers scoring");
    const stale = await hashOf(gameId); // captured BEFORE the flip
    await goLive(gameId);

    // The flip itself moved the hash, so a save still holding the pre-flip base is
    // refused — this is why the client must never let its baseHash follow the poll.
    const live = await draftOf(gameId);
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: stale,
        payload: configDraftToPayload({ ...live, scoringEnabled: false }, live),
      })
    ).rejects.toThrow(/changed on another device/i);
  });
});

describe("saveConfig — the scoring_enabled state machine", () => {
  it("go-live is REFUSED and the whole save rolls back when the game isn't ready", async () => {
    const gameId = await newGame("Not ready");
    const draft = await draftOf(gameId); // no matches, no points → not ready
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload({ ...draft, name: "Should Not Land", scoringEnabled: true }, draft),
      })
    ).rejects.toThrow(/finish setting up/i);

    // Atomicity is the point: the NAME rode the same payload as the rejected flip,
    // so it must not have landed either.
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect(after.name).toBe("Not ready");
    expect((after as { scoring_enabled?: boolean }).scoring_enabled).toBe(false);
  });

  it("a live game refuses a settings save (true→true); disable (true→false) is allowed", async () => {
    const gameId = await newGame("Live guard");
    await goLive(gameId);

    const live = await draftOf(gameId);
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload({ ...live, name: "Edited While Live", scoringEnabled: true }, live),
      })
    ).rejects.toThrow(/live/i);

    // true→false disables without rewriting config — the name in that payload is ignored.
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...live, name: "Ignored On Disable", scoringEnabled: false }, live),
    });
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect((after as { scoring_enabled?: boolean }).scoring_enabled).toBe(false);
    expect(after.name).toBe("Live guard");
  });
});

describe("saveConfig — delegates (the flip's silent-revoke bug)", () => {
  it("an Organizer's save REPLACES the delegate list — so a [] payload revokes", async () => {
    const gameId = await newGame("Delegates");
    await ctx.caller().games.addOrganizer({ tripId, gameId, userId: member });
    expect((await ctx.caller().games.listOrganizers({ tripId, gameId })) as unknown[]).toHaveLength(1);

    // The bug: the client mirrored `delegates: []` while the RPC replaces from the
    // payload, so every Organizer's Save silently revoked the game's delegate.
    const draft = await draftOf(gameId);
    expect(draft.delegates).toEqual([member]); // the mirror must carry the REAL list

    // Round-tripping the seeded draft PRESERVES the delegate...
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...draft, name: "Delegates Kept" }, draft),
    });
    expect(
      ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id)
    ).toEqual([member]);

    // ...and an explicit clear still revokes (the row is a real editable field).
    const kept = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...kept, delegates: [] }, kept),
    });
    expect((await ctx.caller().games.listOrganizers({ tripId, gameId })) as unknown[]).toHaveLength(0);
  });

  it("a DELEGATE's own save leaves the delegate list untouched (no sub-delegation)", async () => {
    const gameId = await newGame("Delegate saves");
    await ctx.caller().games.addOrganizer({ tripId, gameId, userId: member });

    const asDelegate = ctx.callerAs("member");
    const game = await asDelegate.games.getById({ tripId, gameId });
    const draft = configToDraft(game as Parameters<typeof configToDraft>[0], [], []);
    // Even claiming a different delegate, the non-Organizer branch must not apply it.
    await asDelegate.games.saveConfig({
      tripId,
      gameId,
      baseHash: (await asDelegate.games.configHash({ tripId, gameId })).hash,
      payload: configDraftToPayload({ ...draft, name: "Delegate Edited", delegates: [outsider] }, draft),
    });

    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Delegate Edited");
    expect(
      ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id)
    ).toEqual([member]); // unchanged — never `outsider`
  });

  it("a plain member with no grant cannot save at all", async () => {
    const gameId = await newGame("Not yours");
    const draft = await draftOf(gameId);
    await expect(
      ctx.callerAs("outsider").games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload({ ...draft, name: "Hijacked" }, draft),
      })
    ).rejects.toThrow();
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Not yours");
  });
});

describe("saveConfig — the freeze boundaries once scores exist", () => {
  /** Put a real score row on the game so both freezes are armed. */
  async function scoreIt(gameId: string) {
    const matches = (await ctx.caller().matches.listByGame({ tripId, gameId })) as { matches: { id: string }[] };
    expect(matches.matches.length).toBeGreaterThan(0);
    await ctx.caller().scores.upsertEntry({
      tripId,
      gameId,
      participantId: owner,
      participantType: "user",
      unitLabel: "1",
      value: 4,
    });
  }

  it("refuses a MATCH rewrite once scores exist, but still allows an unrelated save", async () => {
    const gameId = await newGame("Match freeze");
    await goLive(gameId);
    await scoreIt(gameId);
    // Disable KEEPS scores — this is the state the guard has to stay usable in.
    const live = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...live, scoringEnabled: false }, live),
    });

    const withScores = await draftOf(gameId);
    const paired = onePairedMatch(withScores);
    // matchesDirty → the clean replace would mint new ids and orphan the score rows.
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload(
          { ...paired, matches: [{ ...paired.matches[0], b: [planner] }] },
          paired
        ),
      })
    ).rejects.toThrow(/scores are already entered/i);

    // ...but an unchanged match set is a no-op write, so the game stays editable.
    // This is exactly what keeps disable → fix a typo → re-enable working.
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...withScores, name: "Still Editable" }, withScores),
    });
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Still Editable");
  });

  it("refuses a COURSE change once scores exist (COURSE_LOCKED), gated on an actual change", async () => {
    const gameId = await newGame("Course freeze");
    await goLive(gameId);
    await scoreIt(gameId);
    const live = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...live, scoringEnabled: false }, live),
    });

    const withScores = await draftOf(gameId);
    // Mirrors applyCourse's own refusal — changing par/index under a scored round
    // would silently rescore it.
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload(
          { ...withScores, course: { id: "some-course-id", backId: null, scorecardSchema: { units: { count: 18 } } } },
          withScores
        ),
      })
    ).rejects.toThrow(/course/i);

    // An untouched course round-trips fine — the guard is change-gated, not blanket.
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...withScores, name: "Course Untouched" }, withScores),
    });
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Course Untouched");
  });
});

describe("saveConfig — the payload contract", () => {
  it("carries the back nine, and a blank name can never erase the title", async () => {
    const gameId = await newGame("Back nine");
    const draft = await draftOf(gameId);

    // W-9HOLE-01: back_course_id must round-trip or a composed two-nines 18 would
    // persist its schema and strand the back-nine identity.
    const payload: SaveConfigPayload = configDraftToPayload(
      { ...draft, course: { id: null, backId: null, scorecardSchema: null } },
      draft
    );
    expect(payload).toHaveProperty("backCourseId");

    // TWO layers, and they catch different things. An EMPTY name is stopped at the
    // zod floor (min(1))...
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: { ...payload, name: "" },
      })
    ).rejects.toThrow();

    // ...but WHITESPACE sails through zod (length 3), so the SQL's
    // COALESCE(NULLIF(btrim(...)), name) is the real guard: the save SUCCEEDS and the
    // title is preserved rather than erased. That's the defence-in-depth working, not
    // a rejection — assert the outcome that actually matters.
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: { ...payload, name: "   " },
    });
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("Back nine");
  });

  it("writes the whole page in one shot — name, rules, entry mode, modifiers, points", async () => {
    const gameId = await newGame("Everything");
    const draft = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload(
        {
          ...onePairedMatch(draft),
          name: "All At Once",
          rulesForToday: "no gimmes",
          entryMode: "outcome",
          modifiers: { glorious_holes: { holes: 3 } },
          pointsTotal: 6,
        },
        draft
      ),
    });

    const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
    expect(g.name).toBe("All At Once");
    expect(g.rules_for_today).toBe("no gimmes");
    expect(g.entry_mode).toBe("outcome");
    expect(g.modifiers).toEqual({ glorious_holes: { holes: 3 } });
    expect(Number(g.points_total)).toBe(6);
    // The even share is DERIVED at write time from the final draft (never snapshotted
    // from a stale match count) — 6 total ÷ 1 filled match.
    expect((g.points_distribution as { type: string; value: number }).type).toBe("per_match");
    expect((g.points_distribution as { value: number }).value).toBe(6);
    // Only fully-filled matches are written.
    const { matches } = (await ctx.caller().matches.listByGame({ tripId, gameId })) as { matches: unknown[] };
    expect(matches).toHaveLength(1);
  });
});
