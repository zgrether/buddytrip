import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Pick'em proxy entry (migration 163) — someone entering a sheet for a person
 * who cannot, or did not.
 *
 * ── Why it exists at all ───────────────────────────────────────────────────
 *
 * `pickem_picks_write` requires `user_id = auth.uid()`, and a placeholder has
 * no `auth.uid()`. So a guest's sheet can ONLY ever be written by someone else.
 * That is not a limitation this works around — it is the mechanism, and without
 * it every placeholder scores home-team defaults.
 *
 * ── Driven through PostgREST, not tRPC ─────────────────────────────────────
 *
 * The 2026-08-20 RLS audit's central lesson: a test that goes through the
 * callers cannot see a policy wider than its callers. Every case here uses
 * `authedClient` — anon key plus a real Bearer token, exactly what a
 * participant's browser holds.
 *
 * ── The three suites that would pass against a wrong build ─────────────────
 *
 * Named in the spec, and each has a case here written specifically to fail it:
 *
 *   1. "only same-team proxying"  passes against a function with NO team check
 *      → CROSS-TEAM, below: the captain is refused for the other side.
 *   2. "only runs as staff"       passes against a captain arm that never works
 *      → the captain cases run as `member`, who holds no trip role at all.
 *   3. "never checks a participant" passes against a policy widened too far
 *      → `outsider` is a plain participant ON the captain's own team, so only
 *        captaincy — not team membership — can be what refuses them.
 *
 * Mutation-verified rather than asserted: see the block comment on the
 * cross-team case for what was changed and what went red.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
/** In the cup, with teams — the game the captain arm can actually reach. */
let cupGameId: string;
let slate1: string;
let slate2: string;
/** No competition at all — the captain arm must return false, not error. */
let soloGameId: string;
let soloSlate: string;

let teamA: string;
let teamB: string;
/** A placeholder: a `public.users` row with no auth user. The whole point. */
let guestId: string;
/** A real, plain participant on the captain's OWN team. Not a captain. */
let teammateId: string;
/** A real participant on the OTHER team. */
let opponentId: string;
/** On no trip at all — the target-membership check needs someone genuinely
 *  absent, and every shared test user is now on this one. */
let strangerId: string;

const HOUR = 3_600_000;

/** A complete sheet for a two-game slate, ranks 1..2. */
const sheet = (a: "away" | "home", b: "away" | "home") => [
  { slateGameId: slate1, pick: a, confidence: 2 },
  { slateGameId: slate2, pick: b, confidence: 1 },
];

