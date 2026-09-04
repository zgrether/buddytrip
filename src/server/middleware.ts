import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { middleware } from "./trpc";

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

export type TripRole = "Owner" | "Organizer" | "Member";

const ROLE_LEVEL: Record<TripRole, number> = {
  Owner: 3,
  Organizer: 2,
  Member: 1,
};

/** The trip membership check RAN and the answer was no. A real refusal. */
export const NOT_A_MEMBER_MESSAGE = "You are not a member of this trip";

/**
 * The trip membership check COULD NOT RUN. Not a refusal — we do not know.
 *
 * Names the failed check rather than a conclusion, and gives the one action
 * that helps (wait, retry), because the conditions that produce it are
 * transient by nature. Never tell someone they have been removed from a trip
 * on the strength of a query that did not answer.
 */
export const GATE_UNAVAILABLE_MESSAGE =
  "Couldn't check your access to this trip just now. Nothing is lost — try again in a moment.";

// ---------------------------------------------------------------------------
// requireTripMember
//
// Reads `tripId` from rawInput, queries trip_members, and adds
// `tripId` + `tripRole` to ctx.  Throws FORBIDDEN if not a member.
// ---------------------------------------------------------------------------

export const requireTripMember = middleware(async ({ ctx, getRawInput, next }) => {
  const raw = await getRawInput();
  const parsed = z.object({ tripId: z.string() }).safeParse(raw);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "tripId is required",
    });
  }
  const { tripId } = parsed.data;

  const role = await resolveTripRole(ctx, tripId);

  return next({
    ctx: {
      ...ctx,
      tripId,
      tripRole: role,
    },
  });
});

// ---------------------------------------------------------------------------
// requireTripRole(minRole)
//
// Factory — returns middleware that checks the user's trip role is at least
// `minRole` in the hierarchy: Owner > Organizer > Member.
//
// Must be chained AFTER authedProcedure (ctx.user is non-null).
// Reads tripId from rawInput, same as requireTripMember.
// ---------------------------------------------------------------------------

