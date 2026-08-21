import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { resolveInviteLink } from "../lib/inviteLink";

/**
 * invites.claim — the invite token authorizes attaching a placeholder to
 * whichever account the holder actually signed in with (migration 141).
 *
 * ── What these tests are actually guarding ────────────────────────────────
 *
 * Not "does the RPC return without an error". The failure this feature is one
 * bad refactor away from is the one `ghostCrew.update` shipped in production:
 * a merge-shaped thing that repoints `trip_members` and stops, leaving
 * `game_participants` / `score_entries` / the `game_matches` side JSONB still
 * pointing at a ghost that no longer exists. That looked completely fine from
 * the roster. So every happy-path assertion below names a SPECIFIC row in a
 * SPECIFIC table, including the JSONB side that no `SET col = value` can reach.
 *
 * The refusals are asserted on their own sentences rather than on "it threw",
 * because several of them throw the same tRPC code for different reasons and
 * the reason is the thing under test — an already-claimed token and an
 * already-a-member claimant must not be able to satisfy each other's test.
 *
 * `outsider` stands in for "the account they actually use": a real auth-backed,
 * non-guest user who is not on the trip. That is the whole case — the invited
 * address and the signed-in address are different people as far as the
 * database is concerned.
 *
 * Runs against the ephemeral local Supabase the suite boots (#636). Seeds
 * sequentially, never Promise.all.
 */

const HOOK_TIMEOUT_MS = 60_000;

let ctx: TestContext;
let outsiderId: string;
let outsiderEmail: string;

type Seed = {
  tripId: string;
  email: string;
  token: string;
  ghostId: string;
  memberRowId: string;
  gameId: string;
  participantRowId: string;
  scoreRowId: string;
  matchId: string;
};

/**
 * A trip with a placeholder who has been invited AND already has competition
 * history — the state a real invited-but-not-signed-up person is in three
 * weeks before the event.
 */
async function seedInvitedPlaceholder(nickname: string): Promise<Seed> {
  const tripId = await ctx.createTrip("Claim Trip");
  const email = `${genId("claim")}@example.com`.toLowerCase();

  const ghost = (await ctx.caller().ghostCrew.create({
    tripId,
    name: "Brad Placeholder",
    role: "Member",
    email,
  })) as { id: string };

  // The trip nickname the crew recognises. It lives on `trip_members`, which is
  // exactly why the already-a-member case has to refuse rather than merge.
  const { data: memberRow, error: nickErr } = await ctx.admin
    .from("trip_members")
    .update({ nickname })
    .eq("trip_id", tripId)
    .eq("user_id", ghost.id)
    .select("id")
    .single();
  if (nickErr || !memberRow) throw new Error(`seed nickname: ${nickErr?.message}`);

  const { data: invite, error: invErr } = await ctx.admin
    .from("invites")
    .insert({ trip_id: tripId, email, role: "Member", created_by: ctx.user.id })
    .select("token")
    .single();
  if (invErr || !invite) throw new Error(`seed invite: ${invErr?.message}`);

  // History that must travel with the identity.
  const gameId = genId("game");
  const { error: gErr } = await ctx.admin.from("games").insert({
    id: gameId,
    trip_id: tripId,
    game_type_id: "gtt_match_play",
    name: "Claim Game",
    status: "active",
  });
  if (gErr) throw new Error(`seed game: ${gErr.message}`);

  const participantRowId = genId("gp");
  const { error: gpErr } = await ctx.admin
    .from("game_participants")
    .insert({ id: participantRowId, game_id: gameId, user_id: ghost.id });
  if (gpErr) throw new Error(`seed game_participants: ${gpErr.message}`);

  const scoreRowId = genId("se");
  const { error: seErr } = await ctx.admin.from("score_entries").insert({
    id: scoreRowId,
    game_id: gameId,
    participant_id: ghost.id,
    participant_type: "user",
    unit_label: "1",
    value: 4,
    annotations: {},
    submitted_at: new Date().toISOString(),
  });
  if (seErr) throw new Error(`seed score_entries: ${seErr.message}`);

  const matchId = genId("match");
  const { error: mErr } = await ctx.admin.from("game_matches").insert({
    id: matchId,
    game_id: gameId,
    match_number: 1,
    status: "active",
    side_a: { type: "user", id: ghost.id },
  });
  if (mErr) throw new Error(`seed game_matches: ${mErr.message}`);

  return {
    tripId,
    email,
    token: invite.token as string,
    ghostId: ghost.id,
    memberRowId: memberRow.id as string,
    gameId,
    participantRowId,
    scoreRowId,
    matchId,
  };
}

async function dropGame(gameId: string) {
  await ctx.admin.from("games").delete().eq("id", gameId);
}

