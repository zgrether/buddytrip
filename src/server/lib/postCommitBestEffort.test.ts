import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToDraft, configDraftToPayload } from "../../lib/configDraft";
import { reconcileClinchClaim, notifyCupClinchedIfDecided } from "./gameFinishNotify";
import { notifyPickemMatchesNotDrawn } from "./pickemMatchesNotify";

/**
 * WORK THAT HAPPENS AFTER A COMMIT IS BEST-EFFORT, AND CAN NEVER TURN A
 * COMMITTED SAVE INTO A REPORTED FAILURE (#1424).
 *
 * The failure this pins: a save commits, then a follow-up step (a clinch
 * reconcile, a push) throws, and the procedure reports the save as FAILED.
 * The device keeps a draft built on the version before its own save, so every
 * later Save conflicts with itself — a device that saved correctly, was told it
 * didn't, and can't save again. Seen on #1529's preview (2026-09-30): one 500,
 * then three 409s from the same device.
 *
 * Missing keys on previews (#634) are one way in: `createAdminClient()` throws
 * `supabaseKey is required`. Any step after the commit that can throw is the
 * same thing in production, so the fix is in each helper — best-effort by
 * construction — not in the environment.
 *
 * The lever: `createAdminClient` is made to throw exactly while the call under
 * test runs, the way a preview's does. Every case asserts BOTH that the call
 * reports success AND that the committed write is really there — success alone
 * would also pass if the write never happened.
 */

const admin = vi.hoisted(() => ({ fail: false }));
vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/supabase-admin")>();
  return {
    ...mod,
    createAdminClient: () => {
      if (admin.fail) throw new Error("supabaseKey is required.");
      return mod.createAdminClient();
    },
  };
});

/** Run `fn` while the admin client cannot be built, the way a preview behaves. */
async function withoutAdminKey<T>(fn: () => Promise<T>): Promise<T> {
  admin.fail = true;
  try {
    return await fn();
  } finally {
    admin.fail = false;
  }
}

let ctx: TestContext;
let tripId: string;
let competitionId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  const cup = await ctx.createCupTrip({
    title: "post-commit best-effort",
    name: "Best-effort Cup",
    scoringModel: "points",
    members: [["member", "Member"]],
    teams: ["Blue", "Red"],
  });
  tripId = cup.tripId;
  competitionId = cup.competitionId;
}, 60000);

afterAll(async () => {
  await ctx.cleanup();
}, 60000);

describe("a committed save reports success when a post-commit step cannot run", () => {
  it("games.saveConfig on a CUP game — the clinch reconcile (#1424)", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Before", competitionId });
    const full = await ctx.caller().games.getById({ tripId, gameId: game.id });
    const seeded = configToDraft(full as Parameters<typeof configToDraft>[0], [], []);
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId: game.id });

    const result = await withoutAdminKey(() =>
      ctx.caller().games.saveConfig({
        tripId,
        gameId: game.id,
        baseHash: hash,
        payload: configDraftToPayload({ ...seeded, name: "After" }, seeded),
      })
    );

    expect(result).toEqual({ ok: true });
    const { data } = await ctx.admin.from("games").select("name").eq("id", game.id).single();
    expect(data!.name).toBe("After");
  }, 60000);

  it("messages.send — the chat push", async () => {
    const id = crypto.randomUUID();
    await withoutAdminKey(() =>
      ctx.caller().messages.send({ tripId, id, text: "best-effort ping" })
    );
    const { data } = await ctx.admin.from("messages").select("text").eq("id", id).maybeSingle();
    expect(data?.text).toBe("best-effort ping");
  }, 60000);

  it("news.create — the news push", async () => {
    const post = await withoutAdminKey(() =>
      ctx.caller().news.create({ tripId, blocks: [{ type: "text", text: "best-effort news" }] })
    );
    const { data } = await ctx.admin.from("news_posts").select("id").eq("id", post.id).maybeSingle();
    expect(data?.id).toBe(post.id);
  }, 60000);

  it("scores.upsertEntry — the first score's pending→active flip", async () => {
    const ownerId = ctx.user.id;
    const memberId = ctx.getUser("member").id;
    const game = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Scored" });
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [ownerId, memberId] });
    await ctx.groupStrokeParticipants(game.id, [ownerId, memberId]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    // The flip is a FALLBACK (scores.ts): `enableScoring` already sets `active`,
    // so the app's own toggle never reaches it; it exists for an enable path
    // that bypasses the toggle. Placed in that state directly — scoring on,
    // pairings published, status still pending — which the migration-135 CHECK
    // permits.
    await ctx.admin.from("games").update({ status: "pending" }).eq("id", game.id);
    const { data: before } = await ctx.admin.from("games").select("status").eq("id", game.id).single();
    expect(before!.status, "premise: the flip path only runs on a pending game").toBe("pending");

    await withoutAdminKey(() =>
      ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: ownerId, unitLabel: "1", value: 4 })
    );

    const { count } = await ctx.admin
      .from("score_entries")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game.id);
    expect(count).toBe(1);
  }, 60000);
});

describe("the best-effort helpers never throw, whoever calls them", () => {
  it("reconcileClinchClaim", async () => {
    await expect(withoutAdminKey(() => reconcileClinchClaim(competitionId))).resolves.toBeUndefined();
  });

  it("notifyCupClinchedIfDecided — including its own failure record", async () => {
    await expect(
      withoutAdminKey(() => notifyCupClinchedIfDecided({ tripId, competitionId, actorUserId: ctx.user.id }))
    ).resolves.toBeUndefined();
  });

  it("notifyPickemMatchesNotDrawn", async () => {
    await expect(
      withoutAdminKey(() =>
        notifyPickemMatchesNotDrawn({ tripId, gameId: "no-such-game", actorUserId: ctx.user.id, priorResults: 0, newResult: "a" })
      )
    ).resolves.toBeNull();
  });
});
