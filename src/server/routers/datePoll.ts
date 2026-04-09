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

      // Fetch locked_window_id from date_polls
      const { data: poll } = await ctx.supabase
        .from("date_polls")
        .select("locked_window_id")
        .eq("trip_id", ctx.tripId)
        .maybeSingle();

      return {
        lockedWindowId: poll?.locked_window_id ?? null,
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
  // vote — any member can vote on a window (toggle: same answer = delete)
  // -----------------------------------------------------------------------
  vote: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        windowId: z.string(),
        answer: z.enum(["yes", "no", "maybe"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Check if user already has this exact vote (toggle-off)
      const { data: existing } = await ctx.supabase
        .from("date_poll_votes")
        .select("answer")
        .eq("window_id", input.windowId)
        .eq("user_id", ctx.user!.id)
        .maybeSingle();

      if (existing?.answer === input.answer) {
        // Toggle off — delete the vote
        const { error } = await ctx.supabase
          .from("date_poll_votes")
          .delete()
          .eq("window_id", input.windowId)
          .eq("user_id", ctx.user!.id);

        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to remove vote: ${error.message}`,
          });
        }

        return { window_id: input.windowId, user_id: ctx.user!.id, answer: null, deleted: true };
      }

      // Upsert the vote
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
  // voteOnBehalf — Owner or Planner can vote for a ghost member
  // -----------------------------------------------------------------------
  voteOnBehalf: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        votes: z.array(
          z.object({
            windowId: z.string(),
            answer: z.enum(["yes", "no", "maybe"]),
          })
        ),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Verify the target user is a ghost member of this trip
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not a member of this trip",
        });
      }

      const { data: user } = await ctx.supabase
        .from("users")
        .select("is_guest")
        .eq("id", input.userId)
        .single();

      if (!user?.is_guest) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Can only vote on behalf of ghost members",
        });
      }

      // Upsert all votes for this ghost user
      const rows = input.votes.map((v) => ({
        window_id: v.windowId,
        user_id: input.userId,
        answer: v.answer,
      }));

      const { error } = await ctx.supabase
        .from("date_poll_votes")
        .upsert(rows, { onConflict: "window_id,user_id" });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to vote on behalf: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // castVoteForMember — Owner can record a vote for any crew member
  // (real or ghost). Used by the owner-only "fill in for the crew" affordance
  // in the dates poll grid. Members themselves use `vote`.
  // -----------------------------------------------------------------------
  castVoteForMember: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        windowId: z.string(),
        userId: z.string(),
        answer: z.enum(["yes", "no", "maybe"]),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Confirm the target is a member of this trip
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not a member of this trip",
        });
      }

      const { data, error } = await ctx.supabase
        .from("date_poll_votes")
        .upsert(
          {
            window_id: input.windowId,
            user_id: input.userId,
            answer: input.answer,
          },
          { onConflict: "window_id,user_id" }
        )
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to cast vote for member: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // resetVotes — Owner: clears all votes for this trip's date poll while
  // keeping the date_windows intact so the crew has to vote again.
  // -----------------------------------------------------------------------
  resetVotes: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      const { data: windows, error: winErr } = await ctx.supabase
        .from("date_windows")
        .select("id")
        .eq("trip_id", ctx.tripId);

      if (winErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read date windows: ${winErr.message}`,
        });
      }

      const ids = (windows ?? []).map((w) => w.id);
      if (ids.length === 0) return { success: true };

      const { error } = await ctx.supabase
        .from("date_poll_votes")
        .delete()
        .in("window_id", ids);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reset votes: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // removeWindow — Owner or Planner: delete a date window (votes cascade)
  // -----------------------------------------------------------------------
  removeWindow: authedProcedure
    .input(z.object({ tripId: z.string(), windowId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("date_windows")
        .delete()
        .eq("id", input.windowId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to remove date window: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // lockWindow — Owner or Planner: lock the winning window
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

      // Write locked_window_id to date_polls (upsert in case row doesn't exist)
      const { error: pollErr } = await ctx.supabase
        .from("date_polls")
        .upsert(
          {
            trip_id: ctx.tripId,
            open: false,
            locked_window_id: input.windowId,
          },
          { onConflict: "trip_id" }
        );

      if (pollErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update date poll lock state",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // unlock — Owner or Planner: clear locked dates
  // -----------------------------------------------------------------------
  unlock: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx }) => {
      // Fetch the locked window ID before clearing it
      const { data: pollData } = await ctx.supabase
        .from("date_polls")
        .select("locked_window_id")
        .eq("trip_id", ctx.tripId)
        .maybeSingle();

      const lockedWindowId = pollData?.locked_window_id;

      // If the locked window has zero votes it was set directly (not chosen from
      // a live poll) — delete it so the UI returns to the simple date picker
      // instead of the poll flow. Windows with votes came from a real poll and
      // must be preserved so crew input isn't lost.
      if (lockedWindowId) {
        const { count } = await ctx.supabase
          .from("date_poll_votes")
          .select("window_id", { count: "exact", head: true })
          .eq("window_id", lockedWindowId);

        if ((count ?? 0) === 0) {
          await ctx.supabase
            .from("date_windows")
            .delete()
            .eq("id", lockedWindowId);
        }
      }

      // Clear trip dates and re-enable poll if dates were set via poll
      const { data: tripData } = await ctx.supabase
        .from("trips")
        .select("date_set_method")
        .eq("id", ctx.tripId)
        .single();

      const wasFromPoll = tripData?.date_set_method === "poll";

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          start_date: null,
          end_date: null,
          date_poll_active: wasFromPoll,
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

      // Clear locked_window_id
      await ctx.supabase
        .from("date_polls")
        .update({ locked_window_id: null, open: true })
        .eq("trip_id", ctx.tripId);

      return data;
    }),
});
