import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

export const usersRouter = router({
  // -----------------------------------------------------------------------
  // getMe — return the current user's profile
  // -----------------------------------------------------------------------
  getMe: authedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("users")
      .select("id, name, nickname, email")
      .eq("id", ctx.user.id)
      .single();

    if (error || !data) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User profile not found",
      });
    }

    return data;
  }),

  // -----------------------------------------------------------------------
  // updateMe — update current user's name/nickname
  // -----------------------------------------------------------------------
  updateMe: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200).optional(),
        nickname: z.string().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.name && !input.nickname) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one field (name or nickname) must be provided",
        });
      }

      const update: Record<string, string> = {};
      if (input.name) update.name = input.name;
      if (input.nickname) update.nickname = input.nickname;

      const { data, error } = await ctx.supabase
        .from("users")
        .update(update)
        .eq("id", ctx.user.id)
        .select("id, name, nickname, email")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update profile",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // search — email-exact lookup only (used by invite flow)
  // -----------------------------------------------------------------------
  search: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = input.query.trim().toLowerCase();
      if (!query.includes("@")) return [];

      const { data, error } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, email, is_guest")
        .eq("email", query)
        .neq("id", ctx.user.id)
        .eq("is_guest", false)
        .limit(1);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // frequentTripmates — top 3 real users who share past trips with current user,
  //                     excluding anyone already on the given trip
  // -----------------------------------------------------------------------
  frequentTripmates: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get all trips current user has been on (excluding current trip)
      const { data: myTrips } = await ctx.supabase
        .from("trip_members")
        .select("trip_id")
        .eq("user_id", userId)
        .neq("trip_id", input.tripId);

      const tripIds = (myTrips ?? []).map((t) => t.trip_id);
      if (tripIds.length === 0) return [];

      // Get members of those trips, excluding current user
      const { data: tripmates } = await ctx.supabase
        .from("trip_members")
        .select("user_id, users!inner(id, name, nickname, email, is_guest)")
        .in("trip_id", tripIds)
        .neq("user_id", userId);

      if (!tripmates) return [];

      // Get current trip members to exclude
      const { data: currentMembers } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", input.tripId);

      const alreadyOn = new Set((currentMembers ?? []).map((m) => m.user_id));

      // Count frequency, skip guests and already-on-trip members
      const counts: Record<string, { user: { id: string; name: string | null; nickname: string | null; email: string; is_guest: boolean }; count: number }> = {};
      for (const tm of tripmates) {
        const raw = tm.users as unknown;
        const u = (Array.isArray(raw) ? raw[0] : raw) as {
          id: string;
          name: string | null;
          nickname: string | null;
          email: string;
          is_guest: boolean;
        };
        if (!u || alreadyOn.has(u.id) || u.is_guest) continue;
        if (!counts[u.id]) counts[u.id] = { user: u, count: 0 };
        counts[u.id].count++;
      }

      return Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((c) => c.user);
    }),
});
