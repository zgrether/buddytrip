import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripMembersRouter = router({
  // -----------------------------------------------------------------------
  // list — all members of a trip (any member can view)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .select("trip_id, user_id, role, status, joined_at")
        .eq("trip_id", ctx.tripId)
        .order("joined_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch members",
        });
      }

      // Join user info
      const userIds = (data ?? []).map((m) => m.user_id);
      const { data: users } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, email")
        .in("id", userIds);

      const userMap = new Map((users ?? []).map((u) => [u.id, u]));
      return (data ?? []).map((m) => ({
        ...m,
        user: userMap.get(m.user_id) ?? null,
      }));
    }),

  // -----------------------------------------------------------------------
  // add — Owner or Planner can add members (canEdit)
  // -----------------------------------------------------------------------
  add: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        role: z.enum(["Planner", "Member"]).default("Member"),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Check if already a member
      const { data: existing } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this trip",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .insert({
          trip_id: ctx.tripId,
          user_id: input.userId,
          role: input.role,
          status: "maybe",
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add member: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // updateRole — Owner only, can promote/demote (not self)
  // -----------------------------------------------------------------------
  updateRole: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        role: z.enum(["Planner", "Member"]),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change your own role",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update({ role: input.role })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update role",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — Owner only (not self)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself",
        });
      }

      const { error } = await ctx.supabase
        .from("trip_members")
        .delete()
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove member",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // updateRsvp — any member can update their own RSVP status
  // -----------------------------------------------------------------------
  updateRsvp: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        status: z.enum(["in", "likely", "maybe", "out"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update({ status: input.status })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update RSVP",
        });
      }

      return data;
    }),
});
