import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripMembersRouter = router({
  // -----------------------------------------------------------------------
  // list — all members of a trip (any member can view)
  //
  // Returns a unified shape for real users and guests (is_guest=true users).
  // All members have a non-null user_id pointing to a row in the users table.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .select("id, trip_id, user_id, role, status, joined_at")
        .eq("trip_id", ctx.tripId)
        .order("joined_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch members",
        });
      }

      const rows = data ?? [];
      const userIds = rows.map((m) => m.user_id).filter(Boolean) as string[];

      const usersResult = userIds.length > 0
        ? await ctx.supabase.from("users").select("id, name, nickname, email, is_guest").in("id", userIds)
        : { data: [] as { id: string; name: string | null; nickname: string | null; email: string | null; is_guest: boolean }[] };

      const userMap = new Map((usersResult.data ?? []).map((u) => [u.id, u]));

      return rows.map((m) => {
        const user = m.user_id ? (userMap.get(m.user_id) ?? null) : null;
        const isGuest = user?.is_guest ?? false;
        const memberId = m.user_id as string;
        const displayName = user
          ? (user.nickname ?? user.name ?? user.email ?? `User ${memberId.slice(0, 6)}`)
          : `Unknown ${memberId.slice(0, 6)}`;

        return {
          ...m,
          user,
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
  // inviteByEmail — Planner/Owner can invite someone by email who has no
  //                 BuddyTrip account yet. Creates a guest user row + a
  //                 trip_members row with status 'invited'.
  // -----------------------------------------------------------------------
  inviteByEmail: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        email: z.string().email(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      // Check if a real (non-guest) account already exists for this email
      const { data: existing } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, is_guest")
        .eq("email", email)
        .maybeSingle();

      if (existing && !existing.is_guest) {
        // Real account exists — caller should use the Find flow instead
        return { status: "real_account_exists" as const };
      }

      let guestUserId: string;

      if (existing?.is_guest) {
        // Reuse the existing guest row
        guestUserId = existing.id;
      } else {
        // Create a new guest user row
        const newId = crypto.randomUUID();
        const { error: userError } = await ctx.supabase.from("users").insert({
          id: newId,
          name: email.split("@")[0],
          email,
          is_guest: true,
        });
        if (userError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create invite. Please try again.",
          });
        }
        guestUserId = newId;
      }

      // Check if already a member of this trip
      const { data: alreadyMember } = await ctx.supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", guestUserId)
        .maybeSingle();

      if (alreadyMember) {
        const displayName = existing?.nickname ?? existing?.name ?? email;
        return { status: "already_member" as const, displayName };
      }

      const { error } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: guestUserId,
          role: "Planner",
          status: "invited",
        });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite. Please try again.",
        });
      }

      return { status: "invited" as const, userId: guestUserId };
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
