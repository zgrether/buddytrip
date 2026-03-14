import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripMembersRouter = router({
  // -----------------------------------------------------------------------
  // list — all members of a trip (any member can view)
  //
  // Returns both real users and ghost crew in a unified shape.
  // Use `memberId` as the stable identifier (user_id ?? guest_crew_id).
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .select("id, trip_id, user_id, guest_crew_id, role, status, joined_at")
        .eq("trip_id", ctx.tripId)
        .order("joined_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch members",
        });
      }

      const rows = data ?? [];
      const userIds = rows.filter((m) => m.user_id).map((m) => m.user_id as string);
      const guestIds = rows.filter((m) => m.guest_crew_id).map((m) => m.guest_crew_id as string);

      const [usersResult, guestsResult] = await Promise.all([
        userIds.length > 0
          ? ctx.supabase.from("users").select("id, name, nickname, email").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; name: string | null; nickname: string | null; email: string | null }[] }),
        guestIds.length > 0
          ? ctx.supabase.from("guest_crew").select("id, name, email").in("id", guestIds)
          : Promise.resolve({ data: [] as { id: string; name: string; email: string | null }[] }),
      ]);

      const userMap = new Map((usersResult.data ?? []).map((u) => [u.id, u]));
      const guestMap = new Map((guestsResult.data ?? []).map((g) => [g.id, g]));

      return rows.map((m) => {
        const user = m.user_id ? (userMap.get(m.user_id) ?? null) : null;
        const guestCrew = m.guest_crew_id ? (guestMap.get(m.guest_crew_id) ?? null) : null;
        const isGuest = !!m.guest_crew_id;
        const memberId = (m.user_id ?? m.guest_crew_id) as string;
        const displayName = user
          ? (user.name ?? user.email ?? `User ${memberId.slice(0, 6)}`)
          : (guestCrew?.name ?? `Guest ${memberId.slice(0, 6)}`);

        return {
          ...m,
          user,
          guestCrew,
          memberId,
          isGuest,
          displayName,
        };
      });
    }),

  // -----------------------------------------------------------------------
  // add — Owner or Planner can add real-account members (canEdit)
  // To add ghost crew, use ghostCrew.create instead.
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
        .select("id")
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
          id: crypto.randomUUID(),
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
  // updateRole — Owner only, can promote/demote real members (not self)
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
  // remove — Owner only, removes a real member (not self)
  // To remove ghost crew, use ghostCrew.remove instead.
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
  // updateRsvp — any real member can update their own RSVP status
  // Ghost crew always stay "in" — no RSVP for ghosts.
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
