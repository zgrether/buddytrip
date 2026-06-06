import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripsRouter = router({
  // -----------------------------------------------------------------------
  // list — all trips for the current user
  // -----------------------------------------------------------------------
  list: authedProcedure.query(async ({ ctx }) => {
    const { data: memberships, error: memErr } = await ctx.supabase
      .from("trip_members")
      .select("trip_id, role, status")
      .eq("user_id", ctx.user.id);

    if (memErr || !memberships || memberships.length === 0) {
      return [];
    }

    const tripIds = memberships.map((m) => m.trip_id);
    const [tripsRes, competitionsRes] = await Promise.all([
      ctx.supabase
        .from("trips")
        .select("*")
        .in("id", tripIds)
        .order("created_at", { ascending: false }),
      // hasCompetition flag drives the dashboard card icon. One row per trip
      // is fine for the MVP one-comp-per-trip rule; we just need to know
      // whether any competition exists for each trip.
      ctx.supabase
        .from("competitions")
        .select("trip_id")
        .in("trip_id", tripIds),
    ]);

    if (tripsRes.error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch trips",
      });
    }

    const membershipByTripId = new Map(
      memberships.map((m) => [m.trip_id, m])
    );
    const tripsWithCompetition = new Set(
      (competitionsRes.data ?? []).map((c) => c.trip_id as string)
    );

    return (tripsRes.data ?? []).map((trip) => ({
      ...trip,
      myRole: membershipByTripId.get(trip.id)?.role ?? null,
      myStatus: membershipByTripId.get(trip.id)?.status ?? null,
      hasCompetition: tripsWithCompetition.has(trip.id),
    }));
  }),

  // -----------------------------------------------------------------------
  // getById — single trip (must be a member)
  // -----------------------------------------------------------------------
  getById: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .select("*")
        .eq("id", ctx.tripId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trip not found",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // create — any logged-in user can create a trip (becomes Owner)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        location: z.string().max(500).nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        comparisonMode: z.boolean().optional(),
        lockedDestination: z
          .object({
            title: z.string().min(1),
            location: z.string().min(1),
          })
          .nullable()
          .optional(),
        // Co-planners to add as Planner role
        coplanners: z
          .array(z.object({ userId: z.string(), role: z.enum(["Planner", "Member"]) }))
          .optional(),
        // Ideas to seed on the trip (user-entered + AI suggestions)
        ideas: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1),
              location: z.string().min(1),
              description: z.string().optional(),
              costTier: z.string().nullable().optional(),
              source: z.enum(["manual", "ai"]).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Step 1: Insert the trip WITHOUT .select() — PostgREST's
      // INSERT ... RETURNING requires the SELECT policy to pass on the
      // new row, but the SELECT policy is `is_trip_member(id)` which is
      // false until we add the creator as a member in step 2.
      const hasLockedDest = !!input.lockedDestination;
      const { error } = await ctx.supabase.from("trips").insert({
        id: input.id,
        title: input.title,
        description: input.description ?? "",
        location: input.lockedDestination?.location ?? input.location ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        comparison_mode: input.comparisonMode ?? false,
        locked_destination_title: input.lockedDestination?.title ?? null,
        locked_destination_location: input.lockedDestination?.location ?? null,
        // A locked destination is what moves a trip out of the idea phase;
        // its absence (null) keeps the trip in idea.
        locked_destination_at: hasLockedDest ? now : null,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create trip: ${error.message}`,
        });
      }

      // Step 2: Add creator as Owner — now is_trip_member() will be true
      const { error: memberErr } = await ctx.supabase
        .from("trip_members")
        .insert({
          trip_id: input.id,
          user_id: ctx.user.id,
          role: "Owner",
          status: "in",
        });

      if (memberErr) {
        // Clean up the trip if member insert fails
        await ctx.supabase.from("trips").delete().eq("id", input.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add creator as trip owner",
        });
      }

      // Step 3: Add co-planners (fail-soft per member)
      if (input.coplanners?.length) {
        for (const cp of input.coplanners) {
          await ctx.supabase.from("trip_members").insert({
            trip_id: input.id,
            user_id: cp.userId,
            role: cp.role,
            status: "draft",
          });
        }
      }

      // Step 4: Seed ideas (fail-soft)
      if (input.ideas?.length) {
        for (const idea of input.ideas) {
          await ctx.supabase.from("ideas").insert({
            id: idea.id,
            trip_id: input.id,
            title: idea.title,
            location: idea.location,
            description: idea.description ?? "",
            cost_tier: idea.costTier ?? null,
            source: idea.source ?? "manual",
          });
        }
      }

      // Step 5: Now fetch the trip — SELECT policy passes because
      // the creator is a trip_member
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select()
        .eq("id", input.id)
        .single();

      if (fetchErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Trip created but failed to fetch: ${fetchErr.message}`,
        });
      }

      return trip;
    }),

  // -----------------------------------------------------------------------
  // lockDestination — Owner only
  // -----------------------------------------------------------------------
  lockDestination: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        title: z.string().min(1),
        location: z.string().min(1),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          locked_destination_title: input.title,
          locked_destination_location: input.location,
          locked_destination_at: new Date().toISOString(),
          location: input.location,
          comparison_mode: false,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to lock destination",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // renameTripName — Owner or Planner can rename
  // -----------------------------------------------------------------------
  renameTripName: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(1).max(100).transform((s) => s.trim()),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({ title: input.name })
        .eq("id", ctx.tripId)
        .select("id, title")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rename trip",
        });
      }

      return { id: data.id, name: data.title };
    }),

  // -----------------------------------------------------------------------
  // transferOwnership — Owner only
  // -----------------------------------------------------------------------
  transferOwnership: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        newOwnerId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;

      if (input.newOwnerId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer ownership to yourself",
        });
      }

      // Verify new owner is a trip member
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("user_id, role")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.newOwnerId)
        .single();

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not a member of this trip",
        });
      }

      // Step 1: Promote new owner FIRST (current user is still Owner
      // so RLS has_trip_role('Owner') passes for this update)
      const { error: promoteErr } = await ctx.supabase
        .from("trip_members")
        .update({ role: "Owner" })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.newOwnerId);

      if (promoteErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to promote new owner",
        });
      }

      // Step 2: Demote current owner to Planner (self-update passes
      // RLS user_id = auth.uid() clause)
      const { error: demoteErr } = await ctx.supabase
        .from("trip_members")
        .update({ role: "Planner" })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", userId);

      if (demoteErr) {
        // Rollback: restore new owner to their previous role
        await ctx.supabase
          .from("trip_members")
          .update({ role: member.role })
          .eq("trip_id", ctx.tripId)
          .eq("user_id", input.newOwnerId);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to demote current owner",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // lockDates — Owner or Planner can set dates directly (no poll)
  // -----------------------------------------------------------------------
  lockDates: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
        // When locking from a poll selection, the caller passes the chosen
        // window id so we don't create a duplicate date_window row.
        windowId: z.string().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      if (input.startDate >= input.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start date must be before end date",
        });
      }

      // 1. If no windowId was supplied, insert a new date_window for this
      //    range. Otherwise reuse the selected window.
      let windowId = input.windowId ?? null;
      if (!windowId) {
        windowId = crypto.randomUUID();
        const { error: winErr } = await ctx.supabase
          .from("date_windows")
          .insert({
            id: windowId,
            trip_id: ctx.tripId,
            start_date: input.startDate,
            end_date: input.endDate,
          });

        if (winErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to create date window: ${winErr.message}`,
          });
        }
      }

      // 2. Lock the trip dates. Locking always closes any active poll.
      const { error: tripErr } = await ctx.supabase
        .from("trips")
        .update({
          start_date: input.startDate,
          end_date: input.endDate,
          poll_mode: false,
        })
        .eq("id", ctx.tripId);

      if (tripErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update trip dates: ${tripErr.message}`,
        });
      }

      // 3. Upsert date_polls with locked_window_id
      const { error: pollErr } = await ctx.supabase
        .from("date_polls")
        .upsert(
          {
            trip_id: ctx.tripId,
            open: false,
            locked_window_id: windowId,
          },
          { onConflict: "trip_id" }
        );

      if (pollErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update date poll: ${pollErr.message}`,
        });
      }

      return { windowId, startDate: input.startDate, endDate: input.endDate };
    }),

  // -----------------------------------------------------------------------
  // delete — Owner only
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      // ON DELETE CASCADE handles all dependent rows (migration 004).
      const { error } = await ctx.supabase
        .from("trips")
        .delete()
        .eq("id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete trip",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // updateAboutMessage — Owner/Planner can update about_message once a
  // destination is locked.
  // -----------------------------------------------------------------------
  updateAboutMessage: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        aboutMessage: z.string().nullable(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("locked_destination_at")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (!trip.locked_destination_at) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Lock a destination before setting an about message.",
        });
      }

      const newMessage = input.aboutMessage?.trim() || null;

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({ about_message: newMessage })
        .eq("id", ctx.tripId)
        .select("id, about_message")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update about message" });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // changeDestination — Owner/Planner can change the destination any time
  // one is already locked (i.e. past the idea phase). Resets date poll votes
  // since dates may change with a new destination.
  // -----------------------------------------------------------------------
  changeDestination: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        destination: z.string().min(1, "Destination is required."),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // A destination must already be locked — there's nothing to "change"
      // while the trip is still an idea (use lockDestination for the first set).
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("locked_destination_at")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (!trip.locked_destination_at) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Lock a destination before changing it.",
        });
      }

      const dest = input.destination.trim();

      // Update destination
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          locked_destination_title: dest,
          locked_destination_location: dest,
          locked_destination_at: new Date().toISOString(),
        })
        .eq("id", ctx.tripId)
        .select("id, locked_destination_title")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to change destination" });
      }

      // Reset date poll votes — dates may change with new destination
      const { data: windows } = await ctx.supabase
        .from("date_windows")
        .select("id")
        .eq("trip_id", ctx.tripId);

      if (windows && windows.length > 0) {
        const windowIds = windows.map((w) => w.id);
        await ctx.supabase
          .from("date_poll_votes")
          .delete()
          .in("window_id", windowIds);
      }

      return data;
    }),

});
