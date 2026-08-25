import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * `chat_reads.last_notified_at` (migration 144) and `markRead` share a ROW, and
 * the whole design rests on them not overwriting each other.
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
    .select("last_read_at, last_notified_at")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .eq("visibility", "crew")
    .maybeSingle();
  return data as { last_read_at: string; last_notified_at: string | null } | null;
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
