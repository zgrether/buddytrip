import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, type TestAccount } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1539 — the two failed reads that fed an IRREVERSIBLE write.
 *
 * The census of server table reads that ignore their error found 142; these
 * are the two whose failure led to a write that cannot be undone:
 *
 *  - `notifications.setPreference` read the person's preference map, and a
 *    failed read became `{}` — so the save wrote ONLY the key being toggled and
 *    erased every other preference. Categories turned off started pushing again,
 *    and the old values were gone.
 *  - `ghostCrew.update`'s auto-link read "is that account already on this
 *    trip?", and a failed read became "no" — so the link went through to
 *    `link_guest_to_account`, which refuses deleted accounts and shared games
 *    but NOT this, and merged the placeholder's own trip row into the account's.
 *
 * Each case fails EXACTLY that read (`callerFailingRead`: table + the exact
 * column string) and asserts the family's sentence AND that nothing was
 * written. Beside each, a CONTROL on real reads proves the write is reachable,
 * so "nothing changed" means the read stopped it rather than the test watching
 * the wrong door.
 */

const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("notifications.setPreference — a failed read never erases the other preferences", () => {
  // Each case uses an account of its own: this procedure writes the CALLER's
  // own row, and changing a shared test user's preferences collides with every
  // file that reads them (#1540).
  async function prefsOf(account: TestAccount): Promise<Record<string, boolean>> {
    const { data, error } = await ctx.admin.from("users").select("notification_prefs").eq("id", account.id).single();
    if (error) throw new Error(`read prefs: ${error.message}`);
    return (data?.notification_prefs ?? {}) as Record<string, boolean>;
  }

  /** An account that has turned two categories OFF — the state a wipe destroys. */
  async function accountWithOptOuts(label: string): Promise<TestAccount> {
    const account = await ctx.createAccount(label);
    await account.caller().notifications.setPreference({ key: "chat", enabled: false });
    await account.caller().notifications.setPreference({ key: "news", enabled: false });
    expect(await prefsOf(account)).toMatchObject({ chat: false, news: false }); // premise
    return account;
  }

  it("CONTROL: real reads — toggling one key keeps the others (the merge is real)", async () => {
    const account = await accountWithOptOuts("prefs-control");
    await account.caller().notifications.setPreference({ key: "game_results", enabled: false });
    expect(await prefsOf(account)).toMatchObject({ chat: false, news: false, game_results: false });
  }, 60_000);

  it("a FAILED read refuses, and every existing preference survives", async () => {
    const account = await accountWithOptOuts("prefs-failing");
    const failing = callerFailingRead(ctx, account, { table: "users", columns: "notification_prefs" });
    await expect(
      failing.notifications.setPreference({ key: "game_results", enabled: false })
    ).rejects.toThrow(SENTENCE("notification settings"));

    const after = await prefsOf(account);
    expect(after).toMatchObject({ chat: false, news: false });
    // …and the refused toggle did not land either.
    expect(after).not.toHaveProperty("game_results");
  }, 60_000);
});

describe("ghostCrew.update auto-link — a failed read never merges into an account already on the trip", () => {
  /** A trip holding a placeholder AND a real account that is already a member. */
  async function duplicateCrew(label: string) {
    const tripId = await ctx.createTrip(`Auto-link ${label}`);
    const account = await ctx.createAccount(`autolink-${label}`);
    await ctx.addTripMemberById(tripId, account.id, "Member");
    const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: "Brad Placeholder", role: "Member" })) as { id: string };
    return { tripId, account, ghostId: ghost.id };
  }

  async function placeholderStillThere(tripId: string, ghostId: string): Promise<{ user: boolean; member: boolean }> {
    const u = await ctx.admin.from("users").select("id").eq("id", ghostId).maybeSingle();
    if (u.error) throw new Error(`read placeholder: ${u.error.message}`);
    const m = await ctx.admin.from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", ghostId).maybeSingle();
    if (m.error) throw new Error(`read placeholder membership: ${m.error.message}`);
    return { user: u.data !== null, member: m.data !== null };
  }

  it("CONTROL: real reads — linking to an account already on the trip is refused as CONFLICT", async () => {
    const { tripId, account, ghostId } = await duplicateCrew("control");
    await expect(
      ctx.caller().ghostCrew.update({ tripId, guestUserId: ghostId, email: account.email })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await placeholderStillThere(tripId, ghostId)).toEqual({ user: true, member: true });
  }, 60_000);

  it("a FAILED membership read refuses — the placeholder is not merged away", async () => {
    const { tripId, account, ghostId } = await duplicateCrew("failing");
    const failing = callerFailingRead(ctx, "owner", { table: "trip_members", columns: "id" });
    await expect(
      failing.ghostCrew.update({ tripId, guestUserId: ghostId, email: account.email })
    ).rejects.toThrow(SENTENCE("trip's crew list"));
    expect(await placeholderStillThere(tripId, ghostId)).toEqual({ user: true, member: true });
  }, 60_000);
});
