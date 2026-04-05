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
    const { data: trips, error: tripErr } = await ctx.supabase
      .from("trips")
      .select("*")
      .in("id", tripIds)
      .order("created_at", { ascending: false });

    if (tripErr) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch trips",
      });
    }

    const membershipByTripId = new Map(
      memberships.map((m) => [m.trip_id, m])
    );

    return (trips ?? []).map((trip) => ({
      ...trip,
      myRole: membershipByTripId.get(trip.id)?.role ?? null,
      myStatus: membershipByTripId.get(trip.id)?.status ?? null,
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
        seriesId: z.string().nullable().optional(),
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
        series_id: input.seriesId ?? null,
        comparison_mode: input.comparisonMode ?? false,
        locked_destination_title: input.lockedDestination?.title ?? null,
        locked_destination_location: input.lockedDestination?.location ?? null,
        locked_destination_at: hasLockedDest ? now : null,
        // Stage: known destination → planning, otherwise → idea
        stage: hasLockedDest ? "planning" : "idea",
        ...(hasLockedDest ? { stage_advanced_to_planning_at: now } : {}),
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
  // update — Owner or Planner can edit trip details
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        location: z.string().max(500).nullable().optional(),
        costTier: z.enum(["$", "$$", "$$$", "$$$$"]).nullable().optional(),
        imageUrl: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        accommodation: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        activities: z.array(z.string()).optional(),
        golfCourses: z.array(z.string()).optional(),
        comparisonMode: z.boolean().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { tripId: _tripId, ...fields } = input;
      const update: Record<string, unknown> = {};

      if (fields.title !== undefined) update.title = fields.title;
      if (fields.description !== undefined) update.description = fields.description;
      if (fields.location !== undefined) update.location = fields.location;
      if (fields.costTier !== undefined) update.cost_tier = fields.costTier;
      if (fields.imageUrl !== undefined) update.image_url = fields.imageUrl;
      if (fields.startDate !== undefined) update.start_date = fields.startDate;
      if (fields.endDate !== undefined) update.end_date = fields.endDate;
      if (fields.accommodation !== undefined) update.accommodation = fields.accommodation;
      if (fields.notes !== undefined) update.notes = fields.notes;
      if (fields.activities !== undefined) update.activities = fields.activities;
      if (fields.golfCourses !== undefined) update.golf_courses = fields.golfCourses;
      if (fields.comparisonMode !== undefined) update.comparison_mode = fields.comparisonMode;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update(update)
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update trip",
        });
      }

      return data;
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
  // unlockDestination — Owner only
  // -----------------------------------------------------------------------
  unlockDestination: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          locked_destination_title: null,
          locked_destination_location: null,
          locked_destination_at: null,
          comparison_mode: true,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to unlock destination",
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
  // saveTrip — Owner only, moves trip to Saved section
  // -----------------------------------------------------------------------
  saveTrip: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          trip_status_override: "saved",
          saved_at: new Date().toISOString(),
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save trip",
        });
      }

      return data;
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
  // advanceToPlanning — Owner advances trip from IDEA → PLANNING
  // Requires: destination is locked
  // -----------------------------------------------------------------------
  advanceToPlanning: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      // Fetch current trip state
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("stage, locked_destination_title")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (trip.stage !== "idea") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Trip is not in the idea stage.",
        });
      }

      if (!trip.locked_destination_title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Lock a destination before advancing to planning.",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          stage: "planning",
          stage_advanced_to_planning_at: new Date().toISOString(),
        })
        .eq("id", ctx.tripId)
        .select("id, stage")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to advance stage" });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // advanceToGoing — Owner advances trip from PLANNING → GOING
  // Requires: at least one date is locked, aboutMessage provided
  // -----------------------------------------------------------------------
  advanceToGoing: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        aboutMessage: z.string().min(1, "A message for your crew is required."),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Fetch current trip state
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("stage")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (trip.stage !== "planning") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Trip is not in the planning stage.",
        });
      }

      // Check for locked date
      const { data: poll } = await ctx.supabase
        .from("date_polls")
        .select("locked_window_id")
        .eq("trip_id", ctx.tripId)
        .maybeSingle();

      if (!poll?.locked_window_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Lock a date before sending the RSVP — your crew will want to know when.",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          stage: "going",
          stage_advanced_to_going_at: new Date().toISOString(),
          about_message: input.aboutMessage.trim(),
        })
        .eq("id", ctx.tripId)
        .select("id, stage, about_message")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to advance stage" });
      }

      // ── RSVP blast email ──────────────────────────────────────────────
      const ghostsWithoutEmail: string[] = [];
      try {
        // Fetch trip details for email content
        const { data: tripDetails } = await ctx.supabase
          .from("trips")
          .select("title, locked_destination_title")
          .eq("id", ctx.tripId)
          .single();

        // Fetch locked date label
        const { data: pollData } = await ctx.supabase
          .from("date_polls")
          .select("locked_window_id, date_windows(start_date, end_date)")
          .eq("trip_id", ctx.tripId)
          .single();

        let lockedDateLabel: string | null = null;
        if (pollData?.date_windows) {
          const windows = pollData.date_windows as unknown as { start_date: string; end_date: string }[];
          const lw = Array.isArray(windows) ? windows[0] : windows;
          if (lw) {
            const { formatDateRange } = await import("@/lib/dates");
            lockedDateLabel = formatDateRange(lw.start_date, lw.end_date);
          }
        }

        // Fetch inviter name
        const { data: inviter } = await ctx.supabase
          .from("users")
          .select("name, nickname")
          .eq("id", ctx.user!.id)
          .single();
        const inviterName = inviter?.nickname ?? inviter?.name ?? "Your trip organizer";

        // Fetch all trip members
        const { data: allMembers } = await ctx.supabase
          .from("trip_members")
          .select("user_id, users(name, email, is_guest)")
          .eq("trip_id", ctx.tripId)
          .neq("user_id", ctx.user!.id); // don't email the owner who just clicked send

        const { sendRsvpBlastExistingUser, sendRsvpBlastNewUser } = await import("@/lib/email");

        for (const m of allMembers ?? []) {
          const u = m.users as unknown as { name: string | null; email: string | null; is_guest: boolean } | null;
          if (!u?.email) {
            ghostsWithoutEmail.push(u?.name ?? "Unknown");
            continue;
          }

          if (u.is_guest) {
            // Guest — find or create invite token
            const { data: invite } = await ctx.supabase
              .from("invites")
              .select("token")
              .eq("trip_id", ctx.tripId)
              .eq("email", u.email)
              .is("accepted_at", null)
              .maybeSingle();

            const token = invite?.token;
            if (token) {
              await sendRsvpBlastNewUser({
                toEmail: u.email,
                inviterName,
                tripName: tripDetails?.title ?? "the trip",
                destination: tripDetails?.locked_destination_title ?? null,
                lockedDate: lockedDateLabel,
                rsvpMessage: input.aboutMessage.trim(),
                token,
              });
            }
          } else {
            await sendRsvpBlastExistingUser({
              toEmail: u.email,
              toName: u.name ?? u.email.split("@")[0],
              tripName: tripDetails?.title ?? "the trip",
              tripId: ctx.tripId,
              destination: tripDetails?.locked_destination_title ?? null,
              lockedDate: lockedDateLabel,
              rsvpMessage: input.aboutMessage.trim(),
            });
          }
        }
      } catch {
        // Email blast failure shouldn't block the stage advancement
      }

      return { ...data, ghostsWithoutEmail };
    }),

  // -----------------------------------------------------------------------
  // updateAboutMessage — Owner/Planner can update about_message on a GOING+ trip
  // -----------------------------------------------------------------------
  updateAboutMessage: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        aboutMessage: z.string().trim().min(1, "Message cannot be empty."),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("stage")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (trip.stage !== "going") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "About message can only be updated once the trip is in the going stage.",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({ about_message: input.aboutMessage.trim() })
        .eq("id", ctx.tripId)
        .select("id, about_message")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update about message" });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // changeDestination — Owner/Planner can change destination in PLANNING stage
  // Resets date poll votes since dates may change
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
      // Fetch current stage
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select("stage")
        .eq("id", ctx.tripId)
        .single();

      if (fetchErr || !trip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      if (trip.stage !== "planning") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Destination can only be changed in the planning stage.",
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
