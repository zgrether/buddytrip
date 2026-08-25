import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * `chat_reads` columns that share a ROW and must not overwrite each other.
 *
 * ── This file was going to retire with `last_notified_at`. It doesn't ───────
 * The handoff said it retires with the column it was written for, and that was
 * right about the column and wrong about the file: the HAZARD it guards moved
 * rather than ended. `viewing_at` (migration 145) is now written by the
 * heartbeat while `markRead` upserts the same primary key from the same client,
 * which is the identical collision one column to the left. So the
 * `last_notified_at` cases below go when that column is dropped, and the
 * `viewing_at` ones inherit the file.
 *
 * ── Why this is a runtime test and not a reading of the docs ────────────────
 * The gate writes `last_notified_at` from the server; `markRead` upserts the
 * SAME primary key from the user's client with only `last_read_at` in the
 * payload. Whether the omitted column survives that upsert is a property of
 * PostgREST's `merge-duplicates` resolution, not of anything TypeScript can see
 * — the client types accept a partial payload either way, so a version that
 * nulls unlisted columns type-checks perfectly and fails only in production, as
 * "the time-based re-arm never fires because reading wipes its state."
 *
 * That is CLAUDE.md #23 exactly: a value crosses a library boundary, the types
 * say nothing useful, and the failure is silent. So it gets a real write against
 * a real database, asserting the exact value survives.
 *
 * The inverse is asserted too — `markRead` must still MOVE `last_read_at` —
 * because a test that only checks preservation would pass against an upsert
 * that had stopped writing anything at all.
 */

let ctx: TestContext;
let tripId: string;
let userId: string;

const NOTIFIED_AT = "2026-03-04T05:06:07.000Z";

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("chat_reads column trip");
  userId = ctx.user.id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function readRow() {
  const { data } = await ctx.admin
    .from("chat_reads")
    .select("last_read_at, last_notified_at, viewing_at")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .eq("visibility", "crew")
    .maybeSingle();
  return data as {
    last_read_at: string;
    last_notified_at: string | null;
    viewing_at: string | null;
  } | null;
}

describe("chat_reads.last_notified_at survives markRead", () => {
  it("starts NULL — nobody is retroactively considered notified", async () => {
    // The seed for every existing row after migration 144. A backfilled now()
    // would silence everyone for the first window after deploy, which is the
    // failure the re-arm exists to fix.
    await ctx.admin.from("chat_reads").insert({
      trip_id: tripId,
      user_id: userId,
      visibility: "crew",
      last_read_at: "2026-03-01T00:00:00.000Z",
    });
    expect((await readRow())?.last_notified_at).toBeNull();
  });

  it("holds a value written by the send path", async () => {
    await ctx.admin
      .from("chat_reads")
      .update({ last_notified_at: NOTIFIED_AT })
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .eq("visibility", "crew");

    const row = await readRow();
    expect(row?.last_notified_at).not.toBeNull();
    expect(new Date(row!.last_notified_at!).toISOString()).toBe(NOTIFIED_AT);
  });

  /**
   * THE ASSERTION THAT MATTERS. `markRead` is the highest-frequency write to
   * this row — every panel open, every message arrival, every heartbeat — so if
   * it cleared `last_notified_at`, the re-arm state would be destroyed by the
   * one action most likely to happen between two pushes.
   */
  it("markRead advances last_read_at WITHOUT clearing last_notified_at", async () => {
    const before = await readRow();

    // The real procedure, through the real caller — not a hand-rolled upsert
    // that could differ from what ships.
    await ctx.caller().messages.markRead({ tripId, visibility: "crew" });

    const after = await readRow();

    // Preserved, to the exact instant.
    expect(
      after?.last_notified_at,
      "markRead wiped last_notified_at — the time-based re-arm would never fire"
    ).not.toBeNull();
    expect(new Date(after!.last_notified_at!).toISOString()).toBe(NOTIFIED_AT);

    // ...and it genuinely did its own job, so the check above is not passing
    // against an upsert that silently stopped writing.
    expect(new Date(after!.last_read_at).getTime()).toBeGreaterThan(
      new Date(before!.last_read_at).getTime()
    );
  });

  /**
   * The other direction: a fresh row created BY markRead (no prior row) must
   * also leave the column null rather than defaulting to now(). Same reasoning
   * as the backfill — a first-ever read must not count as a notification.
   */
  it("a row first created by markRead has a null last_notified_at", async () => {
    await ctx.admin
      .from("chat_reads")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .eq("visibility", "crew");

    await ctx.caller().messages.markRead({ tripId, visibility: "crew" });

    const row = await readRow();
    expect(row).not.toBeNull();
    expect(row?.last_notified_at).toBeNull();
  });
});


