import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const datePollRouter = router({
  // -----------------------------------------------------------------------
  // get — get all windows and votes for a trip's date poll (any member)
  // -----------------------------------------------------------------------
  get: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data: windows, error: winErr } = await ctx.supabase
        .from("date_windows")
        .select("id, trip_id, start_date, end_date, created_at")
        .eq("trip_id", ctx.tripId)
        .order("start_date", { ascending: true });

      if (winErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch date windows",
        });
      }

      const windowIds = (windows ?? []).map((w) => w.id);
      let votes: { window_id: string; user_id: string; answer: string; created_at: string }[] = [];
      if (windowIds.length > 0) {
        const { data: v } = await ctx.supabase
          .from("date_poll_votes")
          .select("window_id, user_id, answer, created_at")
          .in("window_id", windowIds);
        votes = v ?? [];
      }

      const votesByWindow = new Map<string, typeof votes>();
      for (const v of votes) {
        const arr = votesByWindow.get(v.window_id) ?? [];
        arr.push(v);
        votesByWindow.set(v.window_id, arr);
      }

      return {
        windows: (windows ?? []).map((w) => ({
          ...w,
          votes: votesByWindow.get(w.id) ?? [],
        })),
      };
    }),

  // -----------------------------------------------------------------------
  // addWindow — Owner or Planner (canEdit)
  // -----------------------------------------------------------------------
  addWindow: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("date_windows")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          start_date: input.startDate,
          end_date: input.endDate,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add date window: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // vote — any member can vote on a window
  // -----------------------------------------------------------------------
  vote: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        windowId: z.string(),
        answer: z.enum(["yes", "no"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("date_poll_votes")
        .upsert(
          {
            window_id: input.windowId,
            user_id: ctx.user!.id,
            answer: input.answer,
          },
          { onConflict: "window_id,user_id" }
        )
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to vote: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // lockWindow — Owner or Planner (canEdit): lock the winning window
  // -----------------------------------------------------------------------
  lockWindow: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        windowId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Get the window dates
      const { data: window, error: winErr } = await ctx.supabase
        .from("date_windows")
        .select("start_date, end_date")
        .eq("id", input.windowId)
        .eq("trip_id", ctx.tripId)
        .single();

      if (winErr || !window) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Date window not found",
        });
      }

      // Update the trip's start/end dates
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          start_date: window.start_date,
          end_date: window.end_date,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to lock date window",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // unlock — Owner or Planner (canEdit): clear locked dates
  // -----------------------------------------------------------------------
  unlock: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          start_date: null,
          end_date: null,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to unlock dates",
        });
      }

      return data;
    }),
});
