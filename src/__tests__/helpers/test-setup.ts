/**
 * Integration test helpers — shared persistent users + unique trips.
 *
 * Pattern:
 *   - 4 shared users (owner, planner, member, outsider) signed in by global-setup
 *   - Each test file creates unique trips for isolation
 *   - Service role client for setup/teardown (seed data, cleanup)
 *   - Authenticated clients via bearer token injection (no auth endpoint calls)
 *
 * Usage:
 *   const ctx = await TestContext.create();
 *   const caller = ctx.caller();              // tRPC caller as owner
 *   const memberCaller = ctx.callerAs("member");
 *   await ctx.cleanup();
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCallerFactory, type TRPCContext } from "../../server/trpc";
import { appRouter } from "../../server/router";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { AuthData, SharedUser } from "./global-setup";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const factory = createCallerFactory(appRouter);

// ---------------------------------------------------------------------------
// Shared auth data (loaded once per worker from file written by global-setup)
// ---------------------------------------------------------------------------

const AUTH_FILE = resolve(__dirname, "../../../.test-auth.json");
let _authData: AuthData | null = null;

function getAuthData(): AuthData {
  if (!_authData) {
    _authData = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  }
  return _authData!;
}

export type UserRole = "owner" | "planner" | "member" | "outsider";

function getSharedUser(role: UserRole): SharedUser {
  return getAuthData()[role];
}

// ---------------------------------------------------------------------------
// Admin client (service role — bypasses RLS, for setup/teardown only)
// ---------------------------------------------------------------------------

export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ---------------------------------------------------------------------------
// Authenticated client from shared token (no auth endpoint calls)
// ---------------------------------------------------------------------------

function createAuthenticatedClient(shared: SharedUser): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${shared.access_token}` },
    },
  });
}

// ---------------------------------------------------------------------------
// tRPC caller with authenticated Supabase client
// ---------------------------------------------------------------------------

function createCallerForUser(shared: SharedUser) {
  const client = createAuthenticatedClient(shared);
  const user = { id: shared.id, email: shared.email };
  const ctx: TRPCContext = { supabase: client, user, membershipCache: new Map() };
  return factory(ctx);
}

/** tRPC caller with unauthenticated (anon) Supabase client. */
export function createAnonCaller() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const ctx: TRPCContext = { supabase: client, user: null, membershipCache: new Map() };
  return factory(ctx);
}

// ---------------------------------------------------------------------------
// TestContext — manages trips + cleanup for shared users
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
}

export class TestContext {
  readonly admin: SupabaseClient;

  /** The primary user (owner role by default). */
  readonly user: TestUser;

  /** All allocated user roles for this context. */
  private _users: Map<UserRole, TestUser> = new Map();

  /** IDs of resources created via helper methods, cleaned up automatically. */
  private _tripIds: string[] = [];
  private _competitionIds: string[] = [];
  private _groupIds: string[] = [];
  private _teamIds: string[] = [];

  private constructor(admin: SupabaseClient, primaryUser: TestUser) {
    this.admin = admin;
    this.user = primaryUser;
    this._users.set(primaryUser.role, primaryUser);
  }

  /** Create a context. Primary user defaults to "owner". */
  static async create(): Promise<TestContext> {
    const admin = getAdminClient();
    const shared = getSharedUser("owner");
    const user: TestUser = { id: shared.id, email: shared.email, role: "owner" };
    return new TestContext(admin, user);
  }

  /** Get a TestUser for a given role. */
  getUser(role: UserRole): TestUser {
    const cached = this._users.get(role);
    if (cached) return cached;
    const shared = getSharedUser(role);
    const user: TestUser = { id: shared.id, email: shared.email, role };
    this._users.set(role, user);
    return user;
  }

  /** Get an authenticated tRPC caller for the primary user (owner). */
  caller() {
    return createCallerForUser(getSharedUser(this.user.role));
  }

  /** Get an authenticated tRPC caller for a specific role. */
  callerAs(role: UserRole) {
    return createCallerForUser(getSharedUser(role));
  }

  // ---- Trip helpers ----

  /** Create a trip with the primary user as Owner. */
  async createTrip(title = "Test Trip"): Promise<string> {
    const tripId = `test-trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error: tripErr } = await this.admin
      .from("trips")
      .insert({ id: tripId, title });
    if (tripErr) throw new Error(`Failed to create trip: ${tripErr.message}`);

    const { error: memberErr } = await this.admin
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: this.user.id, role: "Owner", status: "in" });
    if (memberErr) throw new Error(`Failed to add trip member: ${memberErr.message}`);

    this._tripIds.push(tripId);
    return tripId;
  }

  /** Add a user (by role) to a trip. */
  async addTripMember(
    tripId: string,
    role: UserRole,
    tripRole: "Owner" | "Organizer" | "Member" = "Member"
  ) {
    const user = this.getUser(role);
    const { error } = await this.admin
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: user.id, role: tripRole, status: "in" });
    if (error) throw new Error(`Failed to add trip member: ${error.message}`);
  }

  /** Add a user by userId to a trip (for cases where you have the id directly). */
  async addTripMemberById(
    tripId: string,
    userId: string,
    tripRole: "Owner" | "Organizer" | "Member" = "Member"
  ) {
    const { error } = await this.admin
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: userId, role: tripRole, status: "in" });
    if (error) throw new Error(`Failed to add trip member: ${error.message}`);
  }

  /** Create a competition for a trip. */
  async createCompetition(
    tripId: string,
    name = "Test Competition",
    opts: { scoringModel?: "match_play" | "points" } = {}
  ): Promise<string> {
    const competitionId = `test-comp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const { error } = await this.admin
      .from("competitions")
      .insert({
        id: competitionId,
        trip_id: tripId,
        name,
        // Default (omitted) → the DB default 'match_play'. Suites that test the
        // points/placement award model pass scoringModel:'points' (W-NONGOLF-02).
        ...(opts.scoringModel ? { scoring_model: opts.scoringModel } : {}),
      });
    if (error) throw new Error(`Failed to create competition: ${error.message}`);
    this._competitionIds.push(competitionId);
    return competitionId;
  }

