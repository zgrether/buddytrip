import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { recordPushAttempt } from "./recordPushAttempt";
import { sendPushToUsers } from "./sendPushToUsers";

/**
 * `push_send_log` (migration 105) — the property Part B exists to provide:
 * **"sent to nobody, correctly" and "failed" must be distinguishable after the
 * fact.**
 *
 * Two investigations stalled without it. The Aug 1 clinch stalled because
 * Vercel's 1-day log retention had expired; the "no push on finalize" report
 * stalled because `sendPushToUsers` computed rich counts and every call site
 * discarded them, leaving both outcomes as `sent: 0`.
 *
 * These run against a real Postgres because the table's usefulness IS its
 * durability — a stubbed insert would prove nothing about whether the row
 * survives to be queried later, which is the entire point.
 */

let ctx: TestContext;

/** Read back the rows this suite wrote, newest first. */
async function rowsFor(trigger: string) {
  const { data } = await ctx.admin
    .from("push_send_log")
    .select("*")
    .eq("trigger", trigger)
    .order("created_at", { ascending: false });
  return data ?? [];
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  // The table has no FK to anything (deliberately — see the migration), so it
  // isn't swept by ctx.cleanup(); remove this suite's rows explicitly.
  await ctx.admin.from("push_send_log").delete().like("trigger", "test:%");
  await ctx.cleanup();
}, 60_000);

describe("push_send_log — the three outcomes are distinguishable", () => {
  let trigger: string;
  beforeEach(() => {
    trigger = `test:${genId("t")}`;
  });

  it("SENT TO NOBODY, CORRECTLY: an audience that resolved but held no devices", async () => {
    await recordPushAttempt(
      ctx.admin,
      { trigger, gameId: "game-1", actorUserId: "actor-1" },
      {
        typeKey: "game_results",
        recipients: 3, // the audience DID resolve — 3 non-actor participants
        skippedPreferenceOff: 0,
        subscriptionsFound: 0, // …none of whom has a registered device
        sent: 0,
        failed: 0,
        removedDead: 0,
        notConfigured: false,
        error: null,
      }
    );

    const [row] = await rowsFor(trigger);
    expect(row).toBeTruthy();
    // This is the production shape that looked like a bug for a week: the
    // audience is fine, the devices are the gap, and nothing failed.
    expect(row.recipients).toBe(3);
    expect(row.subscriptions_found).toBe(0);
    expect(row.sent).toBe(0);
    expect(row.failed).toBe(0);
    expect(row.error).toBeNull();
  }, 60_000);

  it("FAILED: devices existed and delivery threw", async () => {
    await recordPushAttempt(
      ctx.admin,
      { trigger, gameId: "game-2", actorUserId: "actor-1" },
      {
        typeKey: "game_results",
        recipients: 3,
        skippedPreferenceOff: 0,
        subscriptionsFound: 2, // devices WERE there
        sent: 0,
        failed: 2, // …and both sends failed
        removedDead: 0,
        notConfigured: false,
        error: "delivery failed (status 500)",
      }
    );

    const [row] = await rowsFor(trigger);
    // Same `sent: 0` as the case above — and now unambiguously a different
    // event, which is the whole deliverable.
    expect(row.sent).toBe(0);
    expect(row.subscriptions_found).toBe(2);
    expect(row.failed).toBe(2);
    expect(row.error).toContain("status 500");
  }, 60_000);

  it("NOT CONFIGURED: no VAPID, which is neither of the above", async () => {
    await recordPushAttempt(
      ctx.admin,
      { trigger, gameId: "game-3" },
      {
        typeKey: "game_results",
        recipients: 3,
        skippedPreferenceOff: 0,
        subscriptionsFound: 0,
        sent: 0,
        failed: 0,
        removedDead: 0,
        notConfigured: true,
        error: null,
      }
    );

    const [row] = await rowsFor(trigger);
    expect(row.not_configured).toBe(true);
    expect(row.failed).toBe(0);
  }, 60_000);

  it("records preference-off separately from having no device", async () => {
    await recordPushAttempt(
      ctx.admin,
      { trigger },
      {
        typeKey: "game_results",
        recipients: 1,
        skippedPreferenceOff: 2, // two people had the category off
        subscriptionsFound: 1,
        sent: 1,
        failed: 0,
        removedDead: 0,
        notConfigured: false,
        error: null,
      }
    );

    const [row] = await rowsFor(trigger);
    expect(row.skipped_preference_off).toBe(2);
    expect(row.sent).toBe(1);
  }, 60_000);
});

