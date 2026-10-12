import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * A failed trip-list read is an ERROR, never "you have no trips".
 *
 * `trips.list` used to turn a failed membership read into `[]`, and an empty
 * list is the app's first-run empty state: on a bad network moment, someone with
 * trips was told they had none. Both readers (the dashboard and the desktop rail)
 * already render a failed load as "Couldn't load your trips" with a retry,
 * checked BEFORE the empty state (#764); the server just never let them see one.
 * Same fix as the leaderboard's (#1467).
 *
 * The failing client fails exactly ONE read, the membership select, and does
 * everything else against the database. The control is the same account through
 * a client that fails nothing, so the refusal can only come from that one read.
 */

const SENTENCE = "Couldn't check the trips just now. This is temporary — try again in a moment.";

let ctx: TestContext;
let tripId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("List read fails");
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("trips.list when the membership read fails", () => {
  it("control: the same account, reading normally, gets its trips", async () => {
    const trips = await ctx.caller().trips.list();
    expect(trips.map((t) => t.id)).toContain(tripId);
  });

  it("a failed membership read throws the read-failure sentence — not an empty list", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "trip_members", columns: "trip_id, role" });
    await expect(failing.trips.list()).rejects.toThrow(SENTENCE);
  });
});
