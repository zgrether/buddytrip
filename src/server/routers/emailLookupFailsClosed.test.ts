import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRpc } from "../../__tests__/helpers/failingRead";

/**
 * #1537 — a failed `lookup_user_by_email` is not "no account".
 *
 * Three callers read the lookup as `(rows ?? [])[0] ?? null`, so a failed call
 * read as "nobody holds this address" and each took its no-account branch and
 * wrote: a new placeholder with the address (`ghostCrew.create`), the address set
 * on a placeholder without linking it (`ghostCrew.update`), or the new-person
 * invite path (`tripMembers.inviteByEmail`). Seen in a test run (a Kong 502 on
 * the lookup), where the write was refused by `users_email_key` with a raw
 * duplicate-key error for something a retry would have fixed.
 *
 * Each site now reads through `lookupAccountByEmail`, which throws a retryable
 * error. Every case below pairs the failure with a CONTROL on a real caller,
 * proving the account branch is reachable for that address, so a refusal in the
 * failing case is the lookup's and not something else shutting the door. The
 * failure is asserted by its exact sentence, which no other path produces, and
 * by the absence of every write the no-account branch would have made.
 *
 * The addresses belong to fresh accounts (`createAccount`), never the shared
 * users: auto-link merges a placeholder into the account (#1540).
 */

const SENTENCE = "Couldn't check the email address just now. This is temporary — try again in a moment.";

let ctx: TestContext;
const guestIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  if (guestIds.length) await ctx.admin.from("users").delete().in("id", guestIds).eq("is_guest", true);
  await ctx.cleanup();
}, 60_000);

async function onTrip(tripId: string, userId: string): Promise<boolean> {
  const { count } = await ctx.admin
    .from("trip_members").select("id", { count: "exact", head: true })
    .eq("trip_id", tripId).eq("user_id", userId);
  return (count ?? 0) > 0;
}

async function rowsWithEmail(email: string): Promise<number> {
  const { count } = await ctx.admin.from("users").select("id", { count: "exact", head: true }).eq("email", email);
  return count ?? 0;
}

describe("tripMembers.inviteByEmail", () => {
  it("CONTROL: an address held by an account adds that account", async () => {
    const tripId = await ctx.createTrip("1537 invite control");
    const account = await ctx.createAccount("1537-invite-control");
    const result = await ctx.caller().tripMembers.inviteByEmail({ tripId, email: account.email });
    expect(result.status).toBe("added_existing");
    expect(await onTrip(tripId, account.id)).toBe(true);
  }, 60_000);

  it("a failed lookup refuses with the retry sentence, and invites nobody", async () => {
    const tripId = await ctx.createTrip("1537 invite failing");
    const account = await ctx.createAccount("1537-invite-failing");
    const failing = callerFailingRpc(ctx, "owner", "lookup_user_by_email");
    await expect(failing.tripMembers.inviteByEmail({ tripId, email: account.email })).rejects.toThrow(SENTENCE);
    expect(await onTrip(tripId, account.id)).toBe(false);
    expect(await rowsWithEmail(account.email)).toBe(1); // no placeholder minted beside it
  }, 60_000);
});

describe("ghostCrew.create with an email", () => {
  it("CONTROL: an address held by an account adds that account", async () => {
    const tripId = await ctx.createTrip("1537 create control");
    const account = await ctx.createAccount("1537-create-control");
    await ctx.caller().ghostCrew.create({ tripId, name: "Someone", email: account.email });
    expect(await onTrip(tripId, account.id)).toBe(true);
    expect(await rowsWithEmail(account.email)).toBe(1);
  }, 60_000);

  it("a failed lookup refuses with the retry sentence, and creates nobody", async () => {
    const tripId = await ctx.createTrip("1537 create failing");
    const account = await ctx.createAccount("1537-create-failing");
    const failing = callerFailingRpc(ctx, "owner", "lookup_user_by_email");
    await expect(failing.ghostCrew.create({ tripId, name: "Someone", email: account.email })).rejects.toThrow(SENTENCE);
    expect(await onTrip(tripId, account.id)).toBe(false);
    expect(await rowsWithEmail(account.email)).toBe(1);
    const { count } = await ctx.admin
      .from("trip_members").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
    expect(count, "only the owner is on the trip").toBe(1);
  }, 60_000);
});

describe("ghostCrew.update setting an email", () => {
  it("CONTROL: an address held by an account links the placeholder to it", async () => {
    const tripId = await ctx.createTrip("1537 update control");
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "LinkMe" });
    guestIds.push(ghost.id);
    const account = await ctx.createAccount("1537-update-control");
    const result = await ctx.caller().ghostCrew.update({ tripId, guestUserId: ghost.id, email: account.email });
    expect(result.linked).toBe(true);
    expect(await onTrip(tripId, account.id)).toBe(true);
  }, 60_000);

  it("a failed lookup refuses with the retry sentence, and leaves the placeholder as it was", async () => {
    const tripId = await ctx.createTrip("1537 update failing");
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "LinkMe" });
    guestIds.push(ghost.id);
    const account = await ctx.createAccount("1537-update-failing");
    const failing = callerFailingRpc(ctx, "owner", "lookup_user_by_email");
    await expect(
      failing.ghostCrew.update({ tripId, guestUserId: ghost.id, email: account.email })
    ).rejects.toThrow(SENTENCE);
    const { data: g } = await ctx.admin.from("users").select("email, is_guest").eq("id", ghost.id).single();
    expect(g).toEqual({ email: null, is_guest: true });
    expect(await onTrip(tripId, ghost.id)).toBe(true);
    expect(await onTrip(tripId, account.id)).toBe(false);
  }, 60_000);
});
