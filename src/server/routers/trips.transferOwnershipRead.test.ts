import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1276 — `trips.transferOwnership`'s member read, the one site in the sweep
 * that also changed method: it was `.single()`, which reports ZERO rows as an
 * error, so it became `.maybeSingle()` when it moved onto `maybeRowOrThrow`.
 * Both halves of that need pinning:
 *  - a person who really is not on the trip still gets the same NOT_FOUND;
 *  - a FAILED read is a retryable 500, not "User is not a member of this
 *    trip", and nothing is promoted.
 */

let ctx: TestContext;
let tripId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("1276 transfer");
  await ctx.addTripMember(tripId, "member", "Member");
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const roleOf = async (userId: string) =>
  (await ctx.admin.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", userId).maybeSingle()).data?.role;

describe("trips.transferOwnership's member read (#1276)", () => {
  it("someone not on the trip is still NOT_FOUND, with the same message", async () => {
    await expect(
      ctx.caller().trips.transferOwnership({ tripId, newOwnerId: ctx.getUser("outsider").id })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "User is not a member of this trip" });
  }, 60_000);

  it("a failed read is a retryable 500, and nobody is promoted", async () => {
    const member = ctx.getUser("member").id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      callerFailingRead(ctx, "owner", { table: "trip_members", columns: "user_id, role" }).trips.transferOwnership({
        tripId,
        newOwnerId: member,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    vi.restoreAllMocks();
    expect(await roleOf(member)).toBe("Member");
    expect(await roleOf(ctx.user.id)).toBe("Owner");
  }, 60_000);
});
