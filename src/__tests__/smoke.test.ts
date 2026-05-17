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
    // 27 tables remaining post-cleanup (AUDIT_FINDINGS.md). The score
    // entry pipeline (play_groups, player_hole_scores, group_results),
    // the legacy reservations table, idea_comments, golf_course_details,
    // and scoreboard_shares were all dropped during pre-launch cleanup.
    const tables = [
      "users", "series", "trips",
      "competitions", "events", "event_point_distributions",
      "teams", "team_assignments",
      "golf_courses",
      "trip_members", "ideas", "idea_votes", "idea_lodging_options",
      "archived_ideas", "catalog_ideas",
      "date_polls", "date_windows", "date_poll_votes",
      "expenses", "expense_splits", "messages",
      "notification_events", "notification_reads", "quick_info_tiles",
      "schedule_items", "logistics_items", "invites",
    ];

    for (const table of tables) {
      const { error } = await admin.from(table).select("*").limit(0);
      expect(error, `Table "${table}" should be accessible`).toBeNull();
    }
  });
});
