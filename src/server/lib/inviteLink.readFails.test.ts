import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { clientFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1611 — a FAILED invite read is an error, never "This invite link isn't valid".
 *
 * The invite page is the first thing someone sees from an invite email, often
 * before they've ever used the app. Its reads used to answer a failure with the
 * empty value — null, false, "nobody holds this address" — and each of those
 * routes to a false sentence: the link "isn't valid", "You're not on this trip",
 * or sign-UP offered to someone who already has an account. Each read now throws
 * the shared read-failure error, which the page turns into "Couldn't load this
 * invite" with Try again.
 *
 * `resolveInviteLink` builds its own admin client, so the factory is mocked to
 * wrap the REAL one and fail exactly one read (table + exact columns). With no
 * target set, the wrapper fails nothing: that's every control below.
 */
let failTarget: { table: string; columns: string } | null = null;
vi.mock("@/lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-admin")>();
  return {
    ...actual,
    createAdminClient: () => (failTarget ? clientFailingRead(actual.createAdminClient(), failTarget) : actual.createAdminClient()),
  };
});
vi.mock("@/lib/email", () => ({
  sendInvitationBlast: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendInviteExistingUser: vi.fn().mockResolvedValue({}),
  sendInviteNewUser: vi.fn().mockResolvedValue({}),
}));

const { resolveInviteLink, viewerCanSeeTrip } = await import("./inviteLink");
const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;

const INVITE_COLS = "token, trip_id, email, created_by, accepted_at, trips(title), inviter:users!invites_created_by_fkey(name)";

let ctx: TestContext;
let tripId: string;
let placeholderToken: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Invite read fails");
  // A placeholder on THIS trip, so resolution takes every read: the invite, the
  // address, and the crew row the claim offer is built from.
  const email = `${genId("ghost")}@example.com`.toLowerCase();
  const guestId = genId("guest-user");
  const u = await ctx.admin.from("users").insert({ id: guestId, name: "Ghost", email, is_guest: true, created_by: ctx.user.id });
  if (u.error) throw new Error(u.error.message);
  const m = await ctx.admin.from("trip_members").insert({ trip_id: tripId, user_id: guestId, role: "Member", nickname: "Ghosty" });
  if (m.error) throw new Error(m.error.message);
  const inv = await ctx.admin.from("invites").insert({ trip_id: tripId, email, role: "Member", created_by: ctx.user.id }).select("token").single();
  if (inv.error || !inv.data) throw new Error(inv.error?.message);
  placeholderToken = inv.data.token as string;
}, 60_000);

afterEach(() => {
  failTarget = null;
});

afterAll(async () => {
  await ctx.admin.from("invites").delete().eq("trip_id", tripId);
  await ctx.cleanup();
}, 60_000);

describe("resolveInviteLink: a failed read throws, it doesn't read as 'invalid'", () => {
  it("control: with nothing failing, the invite resolves, placeholder and all", async () => {
    const r = await resolveInviteLink(placeholderToken);
    expect(r?.tripId).toBe(tripId);
    expect(r?.placeholder).toEqual({ name: "Ghosty" });
  });

  it("control: an unknown token is still null — 'names nothing' is not a failure", async () => {
    expect(await resolveInviteLink("0".repeat(64))).toBeNull();
  });

  it("the invite read fails → throws (it used to be null: 'This invite link isn't valid')", async () => {
    failTarget = { table: "invites", columns: INVITE_COLS };
    await expect(resolveInviteLink(placeholderToken)).rejects.toThrow(SENTENCE("invite"));
  });

  it("the address read fails → throws (it used to read as 'no account' and offer sign-UP)", async () => {
    failTarget = { table: "users", columns: "id, name, is_guest, deleted_at" };
    await expect(resolveInviteLink(placeholderToken)).rejects.toThrow(SENTENCE("invited address"));
  });

  it("the crew read fails → throws (it used to drop the claim offer silently)", async () => {
    failTarget = { table: "trip_members", columns: "nickname" };
    await expect(resolveInviteLink(placeholderToken)).rejects.toThrow(SENTENCE("invite's crew"));
  });
});

describe("viewerCanSeeTrip: a failed read is not 'not a member'", () => {
  it("control: the owner can see their trip", async () => {
    expect(await viewerCanSeeTrip(ctx.user.id, tripId)).toBe(true);
  });

  it("the membership read fails → throws (it used to be false: 'You're not on this trip')", async () => {
    failTarget = { table: "trip_members", columns: "user_id" };
    await expect(viewerCanSeeTrip(ctx.user.id, tripId)).rejects.toThrow(SENTENCE("trip membership"));
  });
});
