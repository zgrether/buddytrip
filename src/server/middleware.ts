import { TRPCError } from "@trpc/server";
import { z } from "zod";
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
// (game_organizers row). Game-isolated — a pick'em delegate cannot touch the
// scramble. Mirror of the DB rule in migration 045 (is_game_organizer).
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

export function requireGameEdit() {
  return middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput();
    const parsed = z.object({ tripId: z.string(), gameId: z.string() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "tripId and gameId are required" });
    }
    const { tripId, gameId } = parsed.data;

    // Competition role first (owner/co-admin edit any game) — the container
    // grants it; this gate never checks the trip role itself.
    const compRole = await resolveCompetitionRole(ctx, tripId); // throws if not a member
    let allowed = COMP_ROLE_LEVEL[compRole] >= COMP_ROLE_LEVEL.co_admin;

    if (!allowed) {
      // …otherwise a delegated organizer of THIS game (game-isolated).
      const { data } = await (
        ctx.supabase.from("game_organizers") as unknown as {
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
        .eq("user_id", ctx.user!.id)
        .maybeSingle();
      allowed = !!data;
    }

    if (!allowed) {
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

    const compRole = await resolveCompetitionRole(ctx, tripId); // throws if not a member
    let allowed = COMP_ROLE_LEVEL[compRole] >= COMP_ROLE_LEVEL.co_admin;

    if (!allowed) {
      const { data } = await (
        ctx.supabase.from("game_organizers") as unknown as {
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
        .eq("user_id", ctx.user!.id)
        .maybeSingle();
      allowed = !!data;
    }

    if (!allowed) {
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

async function resolveTripRole(
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
            single: () => Promise<{
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
    .single();

  if (error || !member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this trip",
    });
  }

  const role = member.role as TripRole;
  ctx.membershipCache.set(tripId, role);
  return role;
}