describe("invites.claim — token-authorized placeholder claim", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    const outsider = ctx.getUser("outsider");
    outsiderId = outsider.id;
    outsiderEmail = outsider.email;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await ctx.cleanup();
  }, HOOK_TIMEOUT_MS);

  it("attaches the placeholder — and its whole history — to the signed-in account", async () => {
    const seed = await seedInvitedPlaceholder("Bradley");

    const result = await ctx.callerAs("outsider").invites.claim({ token: seed.token });

    expect(result.tripId).toBe(seed.tripId);
    expect(result.claimedName).toBe("Bradley");

    // (1) The membership row was REPOINTED, not replaced. Asserting the row ID
    //     is unchanged is the mechanism: a delete-and-reinsert would produce a
    //     new id and silently drop the nickname and role riding on the old one.
    const member = await ctx.admin
      .from("trip_members")
      .select("id, user_id, nickname, role, status")
      .eq("id", seed.memberRowId)
      .maybeSingle();
    expect(member.data).toBeTruthy();
    expect(member.data!.user_id).toBe(outsiderId);
    expect(member.data!.nickname).toBe("Bradley");
    expect(member.data!.role).toBe("Member");
    expect(member.data!.status).toBe("in");

    // (2) Competition history followed. These three are the tables the shipped
    //     auto-link bug left behind, and the JSONB side is the one a plain
    //     `UPDATE ... SET user_id` cannot reach at all.
    const gp = await ctx.admin
      .from("game_participants")
      .select("user_id")
      .eq("id", seed.participantRowId)
      .single();
    expect(gp.data!.user_id).toBe(outsiderId);

    const se = await ctx.admin
      .from("score_entries")
      .select("participant_id, participant_type")
      .eq("id", seed.scoreRowId)
      .single();
    expect(se.data!.participant_id).toBe(outsiderId);
    expect(se.data!.participant_type).toBe("user");

    const gm = await ctx.admin
      .from("game_matches")
      .select("side_a")
      .eq("id", seed.matchId)
      .single();
    expect((gm.data!.side_a as { id: string }).id).toBe(outsiderId);

    // (3) The placeholder is gone, and with it the address it held. This is
    //     what makes the crew row show the ACCOUNT's address: the roster joins
    //     `users` through `trip_members.user_id`, which now names the claimant.
    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data).toBeNull();

    const stillHeld = await ctx.admin
      .from("users")
      .select("id")
      .eq("email", seed.email)
      .maybeSingle();
    expect(stillHeld.data).toBeNull();

    const claimant = await ctx.admin
      .from("users")
      .select("email")
      .eq("id", outsiderId)
      .single();
    expect(claimant.data!.email).toBe(outsiderEmail);

    // (4) The invite is stamped.
    const invite = await ctx.admin
      .from("invites")
      .select("accepted_at")
      .eq("token", seed.token)
      .single();
    expect(invite.data!.accepted_at).not.toBeNull();

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("resolving the link is READ-ONLY — nothing merges without the explicit claim", async () => {
    const seed = await seedInvitedPlaceholder("Untouched");

    // The landing page resolves the token on every visit, including for someone
    // who then picks "Continue as …" or signs out. If a claim ever migrated
    // into the resolver, this is what would catch it.
    const resolved = await resolveInviteLink(seed.token);
    expect(resolved).toBeTruthy();
    expect(resolved!.placeholder?.name).toBe("Untouched");
    expect(resolved!.spent).toBe(false);

    const ghost = await ctx.admin
      .from("users")
      .select("id, is_guest")
      .eq("id", seed.ghostId)
      .maybeSingle();
    expect(ghost.data?.is_guest).toBe(true);

    const member = await ctx.admin
      .from("trip_members")
      .select("user_id")
      .eq("id", seed.memberRowId)
      .single();
    expect(member.data!.user_id).toBe(seed.ghostId);

    const invite = await ctx.admin
      .from("invites")
      .select("accepted_at")
      .eq("token", seed.token)
      .single();
    expect(invite.data!.accepted_at).toBeNull();

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("REFUSES when the claimant is already on the trip — and leaves the placeholder whole", async () => {
    const seed = await seedInvitedPlaceholder("Duplicate Brad");
    await ctx.addTripMemberById(seed.tripId, outsiderId, "Member");

    await expect(
      ctx.callerAs("outsider").invites.claim({ token: seed.token })
    ).rejects.toThrow(/already on this trip/i);

    // The refusal has to happen BEFORE anything moves. The merge would resolve
    // this collision by DELETING the placeholder's membership row — the row
    // carrying the nickname and role — so a partial merge here destroys exactly
    // what the feature exists to preserve.
    const member = await ctx.admin
      .from("trip_members")
      .select("user_id, nickname")
      .eq("id", seed.memberRowId)
      .maybeSingle();
    expect(member.data).toBeTruthy();
    expect(member.data!.user_id).toBe(seed.ghostId);
    expect(member.data!.nickname).toBe("Duplicate Brad");

    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data?.id).toBe(seed.ghostId);

    const se = await ctx.admin
      .from("score_entries")
      .select("participant_id")
      .eq("id", seed.scoreRowId)
      .single();
    expect(se.data!.participant_id).toBe(seed.ghostId);

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("REFUSES a second claim on the same token — and says so for the right reason", async () => {
    const seed = await seedInvitedPlaceholder("Once Only");

    await ctx.callerAs("outsider").invites.claim({ token: seed.token });

    // Asserted on the SENTENCE, not just the throw. After the first claim the
    // claimant IS a member of the trip, so an "already on this trip" refusal
    // would also throw here — and would mean the consumption check never ran.
    // The token is spent because the placeholder is GONE, which is a fact
    // rather than a flag.
    await expect(
      ctx.callerAs("outsider").invites.claim({ token: seed.token })
    ).rejects.toThrow(/already been used/i);

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("REFUSES a token that names nothing", async () => {
    const seed = await seedInvitedPlaceholder("Not Forged");
    const forged = "f".repeat(64);

    await expect(
      ctx.callerAs("outsider").invites.claim({ token: forged })
    ).rejects.toThrow(/isn't valid/i);

    // A forged token must not reach some OTHER trip's placeholder.
    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data?.id).toBe(seed.ghostId);

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("REFUSES a placeholder that is a DELETED account (migration 132's third caller)", async () => {
    const seed = await seedInvitedPlaceholder("Deleted Person");
    await ctx.admin
      .from("users")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", seed.ghostId);

    await expect(
      ctx.callerAs("outsider").invites.claim({ token: seed.token })
    ).rejects.toThrow(/deleted their account/i);

    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data?.id).toBe(seed.ghostId);

    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("REFUSES when both identities already hold a score for the same hole", async () => {
    const seed = await seedInvitedPlaceholder("Two Places At Once");

    // The realistic route, and the reason the guard cannot be trip-local: the
    // merge is GLOBAL, one guest row is shared across trips (`users.email` is
    // UNIQUE and `ghostCrew.create` reuses it), so the collision can sit on a
    // trip the token says nothing about.
    const otherTripId = await ctx.createTrip("Shared Second Trip");
    await ctx.caller().ghostCrew.create({
      tripId: otherTripId,
      name: "Brad Placeholder",
      role: "Member",
      email: seed.email,
    });
    await ctx.addTripMemberById(otherTripId, outsiderId, "Member");

    const otherGameId = genId("game");
    const { error: gErr } = await ctx.admin.from("games").insert({
      id: otherGameId,
      trip_id: otherTripId,
      game_type_id: "gtt_match_play",
      name: "Collision Game",
      status: "active",
    });
    if (gErr) throw new Error(`seed collision game: ${gErr.message}`);

    for (const participantId of [seed.ghostId, outsiderId]) {
      const { error } = await ctx.admin.from("score_entries").insert({
        id: genId("se-collide"),
        game_id: otherGameId,
        participant_id: participantId,
        participant_type: "user",
        unit_label: "7",
        value: 5,
        annotations: {},
        submitted_at: new Date().toISOString(),
      });
      if (error) throw new Error(`seed collision score: ${error.message}`);
    }

    // Asserted on OUR sentence. `score_entries` is UNIQUE (game_id,
    // participant_id, unit_label) and the merge does a plain UPDATE, so without
    // the pre-check this still fails — with a raw duplicate-key error mapped to
    // the same tRPC code. Matching the sentence is what distinguishes "the
    // guard fired" from "the constraint did", and a Postgres constraint message
    // cannot produce this wording.
    await expect(
      ctx.callerAs("outsider").invites.claim({ token: seed.token })
    ).rejects.toThrow(/scores in the same game/i);

    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data?.id).toBe(seed.ghostId);

    await dropGame(otherGameId);
    await dropGame(seed.gameId);
  }, HOOK_TIMEOUT_MS);

  it("does NOT change the email-matching signup path — that merge still runs on its own", async () => {
    const seed = await seedInvitedPlaceholder("Signs Up Normally");

    // The #722 path: the invited address itself signs up. `handle_new_user`
    // matches on email and merges without any token involved. Migration 141
    // adds a caller; it must not have moved anything this one relies on.
    const { data: created, error } = await ctx.admin.auth.admin.createUser({
      email: seed.email,
      password: "BuddyTripTest2026!",
      email_confirm: true,
      user_metadata: { name: "Signs Up Normally" },
    });
    if (error || !created?.user) throw new Error(`signup: ${error?.message}`);
    const realId = created.user.id;

    const member = await ctx.admin
      .from("trip_members")
      .select("user_id, nickname")
      .eq("id", seed.memberRowId)
      .single();
    expect(member.data!.user_id).toBe(realId);
    expect(member.data!.nickname).toBe("Signs Up Normally");

    const se = await ctx.admin
      .from("score_entries")
      .select("participant_id")
      .eq("id", seed.scoreRowId)
      .single();
    expect(se.data!.participant_id).toBe(realId);

    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).maybeSingle();
    expect(ghost.data).toBeNull();

    await dropGame(seed.gameId);
    await ctx.admin.auth.admin.deleteUser(realId);
    await ctx.admin.from("users").delete().eq("id", realId);
  }, HOOK_TIMEOUT_MS);
});
