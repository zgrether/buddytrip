import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #991, migration 216 — a trip and its Owner are created in ONE transaction.
 *
 * `trips.create` used to insert the trip and then the caller's Owner row as two
 * statements through the caller's client. When the second failed, its clean-up
 * deleted the trip through that same client — and `trips_delete` needs the
 * Owner role, which a trip with no members has nobody holding. The delete
 * removed nothing and said nothing, so the empty trip stayed, claimable by
 * anyone who named its id (migration 128's bootstrap arm).
 *
 * Each atomicity case runs beside a CONTROL that drives the old two-statement
 * sequence into the same failure, so the test is shown able to express the
 * leftover trip it asserts is gone.
 *
 * The failure is a real one: the caller's `users` row is removed, so the Owner
 * insert breaks on its foreign key AFTER the trip insert has succeeded — the
 * exact order in which the old path stranded a trip.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let ctx: TestContext;

function tripArgs(id: string) {
  return {
    p_id: id,
    p_title: "991 atomic",
    p_description: null,
    p_location: null,
    p_start_date: null,
    p_end_date: null,
    p_comparison_mode: false,
    p_locked_destination_title: null,
    p_locked_destination_location: null,
  };
}

async function tripExists(id: string): Promise<boolean> {
  const { count, error } = await ctx.admin.from("trips").select("id", { count: "exact", head: true }).eq("id", id);
  if (error) throw new Error(`trip count: ${error.message}`);
  return (count ?? 0) > 0;
}

/** A signed-in account whose `users` row is gone, so any Owner insert for it fails on the FK. */
async function accountWithoutUsersRow(label: string) {
  const acct = await ctx.createAccount(label);
  const { error } = await ctx.admin.from("users").delete().eq("id", acct.id);
  if (error) throw new Error(`remove users row: ${error.message}`);
  return acct;
}

describe("create_trip (#991, migration 216)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("creates the trip with the caller as its only member, as Owner", async () => {
    const acct = await ctx.createAccount("991-ok");
    const id = genId("trip-991-ok");
    ctx.trackTrip(id);

    const { error } = await acct.client().rpc("create_trip", {
      ...tripArgs(id),
      p_locked_destination_title: "Bandon",
      p_locked_destination_location: "Oregon",
    });
    expect(error).toBeNull();

    const { data: members } = await ctx.admin.from("trip_members").select("user_id, role").eq("trip_id", id);
    expect(members).toEqual([{ user_id: acct.id, role: "Owner" }]);

    const { data: trip } = await ctx.admin
      .from("trips")
      .select("title, locked_destination_title, locked_destination_at")
      .eq("id", id)
      .single();
    expect(trip?.title).toBe("991 atomic");
    expect(trip?.locked_destination_title).toBe("Bandon");
    expect(trip?.locked_destination_at).not.toBeNull();
  }, 60_000);

  it("when the Owner insert fails, NO trip is left behind", async () => {
    const acct = await accountWithoutUsersRow("991-atomic");
    const id = genId("trip-991-atomic");
    ctx.trackTrip(id);

    const { error } = await acct.client().rpc("create_trip", tripArgs(id));
    expect(error, "the Owner insert must fail for this account").not.toBeNull();
    expect(await tripExists(id)).toBe(false);
  }, 60_000);

  it("CONTROL: the old two-statement path, failing the same way, DOES leave the trip", async () => {
    // What `trips.create` did before 216: insert the trip, insert the Owner,
    // and on failure delete the trip through the caller's own client.
    const acct = await accountWithoutUsersRow("991-control");
    const id = genId("trip-991-control");
    ctx.trackTrip(id);
    const client = acct.client();

    const { error: tripErr } = await client.from("trips").insert({ id, title: "991 control", description: "" });
    expect(tripErr).toBeNull();
    const { error: ownerErr } = await client.from("trip_members").insert({ trip_id: id, user_id: acct.id, role: "Owner" });
    expect(ownerErr, "the Owner insert must fail for this account").not.toBeNull();
    const { error: delErr } = await client.from("trips").delete().eq("id", id);
    expect(delErr, "the refused delete reports no error — which is why nobody saw it").toBeNull();

    expect(await tripExists(id)).toBe(true);
  }, 60_000);

  it("is not callable signed out", async () => {
    const id = genId("trip-991-anon");
    ctx.trackTrip(id);
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc("create_trip", tripArgs(id));
    expect(error).not.toBeNull();
    expect(await tripExists(id)).toBe(false);
  }, 60_000);
});