describe("chat_reads.viewing_at and last_read_at do not clobber each other", () => {
  /**
   * The two writers are `markRead` (message arrival) and `markViewing` (the 15s
   * heartbeat), both from the same client, both upserting the same primary key
   * with ONE column each in the payload. Whether the omitted column survives is
   * PostgREST's `merge-duplicates` behaviour — invisible to TypeScript, which
   * accepts a partial payload either way.
   *
   * Getting it wrong in either direction is silent and bad:
   *   heartbeat wipes last_read_at → the unread badge resets every 15 seconds
   *   markRead wipes viewing_at    → you get pushed while staring at the panel
   *
   * ── And this is the pair migration 145 exists to keep apart ───────────────
   * The point of splitting the columns was that a heartbeat can no longer mark
   * anything read. That is only true if the heartbeat's write really does leave
   * `last_read_at` alone, which is exactly what the first case here asserts. The
   * schema makes the bug unrepresentable in CODE; this is the check that the
   * DATABASE agrees.
   */
  const VIEWING_AT = "2026-04-05T06:07:08.000Z";

  it("markViewing advances viewing_at WITHOUT touching last_read_at", async () => {
    const caller = ctx.callerAs("owner");
    await caller.messages.markRead({ tripId, visibility: "crew" });
    const before = await readRow();
    expect(before?.last_read_at).toBeTruthy();

    await caller.messages.markViewing({ tripId, visibility: "crew" });

    const after = await readRow();
    expect(after?.viewing_at, "markViewing did not write viewing_at").toBeTruthy();
    expect(
      after?.last_read_at,
      "markViewing moved last_read_at — the heartbeat is marking messages read again"
    ).toBe(before?.last_read_at);
  });

  it("markRead advances last_read_at WITHOUT clearing viewing_at", async () => {
    const caller = ctx.callerAs("owner");
    await ctx.admin
      .from("chat_reads")
      .update({ viewing_at: VIEWING_AT })
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .eq("visibility", "crew");

    const before = await readRow();
    await caller.messages.markRead({ tripId, visibility: "crew" });
    const after = await readRow();

    expect(
      after?.viewing_at,
      "markRead wiped viewing_at — recipients would be pushed while looking at the panel"
    ).toBeTruthy();
    expect(new Date(after!.viewing_at!).toISOString()).toBe(VIEWING_AT);
    // The inverse, so this cannot pass against an upsert that stopped writing.
    expect(new Date(after!.last_read_at).getTime()).toBeGreaterThan(
      new Date(before!.last_read_at).getTime()
    );
  });

  /**
   * A row CREATED by the heartbeat takes `last_read_at` from the column DEFAULT
   * (NOT NULL DEFAULT now()) — the one place the two columns still touch, and it
   * is schema rather than code. Reachable only before anything has been read in
   * a channel, which in practice means an empty one, where `now()` cannot mark
   * any message read because there are none. Pinned so the reachable case is a
   * known one rather than a discovery.
   */
  it("a row first created by markViewing still gets a defaulted last_read_at", async () => {
    const otherTrip = await ctx.createTrip("chat_reads viewing-first trip");
    const caller = ctx.callerAs("owner");
    await caller.messages.markViewing({ tripId: otherTrip, visibility: "crew" });

    const { data } = await ctx.admin
      .from("chat_reads")
      .select("last_read_at, viewing_at")
      .eq("trip_id", otherTrip)
      .eq("user_id", userId)
      .eq("visibility", "crew")
      .maybeSingle();
    const row = data as { last_read_at: string; viewing_at: string | null } | null;

    expect(row?.viewing_at).toBeTruthy();
    expect(row?.last_read_at).toBeTruthy(); // the DEFAULT, not a value we chose
  });
});
