import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToDraft, configDraftToPayload, type ConfigDraft, type DraftMatchConfig, type SaveConfigPayload } from "../../lib/configDraft";

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
  // Batched by table, NOT looped per game: this file makes a dozen-plus games, and a
  // per-game loop is 5+ sequential round-trips each — enough to blow vitest's 10s
  // hookTimeout and fail the file with every test passing. Children first
  // (game_participants → play_groups is ON DELETE SET NULL, so clear it before the
  // groups), mirroring the RPC's own clean-replace order.
  if (gameIds.length > 0) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("match_hole_outcomes").delete().in("game_id", gameIds);
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("play_groups").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

/**
 * configHash determinism — the assumption the whole draft-then-save model rests on.
 *
 * The hash is read twice for two different purposes and compared: `useConfigSync`
 * polls it (a change = another device edited the config) and `saveConfig` recomputes
 * it to judge the client's baseHash. If it were unstable for a FIXED state, both
 * consumers break in ways that look like anything but a hash bug — sync would fire
 * "config changed" on every poll, and Save would reject at random with "this game
 * changed on another device".
 *
 * `readGameConfigHash` fans out over four queries; the three LIST reads
 * (game_participants / play_groups / game_matches) each need a total ORDER BY or the
 * row order — and therefore the hash — is at Postgres's discretion. They order by
 * `user_id`, `id`, `id`; the schema makes each unique within a game
 * (UNIQUE(game_id, user_id) + the two primary keys), so each is a total order. These
 * tests hold that empirically, over the shapes where a tie could actually exist:
 * several matches, several participants, and play_groups.
 */
