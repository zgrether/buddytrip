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
    // Trip has no dates/locked destination → 'idea' (stage model default)
    const admin = ctx.admin;
    const { data, error } = await admin
      .from("trips")
      .select("id, trip_status")
      .eq("id", tripId)
      .single();

    expect(error).toBeNull();
    expect(data?.trip_status).toBe("idea");
  });

  it("should have all core tables accessible", async () => {
    const admin = getAdminClient();
    // Reflects the post-062 schema rebuild: rounds / side_events / players /
    // group_result_scores / hole_results were dropped (Phase B will rebuild
    // scoring); competitions + event_point_distributions + golf_course_details
    // were added; events became scored activities under a competition.
    const tables = [
      "users", "series", "trips",
      "competitions", "events", "event_point_distributions",
      "teams", "team_assignments", "play_groups",
      "group_results", "player_hole_scores",
      "golf_courses", "golf_course_details",
      "trip_members", "ideas", "idea_votes",
      "idea_comments", "date_polls", "date_windows", "date_poll_votes",
      "reservations", "expenses", "expense_splits", "messages",
      "notification_events", "notification_reads", "quick_info_tiles",
    ];

    for (const table of tables) {
      const { error } = await admin.from(table).select("*").limit(0);
      expect(error, `Table "${table}" should be accessible`).toBeNull();
    }
  });

  // The legacy `round_results` view was dropped via CASCADE alongside
  // `rounds` and `group_result_scores` in migration 062. Phase B reintroduces
  // an equivalent view (or computes scoring inline) once the new scoring
  // surface is in place.
});