describe("push_send_log — the record can never break the send", () => {
  it("a failing insert is swallowed, not thrown", async () => {
    // `trigger` is NOT NULL. Forcing it null makes the insert fail for real,
    // rather than simulating a failure with a stub that might not behave like
    // Postgres does.
    await expect(
      recordPushAttempt(
        ctx.admin,
        { trigger: null as unknown as string },
        {
          typeKey: "game_results",
          recipients: 1,
          skippedPreferenceOff: 0,
          subscriptionsFound: 1,
          sent: 1,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          error: null,
        }
      )
    ).resolves.toBeUndefined();
  }, 60_000);

  it("a THROWING client is swallowed too", async () => {
    // The other half: not a rejected insert but a client that blows up. An
    // observability helper that can throw into a notification path would be a
    // new failure mode dressed as a diagnostic.
    const exploding = {
      from() {
        throw new Error("client exploded");
      },
    } as unknown as Parameters<typeof recordPushAttempt>[0];

    await expect(
      recordPushAttempt(
        exploding,
        { trigger: "test:throwing" },
        {
          typeKey: "game_results",
          recipients: 0,
          skippedPreferenceOff: 0,
          subscriptionsFound: 0,
          sent: 0,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          error: null,
        }
      )
    ).resolves.toBeUndefined();
  }, 60_000);
});

describe("the REAL send helper writes a row — end to end", () => {
  it("sendPushToUsers records the production shape: audience resolved, no devices", async () => {
    const trigger = `test:${genId("e2e")}`;
    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;

    // Exactly production's situation: participants resolve, the actor is
    // excluded, and nobody left has a registered device.
    const result = await sendPushToUsers(
      [owner, member, "ghost-a"],
      "game_results",
      { title: "t", body: "b", url: "/", tag: "x" },
      {
        admin: ctx.admin,
        excludeUserId: owner,
        context: { trigger, gameId: "game-e2e", actorUserId: owner },
      }
    );

    const [row] = await rowsFor(trigger);
    expect(row, "the helper wrote a row without being asked twice").toBeTruthy();
    // The row agrees with what the function returned — one source of truth.
    expect(row.recipients).toBe(result.recipients);
    expect(row.sent).toBe(result.sent);
    expect(row.subscriptions_found).toBe(result.subscriptionsFound);
    expect(row.actor_user_id).toBe(owner);
    expect(row.game_id).toBe("game-e2e");
    expect(row.type_key).toBe("game_results");
    // 2 non-actor recipients, no devices, nothing sent, nothing failed.
    expect(row.recipients).toBe(2);
    expect(row.sent).toBe(0);
    expect(row.failed).toBe(0);
  }, 60_000);

  it("records even when the audience is EMPTY — the early-return path", async () => {
    // The exit that would be easiest to leave unrecorded, and the one that
    // most needs a row: "we sent nothing" is the claim being investigated.
    const trigger = `test:${genId("empty")}`;
    const owner = ctx.getUser("owner").id;

    await sendPushToUsers(
      [owner], // the only recipient IS the actor
      "game_results",
      { title: "t", body: "b" },
      { admin: ctx.admin, excludeUserId: owner, context: { trigger, actorUserId: owner } }
    );

    const [row] = await rowsFor(trigger);
    expect(row, "an empty audience still leaves evidence").toBeTruthy();
    expect(row.recipients).toBe(0);
    expect(row.sent).toBe(0);
  }, 60_000);
});

describe("push_send_log — no message content is stored", () => {
  it("the table has no column that could hold a title, body or url", async () => {
    // A structural assertion, not a behavioural one: the guarantee is that
    // there is nowhere to put content even by accident. `recordPushAttempt`
    // never receives the payload, and this proves the schema agrees.
    const trigger = `test:${genId("shape")}`;
    await recordPushAttempt(
      ctx.admin,
      { trigger },
      {
        typeKey: "game_results",
        recipients: 1,
        skippedPreferenceOff: 0,
        subscriptionsFound: 1,
        sent: 1,
        failed: 0,
        removedDead: 0,
        notConfigured: false,
        error: null,
      }
    );
    const [row] = await rowsFor(trigger);
    const columns = Object.keys(row);
    for (const forbidden of ["title", "body", "url", "payload", "message", "tag"]) {
      expect(columns, `push_send_log must not carry '${forbidden}'`).not.toContain(forbidden);
    }
  }, 60_000);
});
