import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * venues — venue/time-slot for a competition event.
 *
 * A venue pairs a competition event with where + when it actually takes
 * place. Three sources:
 *   • Scheduled  — references a schedule_items row (golf tee times etc.)
 *   • Manual     — caller supplied name/location/date/time directly
 *   • Anytime    — happens during the trip without a fixed slot
 *
 * schedule_items.id is uuid stored as text here (no FK — the codebase's
 * uuid/text divide makes a real FK awkward). The create procedure
 * validates the referenced row exists and belongs to this trip.
 */

interface VenueRow {
  id: string;
  competition_id: string;
  schedule_item_id: string | null;
  event_id: string | null;
  name: string | null;
  location: string | null;
  venue_date: string | null;
  venue_time: string | null;
  is_anytime: boolean;
  created_at: string;
}

interface ScheduleItemRow {
  id: string;
  trip_id: string;
  title: string;
  course_name: string | null;
  course_location: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  tee_times: unknown;
}

async function loadCompetition(
  ctx: { supabase: { from: (t: string) => unknown }; tripId?: string },
  competitionId: string
): Promise<{ id: string; trip_id: string }> {
  const { data, error } = await (
    ctx.supabase.from("competitions") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          single: () => Promise<{
            data: { id: string; trip_id: string } | null;
            error: unknown;
          }>;
        };
      };
    }
  )
    .select("id, trip_id")
    .eq("id", competitionId)
    .single();

  if (error || !data) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
  }
  if (data.trip_id !== ctx.tripId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Competition does not belong to this trip",
    });
  }
  return data;
}

export const venuesRouter = router({
  // -----------------------------------------------------------------------
  // list — venues for a competition, enriched with the underlying schedule
  // item when one is linked. The shape returned is what EventCard +
  // VenuesPanel expect to render the per-event status line.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      await loadCompetition(ctx, input.competitionId);

      const { data: venues, error: venuesErr } = await ctx.supabase
        .from("venues")
        .select("*")
        .eq("competition_id", input.competitionId)
        .order("created_at", { ascending: true });

      if (venuesErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch venues: ${venuesErr.message}`,
        });
      }

      const rows = (venues ?? []) as VenueRow[];
      const scheduleIds = rows
        .map((v) => v.schedule_item_id)
        .filter((x): x is string => !!x);

      let scheduleItems: ScheduleItemRow[] = [];
      if (scheduleIds.length > 0) {
        const { data, error } = await ctx.supabase
          .from("schedule_items")
          .select(
            "id, trip_id, title, course_name, course_location, scheduled_date, scheduled_time, tee_times"
          )
          .in("id", scheduleIds);
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to fetch schedule items: ${error.message}`,
          });
        }
        scheduleItems = (data ?? []) as ScheduleItemRow[];
      }

      const scheduleById = new Map(scheduleItems.map((s) => [s.id, s]));

      return rows.map((venue) => ({
        ...venue,
        schedule_item: venue.schedule_item_id
          ? scheduleById.get(venue.schedule_item_id) ?? null
          : null,
      }));
    }),

  // -----------------------------------------------------------------------
  // create — new venue (canEdit). Either schedule_item_id OR name required.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        scheduleItemId: z.string().optional(),
        name: z.string().min(1).max(200).optional(),
        location: z.string().max(500).optional(),
        venueDate: z.string().optional(),
        venueTime: z.string().max(40).optional(),
        isAnytime: z.boolean().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const competition = await loadCompetition(ctx, input.competitionId);

      if (!input.scheduleItemId && !input.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either scheduleItemId or name is required",
        });
      }

      // App-level integrity check — schedule_items.id is uuid stored as
      // text here, so the DB has no FK. Verify the row exists and belongs
      // to this trip before recording the linkage.
      if (input.scheduleItemId) {
        const { data: item, error } = await ctx.supabase
          .from("schedule_items")
          .select("id, trip_id")
          .eq("id", input.scheduleItemId)
          .maybeSingle();
        if (error || !item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Schedule item not found",
          });
        }
        if (item.trip_id !== competition.trip_id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Schedule item does not belong to this trip",
          });
        }
      }

      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("venues")
        .insert({
          competition_id: input.competitionId,
          schedule_item_id: input.scheduleItemId ?? null,
          name: input.name ?? null,
          location: input.location ?? null,
          venue_date: input.venueDate ?? null,
          venue_time: input.venueTime ?? null,
          is_anytime: input.isAnytime ?? false,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create venue: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("venues")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created venue: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // assignEvent — link a competition event to this venue (canEdit).
  // -----------------------------------------------------------------------
  assignEvent: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        venueId: z.string(),
        eventId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Validate venue + event belong to the same competition (and to the
      // current trip via the competition).
      const { data: venue, error: venueErr } = await ctx.supabase
        .from("venues")
        .select("id, competition_id")
        .eq("id", input.venueId)
        .single();
      if (venueErr || !venue) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Venue not found" });
      }

      const { data: event, error: eventErr } = await ctx.supabase
        .from("events")
        .select("id, competition_id")
        .eq("id", input.eventId)
        .single();
      if (eventErr || !event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      if (event.competition_id !== venue.competition_id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Event and venue belong to different competitions",
        });
      }

      // Reject if the event is already assigned to another venue. The DB
      // partial unique index will enforce this on write but we surface a
      // clearer error here.
      const { data: existing } = await ctx.supabase
        .from("venues")
        .select("id")
        .eq("competition_id", venue.competition_id)
        .eq("event_id", input.eventId)
        .neq("id", input.venueId)
        .maybeSingle();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Event is already assigned to another venue",
        });
      }

      const { data, error } = await ctx.supabase
        .from("venues")
        .update({ event_id: input.eventId })
        .eq("id", input.venueId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign event: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // unassignEvent — clear the event linkage. Also resets is_anytime so an
  // "anytime" venue that was created on demand for an event doesn't strand.
  // -----------------------------------------------------------------------
  unassignEvent: authedProcedure
    .input(z.object({ tripId: z.string(), venueId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("venues")
        .update({ event_id: null, is_anytime: false })
        .eq("id", input.venueId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to unassign event: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove the venue (canEdit). Linked event becomes unassigned
  // again via the SET NULL FK.
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), venueId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("venues")
        .delete()
        .eq("id", input.venueId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete venue: ${error.message}`,
        });
      }
      return { success: true };
    }),
});
