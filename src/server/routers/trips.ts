import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assertAffected } from "@/server/lib/assertAffected";
import { rowsOrThrow } from "@/server/lib/rowOrThrow";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripsRouter = router({
  // -----------------------------------------------------------------------
  // list — all trips for the current user
  // -----------------------------------------------------------------------
  list: authedProcedure.query(async ({ ctx }) => {
    // A FAILED read is not "you have no trips". It used to return [] here, so a
    // bad network moment showed someone the app's empty state for an account
    // full of trips: the app telling them something false. It now throws, and
    // both readers already render a failed load as "Couldn't load your trips"
    // with a retry (#764), checked BEFORE their empty state. The same fix the
    // leaderboard got (#1467). Only a SUCCESSFUL empty read is "no trips".
    const memberships = rowsOrThrow(
      await ctx.supabase.from("trip_members").select("trip_id, role").eq("user_id", ctx.user.id),
      "trips"
    );
    if (memberships.length === 0) return [];

    const tripIds = memberships.map((m) => m.trip_id);
    const [tripsRes, competitionsRes, ideasRes] = await Promise.all([
      ctx.supabase
        .from("trips")
        .select("*")
        .in("id", tripIds)
        .order("created_at", { ascending: false }),
      // hasCompetition flag drives the dashboard card icon. One row per trip
      // is fine for the MVP one-comp-per-trip rule; we just need to know
      // whether any competition exists for each trip — and its own name, which
      // the card's trophy chip shows. Not its type: a trip list doesn't need to
      // tell a Cup from a Tournament, and "Turkey Cup · Cup" says it twice.
      ctx.supabase
        .from("competitions")
        .select("trip_id, name")
        .in("trip_id", tripIds),
      // ideaCount drives the desktop rail's Ideas row ("4 ideas"), which is the
      // ONLY thing that meaningfully varies about a trip with no destination.
      //
      // Selecting `trip_id` ALONE is the point. Every existing consumer of idea
      // data calls `ideas.list` — which is `select("*")`, full rows including
      // titles, locations, image urls and notes — and then reads `.length`.
      // That's the pattern #764's four-call-site audit is about, and the rail
      // would have been the fifth. One id column per idea is the smallest thing
      // that answers "how many", and it is grouped here rather than fanned out
      // per trip.
      ctx.supabase
        .from("ideas")
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
    const competitionNameByTrip = new Map(
      (competitionsRes.data ?? []).map((c) => [c.trip_id as string, (c.name as string | null) ?? null])
    );
    // Counted here rather than shipped as rows. `ideasRes` failing is NOT fatal:
    // a missing count degrades the rail's Ideas row to "0 ideas", where a thrown
    // error would take the whole trip list down with it. The competition fold
    // above already takes the same posture (`competitionsRes.error` is not
    // checked), and the same reasoning applies — these are decorations on a list
    // whose own failure is handled separately.
    const ideaCountByTripId = new Map<string, number>();
    for (const row of ideasRes.data ?? []) {
      const id = row.trip_id as string;
      ideaCountByTripId.set(id, (ideaCountByTripId.get(id) ?? 0) + 1);
    }

    return (tripsRes.data ?? []).map((trip) => ({
      ...trip,
      myRole: membershipByTripId.get(trip.id)?.role ?? null,
      hasCompetition: competitionNameByTrip.has(trip.id),
      competitionName: competitionNameByTrip.get(trip.id) ?? null,
      ideaCount: ideaCountByTripId.get(trip.id) ?? 0,
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
        // Co-planners to add as Organizer role
        coplanners: z
          .array(z.object({ userId: z.string(), role: z.enum(["Organizer", "Member"]) }))
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
      // Steps 1 + 2: the trip and its Owner, in ONE transaction (#991,
      // migration 216). As two statements through this client, a failed Owner
      // insert left the trip behind: the clean-up delete ran as the caller, and
      // `trips_delete` needs the Owner role nobody held yet, so it removed
      // nothing and said nothing.
      const { error } = await ctx.supabase.rpc("create_trip", {
        p_id: input.id,
        p_title: input.title,
        p_description: input.description ?? "",
        p_location: input.lockedDestination?.location ?? input.location ?? null,
        p_start_date: input.startDate ?? null,
        p_end_date: input.endDate ?? null,
        p_comparison_mode: input.comparisonMode ?? false,
        p_locked_destination_title: input.lockedDestination?.title ?? null,
        p_locked_destination_location: input.lockedDestination?.location ?? null,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create trip: ${error.message}`,
        });
      }

      // Step 3: Add co-planners (fail-soft per member)
      if (input.coplanners?.length) {
        for (const cp of input.coplanners) {
          await ctx.supabase.from("trip_members").insert({
            trip_id: input.id,
            user_id: cp.userId,
            role: cp.role,
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
    // #786 — Organizer parity. Choosing the destination is trip-running, not
    // trip administration. No RLS change was needed: `trips_update` has always
    // been Owner+Organizer (migration 030 declined to narrow it, because
    // lockDestination is a COLUMN-level distinction row-level RLS can't
    // express) — so tRPC was the only gate holding this one.
    .use(requireTripRole("Organizer"))
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
  // renameTripName — Owner or Organizer can rename
  // -----------------------------------------------------------------------
  renameTripName: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(1).max(100).transform((s) => s.trim()),
      })
    )
    .use(requireTripRole("Organizer"))
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
      // so RLS has_trip_role('Owner') passes for this update).
      //
      // #777 — the COUNT is what matters here, not just the error. Both steps
      // checked `error` already; neither verified a row actually moved, and the
      // two failure modes are the two states a trip must never be in: a promote
      // that matches nothing leaves ZERO Owners once step 2 demotes, and a
      // demote that matches nothing leaves TWO. Neither is detectable afterwards
      // without reading the roster, and the procedure returned success for both.
      assertAffected(
        await ctx.supabase
          .from("trip_members")
          .update({ role: "Owner" }, { count: "exact" })
          .eq("trip_id", ctx.tripId)
          .eq("user_id", input.newOwnerId),
        1,
        "promote the new owner"
      );

      // Step 2: Demote current owner to Organizer (self-update passes
      // RLS user_id = auth.uid() clause).
      const demoteRes = await ctx.supabase
        .from("trip_members")
        .update({ role: "Organizer" }, { count: "exact" })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", userId);

      if (demoteRes.error || demoteRes.count !== 1) {
        // Rollback: restore new owner to their previous role.
        //
        // #777 — the rollback was entirely unchecked, which was the worst of the
        // three: it runs precisely when the trip already has two Owners, so a
        // silent failure here LEAVES it that way while reporting the demote
        // error. Its outcome is now folded into the thrown message, because
        // "the demote failed" and "the demote failed AND I couldn't undo the
        // promote" are different emergencies and the reader needs to know which.
        //
        // Deliberately not a throw of its own: it must not replace the
        // underlying demote failure, which is the more useful diagnostic.
        const rollbackRes = await ctx.supabase
          .from("trip_members")
          .update({ role: member.role }, { count: "exact" })
          .eq("trip_id", ctx.tripId)
          .eq("user_id", input.newOwnerId);
        const rolledBack = !rollbackRes.error && rollbackRes.count === 1;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: rolledBack
            ? "Failed to demote current owner; ownership was left unchanged."
            : "Failed to demote current owner AND failed to roll back the " +
              "promotion — this trip may now have two Owners. Check the roster.",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // lockDates — Owner or Organizer can set dates directly (no poll)
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
    .use(requireTripRole("Organizer"))
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
  // updateAboutMessage — Owner/Organizer can update about_message once a
  // destination is locked.
  // -----------------------------------------------------------------------
  updateAboutMessage: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        aboutMessage: z.string().nullable(),
      })
    )
    .use(requireTripRole("Organizer"))
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
  // changeDestination — Owner/Organizer can change the destination any time
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
    .use(requireTripRole("Organizer"))
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

      // The date options whose votes a new destination clears. Read BEFORE the
      // update (#1539): read after it, a failed read left the old votes standing
      // behind a destination that had already changed. Now it refuses first.
      const windows = rowsOrThrow(
        await ctx.supabase.from("date_windows").select("id").eq("trip_id", ctx.tripId),
        "date options"
      );

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
      if (windows.length > 0) {
        const windowIds = windows.map((w) => w.id);
        await ctx.supabase
          .from("date_poll_votes")
          .delete()
          .in("window_id", windowIds);
      }

      return data;
    }),

});
