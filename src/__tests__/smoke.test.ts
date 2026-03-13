import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, getAdminClient } from "./helpers/test-setup";

/**
 * Smoke test — Phase 0 sanity checks against the live Supabase project.
 *
 * Uses authenticated clients (respects RLS) for test operations and
 * service role key for setup/teardown.
 */

let ctx: TestContext;

describe("Phase 0 Smoke Test", () => {
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Smoke Test Trip");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("should have a public.users row synced from auth.users", async () => {
    const admin = ctx.admin;
    const { data, error } = await admin
      .from("users")
      .select("id, email")
      .eq("id", ctx.user.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.user.id);
    expect(data?.email).toBe(ctx.user.email);
  });

  it("should query the trip back via authenticated client (RLS)", async () => {
    const caller = ctx.caller();
    const trip = await caller.trips.getById({ tripId });

    expect(trip.id).toBe(tripId);
    expect(trip.title).toBe("Smoke Test Trip");
  });

  it("should compute trip_status via Postgres function", async () => {
    // Trip has no dates/locked destination → 'planning'
    const admin = ctx.admin;
    const { data, error } = await admin
      .from("trips")
      .select("id, trip_status")
      .eq("id", tripId)
      .single();

    expect(error).toBeNull();
    expect(data?.trip_status).toBe("planning");
  });

  it("should have all core tables accessible", async () => {
    const admin = getAdminClient();
    const tables = [
      "users", "series", "trips", "events", "teams", "players",
      "team_assignments", "play_groups", "rounds", "side_events",
      "group_results", "group_result_scores", "hole_results",
      "player_hole_scores", "trip_members", "ideas", "idea_votes",
      "idea_comments", "date_polls", "date_windows", "date_poll_votes",
      "reservations", "expenses", "expense_splits", "messages",
      "notification_events", "notification_reads", "quick_info_tiles",
    ];

    for (const table of tables) {
      const { error } = await admin.from(table).select("*").limit(0);
      expect(error, `Table "${table}" should be accessible`).toBeNull();
    }
  });

  it("should return data from round_results view", async () => {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("round_results")
      .select("round_id, team_id, total_points")
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    // View may be empty if no seed data; just verify the view works
    if (data!.length > 0) {
      expect(data![0]).toHaveProperty("round_id");
      expect(data![0]).toHaveProperty("team_id");
      expect(data![0]).toHaveProperty("total_points");
    }
  });
});
