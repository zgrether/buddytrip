import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Regression guard for the 2026-08-20 RLS audit.
 *
 * Every case here runs through `authedClient` — a real JWT against PostgREST —
 * and NOT through tRPC. That is the whole point, and it is the audit's central
 * finding restated as a test file:
 *
 *   **A test that goes through the callers cannot see a policy wider than its
 *   callers.**
 *
 * Each of these gaps sat behind a correct, careful procedure. The app never did
 * the thing the policy permitted, so no caller-level test could fail and none
 * did — F1 survived three migrations that edited its own table. The only way to
 * see the difference between "what the procedures do" and "what the policies
 * allow" is to skip the procedures.
 *
 * So: when a policy is narrowed, pin it HERE, at the layer the attacker uses.
 * A tRPC test proves the caller is well-behaved; it proves nothing about the
 * policy behind it.
 *
 * Every assertion below was confirmed to FAIL before its migration (each was
 * first reproduced as a live attack inside a force-aborted transaction), so
 * none of them is vacuous — the failure mode where a check passes because it
 * cannot express what it is testing for.
 */

let ctx: TestContext;
let tripId: string;
let otherTripId: string;
let competitionId: string;
let otherCompetitionId: string;

describe("RLS audit 2026-08-20 — the closed findings stay closed", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    // Sequential, never Promise.all — these race and flake (CLAUDE.md).
    tripId = await ctx.createTrip("RLS Audit Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Audit Cup");

    // A second trip the outsider has nothing to do with.
    otherTripId = await ctx.createTrip("RLS Audit Other Trip");
    otherCompetitionId = await ctx.createCompetition(otherTripId, "Other Cup");
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  // ── F1 — users_select was USING (true) ──────────────────────────────────

  describe("F1 (migration 134) — users is not a directory", () => {
    it("an outsider cannot see a person from a trip they aren't on", async () => {
      // Keyed on a placeholder created for `otherTripId` rather than on one of
      // the four shared accounts: those accumulate memberships across the whole
      // suite, so "outsider cannot see owner" is not a stable fact about the
      // POLICY — the two genuinely do share trips, and seeing each other is
      // correct. A fresh person on a trip the outsider is not on is the same
      // question asked in a way the environment cannot answer by accident.
      const strangerId = `ghost-${genId()}`;
      await ctx.admin.from("users").insert({
        id: strangerId, name: "Stranger", is_guest: true, created_by: ctx.getUser("owner").id,
      });
      await ctx.addTripMemberById(otherTripId, strangerId, "Member");

      const outsider = await ctx
        .authedClient("outsider")
        .from("users").select("id").eq("id", strangerId);
      expect(outsider.error).toBeNull();
      expect(outsider.data ?? []).toEqual([]); // before migration 134: one row

      // The same read from someone who IS on that trip must still work, or the
      // policy is simply broken rather than narrowed.
      const insider = await ctx
        .authedClient("owner")
        .from("users").select("id").eq("id", strangerId);
      expect((insider.data ?? []).map((r) => r.id)).toEqual([strangerId]);

      await ctx.admin.from("users").delete().eq("id", strangerId);
    });

    it("an outsider can always see themselves", async () => {
      const outsiderId = ctx.getUser("outsider").id;
      const { data } = await ctx
        .authedClient("outsider")
        .from("users").select("id").eq("id", outsiderId);
      expect((data ?? []).map((r) => r.id)).toEqual([outsiderId]);
    });

    it("a member CAN still resolve everyone on their own trip", async () => {
      // The other half, and the one that would render as blank names rather
      // than an error if this were over-tightened.
      const { data: roster } = await ctx
        .authedClient("member")
        .from("trip_members")
        .select("user_id, users!inner(id, name)")
        .eq("trip_id", tripId);
      const rows = roster ?? [];
      expect(rows.length).toBeGreaterThan(0);
      // `!inner` drops the membership row entirely if the user is invisible,
      // which is how this would fail silently rather than loudly.
      const { count } = await ctx
        .authedClient("member")
        .from("trip_members")
        .select("*", { count: "exact", head: true })
        .eq("trip_id", tripId);
      expect(rows.length).toBe(count);
    });

    it("the sanctioned cross-trip lookup still answers for an unrelated address", async () => {
      // What `users_select` can no longer serve, and why it needed a definer
      // rather than a wider policy: invite-by-email must recognise an account
      // the caller shares no trip with.
      const owner = ctx.getUser("owner");
      const { data, error } = await ctx
        .authedClient("outsider")
        .rpc("lookup_user_by_email", { p_email: owner.email });
      expect(error).toBeNull();
      expect((data ?? []).map((r: { id: string }) => r.id)).toEqual([owner.id]);
    });

    it("...and returns nothing for an address that has no account", async () => {
      const { data } = await ctx
        .authedClient("outsider")
        .rpc("lookup_user_by_email", { p_email: `nobody-${genId()}@nowhere.test` });
      expect(data ?? []).toEqual([]);
    });
  });

  // ── F2 — the is_guest write arm was scoped to nothing ───────────────────

  describe("F2 (migration 133) — a placeholder belongs to its trip", () => {
    it("an outsider cannot rename a placeholder on a trip they aren't on", async () => {
      const ghostId = `ghost-${genId()}`;
      await ctx.admin.from("users").insert({
        id: ghostId, name: "Placeholder", is_guest: true, created_by: ctx.getUser("owner").id,
      });
      await ctx.addTripMemberById(tripId, ghostId, "Member");

      const { error, count } = await ctx
        .authedClient("outsider")
        .from("users")
        .update({ name: "DEFACED" }, { count: "exact" })
        .eq("id", ghostId);
      // Refused as "no such row" rather than an error — the row is not
      // reachable for write, which is the same outcome by a different route.
      expect(error === null ? count : 0).toBe(0);

      await ctx.admin.from("users").delete().eq("id", ghostId);
    });

    it("an outsider cannot repoint a placeholder's email at an address they control", async () => {
      // Chain step 2: with this open, signing up at the new address hands the
      // attacker that placeholder's trip_members row via the signup merge.
      const ghostId = `ghost-${genId()}`;
      await ctx.admin.from("users").insert({
        id: ghostId, name: "Placeholder", is_guest: true, created_by: ctx.getUser("owner").id,
      });
      await ctx.addTripMemberById(tripId, ghostId, "Member");

      const { error, count } = await ctx
        .authedClient("outsider")
        .from("users")
        .update({ email: `attacker-${genId()}@evil.test` }, { count: "exact" })
        .eq("id", ghostId);
      expect(error === null ? count : 0).toBe(0);

      await ctx.admin.from("users").delete().eq("id", ghostId);
    });

    it("an outsider cannot forge a placeholder as somebody else's work", async () => {
      const { error } = await ctx.authedClient("outsider").from("users").insert({
        id: `ghost-${genId()}`,
        name: "Forged",
        is_guest: true,
        created_by: ctx.getUser("owner").id, // not the caller
      });
      expect(error).not.toBeNull();
    });
  });

  // ── F3 — invites had FOR UPDATE USING (true) ────────────────────────────

  describe("F3 (migration 136) — invites are not editable", () => {
    it("a member cannot rewrite their own trip's invite", async () => {
      const inviteId = crypto.randomUUID();
      await ctx.admin.from("invites").insert({
        id: inviteId, trip_id: tripId, email: `pending-${genId()}@example.com`,
        role: "Member", created_by: ctx.getUser("owner").id,
      });

      const { error, count } = await ctx
        .authedClient("member")
        .from("invites")
        .update({ role: "Organizer" }, { count: "exact" })
        .eq("id", inviteId);
      expect(error === null ? count : 0).toBe(0);

      // The role really is untouched, not merely unreported.
      const { data } = await ctx.admin.from("invites").select("role").eq("id", inviteId).single();
      expect(data?.role).toBe("Member");

      await ctx.admin.from("invites").delete().eq("id", inviteId);
    });
  });

  // ── F6 / F7 — submitted_by was unconstrained ────────────────────────────

  describe("F6/F7 (migration 136) — a score is signed by whoever wrote it", () => {
    let gameId: string;

    beforeAll(async () => {
      gameId = genId("game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_manual", name: "Provenance",
        status: "active", scoring_enabled: true,
        pairings_published_at: new Date().toISOString(),
      });
      await ctx.admin.from("game_participants").insert({
        id: genId("gp"), game_id: gameId, user_id: ctx.getUser("member").id,
      });
    }, 30_000);

    it("a member cannot sign a score as the trip owner", async () => {
      const { error } = await ctx.authedClient("member").from("score_entries").insert({
        id: genId("se"), game_id: gameId,
        participant_id: ctx.getUser("member").id, participant_type: "user",
        unit_label: "1", value: 4,
        submitted_by: ctx.getUser("owner").id, // forged
      });
      expect(error).not.toBeNull();
    });

    it("...but signs their own score fine", async () => {
      const id = genId("se");
      const { error } = await ctx.authedClient("member").from("score_entries").insert({
        id, game_id: gameId,
        participant_id: ctx.getUser("member").id, participant_type: "user",
        unit_label: "2", value: 4,
        submitted_by: ctx.getUser("member").id,
      });
      expect(error).toBeNull();
      await ctx.admin.from("score_entries").delete().eq("id", id);
    });

    it("an owner can still correct a score somebody else submitted", async () => {
      // The reason the new term is in WITH CHECK and not USING. Putting it in
      // USING would make this legitimate correction unreachable.
      const id = genId("se");
      await ctx.admin.from("score_entries").insert({
        id, game_id: gameId,
        participant_id: ctx.getUser("member").id, participant_type: "user",
        unit_label: "3", value: 4, submitted_by: ctx.getUser("member").id,
      });

      const { error, count } = await ctx
        .authedClient("owner")
        .from("score_entries")
        .update({ value: 9, submitted_by: ctx.getUser("owner").id }, { count: "exact" })
        .eq("id", id);
      expect(error).toBeNull();
      expect(count).toBe(1);

      await ctx.admin.from("score_entries").delete().eq("id", id);
    });

    it("a score whose submitter deleted their account stays correctable", async () => {
      // Migration 129 leaves submitted_by NULL on those rows; they must not
      // become permanently frozen by a provenance rule.
      const id = genId("se");
      await ctx.admin.from("score_entries").insert({
        id, game_id: gameId,
        participant_id: ctx.getUser("member").id, participant_type: "user",
        unit_label: "4", value: 4, submitted_by: null,
      });

      const { error, count } = await ctx
        .authedClient("owner")
        .from("score_entries")
        .update({ value: 7, submitted_by: ctx.getUser("owner").id }, { count: "exact" })
        .eq("id", id);
      expect(error).toBeNull();
      expect(count).toBe(1);

      await ctx.admin.from("score_entries").delete().eq("id", id);
    });
  });

  // ── F4 — a member could write their own share to any figure ─────────────

  describe("F4 (migration 137) — opting out is not setting what you owe", () => {
    let expenseId: string;

    beforeAll(async () => {
      expenseId = genId("exp");
      await ctx.admin.from("expenses").insert({
        id: expenseId, trip_id: tripId, title: "Dinner",
        amount: 90, paid_by_user_id: ctx.getUser("owner").id,
      });
      await ctx.admin.from("expense_splits").insert([
        { expense_id: expenseId, user_id: ctx.getUser("owner").id, amount: 45 },
        { expense_id: expenseId, user_id: ctx.getUser("member").id, amount: 45 },
      ]);
    }, 30_000);

    it("a member cannot write their own share down to an arbitrary figure", async () => {
      for (const amount of [1, -9999]) {
        const { error } = await ctx
          .authedClient("member")
          .from("expense_splits")
          .update({ amount })
          .eq("expense_id", expenseId)
          .eq("user_id", ctx.getUser("member").id);
        expect(error).not.toBeNull();
      }
    });

    it("...but can still opt out, and opt back in", async () => {
      const out = await ctx
        .authedClient("member")
        .from("expense_splits")
        .update({ opted_out: true, amount: 0 }, { count: "exact" })
        .eq("expense_id", expenseId).eq("user_id", ctx.getUser("member").id);
      expect(out.error).toBeNull();
      expect(out.count).toBe(1);

      const back = await ctx
        .authedClient("member")
        .from("expense_splits")
        .update({ opted_out: false, amount: null }, { count: "exact" })
        .eq("expense_id", expenseId).eq("user_id", ctx.getUser("member").id);
      expect(back.error).toBeNull();
      expect(back.count).toBe(1);
    });

    it("an owner can still write a real figure — the other policy arm", async () => {
      // Permissive policies OR, checks included, so the Owner never has to
      // satisfy the opt-out constraint. If this breaks, the fix caught the
      // wrong people.
      const { error, count } = await ctx
        .authedClient("owner")
        .from("expense_splits")
        .update({ amount: 60 }, { count: "exact" })
        .eq("expense_id", expenseId).eq("user_id", ctx.getUser("member").id);
      expect(error).toBeNull();
      expect(count).toBe(1);
    });
  });

  // ── F5 — anyone on the trip could add splits to anyone's receipt ────────

  describe("F5 (migration 140) — splits belong to the receipt's people", () => {
    it("a member cannot add a split to a receipt they neither own, paid, nor logged", async () => {
      const id = genId("exp");
      await ctx.admin.from("expenses").insert({
        id, trip_id: tripId, title: "Not mine", amount: 90,
        paid_by_user_id: ctx.getUser("owner").id,
        created_by: ctx.getUser("owner").id,
      });
      await ctx.admin.from("expense_splits").insert({
        expense_id: id, user_id: ctx.getUser("owner").id, amount: 45,
      });

      const { error } = await ctx.authedClient("member").from("expense_splits").insert({
        expense_id: id, user_id: ctx.getUser("outsider").id, amount: 999,
      });
      expect(error).not.toBeNull();
    });

    it("...but CAN insert splits for a receipt they logged, even if someone else paid", async () => {
      // The flow that made Owner-OR-payer unusable, and the reason migration 138
      // added `created_by`: "I'm recording that the owner paid for dinner."
      const id = genId("exp");
      const { error: expErr } = await ctx.authedClient("member").from("expenses").insert({
        id, trip_id: tripId, title: "I logged it", amount: 60,
        paid_by_user_id: ctx.getUser("owner").id,
        created_by: ctx.getUser("member").id,
      });
      expect(expErr).toBeNull();

      const { error } = await ctx.authedClient("member").from("expense_splits").insert([
        { expense_id: id, user_id: ctx.getUser("owner").id, amount: 30 },
        { expense_id: id, user_id: ctx.getUser("member").id, amount: 30 },
      ]);
      expect(error).toBeNull();
    });
  });

  // ── F8 / F9 — the captain arms ──────────────────────────────────────────

  describe("F8/F9 (migration 140) — captaincy is two doors, not row access", () => {
    let teamId: string;

    beforeAll(async () => {
      teamId = genId("team");
      await ctx.admin.from("teams").insert({
        id: teamId, competition_id: competitionId,
        name: "Alpha", short_name: "ALP", color: "#2dd4bf", color_dim: "#134e4a",
      });
      await ctx.admin.from("team_assignments").insert([
        { competition_id: competitionId, user_id: ctx.getUser("member").id, team_id: teamId, is_captain: true },
        { competition_id: competitionId, user_id: ctx.getUser("owner").id, team_id: teamId, is_captain: false },
      ]);
    }, 30_000);

    it("a captain cannot swap a teammate by writing the table", async () => {
      const { error, count } = await ctx
        .authedClient("member")
        .from("team_assignments")
        .update({ user_id: ctx.getUser("outsider").id }, { count: "exact" })
        .eq("team_id", teamId).eq("user_id", ctx.getUser("owner").id);
      expect(error === null ? count : 0).toBe(0);
    });

    it("a captain cannot move their team to another competition", async () => {
      const otherCup = await ctx.createCompetition(tripId, "Rival Cup");
      const { error, count } = await ctx
        .authedClient("member")
        .from("teams")
        .update({ competition_id: otherCup }, { count: "exact" })
        .eq("id", teamId);
      expect(error === null ? count : 0).toBe(0);
    });

    it("...and can no longer rename it by writing the table either", async () => {
      const { error, count } = await ctx
        .authedClient("member")
        .from("teams")
        .update({ name: "Direct" }, { count: "exact" })
        .eq("id", teamId);
      expect(error === null ? count : 0).toBe(0);
    });

    it("but a captain CAN still rename and recolour through the definer", async () => {
      // Nothing was taken away — the capability moved. If this breaks, the
      // narrowing removed a power captains are supposed to have.
      const { error } = await ctx.authedClient("member").rpc("update_team_identity", {
        p_team_id: teamId, p_name: "Renamed", p_short_name: "RNM",
        p_color: null, p_color_dim: null,
      });
      expect(error).toBeNull();

      const { data } = await ctx.admin
        .from("teams").select("name, competition_id").eq("id", teamId).single();
      expect(data?.name).toBe("Renamed");
      expect(data?.competition_id).toBe(competitionId); // and the cup did not move
    });

    it("...and CAN still reorder, but only with a genuine permutation", async () => {
      const roster = [ctx.getUser("owner").id, ctx.getUser("member").id];
      const ok = await ctx.authedClient("member").rpc("reorder_team_roster", {
        p_competition_id: competitionId, p_team_id: teamId, p_ordered_user_ids: roster,
      });
      expect(ok.error).toBeNull();

      // Swapping someone in through the reorder door is refused too — the
      // permutation check is what let reorder sit on the captain gate at all.
      const swap = await ctx.authedClient("member").rpc("reorder_team_roster", {
        p_competition_id: competitionId, p_team_id: teamId,
        p_ordered_user_ids: [ctx.getUser("outsider").id, ctx.getUser("member").id],
      });
      expect(swap.error).not.toBeNull();
    });

    it("trip staff are unaffected on both tables", async () => {
      const assignments = await ctx
        .authedClient("owner")
        .from("team_assignments")
        .update({ is_captain: false }, { count: "exact" })
        .eq("team_id", teamId).eq("user_id", ctx.getUser("member").id);
      expect(assignments.error).toBeNull();
      expect(assignments.count).toBe(1);

      const team = await ctx
        .authedClient("owner")
        .from("teams")
        .update({ name: "Owner Renamed" }, { count: "exact" })
        .eq("id", teamId);
      expect(team.error).toBeNull();
      expect(team.count).toBe(1);

      // put the captaincy back for any later case
      await ctx.admin.from("team_assignments")
        .update({ is_captain: true })
        .eq("team_id", teamId).eq("user_id", ctx.getUser("member").id);
    });
  });

  // ── F10 / F11 — games invariants ────────────────────────────────────────

  describe("F10/F11 (migration 135) — a game's competition and its go-live state", () => {
    it("a game cannot be moved into another trip's competition", async () => {
      const gameId = genId("game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_manual", name: "Cross trip",
      });

      const { error } = await ctx.admin
        .from("games")
        .update({ competition_id: otherCompetitionId })
        .eq("id", gameId);
      // Asserted through the ADMIN client on purpose: this is a constraint,
      // not a policy, so it must hold even where RLS does not apply.
      expect(error).not.toBeNull();

      await ctx.admin.from("games").delete().eq("id", gameId);
    });

    it("...but moves freely between competitions in its OWN trip", async () => {
      const secondCup = await ctx.createCompetition(tripId, "Second Cup");
      const gameId = genId("game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_manual", name: "Same trip",
      });

      const { error } = await ctx.admin
        .from("games")
        .update({ competition_id: secondCup })
        .eq("id", gameId);
      expect(error).toBeNull();

      await ctx.admin.from("games").delete().eq("id", gameId);
    });

    it("scoring cannot be opened on a game that is neither announced nor started", async () => {
      const gameId = genId("game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_manual", name: "Never live", status: "pending",
      });

      const { error } = await ctx.admin
        .from("games")
        .update({ scoring_enabled: true })
        .eq("id", gameId);
      expect(error).not.toBeNull();

      await ctx.admin.from("games").delete().eq("id", gameId);
    });

    it("...but a real go-live is fine, and so is finalizing a game that never went live", async () => {
      // The second half is the shortcut that falsified a stricter rule:
      // games.finish has no live-ness guard, so complete + scoring + never
      // published is reachable and must stay legal.
      const gameId = genId("game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_manual", name: "Lifecycle", status: "pending",
      });

      const goLive = await ctx.admin.from("games").update({
        scoring_enabled: true, status: "active",
        pairings_published_at: new Date().toISOString(),
      }).eq("id", gameId);
      expect(goLive.error).toBeNull();

      const reset = await ctx.admin.from("games").update({
        scoring_enabled: false, status: "pending", pairings_published_at: null,
      }).eq("id", gameId);
      expect(reset.error).toBeNull();

      const finishWithoutGoLive = await ctx.admin.from("games").update({
        status: "complete", scoring_enabled: true,
      }).eq("id", gameId);
      expect(finishWithoutGoLive.error).toBeNull();

      await ctx.admin.from("games").delete().eq("id", gameId);
    });
  });
});
