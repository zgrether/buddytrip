import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, publicProcedure } from "../trpc";

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
  // search — search users by email (for invite flow)
  // -----------------------------------------------------------------------
  search: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, email")
        .ilike("email", `%${input.query}%`)
        .limit(10);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Search failed",
        });
      }

      return data ?? [];
    }),
});
