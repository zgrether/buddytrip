import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const ghostCrewRouter = router({
  // -----------------------------------------------------------------------
  // list — all ghost crew for a trip (any member can view)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("guest_crew")
        .select("id, trip_id, name, email, role, invited_at, created_at")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch ghost crew",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — add a ghost crew member (Planner+)
  //
  // If email is provided and matches an existing account, throws CONFLICT
  // so the caller can add them as a real member instead.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(100),
        email: z.string().email().optional(),
        role: z.enum(["Planner", "Member"]).default("Member"),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // If email provided, check if it already matches a registered user
      if (input.email) {
        const { data: existingUser } = await ctx.supabase
          .from("users")
          .select("id")
          .eq("email", input.email)
          .maybeSingle();

        if (existingUser) {
          // Check if they're already a trip member
          const { data: existingMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (existingMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A user with this email is already a crew member",
            });
          }

          // Real account exists but not yet a member — caller should add them
          // as a real member, not a ghost
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This email belongs to an existing BuddyTrip account. Add them as a crew member instead.",
          });
        }
      }

      // Insert ghost_crew record
      const { data: ghost, error: ghostError } = await ctx.supabase
        .from("guest_crew")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          name: input.name,
          email: input.email ?? null,
          role: input.role,
        })
        .select()
        .single();

      if (ghostError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create ghost crew: ${ghostError.message}`,
        });
      }

      // Insert corresponding trip_members row (ghosts are always "in")
      const { error: memberError } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          guest_crew_id: ghost.id,
          role: input.role,
          status: "in",
        });

      if (memberError) {
        // Rollback ghost_crew insert
        await ctx.supabase.from("guest_crew").delete().eq("id", ghost.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add ghost to trip members: ${memberError.message}`,
        });
      }

      return ghost;
    }),

  // -----------------------------------------------------------------------
  // update — edit name or email of a ghost (Planner+)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestCrewId: z.string(),
        name: z.string().min(1).max(100).optional(),
        email: z.string().email().nullable().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.email !== undefined) update.email = input.email;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("guest_crew")
        .update(update)
        .eq("id", input.guestCrewId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update ghost crew member",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — delete ghost crew member (Owner only)
  //
  // Deletes the ghost_crew record. Because trip_members.guest_crew_id and
  // team_assignments.guest_crew_id both reference guest_crew with ON DELETE
  // CASCADE, all downstream rows are cleaned up automatically.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestCrewId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("guest_crew")
        .delete()
        .eq("id", input.guestCrewId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove ghost crew member",
        });
      }

      return { success: true };
    }),
});
