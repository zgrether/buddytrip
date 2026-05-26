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
      .select("id, name, email, avatar_url, avatar_icon")
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
  // updateMe — update current user's name/avatar_url
  // -----------------------------------------------------------------------
  updateMe: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200).optional(),
        avatar_url: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.name && input.avatar_url === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one field must be provided",
        });
      }

      const update: Record<string, string | null> = {};
      if (input.name) update.name = input.name;
      if (input.avatar_url !== undefined) update.avatar_url = input.avatar_url;

      const { data, error } = await ctx.supabase
        .from("users")
        .update(update)
        .eq("id", ctx.user.id)
        .select("id, name, email, avatar_url, avatar_icon")
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
  // updateAvatar — set or clear the current user's Tabler avatar icon
  //   Pass a string (e.g. "flag-2") to set; pass null to revert to initials.
  //   Returns the updated row so the client can refresh its `getMe` cache.
  // -----------------------------------------------------------------------
  updateAvatar: authedProcedure
    .input(
      z.object({
        avatarIcon: z.string().max(50).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("users")
        .update({ avatar_icon: input.avatarIcon })
        .eq("id", ctx.user.id)
        .select("id, name, email, avatar_url, avatar_icon")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update avatar",
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
        .select("id, name, email, is_guest")
        .eq("email", query)
        .neq("id", ctx.user.id)
        .eq("is_guest", false)
        .limit(1);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return data ?? [];
    }),

});
