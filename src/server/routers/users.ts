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
  // search — privacy-aware user search
  //   @ in query → exact email match, any user on platform
  //   name query  → trip history only, never strangers
  // -----------------------------------------------------------------------
  search: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = input.query.trim();
      const userId = ctx.user.id;
      const isEmailSearch = query.includes("@");

      if (isEmailSearch) {
        const { data, error } = await ctx.supabase
          .from("users")
          .select("id, name, nickname, email, is_guest")
          .eq("email", query.toLowerCase())
          .neq("id", userId)
          .limit(1);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return data ?? [];
      }

      if (query.length < 2) return [];

      // Get trips the current user is on
      const { data: myTrips } = await ctx.supabase
        .from("trip_members")
        .select("trip_id")
        .eq("user_id", userId);

      const tripIds = (myTrips ?? []).map((t) => t.trip_id);
      if (tripIds.length === 0) return [];

      // Find members of those trips matching the name query
      const { data: members } = await ctx.supabase
        .from("trip_members")
        .select("user_id, users!inner(id, name, nickname, email, is_guest)")
        .in("trip_id", tripIds)
        .neq("user_id", userId);

      if (!members) return [];

      // Deduplicate and filter by name/nickname
      const seen = new Set<string>();
      const results = [];
      for (const m of members) {
        const raw = m.users as unknown;
        const u = (Array.isArray(raw) ? raw[0] : raw) as {
          id: string;
          name: string | null;
          nickname: string | null;
          email: string;
          is_guest: boolean;
        };
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        const nameMatch = u.name?.toLowerCase().includes(query.toLowerCase());
        const nickMatch = u.nickname?.toLowerCase().includes(query.toLowerCase());
        if (nameMatch || nickMatch) results.push(u);
      }

      return results.slice(0, 8);
    }),
});