  /** Create a team under a competition. */
  async createTeam(
    competitionId: string,
    name = "Team A",
    opts: { shortName?: string; color?: string; colorDim?: string } = {}
  ): Promise<string> {
    const teamId = `test-team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await this.admin.from("teams").insert({
      id: teamId,
      competition_id: competitionId,
      name,
      short_name: opts.shortName ?? name.slice(0, 3).toUpperCase(),
      color: opts.color ?? "#3b82f6",
      color_dim: opts.colorDim ?? "#0a1a2a",
    });
    if (error) throw new Error(`Failed to create team: ${error.message}`);
    this._teamIds.push(teamId);
    return teamId;
  }

  /** Create a play group under an event. */
  async createPlayGroup(
    eventId: string,
    playerIds: string[],
    name: string | null = "Group A"
  ): Promise<string> {
    const groupId = `test-grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await this.admin.from("play_groups").insert({
      id: groupId,
      event_id: eventId,
      name,
      tee_time: "8:00 AM",
      player_ids: playerIds,
    });
    if (error) throw new Error(`Failed to create play group: ${error.message}`);
    this._groupIds.push(groupId);
    return groupId;
  }

  /** Register a trip ID created externally (e.g. via tRPC caller) for cleanup. */
  trackTrip(tripId: string) {
    if (!this._tripIds.includes(tripId)) this._tripIds.push(tripId);
  }

  /** Register a competition ID created externally for cleanup. */
  trackCompetition(competitionId: string) {
    if (!this._competitionIds.includes(competitionId))
      this._competitionIds.push(competitionId);
  }

  /** Register a team ID created externally for cleanup. */
  trackTeam(teamId: string) {
    if (!this._teamIds.includes(teamId)) this._teamIds.push(teamId);
  }

  /** Register a play group ID created externally for cleanup. */
  trackGroup(groupId: string) {
    if (!this._groupIds.includes(groupId)) this._groupIds.push(groupId);
  }

  /** Delete all test data created by this context. Users are persistent — never deleted. */
  async cleanup() {
    // Play groups (group-scoped)
    for (const groupId of this._groupIds) {
      await this.admin.from("play_groups").delete().eq("id", groupId);
    }
    // Team assignments + teams (competition-scoped)
    for (const competitionId of this._competitionIds) {
      await this.admin
        .from("team_assignments")
        .delete()
        .eq("competition_id", competitionId);
    }
    for (const teamId of this._teamIds) {
      await this.admin.from("teams").delete().eq("id", teamId);
    }
    for (const competitionId of this._competitionIds) {
      await this.admin.from("teams").delete().eq("competition_id", competitionId);
    }
    // Scoreboard shares (competition-scoped per migration 062)
    for (const competitionId of this._competitionIds) {
      await this.admin
        .from("scoreboard_shares")
        .delete()
        .eq("competition_id", competitionId);
    }
    // Competitions
    for (const competitionId of this._competitionIds) {
      await this.admin.from("competitions").delete().eq("id", competitionId);
    }
    // Trip-level tables
    for (const tripId of this._tripIds) {
      await this.admin.from("messages").delete().eq("trip_id", tripId);
      await this.admin.from("idea_comments").delete().eq("trip_id", tripId);
      await this.admin.from("idea_votes").delete().eq("trip_id", tripId);
      await this.admin.from("ideas").delete().eq("trip_id", tripId);
      const { data: windows } = await this.admin
        .from("date_windows").select("id").eq("trip_id", tripId);
      for (const win of windows ?? []) {
        await this.admin.from("date_poll_votes").delete().eq("window_id", win.id);
      }
      await this.admin.from("date_windows").delete().eq("trip_id", tripId);
      const { data: expenses } = await this.admin
        .from("expenses").select("id").eq("trip_id", tripId);
      const expenseIds = expenses?.map((e: { id: string }) => e.id) ?? [];
      if (expenseIds.length > 0) {
        await this.admin.from("expense_splits").delete().in("expense_id", expenseIds);
      }
      await this.admin.from("expenses").delete().eq("trip_id", tripId);
      await this.admin.from("reservations").delete().eq("trip_id", tripId);
      await this.admin.from("quick_info_tiles").delete().eq("trip_id", tripId);
      await this.admin.from("trip_members").delete().eq("trip_id", tripId);
      await this.admin.from("trips").delete().eq("id", tripId);
    }
  }
}

/** Generate a unique test ID with optional prefix. */
export function genId(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