export function requireTripRole(minRole: TripRole) {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "tripId is required",
      });
    }
    const { tripId } = parsed.data;

    const role = await resolveTripRole(ctx, tripId);
    if (ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${minRole} role or higher`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        tripId,
        tripRole: role,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Competition roles — the competition's OWN role model (container-independent).
//
// The competition gate honors EXACTLY these roles and nothing else; it must
// NEVER reach up and check trip roles directly. Instead the CONTAINER grants
// competition roles: `resolveCompetitionRole` is the container's trip→competition
// mapping (its implementation of "who are my co-admins"), and it is LIVE —
// derived fresh from current trip membership on every check, never snapshotted.
// Demote a trip organizer and their co-admin access is gone on the NEXT check
// (no stale grant to leak). This is the same live-derivation discipline as the
// roster seed reading team_assignments at pairing time.
//
//   co-admin = owner-minus-destructive: configure any game, edit teams, post any
//   result, go-live — but NOT delete the competition / transfer ownership.
//
// Container mapping (trip-attached): Owner→owner, Organizer→co_admin, else member.
// Standalone / Circle are FUTURE container mappings — they swap this derivation,
// not the gate. The gate below only ever asks for the competition role.
// ---------------------------------------------------------------------------

export type CompetitionRole = "owner" | "co_admin" | "member";

const COMP_ROLE_LEVEL: Record<CompetitionRole, number> = {
  owner: 3,
  co_admin: 2,
  member: 1,
};

async function resolveCompetitionRole(
  ctx: {
    supabase: { from: (t: string) => unknown };
    user: { id: string } | null;
    membershipCache: Map<string, TripRole>;
  },
  tripId: string
): Promise<CompetitionRole> {
  // The ONLY place the trip role is consulted for competition authority — the
  // container mapping, live-derived (resolveTripRole reads current membership).
  const tripRole = await resolveTripRole(ctx, tripId);
  if (tripRole === "Owner") return "owner";
  if (tripRole === "Organizer") return "co_admin";
  return "member";
}

// requireCompetitionRole(minRole) — competition-level gate (go-live, delete,
// team edits). Checks the COMPETITION role granted by the container, never the
// trip role. Reads tripId from rawInput; chain AFTER authedProcedure.
export function requireCompetitionRole(minRole: CompetitionRole) {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "tripId is required" });
    }
    const { tripId } = parsed.data;
    const role = await resolveCompetitionRole(ctx, tripId);
    if (COMP_ROLE_LEVEL[role] < COMP_ROLE_LEVEL[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          minRole === "owner"
            ? "Only the competition owner can do this."
            : "Requires competition co-admin access.",
      });
    }
    return next({ ctx: { ...ctx, tripId } });
  });
}

// ---------------------------------------------------------------------------
// requireGameEdit (Slice D1 §8; co-admin role-model)
//
// The per-game edit gate: passes if the user is a competition owner/co-admin
// (granted by the container) OR a delegated organizer of THIS game
// (game_delegates row). Game-isolated — a pick'em delegate cannot touch the
// scramble. Mirror of the DB rule (is_game_delegate, migration 045 → renamed 061).
//
// Authority is the COMPETITION role, not the trip role — the trip→co-admin
// mapping lives in resolveCompetitionRole (the container), so this gate stays
// container-independent (standalone / Circle just change the mapping). Phase-
// independent: there is no competition-status condition here, by design.
//
// Reads tripId + gameId from rawInput. Chain AFTER authedProcedure. Use on every
// game-EDIT mutation (configure / enter-results); game CREATE stays trip-role
// (you can't be delegated to a game that doesn't exist yet).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// requireTeamIdentityEdit
//
// The captain permission tier (Rosters PR b2). Allows the trip Owner OR the
// captain of THAT team (team_assignments.is_captain). Admits two things:
//   - team IDENTITY — name / short name / color (`teams.update`, mig 065)
//   - roster ORDER  — `teamAssignments.reorder` (mig 094)
//
// MEMBERSHIP stays owner-only and does NOT use this gate — don't widen it:
// assign/remove players, appointing the captain (setCaptain), create/delete
// team. Order was moved onto this gate deliberately (094) because it is display
// order, not membership: reorder is permutation-validated against the team's
// current roster, so it cannot add, drop or move anyone. Keep that line — the
// gate is "identity + presentation of a team you already run", not "roster
// control". See mig 094's header and PERMISSIONS.md.
//
// Reads tripId + teamId from rawInput; scopes to THAT teamId (captaincy of some
// other team does not admit you). Chain AFTER authedProcedure.
// ---------------------------------------------------------------------------

export function requireTeamIdentityEdit() {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string(), teamId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "tripId and teamId are required" });
    }
    const { tripId, teamId } = parsed.data;
    const db = ctx.supabase as unknown as SupabaseClient;

    // The team must belong to THIS trip (defends a teamId from another trip
    // paired with a trip the caller happens to be a member of).
    const { data: team } = await db
      .from("teams")
      .select("competition_id")
      .eq("id", teamId)
      .maybeSingle();
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
    const { data: comp } = await db
      .from("competitions")
      .select("trip_id")
      .eq("id", team.competition_id as string)
      .maybeSingle();
    if (!comp || comp.trip_id !== tripId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found in this trip" });
    }

    // Owner of the trip → allowed (resolveTripRole also confirms membership).
    const role = await resolveTripRole(ctx, tripId);
    if (role === "Owner") {
      return next({ ctx: { ...ctx, tripId } });
    }

    // Else: the captain of THIS team may edit its identity.
    const { data: cap } = await db
      .from("team_assignments")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", ctx.user!.id)
      .eq("is_captain", true)
      .maybeSingle();
    if (cap) {
      return next({ ctx: { ...ctx, tripId } });
    }

    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner or this team's captain can edit its identity.",
    });
  });
}

// canEditGame — the NON-throwing core of requireGameEdit (A2-core). True when the
// user is a competition owner/co-admin (container-granted) OR a delegate of THIS
// game (game_delegates row). The throwing middlewares below wrap it; READS that
// must stay callable by members (e.g. the game scoreboard page, which a member
// loads but sees redacted for a pending game) call it directly and branch on the
// boolean instead of catching a throw. One home for "can this user edit / see the
// setup of this game". Mirrors the DB rule `is_game_delegate` (migration 061).
export async function canEditGame(
  ctx: {
    supabase: { from: (t: string) => unknown };
    user: { id: string } | null;
    membershipCache: Map<string, TripRole>;
  },
  tripId: string,
  gameId: string
): Promise<boolean> {
  // Competition role first (owner/co-admin edit any game). resolveCompetitionRole
  // returns "member" for a plain member (it only throws for a non-member, which a
  // requireTripMember-gated read has already excluded) — so this is safe on reads.
  const compRole = await resolveCompetitionRole(ctx, tripId);
  if (COMP_ROLE_LEVEL[compRole] >= COMP_ROLE_LEVEL.co_admin) return true;
  if (!ctx.user) return false;
  // …otherwise a delegated organizer of THIS game (game-isolated).
  const { data } = await (
    ctx.supabase.from("game_delegates") as unknown as {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { game_id: string } | null }>;
          };
        };
      };
    }
  )
    .select("game_id")
    .eq("game_id", gameId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return !!data;
}

export function requireGameEdit() {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string(), gameId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "tripId and gameId are required" });
    }
    const { tripId, gameId } = parsed.data;

    if (!(await canEditGame(ctx, tripId, gameId))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Requires competition co-admin access or a game-organizer grant for this game",
      });
    }

    return next({ ctx: { ...ctx, tripId } });
  });
}

// ---------------------------------------------------------------------------
// requireGameRunAction (Slice D Run/Post §5; co-admin role-model)
//
// Competition RUN-actions (post results / open score correction): a competition
// owner/co-admin (granted by the container) OR THIS game's delegate. Co-admin is
// owner-minus-destructive, and posting a result is operational, not destructive —
// so co-admins post (the game-day redundancy this role exists for). Authority is
// the COMPETITION role, never the trip role; enforced server-side so the controls
// can't be reached by hiding the UI.
// ---------------------------------------------------------------------------

export function requireGameRunAction() {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string(), gameId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "tripId and gameId are required" });
    }
    const { tripId, gameId } = parsed.data;

    if (!(await canEditGame(ctx, tripId, gameId))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Posting and score corrections are limited to a competition owner/co-admin or this game's delegate.",
      });
    }

    return next({ ctx: { ...ctx, tripId } });
  });
}

// ---------------------------------------------------------------------------
// resolveTripRole — internal shared lookup with request-scoped cache.
//
// Every batched procedure that uses requireTripMember / requireTripRole
// against the same tripId reuses the first SELECT's result. The cache
// lives on ctx and dies with the request, so it can't drift across
// trips or sessions.
// ---------------------------------------------------------------------------

export async function resolveTripRole(
  ctx: {
    supabase: { from: (t: string) => unknown };
    user: { id: string } | null;
    membershipCache: Map<string, TripRole>;
  },
  tripId: string
): Promise<TripRole> {
  const cached = ctx.membershipCache.get(tripId);
  if (cached) return cached;

  const { data: member, error } = await (
    ctx.supabase.from("trip_members") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          eq: (
            c: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: { role: TripRole } | null;
              error: unknown;
            }>;
          };
        };
      };
    }
  )
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", ctx.user!.id)
    .maybeSingle();

  /**
   * ── A FAILED CHECK IS NOT A REFUSAL ────────────────────────────────────────
   *
   * These were one branch — `if (error || !member) throw FORBIDDEN "You are not
   * a member of this trip"` — so any failure of the QUERY told the caller they
   * had been removed from the trip.
   *
   * Lived 2026-09-04, 18:06:44 UTC. Six people stress-testing exhausted
   * PostgREST's connection pool (`PGRST003: Timed out acquiring connection from
   * connection pool`), and this exact SELECT came back 504:
   *
   *     GET /trip_members?select=role&trip_id=eq.1fccd7cb…&user_id=eq.0a567efb…
   *       → 504
   *
   * Everyone on the trip was told they were not on it, mid-round. It is the
   * CLAUDE.md "empty is not unknown" rule — `error` means *we do not know*,
   * `!member` means *definitively not a member* — landing in the security gate,
   * where the wrong answer accuses the user and sends them looking for a
   * permissions problem that does not exist.
   *
   * ── Why `maybeSingle`, and why the naive split would have been WORSE ───────
   *
   * `.single()` raises an error for zero rows (PGRST116) as well as for a real
   * failure, so splitting `error` from `!member` while keeping `.single()`
   * would route every GENUINE non-member into the "check failed" branch — the
   * same conflation pointed the other way, and this time it would hide real
   * permission refusals behind a retry suggestion. `maybeSingle()` returns
   * `data: null, error: null` for zero rows, which makes the distinction
   * STRUCTURAL rather than a string comparison on an error code.
   *
   * ── The log line is the other half ────────────────────────────────────────
   *
   * The 504 was invisible from inside the app: it presented only as a
   * membership refusal, which is why the outage read as a permissions bug for
   * the first twenty minutes. A gate that cannot answer now says so where the
   * next investigation will find it.
   *
   * Thirteen other non-test call sites share the `if (error || !data)` shape
   * (`games.ts:442`'s "Game not found" among them). They are a class sweep
   * AFTER the trip; this one is the security gate and runs on every request.
   */
  if (error) {
    // `String(err)` renders a PostgREST error object as "[object Object]" —
    // which is the SHAPE THIS GATE ACTUALLY RECEIVES (supabase-js returns a
    // plain `{ code, message, details, hint }`, not an Error), so the naive
    // version would have discarded `PGRST003` and reproduced the invisibility
    // this log exists to end. Caught by the test below, not by reading.
    console.error(
      JSON.stringify({
        tag: "trip-gate-unavailable",
        tripId,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null
              ? error
              : String(error),
      })
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: GATE_UNAVAILABLE_MESSAGE,
    });
  }

  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: NOT_A_MEMBER_MESSAGE,
    });
  }

  const role = member.role as TripRole;
  ctx.membershipCache.set(tripId, role);
  return role;
}