describe("pick'em proxy entry (migration 163)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Proxy Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    // A plain participant WITH an account, on the captain's own team. Needed
    // because the non-captain teammates below are bare `users` rows that cannot
    // authenticate — and "a non-captain is refused" is unaskable without a
    // reader who is genuinely on that team and genuinely not its captain.
    await ctx.addTripMember(tripId, "outsider", "Member");
    competitionId = await ctx.createCompetition(tripId, "Proxy Cup");

    // Three extra people. The guest is the reason this feature exists; the two
    // real ones let a captain's own-team and other-team cases be distinguished
    // without either of them being staff.
    guestId = genId("guest");
    teammateId = genId("mate");
    opponentId = genId("opp");
    strangerId = genId("stranger");
    await ctx.admin.from("users").insert([
      { id: guestId, name: "Ghost Guest", is_guest: true },
      { id: teammateId, name: "Real Teammate", is_guest: false },
      { id: opponentId, name: "Real Opponent", is_guest: false },
      // Deliberately never added to the trip.
      { id: strangerId, name: "Not On This Trip", is_guest: false },
    ]);
    await ctx.addTripMemberById(tripId, guestId);
    await ctx.addTripMemberById(tripId, teammateId);
    await ctx.addTripMemberById(tripId, opponentId);

    teamA = genId("team");
    teamB = genId("team");
    // ASSERTED. color_dim is NOT NULL and was omitted in the first version of
    // this file: the teams insert failed, the assignments FK'd to nothing, and three
    // cases reported "the captain arm is broken" when the captain simply did
    // not exist. A seed that can fail silently turns a fixture bug into a
    // policy bug, which is the most expensive kind to chase.
    const teamSeed = await ctx.admin.from("teams").insert([
      { id: teamA, competition_id: competitionId, name: "Team A", short_name: "TA",
        color: "#111111", color_dim: "#050505" },
      { id: teamB, competition_id: competitionId, name: "Team B", short_name: "TB",
        color: "#222222", color_dim: "#0a0a0a" },
    ]);
    expect(teamSeed.error).toBeNull();

    // `member` CAPTAINS team A. They hold no trip role beyond Member, which is
    // what makes the captain arm the only thing that can be admitting them.
    const assignSeed = await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, team_id: teamA,
        user_id: ctx.getUser("member").id, sort_order: 0, is_captain: true },
      { competition_id: competitionId, team_id: teamA,
        user_id: guestId, sort_order: 1, is_captain: false },
      { competition_id: competitionId, team_id: teamA,
        user_id: teammateId, sort_order: 2, is_captain: false },
      { competition_id: competitionId, team_id: teamA,
        user_id: ctx.getUser("outsider").id, sort_order: 3, is_captain: false },
      { competition_id: competitionId, team_id: teamB,
        user_id: opponentId, sort_order: 0, is_captain: false },
    ]);
    expect(assignSeed.error).toBeNull();

    // The captain actually exists — the positive control the three failures
    // above had no way to distinguish from a refusal.
    const capCheck = await ctx.admin.from("team_assignments").select("user_id")
      .eq("team_id", teamA).eq("is_captain", true);
    expect((capCheck.data ?? []).map((r) => r.user_id)).toEqual([ctx.getUser("member").id]);

    cupGameId = genId("pxgame");
    await ctx.admin.from("games").insert({
      id: cupGameId, trip_id: tripId, competition_id: competitionId,
      game_type_id: "gtt_pickem", name: "Cup Pick'em",
    });
    await ctx.admin.from("pickem_games").insert({ game_id: cupGameId, use_confidence: true });
    slate1 = genId("sl");
    slate2 = genId("sl");
    await ctx.admin.from("pickem_slate_games").insert([
      { id: slate1, game_id: cupGameId, display_order: 0, away_team: "Alabama", home_team: "Georgia", multiplier: 1 },
      { id: slate2, game_id: cupGameId, display_order: 1, away_team: "Ohio St", home_team: "Michigan", multiplier: 1 },
    ]);

    soloGameId = genId("pxsolo");
    await ctx.admin.from("games").insert({
      id: soloGameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Standalone Pick'em",
    });
    await ctx.admin.from("pickem_games").insert({ game_id: soloGameId, use_confidence: false });
    soloSlate = genId("sl");
    await ctx.admin.from("pickem_slate_games").insert({
      id: soloSlate, game_id: soloGameId, display_order: 0,
      away_team: "Solo", home_team: "Game", multiplier: 1,
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("games").delete().in("id", [cupGameId, soloGameId]);
    await ctx.admin.from("users").delete().in("id", [guestId, teammateId, opponentId, strangerId]);
    await ctx.cleanup();
  }, 60_000);

  /** Picks open, no deadline — the state every write case needs. */
  const openPicks = async (id = cupGameId) => {
    await ctx.admin
      .from("pickem_games")
      .update({
        picks_opened_at: new Date(Date.now() - HOUR).toISOString(),
        picks_locked_at: null,
        picks_deadline: null,
      })
      .eq("game_id", id);
  };

  beforeEach(async () => {
    await ctx.admin.from("pickem_picks").delete().eq("game_id", cupGameId);
    await ctx.admin.from("pickem_picks").delete().eq("game_id", soloGameId);
    await openPicks();
    await openPicks(soloGameId);
  });

  const proxy = (
    role: "owner" | "planner" | "member" | "outsider",
    target: string,
    picks: unknown,
    gameId = cupGameId
  ) =>
    ctx.authedClient(role).rpc("save_pickem_picks_for", {
      p_game_id: gameId,
      p_target_user_id: target,
      p_picks: picks,
    });

  const readSheet = async (target: string, gameId = cupGameId) => {
    const { data } = await ctx.admin
      .from("pickem_picks")
      .select("slate_game_id, pick, confidence, entered_by, user_id")
      .eq("game_id", gameId)
      .eq("user_id", target);
    return data ?? [];
  };

  const visibleTo = async (role: "owner" | "planner" | "member" | "outsider") => {
    const { data } = await ctx
      .authedClient(role)
      .from("pickem_picks")
      .select("user_id")
      .eq("game_id", cupGameId);
    return new Set((data ?? []).map((r) => r.user_id as string));
  };

  // ══ WRITE ════════════════════════════════════════════════════════════════

  describe("who can write for whom", () => {
    it("a CAPTAIN enters a sheet for a guest on their own team", async () => {
      // The feature's reason for existing, in one case: `member` is a plain
      // trip Member — no Owner, no Organizer, no delegate — and the guest has
      // no auth user, so neither of them could produce this row alone.
      const { error } = await proxy("member", guestId, sheet("away", "home"));
      expect(error).toBeNull();

      const rows = await readSheet(guestId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.entered_by === ctx.getUser("member").id)).toBe(true);
    });

    it("a CAPTAIN is REFUSED for the other team — the one hard boundary", async () => {
      /**
       * Mutation-verified: deleting the `tgt.team_id = cap.team_id` join
       * condition from `_pickem_can_proxy_for` — the exact "no team check"
       * wrong build the spec names — makes this case, and the cross-team READ
       * case below, go red while every other case in this file stays green.
       * Nothing else in the suite distinguishes the two builds.
       */
      const { error } = await proxy("member", opponentId, sheet("home", "away"));
      expect(error?.message ?? "").toContain("NOT_AUTHORIZED");
      expect(await readSheet(opponentId)).toHaveLength(0);
    });

    it("a NON-CAPTAIN on the SAME TEAM is refused for a teammate", async () => {
      /**
       * The only case that reads `cap.is_captain` — and it was MISLABELLED in
       * the first version of this file. It ran as an `outsider` who was not on
       * the trip at all, so it proved "a stranger is refused" while its name and
       * comment claimed it proved "a non-captain is refused". Same shape as the
       * bracket COMEBACK test in CLAUDE.md: a test whose name asserts a path its
       * body never takes, which is worse than no test because it stops anyone
       * looking again.
       *
       * `outsider` is now a plain Member of this trip AND on team A beside the
       * captain, so the only thing that can refuse them is captaincy. Deleting
       * `cap.is_captain` from the arm makes this the case that goes red.
       */
      const { error } = await ctx.authedClient("outsider").rpc("save_pickem_picks_for", {
        p_game_id: cupGameId, p_target_user_id: guestId, p_picks: sheet("away", "away"),
      });
      expect(error?.message ?? "").toContain("NOT_AUTHORIZED");
      expect(await readSheet(guestId)).toHaveLength(0);
    });

    it("OWNER, ORGANIZER and DELEGATE each enter for anyone", async () => {
      expect((await proxy("owner", opponentId, sheet("away", "home"))).error).toBeNull();
      expect((await proxy("planner", guestId, sheet("home", "away"))).error).toBeNull();
      expect(await readSheet(opponentId)).toHaveLength(2);
      expect(await readSheet(guestId)).toHaveLength(2);

      // The delegate arm, on the standalone game so it cannot be the captain
      // arm quietly admitting them: `soloGameId` has no competition and
      // therefore no teams at all.
      await ctx.admin.from("game_delegates").insert({
        game_id: soloGameId, user_id: ctx.getUser("member").id,
        granted_by: ctx.getUser("owner").id,
      });
      const { error } = await proxy(
        "member", opponentId, [{ slateGameId: soloSlate, pick: "away", confidence: null }], soloGameId
      );
      expect(error).toBeNull();
      expect(await readSheet(opponentId, soloGameId)).toHaveLength(1);
      await ctx.admin.from("game_delegates").delete().eq("game_id", soloGameId);
    });

    it("a game with NO COMPETITION returns false from the captain arm, not an error", async () => {
      // `member` captains team A, but `soloGameId` has no competition — so the
      // arm's two EXISTS are empty rather than throwing. A null competition_id
      // reaching a join is the shape that would otherwise surface as a 500.
      const { error } = await proxy(
        "member", guestId, [{ slateGameId: soloSlate, pick: "home", confidence: null }], soloGameId
      );
      expect(error?.message ?? "").toContain("NOT_AUTHORIZED");
      expect(await readSheet(guestId, soloGameId)).toHaveLength(0);
    });

    it("refuses a target who is not on the trip", async () => {
      // `_pickem_can_proxy_for` answers about the ACTOR. Without the separate
      // membership check on the TARGET, an Owner could mint a sheet for any
      // user id in the database — and ids are not secrets (audit finding F1).
      // `strangerId` rather than a shared test user: `outsider` is now a Member
      // of this trip (it had to be, to ask the non-captain question), so aiming
      // at them stopped testing anything — the case went green-to-red the moment
      // that fixture changed, which is the only reason it was noticed.
      const { error } = await proxy("owner", strangerId, sheet("away", "home"));
      expect(error?.message ?? "").toContain("NOT_A_MEMBER");
    });

    it("is refused AFTER THE LOCK, like every other edit", async () => {
      await ctx.admin
        .from("pickem_games")
        .update({ picks_locked_at: new Date(Date.now() - HOUR).toISOString() })
        .eq("game_id", cupGameId);

      const { error } = await proxy("owner", guestId, sheet("away", "home"));
      expect(error?.message ?? "").toContain("PICKS_CLOSED");
      expect(await readSheet(guestId)).toHaveLength(0);
    });

    it("validates the sheet exactly as self-entry does — one body, not two", async () => {
      /**
       * The core is shared, so a rejected sheet must fail identically here. If
       * the proxy path ever grew its own copy of the validation this is what
       * would notice, because a copy is where the two would first disagree.
       *
       * It used to probe with an INCOMPLETE sheet, which migration 166 makes
       * legal — a partial sheet is now a normal thing to save, and this case
       * was asserting the absence of that feature from the other side of the
       * app. It probes with a DUPLICATE instead: the check 166 had to make
       * explicit, running through the same shared body.
       */
      const dup = [
        { slateGameId: slate1, pick: "away", confidence: 2 },
        { slateGameId: slate1, pick: "home", confidence: 1 },
      ];
      expect((await proxy("owner", guestId, dup)).error?.message ?? "").toContain(
        "DUPLICATE_PICK"
      );
    });

    it("accepts a PARTIAL sheet for somebody else, exactly as for yourself", async () => {
      /**
       * The pair, and the half that would otherwise go untested from this side:
       * a captain entering for a teammate who is halfway through is the whole
       * reason partial saves matter to proxy entry.
       *
       * Without this, a build that kept a completeness gate on the proxy path
       * alone would pass everything above — which is precisely the "one body,
       * not two" claim failing in the direction the old case could not see.
       */
      const { error } = await proxy("owner", guestId, [
        { slateGameId: slate1, pick: "away", confidence: 1 },
      ]);
      expect(error).toBeNull();
    });
  });

  // ══ entered_by ═══════════════════════════════════════════════════════════

  describe("entered_by", () => {
    it("SELF-entry stamps the actor, so proxy derives as entered_by <> user_id", async () => {
      // Not NULL-for-self. A NULL meaning "self" becomes indistinguishable from
      // "row predates the column", which every existing row genuinely is.
      const { error } = await ctx
        .authedClient("member")
        .rpc("save_pickem_picks", { p_game_id: cupGameId, p_picks: sheet("home", "home") });
      expect(error).toBeNull();

      const rows = await readSheet(ctx.getUser("member").id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.entered_by === ctx.getUser("member").id)).toBe(true);
      expect(rows.every((r) => r.entered_by === r.user_id)).toBe(true);
    });

    it("cannot be FORGED — it is read from auth.uid(), never taken as a parameter", async () => {
      // The core is executable by `authenticated` (the self path needs it), so
      // this asks the question that grant raises: can a caller stamp someone
      // else's name on their own sheet? Only if the actor were a parameter.
      const { error } = await ctx.authedClient("member").rpc("_pickem_write_sheet", {
        p_game_id: cupGameId,
        p_user_id: ctx.getUser("member").id,
        p_picks: sheet("away", "away"),
      });
      expect(error).toBeNull();
      const rows = await readSheet(ctx.getUser("member").id);
      expect(rows.every((r) => r.entered_by === ctx.getUser("member").id)).toBe(true);
    });

    it("a direct call to the core for ANOTHER person is refused by RLS", async () => {
      // Why granting the core to `authenticated` is safe: it is SECURITY
      // INVOKER, so a direct call runs as the caller and `pickem_picks_write`
      // still requires `user_id = auth.uid()`. The rows simply never land.
      await ctx.authedClient("member").rpc("_pickem_write_sheet", {
        p_game_id: cupGameId,
        p_user_id: opponentId,
        p_picks: sheet("away", "away"),
      });
      expect(await readSheet(opponentId)).toHaveLength(0);
    });
  });

  // ══ READ FOLLOWS WRITE ═══════════════════════════════════════════════════

  describe("reading a sheet you may write", () => {
    beforeEach(async () => {
      // A sheet for everyone, written as admin so no policy is involved in the
      // setup of a test about policies.
      for (const uid of [guestId, teammateId, opponentId, ctx.getUser("owner").id]) {
        await ctx.admin.from("pickem_picks").insert([
          { id: genId("pk"), game_id: cupGameId, slate_game_id: slate1, user_id: uid, pick: "away", confidence: 2 },
          { id: genId("pk"), game_id: cupGameId, slate_game_id: slate2, user_id: uid, pick: "home", confidence: 1 },
        ]);
      }
    });

    it("a CAPTAIN reads their own team's sheets", async () => {
      const seen = await visibleTo("member");
      expect(seen.has(guestId)).toBe(true);
      expect(seen.has(teammateId)).toBe(true);
    });

    it("a CAPTAIN does NOT read the other team's — before the reveal", async () => {
      // The boundary the whole design rests on. Same mutation as the write
      // case: drop the team join and this goes red.
      const seen = await visibleTo("member");
      expect(seen.has(opponentId)).toBe(false);
      // ...nor is it reachable by asking for it directly.
      const { data } = await ctx
        .authedClient("member")
        .from("pickem_picks")
        .select("pick, confidence")
        .eq("game_id", cupGameId)
        .eq("user_id", opponentId);
      expect(data ?? []).toEqual([]);
    });

    it("a plain PARTICIPANT on the captain's team reads nobody else", async () => {
      // The third wrong-build guard: a suite that never checks a participant
      // passes against a policy widened too far. `outsider` is a Member of this
      // trip and sits on team A next to the captain — so a policy keyed on
      // same-TEAM rather than same-team-AND-captain would show them the guest
      // and the teammate here.
      const { data } = await ctx
        .authedClient("outsider")
        .from("pickem_picks")
        .select("user_id")
        .eq("game_id", cupGameId);
      expect(data ?? []).toEqual([]);
    });

    it("STAFF read every sheet", async () => {
      const seen = await visibleTo("owner");
      expect(seen.has(guestId)).toBe(true);
      expect(seen.has(opponentId)).toBe(true);
      expect((await visibleTo("planner")).has(opponentId)).toBe(true);
    });
  });

  // ══ SUBMISSION STATUS ════════════════════════════════════════════════════

  describe("pickem_sheet_status — a count, never a sheet", () => {
    it("tells a CAPTAIN who on their team has submitted, and nobody else", async () => {
      await proxy("member", guestId, sheet("away", "home"));

      const { data, error } = await ctx
        .authedClient("member")
        .rpc("pickem_sheet_status", { p_game_id: cupGameId });
      expect(error).toBeNull();

      const rows = (data ?? []) as { user_id: string; submitted: boolean }[];
      const byUser = new Map(rows.map((r) => [r.user_id, r.submitted]));

      expect(byUser.get(guestId)).toBe(true);
      expect(byUser.get(teammateId)).toBe(false);
      // The other team is ABSENT — not present-and-false, which would still
      // answer "has the opponent submitted".
      expect(byUser.has(opponentId)).toBe(false);
    });

    it("returns no column that could carry a pick", async () => {
      // §11: the count and the sheet read must not share a function. This is
      // that rule made mechanical — if someone widens the return type to
      // include picks "while they're in there", this fails.
      await proxy("member", guestId, sheet("away", "home"));
      const { data } = await ctx
        .authedClient("member")
        .rpc("pickem_sheet_status", { p_game_id: cupGameId });
      const keys = Object.keys(((data ?? []) as object[])[0] ?? {});
      expect(keys.sort()).toEqual(["submitted", "user_id"]);
    });

    it("tells a plain participant about themselves and NOBODY else", async () => {
      // Exactly one row, not zero: a participant can always proxy for himself,
      // so the self arm should put him in his own list. Asserting `[]` would
      // pass against a function that returned nothing to anybody — and it did,
      // while `outsider` was not on the trip.
      const { data, error } = await ctx
        .authedClient("outsider")
        .rpc("pickem_sheet_status", { p_game_id: cupGameId });
      expect(error).toBeNull();
      expect(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))
        .toEqual([ctx.getUser("outsider").id]);
    });
  });
});
