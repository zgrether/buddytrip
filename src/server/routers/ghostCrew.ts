import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const ghostCrewRouter = router({
  // -----------------------------------------------------------------------
  // list — all guest users for a trip (any member can view)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data: memberRows, error: mErr } = await ctx.supabase
        .from("trip_members")
        .select("user_id, role")
        .eq("trip_id", ctx.tripId);

      if (mErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch members",
        });
      }

      const userIds = (memberRows ?? []).map((m) => m.user_id).filter(Boolean) as string[];
      if (userIds.length === 0) return [];

      const { data: users, error: uErr } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, email, is_guest, created_at")
        .in("id", userIds)
        .eq("is_guest", true);

      if (uErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch guest users",
        });
      }

      const roleMap = new Map((memberRows ?? []).map((m) => [m.user_id, m.role]));

      return (users ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        nickname: u.nickname,
        email: u.email,
        role: roleMap.get(u.id) ?? "Member",
        is_guest: u.is_guest,
        created_at: u.created_at,
      }));
    }),

  // -----------------------------------------------------------------------
  // create — add a guest user and add them to the trip (Planner+)
  //
  // Creates a users row with is_guest=true, then a trip_members row.
  // If email belongs to an existing real account, throws PRECONDITION_FAILED.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(1).max(100),
        nickname: z.string().min(1).max(100).optional(),
        email: z.string().email().optional(),
        role: z.enum(["Planner", "Member"]).default("Member"),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // If email provided, check it against existing accounts
      if (input.email) {
        const { data: existingUser } = await ctx.supabase
          .from("users")
          .select("id, is_guest")
          .eq("email", input.email)
          .maybeSingle();

        if (existingUser && !existingUser.is_guest) {
          // Real account exists — check if already a member
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

          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This email belongs to an existing BuddyTrip account. Add them as a crew member instead.",
          });
        }

        if (existingUser && existingUser.is_guest) {
          // Guest with this email already exists — check if they're in this trip
          const { data: existingMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (existingMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A crew member with this email already exists.",
            });
          }

          // Reuse the existing ghost user — just add them to this trip
          const { error: memberError } = await ctx.supabase
            .from("trip_members")
            .insert({
              id: crypto.randomUUID(),
              trip_id: ctx.tripId,
              user_id: existingUser.id,
              role: input.role,
              status: "in",
            });

          if (memberError) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to add guest to trip: ${memberError.message}`,
            });
          }

          return { id: existingUser.id, name: input.name, nickname: input.nickname ?? null, email: input.email ?? null, is_guest: true, created_by: null, created_at: null, role: input.role };
        }
      }

      // Create guest users row
      const guestId = `ghost-${crypto.randomUUID()}`;
      const { data: guest, error: guestError } = await ctx.supabase
        .from("users")
        .insert({
          id: guestId,
          name: input.name,
          nickname: input.nickname ?? null,
          email: input.email ?? null,
          is_guest: true,
          created_by: ctx.user!.id,
        })
        .select("id, name, nickname, email, is_guest, created_by, created_at")
        .single();

      if (guestError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create guest user: ${guestError.message}`,
        });
      }

      // Insert trip_members row (guests are always "in")
      const { error: memberError } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: guest.id,
          role: input.role,
          status: "in",
        });

      if (memberError) {
        // Rollback guest user insert
        await ctx.supabase.from("users").delete().eq("id", guest.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add guest to trip members: ${memberError.message}`,
        });
      }

      return { ...guest, role: input.role };
    }),

  // -----------------------------------------------------------------------
  // update — edit a guest user's name/nickname/email (Planner+).
  //
  // If `email` is provided and matches an existing real BuddyTrip account,
  // this swaps trip_members.user_id from the ghost to the real user (the
  // "auto-link" path) and returns the real user record with linked: true.
  // The ghost users row is left intact in case it's referenced by other
  // trips — only the trip_members pointer changes.
  //
  // Otherwise, falls through to a plain UPDATE on the ghost users row.
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestUserId: z.string(),
        name: z.string().min(1).max(100).optional(),
        nickname: z.string().min(1).max(100).nullable().optional(),
        email: z.string().email().nullable().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Verify this guest is a member of this trip
      const { data: membership } = await ctx.supabase
        .from("trip_members")
        .select("id, role")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.guestUserId)
        .maybeSingle();

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Guest not found in this trip",
        });
      }

      // ── Auto-link branch: email matches an existing real BT account ───
      if (input.email) {
        const { data: existingUser } = await ctx.supabase
          .from("users")
          .select("id, name, nickname, email, is_guest, created_at")
          .eq("email", input.email)
          .maybeSingle();

        if (existingUser && !existingUser.is_guest) {
          // Reject if the real user is already a member of this trip.
          const { data: alreadyMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (alreadyMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A user with this email is already a member of this trip.",
            });
          }

          // Swap the trip_members row to point at the real account. We
          // preserve the ghost's role and flip status to 'in' since they
          // now have a real account.
          const { error: linkErr } = await ctx.supabase
            .from("trip_members")
            .update({ user_id: existingUser.id, status: "in" })
            .eq("trip_id", ctx.tripId)
            .eq("user_id", input.guestUserId);

          if (linkErr) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to link existing account: ${linkErr.message}`,
            });
          }

          return { ...existingUser, linked: true as const };
        }
      }

      // ── Plain ghost update ────────────────────────────────────────────
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.nickname !== undefined) update.nickname = input.nickname;
      if (input.email !== undefined) update.email = input.email;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("users")
        .update(update)
        .eq("id", input.guestUserId)
        .eq("is_guest", true)
        .select("id, name, nickname, email, is_guest, created_at")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update guest user",
        });
      }

      return { ...data, linked: false as const };
    }),

  // -----------------------------------------------------------------------
  // remove — remove a guest from a trip (Owner only)
  //
  // Deletes the trip_members row. The guest users row is kept so that
  // historical data (expenses, scores) is preserved across trips.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestUserId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("trip_members")
        .delete()
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.guestUserId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove guest",
        });
      }

      return { success: true };
    }),
});