describe("configHash — determinism (the concurrency check rides on this)", () => {
  /** Read the hash N times back-to-back with NO writes in between. */
  async function hashRepeatedly(gameId: string, times = 5): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < times; i++) out.push(await hashOf(gameId));
    return out;
  }

  it("is stable across repeated reads — multiple matches + participants", async () => {
    const gameId = await newGame("Hash stable 1v1s");
    const seeded = await draftOf(gameId);
    // TWO matches so game_matches has >1 row to order, and four participants so
    // game_participants does too. A missing/partial ORDER BY has ties to get wrong.
    const edited: ConfigDraft = {
      ...seeded,
      pointsTotal: 4,
      matches: [
        { matchNumber: 1, playersPerSide: 1, a: [owner], b: [member], handicap: -1, pointValue: null },
        { matchNumber: 2, playersPerSide: 1, a: [planner], b: [outsider], handicap: 2, pointValue: 3 },
      ],
    };
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload(edited, seeded),
    });

    const hashes = await hashRepeatedly(gameId);
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is stable across repeated reads — a 2v2 (play_groups in the fan-out)", async () => {
    const gameId = await newGame("Hash stable 2v2");
    const seeded = await draftOf(gameId);
    // A 2v2 mints TWO play_groups and four participants — the only shape that
    // exercises the play_groups read at all.
    const edited: ConfigDraft = {
      ...seeded,
      pointsTotal: 2,
      matches: [
        { matchNumber: 1, playersPerSide: 2, a: [owner, planner], b: [member, outsider], handicap: 3, pointValue: null },
      ],
    };
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload(edited, seeded),
    });

    expect(new Set(await hashRepeatedly(gameId)).size).toBe(1);
  });

  it("but still MOVES on a real config write (it isn't stable by being constant)", async () => {
    // Guards the obvious way to pass the tests above: a hash that never changes is
    // perfectly stable and perfectly useless.
    const gameId = await newGame("Hash moves");
    const before = await hashOf(gameId);
    const seeded = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: before,
      payload: configDraftToPayload({ ...seeded, name: "Moved" }, seeded),
    });
    expect(await hashOf(gameId)).not.toBe(before);
  });

  it("MOVES on a delegate change — game_delegates is in the fan-out now", async () => {
    // The gap this closes: game_delegates is the last field the RPC writes that the
    // hash didn't see, so a cross-device delegate change was invisible to the
    // conflict check AND to useConfigSync — same class as the `.from("matches")` bug.
    const gameId = await newGame("Hash sees delegates");
    const before = await hashOf(gameId);
    const seeded = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: before,
      payload: configDraftToPayload({ ...seeded, delegates: [member] }, seeded),
    });
    expect(await hashOf(gameId)).not.toBe(before);
  });

  it("does NOT churn when the SAME delegate set is re-granted (created_at/granted_by excluded)", async () => {
    // The churn trap: save_game_config DELETE+INSERTs the whole delegate list on every
    // org save, re-minting granted_by (auth.uid()) and created_at (now()). Hashing
    // those would move the fingerprint on every save even when the delegate SET is
    // unchanged — false conflicts + phantom "config changed" on other devices. The
    // hash reads user_id ONLY, so a re-grant of the identical set is a no-op.
    const gameId = await newGame("Delegate re-grant");
    const seed = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...seed, delegates: [member] }, seed),
    });
    const afterGrant = await hashOf(gameId);

    // Re-save with the IDENTICAL delegate set → RPC re-mints granted_by/created_at.
    const now = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: afterGrant,
      payload: configDraftToPayload({ ...now, delegates: [member] }, now),
    });
    expect(await hashOf(gameId)).toBe(afterGrant); // unchanged — only user_id is hashed
  });
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

  it("a live game (true→true) writes name + rules but stays live and leaves game config frozen", async () => {
    const gameId = await newGame("Live editable");
    await goLive(gameId);

    // 083: a live game staying live is no longer refused — it writes the fields that
    // can't rescore a completed hole (name / rules), ignores everything game-altering,
    // and stays live. Bundle a matches change into the SAME payload to prove it's
    // ignored rather than applied.
    const live = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload(
        {
          ...onePairedMatch(live),
          name: "Renamed While Live",
          rulesForToday: "no gimmes after 5pm",
          scoringEnabled: true,
          matches: [{ matchNumber: 1, playersPerSide: 1, a: [planner], b: [outsider], handicap: 0, pointValue: null }],
        },
        live
      ),
    });
    const after = await ctx.caller().games.getById({ tripId, gameId }) as Record<string, unknown>;
    expect(after.name).toBe("Renamed While Live");
    expect(after.rules_for_today).toBe("no gimmes after 5pm");
    expect(after.scoring_enabled).toBe(true); // stayed live
    // The matchup in the payload was IGNORED — the live game still has its original
    // owner-vs-member pairing, not the planner-vs-outsider one bundled above.
    const { matches } = (await ctx.caller().matches.listByGame({ tripId, gameId })) as {
      matches: { side_a: { id: string } | null; side_b: { id: string } | null }[];
    };
    const ids = matches.flatMap((m) => [m.side_a?.id, m.side_b?.id]);
    expect(ids).toContain(owner);
    expect(ids).toContain(member);
    expect(ids).not.toContain(outsider);
  });

  it("a live game (true→true) can gain a delegate mid-round (Organizer write)", async () => {
    const gameId = await newGame("Live delegate");
    await goLive(gameId);
    expect((await ctx.caller().games.listOrganizers({ tripId, gameId })) as unknown[]).toHaveLength(0);

    const live = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      // Adding a co-scorer mid-round is exactly the case this exists for.
      payload: configDraftToPayload({ ...live, delegates: [member], scoringEnabled: true }, live),
    });
    expect(
      ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id)
    ).toEqual([member]);
    expect((await ctx.caller().games.getById({ tripId, gameId }) as { scoring_enabled?: boolean }).scoring_enabled).toBe(true);
  });

  it("disable (true→false) writes config in one atomic save", async () => {
    const gameId = await newGame("Disable writes");
    await goLive(gameId);
    const live = await draftOf(gameId);
    // true→false DISABLES AND WRITES CONFIG in one atomic save (migration 082).
    // Under 081 this branch returned early and the name was silently dropped — which
    // is why the settings rows couldn't unlock on a merely-staged Setup.
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...live, name: "Disabled And Renamed", scoringEnabled: false }, live),
    });
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect((after as { scoring_enabled?: boolean }).scoring_enabled).toBe(false);
    expect(after.name).toBe("Disabled And Renamed");
  });

  it("disable + a MATCH change on a scored game is refused atomically — the disable rolls back too", async () => {
    const gameId = await newGame("Disable with scores");
    await goLive(gameId);
    // A disable KEEPS scores, so this is the state the guard has to hold in.
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4,
    });

    const live = await draftOf(gameId);
    const paired = onePairedMatch(live);
    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: configDraftToPayload(
          { ...paired, scoringEnabled: false, matches: [{ ...paired.matches[0], b: [planner] }] },
          paired
        ),
      })
      // Actionable, and it names the real affordance — not the raw RAISE prefix.
    ).rejects.toThrow(/Reset scores in the game's Danger zone/i);

    // ATOMIC: the disable rode the same payload as the refused match edit, so it must
    // NOT have landed. The user resets the scores, or drops the edit and saves the
    // disable alone.
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect((after as { scoring_enabled?: boolean }).scoring_enabled).toBe(true);
  });

  it("disable + a non-match edit on a scored game DOES land (the guard is change-gated)", async () => {
    const gameId = await newGame("Disable keeps scores");
    await goLive(gameId);
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 5,
    });

    const live = await draftOf(gameId);
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: configDraftToPayload({ ...live, name: "Renamed On Disable", rulesForToday: "no gimmes", scoringEnabled: false }, live),
    });
    const after = await ctx.caller().games.getById({ tripId, gameId });
    expect((after as { scoring_enabled?: boolean }).scoring_enabled).toBe(false);
    expect(after.name).toBe("Renamed On Disable");
    expect((after as Record<string, unknown>).rules_for_today).toBe("no gimmes");
    // Scores are NEVER touched by a disable — that's what makes it non-destructive.
    const rows = (await ctx.caller().scores.listByGame({ tripId, gameId })) as unknown[];
    expect(rows.length).toBeGreaterThan(0);
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
      // Actionable copy naming the real affordance — not the raw RAISE prefix, and
      // not a restatement of the condition.
    ).rejects.toThrow(/Reset scores in the game's Danger zone/i);

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

describe("saveConfig — the STRUCTURE / FIELD split (084 warned tier)", () => {
  /** A draft whose matches mirror the live game's single owner-vs-member match, so a
   *  field-only edit (handicap / point override) is STRUCTURE-clean and takes the
   *  in-place path — the whole point of the split. */
  const withMatch = (draft: ConfigDraft, over: Partial<DraftMatchConfig> = {}): ConfigDraft => ({
    ...draft,
    matches: [{ matchNumber: 1, playersPerSide: 1, a: [owner], b: [member], handicap: 0, pointValue: null, ...over }],
  });

  it("a HANDICAP edit on a scored game SUCCEEDS and writes in place (warned, not refused)", async () => {
    const gameId = await newGame("Handicap warned");
    await goLive(gameId); // one match: owner vs member, handicap 0
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4,
    });

    // handicap 5 (positive → side B = member gets 5). Same SET, a FIELD differs, so
    // this is structure-clean → the in-place UPDATE, allowed with scores. Under the
    // old conflated `matchesDirty` this was refused as HAS_SCORES.
    const base = withMatch(await draftOf(gameId));
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: configDraftToPayload(withMatch(await draftOf(gameId), { handicap: 5 }), base),
    });

    // Persisted in place — the member's handicap_strokes moved, no clean-replace.
    const { data } = await ctx.admin.from("game_participants").select("user_id, handicap_strokes").eq("game_id", gameId);
    expect(new Map((data ?? []).map((p) => [p.user_id as string, p.handicap_strokes])).get(member)).toBe(5);
    // Game stayed live; scores untouched.
    expect((await ctx.caller().games.getById({ tripId, gameId }) as { scoring_enabled?: boolean }).scoring_enabled).toBe(true);
    expect(((await ctx.caller().scores.listByGame({ tripId, gameId })) as unknown[]).length).toBeGreaterThan(0);
  });

  it("a POINT OVERRIDE edit on a scored game SUCCEEDS in place", async () => {
    const gameId = await newGame("Point override warned");
    await goLive(gameId);
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4,
    });
    const base = withMatch(await draftOf(gameId));
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: configDraftToPayload(withMatch(await draftOf(gameId), { pointValue: 5 }), base),
    });
    const { data } = await ctx.admin.from("game_matches").select("point_value").eq("game_id", gameId);
    expect(Number((data ?? [])[0]?.point_value)).toBe(5);
  });

  it("ENTRY MODE change on a scored game is REFUSED — the third locked-tier guard", async () => {
    const gameId = await newGame("Entry mode locked");
    await goLive(gameId);
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4,
    });
    const live = await draftOf(gameId);
    await expect(
      ctx.caller().games.saveConfig({
        tripId, gameId, baseHash: await hashOf(gameId),
        payload: configDraftToPayload({ ...live, entryMode: "outcome" }, live),
      })
      // Actionable, names the affordance — not the raw ENTRY_MODE_LOCKED prefix.
    ).rejects.toThrow(/changing how it's scored/i);
    // Refused → entry_mode unchanged.
    expect((await ctx.caller().games.getById({ tripId, gameId }) as Record<string, unknown>).entry_mode).toBe("score");
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
