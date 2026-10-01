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
import { strictTestClient } from "./strictTestClient";
import { createCallerFactory, type TRPCContext } from "../../server/trpc";
import { appRouter } from "../../server/router";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { AuthData, SharedUser } from "./global-setup";
import { withSeedRetry } from "./seedRetry";
import { deleteTestTrips } from "./deleteTestTrips";

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
  // Strict (#1527): an infrastructure failure THROWS, so a test can never read a
  // 502 as "no rows" and report it as a behaviour regression.
  return strictTestClient(createClient(SUPABASE_URL, SERVICE_KEY), "admin");
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

/** A throwaway account made by `TestContext.createAccount`. */
export interface TestAccount {
  id: string;
  email: string;
  caller: () => ReturnType<typeof createCallerForUser>;
  client: () => SupabaseClient;
}

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
  private _accountIds: string[] = [];

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

  /**
   * A THROWAWAY real account, owned by this context and deleted by `cleanup()`.
   *
   * For any test that makes an account the TARGET of a destructive write — a
   * guest link or an invite claim, both of which run the merge, move rows onto
   * the account and delete the placeholder. Six files used the shared
   * `outsider` for this and wrote into each other's state when run in parallel
   * (a different one failed each run). A shared account is fine to READ as; it
   * is not fine to merge INTO. See CLAUDE.md's destructive-write rule.
   *
   * Created like a real signup (the `handle_new_user` trigger makes its
   * `users` row) and signed in, so it can also act as the claimant.
   */
  async createAccount(label: string): Promise<TestAccount> {
    const email = `acct-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`.toLowerCase();
    const password = `Acct-${Math.random().toString(36).slice(2)}-${Date.now()}!`;
    const { data, error } = await this.admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name: `Account ${label}` },
    });
    if (error || !data.user) throw new Error(`createAccount(${label}): ${error?.message ?? "no user"}`);
    this._accountIds.push(data.user.id);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`createAccount(${label}) sign-in: ${res.status} ${await res.text()}`);
    const session = await res.json();
    const shared: SharedUser = {
      id: data.user.id, email, access_token: session.access_token, refresh_token: session.refresh_token,
    };
    return {
      id: shared.id,
      email,
      caller: () => createCallerForUser(shared),
      client: () => createAuthenticatedClient(shared),
    };
  }

  /** Get an authenticated tRPC caller for the primary user (owner). */
  caller() {
    return createCallerForUser(getSharedUser(this.user.role));
  }

  /** Get an authenticated tRPC caller for a specific role. */
  callerAs(role: UserRole) {
    return createCallerForUser(getSharedUser(role));
  }

  /** A raw Supabase client carrying a role's authenticated JWT (anon key +
   *  Bearer) — the `authenticated` Postgres role, RLS + function grants applied.
   *  Use to test what a logged-in user can reach DIRECTLY (e.g. an rpc() call to
   *  a SECURITY DEFINER function), bypassing the tRPC layer. */
  authedClient(role: UserRole): SupabaseClient {
    // Strict (#1527) — and here it also stops a 502 passing for an RLS refusal:
    // `expect(error).not.toBeNull()` is satisfied by either. The tRPC caller's
    // client (createCallerForUser) is deliberately NOT wrapped: that is the code
    // under test, and it already names its own 502s.
    return strictTestClient(createAuthenticatedClient(getSharedUser(role)), `authed(${role})`);
  }

  // ---- Trip helpers ----

  /** Create a trip with the primary user as Owner. */
  async createTrip(title = "Test Trip"): Promise<string> {
    const tripId = `test-trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await withSeedRetry(
      () => this.admin.from("trips").insert({ id: tripId, title }),
      "Failed to create trip"
    );

    await withSeedRetry(
      () =>
        this.admin
          .from("trip_members")
          .insert({ trip_id: tripId, user_id: this.user.id, role: "Owner", status: "in" }),
      "Failed to add trip member"
    );

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
    await withSeedRetry(
      () =>
        this.admin
          .from("trip_members")
          .insert({ trip_id: tripId, user_id: user.id, role: tripRole, status: "in" }),
      "Failed to add trip member"
    );
  }

  /** Add a user by userId to a trip (for cases where you have the id directly). */
  async addTripMemberById(
    tripId: string,
    userId: string,
    tripRole: "Owner" | "Organizer" | "Member" = "Member"
  ) {
    await withSeedRetry(
      () =>
        this.admin
          .from("trip_members")
          .insert({ trip_id: tripId, user_id: userId, role: tripRole, status: "in" }),
      "Failed to add trip member"
    );
  }

  /**
   * A trip and ITS competition, created together — THE sanctioned way to get a
   * competition in a test.
   *
   * A trip holds one competition (ruled 2026-09-22; UNIQUE (trip_id), migration
   * 195). Suites used to share one trip across a file and hang a fresh cup off it
   * per case for isolation, which built a state the app refuses: 37 files and 120
   * tests did it, and only the database constraint exposed them. So a test that
   * wants a cup gets a trip with it. `members` are added to the NEW trip (the
   * owner is added by `createTrip`), so a case needing a member or an organizer
   * says so here rather than borrowing another case's trip.
   */
  async createCupTrip(
    opts: {
      title?: string;
      name?: string;
      scoringModel?: "match_play" | "points";
      members?: Array<UserRole | [UserRole, "Owner" | "Organizer" | "Member"]>;
      /**
       * Team names to create, in order (sequentially: seeding in parallel races).
       *
       * Say so when the case means a TEAMED race. Since PR 7 a points race with
       * no teams is a legitimate state of its own — a TEAMLESS race, played as
       * individuals, which admits only formats that record a result per person
       * (`canPlayInTeamlessRace`). Before PR 7 this helper's zero-team points cup
       * was a state `competitions.create` could never produce (it seeds at least
       * two), and twelve files built team-paying games in it unnoticed.
       */
      teams?: string[];
    } = {}
  ): Promise<{ tripId: string; competitionId: string; teamIds: string[] }> {
    const tripId = await this.createTrip(opts.title ?? opts.name ?? "Cup Trip");
    for (const m of opts.members ?? []) {
      const [role, tripRole] = Array.isArray(m) ? m : [m, "Member" as const];
      await this.addTripMember(tripId, role, tripRole);
    }
    const competitionId = await this.createCompetition(tripId, opts.name, { scoringModel: opts.scoringModel });
    const teamIds: string[] = [];
    for (const name of opts.teams ?? []) teamIds.push(await this.createTeam(competitionId, name));
    return { tripId, competitionId, teamIds };
  }

  /**
   * Create a competition for a trip that does not have one yet.
   *
   * REFUSES a trip that already holds a competition, before the database is
   * asked — so a fixture cannot rebuild the forbidden state even where migration
   * 195's constraint is absent, and the failure names the fix. For a fresh trip
   * with its own cup, use `createCupTrip`.
   */
  async createCompetition(
    tripId: string,
    name = "Test Competition",
    opts: { scoringModel?: "match_play" | "points" } = {}
  ): Promise<string> {
    const { count, error: countErr } = await this.admin
      .from("competitions")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId);
    if (countErr) throw new Error(`createCompetition: couldn't check the trip's competitions: ${countErr.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        `createCompetition: trip ${tripId} already has a competition, and a trip holds one ` +
          `(migration 195). Use ctx.createCupTrip() to get a trip with its own competition.`
      );
    }
    const competitionId = `test-comp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    await withSeedRetry(
      () =>
        this.admin.from("competitions").insert({
          id: competitionId,
          trip_id: tripId,
          name,
          // Default (omitted) → the DB default 'match_play'. Suites that test the
          // points/placement award model pass scoringModel:'points' (W-NONGOLF-02).
          ...(opts.scoringModel ? { scoring_model: opts.scoringModel } : {}),
        }),
      "Failed to create competition"
    );
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
    await withSeedRetry(
      () =>
        this.admin.from("teams").insert({
          id: teamId,
          competition_id: competitionId,
          name,
          short_name: opts.shortName ?? name.slice(0, 3).toUpperCase(),
          color: opts.color ?? "#3b82f6",
          color_dim: opts.colorDim ?? "#0a1a2a",
        }),
      "Failed to create team"
    );
    this._teamIds.push(teamId);
    return teamId;
  }

  /**
   * Roster users onto a team. A Ryder cup (`scoring_model = 'match_play'`, the
   * column's DEFAULT) refuses an unrostered game participant since migration
   * 193, so a fixture that pairs or groups players in one must roster them
   * FIRST — the order the app requires, since its pickers offer only rostered
   * players. Cleared with the competition (FK cascade).
   */
  async assignTeam(competitionId: string, teamId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await withSeedRetry(
      () =>
        this.admin.from("team_assignments").insert(
          userIds.map((userId) => ({ competition_id: competitionId, team_id: teamId, user_id: userId })),
        ),
      "Failed to assign team"
    );
  }

  /** Create a play group under an event. */
  async createPlayGroup(
    eventId: string,
    playerIds: string[],
    name: string | null = "Group A"
  ): Promise<string> {
    const groupId = `test-grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await withSeedRetry(
      () =>
        this.admin.from("play_groups").insert({
          id: groupId,
          event_id: eventId,
          name,
          tee_time: "8:00 AM",
          player_ids: playerIds,
        }),
      "Failed to create play group"
    );
    this._groupIds.push(groupId);
    return groupId;
  }

  /**
   * Group stroke/rack participants into a play_group so the game reads as READY
   * (mig 089: stroke + rack go-live requires participants assigned to a PLAYING
   * GROUP — an ungrouped roster isn't ready). Call AFTER the roster is added
   * (`games.addParticipants` / `games.create`), BEFORE `games.enableScoring` /
   * a `scoringEnabled: true` save. The participants must already exist.
   * Returns the created play_group id (also registered for cleanup).
   */
  async groupStrokeParticipants(gameId: string, userIds: string[]): Promise<string> {
    const groupId = `test-grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await withSeedRetry(
      () =>
        this.admin.from("play_groups").insert({
          id: groupId,
          game_id: gameId,
          display_name: "Group 1",
          tee_time: null,
        }),
      "Failed to create play group"
    );
    this.trackGroup(groupId);

    // Idempotent: re-applying the same update sets the same value again — no
    // uniqueness constraint to collide with, so a plain 502-retry is safe
    // without the 23505 tell.
    await withSeedRetry(
      () =>
        this.admin
          .from("game_participants")
          .update({ play_group_id: groupId })
          .eq("game_id", gameId)
          .in("user_id", userIds),
      "Failed to assign play group",
      { idempotent: true }
    );

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
    // Competitions
    for (const competitionId of this._competitionIds) {
      await this.admin.from("competitions").delete().eq("id", competitionId);
    }
    // Trip-level tables — the ONE trip-removal path, shared with the run's
    // leak sweep (`global-setup.ts` teardown), so the two cannot drift.
    const failures = await deleteTestTrips(this.admin, this._tripIds);
    if (failures.length > 0) {
      // Loud, not thrown: a cleanup failure must not turn a passing file red,
      // but it is exactly how a trip survives — the sweep reports what remains.
      console.warn(`[TestContext.cleanup] ${failures.length} trip deletion(s) failed:\n  ${failures.join("\n  ")}`);
    }
    // Emptied, so a second cleanup() on the same context (or a helper reused
    // after one) never re-deletes, and anything created afterwards is tracked.
    // Throwaway accounts LAST: their rows may sit in the trips deleted above.
    // `handle_user_delete` removes the public.users row, and FKs cascade.
    for (const id of this._accountIds) {
      const { error } = await this.admin.auth.admin.deleteUser(id);
      if (error) console.warn(`[TestContext.cleanup] could not delete account ${id}: ${error.message}`);
    }
    this._accountIds = [];
    this._tripIds = [];
    this._competitionIds = [];
    this._teamIds = [];
    this._groupIds = [];
  }
}

/** Generate a unique test ID with optional prefix. */
export function genId(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
