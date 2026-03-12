import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { middleware } from "./trpc";

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

export type TripRole = "Owner" | "Planner" | "Member";

const ROLE_LEVEL: Record<TripRole, number> = {
  Owner: 3,
  Planner: 2,
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

  const { data: member, error } = await ctx.supabase
    .from("trip_members")
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

  return next({
    ctx: {
      ...ctx,
      tripId,
      tripRole: member.role as TripRole,
    },
  });
});

// ---------------------------------------------------------------------------
// requireTripRole(minRole)
//
// Factory — returns middleware that checks the user's trip role is at least
// `minRole` in the hierarchy: Owner > Planner > Member.
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

    const { data: member, error } = await ctx.supabase
      .from("trip_members")
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
