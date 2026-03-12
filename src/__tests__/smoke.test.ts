import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Smoke test — Phase 0 sanity checks against the live Supabase project.
 *
 * Uses the service role key (bypasses RLS) when available, otherwise
 * falls back to anon key for read-only checks.
 *
 * Tests:
 *  1. Sign up a throwaway user via Supabase Auth + insert into public.users
 *  2. Insert a trip row and query it back
 *  3. Verify the round_results view returns seeded data
 *  4. Verify trip_status computed column works
 *  5. Clean up test data
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Use service role if available (bypasses RLS), otherwise anon
const client = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY
);

const hasServiceKey = !!SUPABASE_SERVICE_KEY;

const TEST_EMAIL = `smoke-test-${Date.now()}@test.local`;
const TEST_PASSWORD = "SmokeTe$t-2026!";
const TEST_USER_ID = `smoke-user-${Date.now()}`;
const TEST_TRIP_ID = `smoke-trip-${Date.now()}`;

let authUserId: string | null = null;

describe("Phase 0 Smoke Test", () => {
  // --- Auth & write tests (require service role key) ---

  it.skipIf(!hasServiceKey)(
    "should sign up a new user via Supabase Auth",
    async () => {
      const { data, error } = await client.auth.admin.createUser({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        email_confirm: true,
      });

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      authUserId = data.user!.id;
    }
  );

  it.skipIf(!hasServiceKey)(
    "should insert into public.users table",
    async () => {
      const { error } = await client.from("users").insert({
        id: TEST_USER_ID,
        name: "Smoke Tester",
        nickname: "smokey",
        email: TEST_EMAIL,
      });
      expect(error).toBeNull();
    }
  );

  it.skipIf(!hasServiceKey)(
    "should create a trip and query it back",
    async () => {
      // Insert trip
      const { error: insertErr } = await client.from("trips").insert({
        id: TEST_TRIP_ID,
        title: "Smoke Test Trip",
        description: "Created by vitest smoke test",
      });
      expect(insertErr).toBeNull();

      // Add trip member (needed for RLS)
      const { error: memberErr } = await client.from("trip_members").insert({
        trip_id: TEST_TRIP_ID,
        user_id: TEST_USER_ID,
        role: "Owner",
        status: "in",
      });
      expect(memberErr).toBeNull();

      // Query back
      const { data, error: selectErr } = await client
        .from("trips")
        .select("id, title, description")
        .eq("id", TEST_TRIP_ID)
        .single();

      expect(selectErr).toBeNull();
      expect(data).toMatchObject({
        id: TEST_TRIP_ID,
        title: "Smoke Test Trip",
        description: "Created by vitest smoke test",
      });
    }
  );

  it.skipIf(!hasServiceKey)(
    "should compute trip_status via Postgres function",
    async () => {
      // Smoke test trip has no dates/locked destination → 'planning'
      const { data, error } = await client
        .from("trips")
        .select("id, trip_status")
        .eq("id", TEST_TRIP_ID)
        .single();

      expect(error).toBeNull();
      expect(data?.trip_status).toBe("planning");
    }
  );

  // --- Read-only tests (work with anon key too) ---

  it("should have all 26 tables accessible", async () => {
    const tables = [
      "users",
      "series",
      "trips",
      "events",
      "teams",
      "players",
      "team_assignments",
      "play_groups",
      "rounds",
      "side_events",
      "group_results",
      "group_result_scores",
      "hole_results",
      "player_hole_scores",
      "trip_members",
      "ideas",
      "idea_votes",
      "idea_comments",
      "date_polls",
      "date_windows",
      "date_poll_votes",
      "reservations",
      "expenses",
      "expense_splits",
      "messages",
      "notification_events",
      "notification_reads",
      "quick_info_tiles",
    ];

    for (const table of tables) {
      const { error } = await client.from(table).select("*").limit(0);
      expect(error, `Table "${table}" should be accessible`).toBeNull();
    }
  });

  it("should return seeded data from round_results view", async () => {
    const { data, error } = await client
      .from("round_results")
      .select("round_id, team_id, total_points")
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0]).toHaveProperty("round_id");
    expect(data![0]).toHaveProperty("team_id");
    expect(data![0]).toHaveProperty("total_points");
  });

  // --- Cleanup ---

  it.skipIf(!hasServiceKey)("cleanup: remove test data", async () => {
    await client.from("trip_members").delete().eq("trip_id", TEST_TRIP_ID);
    await client.from("trips").delete().eq("id", TEST_TRIP_ID);
    await client.from("users").delete().eq("id", TEST_USER_ID);
    if (authUserId) {
      await client.auth.admin.deleteUser(authUserId);
    }
  });
});
