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

      // Poll mode lives on trips
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("poll_mode")
        .eq("id", ctx.tripId)
        .maybeSingle();

      return {
        lockedWindowId: poll?.locked_window_id ?? null,
        pollMode: trip?.poll_mode ?? false,
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

      // Ensure a date_polls row exists for this trip (first-window-activates-poll
      // flow may run before setPollMode(true) has created the row).
      await ctx.supabase
        .from("date_polls")
        .upsert(
          { trip_id: ctx.tripId, open: true },
          { onConflict: "trip_id" }
        );

      return data;
    }),

  // -----------------------------------------------------------------------
  // castDateVote — any member can vote on a window.
  // answer cycles client-side through: null → yes → maybe → no → null.
  // null deletes the vote; any other value upserts it.
  // -----------------------------------------------------------------------
  castDateVote: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        windowId: z.string(),
        answer: z.enum(["yes", "no", "maybe"]).nullable(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // null answer → delete the vote
      if (input.answer === null) {
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

      // Check if user already has this exact vote (toggle-off via repeated tap)
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
        // Nullable — null clears the vote, mirroring castDateVote.
        answer: z.enum(["yes", "no", "maybe"]).nullable(),
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

      // Null answer = clear the vote (delete row, mirrors castDateVote).
      if (input.answer === null) {
        const { error } = await ctx.supabase
          .from("date_poll_votes")
          .delete()
          .eq("window_id", input.windowId)
          .eq("user_id", input.userId);
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to clear vote for member: ${error.message}`,
          });
        }
        return { cleared: true };
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
  // lockDateWindow — Owner or Planner: lock the winning window as trip dates
  // -----------------------------------------------------------------------
  lockDateWindow: authedProcedure
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

      // Lock the dates on the trip and close poll mode
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          start_date: window.start_date,
          end_date: window.end_date,
          poll_mode: false,
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

      // Clear the locked trip dates. Leave poll_mode untouched — the owner
      // decides (via setPollMode) whether to reopen the poll or go direct.
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

      // Clear locked_window_id
      await ctx.supabase
        .from("date_polls")
        .update({ locked_window_id: null, open: true })
        .eq("trip_id", ctx.tripId);

      return data;
    }),

  // -----------------------------------------------------------------------
  // returnToPoll — Owner or Planner: clear locked dates AND reopen the
  // poll (trips.poll_mode = true) while preserving every existing window
  // and vote — including the formerly-locked window (even if it has zero
  // votes, which unlock() would have deleted). This is the reverse of
  // lockDateWindow: the crew lands back on the poll grid with their full
  // history intact.
  // -----------------------------------------------------------------------
  returnToPoll: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx }) => {
      // Clear the trip dates and flip poll_mode back on in a single update
      // so the UI transitions in one render.
      const { error: tripErr } = await ctx.supabase
        .from("trips")
        .update({
          start_date: null,
          end_date: null,
          poll_mode: true,
        })
        .eq("id", ctx.tripId);

      if (tripErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to return to poll: ${tripErr.message}`,
        });
      }

      // Reopen the poll row — if it doesn't exist (direct-date-entry path),
      // create one. We intentionally do NOT delete any date_windows so the
      // previously-chosen window remains available as a voting option.
      const { error: pollErr } = await ctx.supabase
        .from("date_polls")
        .upsert(
          {
            trip_id: ctx.tripId,
            open: true,
            locked_window_id: null,
          },
          { onConflict: "trip_id" }
        );

      if (pollErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reopen date poll: ${pollErr.message}`,
        });
      }

      return { ok: true };
    }),

  // -----------------------------------------------------------------------
  // setPollMode — Owner or Planner: flip trips.poll_mode on or off.
  //
  // When pollMode = false (cancel poll):
  //   1. Delete all date_poll_votes for this trip's windows (child rows first)
  //   2. Delete all date_windows for this trip
  //   3. Close the date_polls record (open = false)
  //   4. Flip poll_mode = false on trips
  //
  // This matches the spec's cancelPoll semantics — all poll data is cleared
  // so the owner starts fresh if they re-open a poll later.
  //
  // When pollMode = true (open poll): just flip the flag and ensure a
  // date_polls row exists (no data to clear).
  // -----------------------------------------------------------------------
  setPollMode: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        pollMode: z.boolean(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      if (!input.pollMode) {
        // ── Cancel poll: clear all data, children before parents ──────────

        // 1. Collect the window IDs for this trip so we can delete votes.
        const { data: windows } = await ctx.supabase
          .from("date_windows")
          .select("id")
          .eq("trip_id", ctx.tripId);

        const windowIds = (windows ?? []).map((w) => w.id);

        // 2. Delete all votes that reference those windows.
        if (windowIds.length > 0) {
          const { error: votesErr } = await ctx.supabase
            .from("date_poll_votes")
            .delete()
            .in("window_id", windowIds);

          if (votesErr) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to clear poll votes: ${votesErr.message}`,
            });
          }
        }

        // 3. Delete the date windows themselves.
        const { error: windowsErr } = await ctx.supabase
          .from("date_windows")
          .delete()
          .eq("trip_id", ctx.tripId);

        if (windowsErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to clear date windows: ${windowsErr.message}`,
          });
        }

        // 4. Close the poll row.
        await ctx.supabase
          .from("date_polls")
          .update({ open: false })
          .eq("trip_id", ctx.tripId);
      }

      // 5. Flip poll_mode on the trip (both open and cancel paths).
      const { error } = await ctx.supabase
        .from("trips")
        .update({ poll_mode: input.pollMode })
        .eq("id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update poll mode: ${error.message}`,
        });
      }

      // When opening a poll, ensure a date_polls row exists.
      if (input.pollMode) {
        await ctx.supabase
          .from("date_polls")
          .upsert(
            { trip_id: ctx.tripId, open: true },
            { onConflict: "trip_id" }
          );
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // resetPoll — Owner or Planner: clear all votes. Windows are preserved.
  // -----------------------------------------------------------------------
  resetPoll: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
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
      if (ids.length > 0) {
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
      }

      await ctx.supabase
        .from("date_polls")
        .upsert(
          { trip_id: ctx.tripId, open: true },
          { onConflict: "trip_id" }
        );

      return { success: true };
    }),
});
