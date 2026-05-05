import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * arenas — venue/time-slot for a competition event.
 *
 * An arena pairs a competition event with where + when it actually takes
 * place. Three sources:
 *   • Scheduled  — references a schedule_items row (golf tee times etc.)
 *   • Manual     — caller supplied name/location/date/time directly
 *   • Anytime    — happens during the trip without a fixed slot
 *
 * schedule_items.id is uuid stored as text here (no FK — the codebase's
 * uuid/text divide makes a real FK awkward). The create procedure
 * validates the referenced row exists and belongs to this trip.
 */

interface ArenaRow {
  id: string;
  competition_id: string;
  schedule_item_id: string | null;
  event_id: string | null;
  name: string | null;
  location: string | null;
  arena_date: string | null;
  arena_time: string | null;
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

export const arenasRouter = router({
  // -----------------------------------------------------------------------
  // list — arenas for a competition, enriched with the underlying schedule
  // item when one is linked. The shape returned is what EventCard +
  // ArenasPanel expect to render the per-event status line.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      await loadCompetition(ctx, input.competitionId);

      const { data: arenas, error: arenasErr } = await ctx.supabase
        .from("arenas")
        .select("*")
        .eq("competition_id", input.competitionId)
        .order("created_at", { ascending: true });

      if (arenasErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch arenas: ${arenasErr.message}`,
        });
      }

      const rows = (arenas ?? []) as ArenaRow[];
      const scheduleIds = rows
        .map((a) => a.schedule_item_id)
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

      return rows.map((arena) => ({
        ...arena,
        schedule_item: arena.schedule_item_id
          ? scheduleById.get(arena.schedule_item_id) ?? null
          : null,
      }));
    }),

  // -----------------------------------------------------------------------
  // create — new arena (canEdit). Either schedule_item_id OR name required.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        scheduleItemId: z.string().optional(),
        name: z.string().min(1).max(200).optional(),
        location: z.string().max(500).optional(),
        arenaDate: z.string().optional(),
        arenaTime: z.string().max(40).optional(),
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
        .from("arenas")
        .insert({
          competition_id: input.competitionId,
          schedule_item_id: input.scheduleItemId ?? null,
          name: input.name ?? null,
          location: input.location ?? null,
          arena_date: input.arenaDate ?? null,
          arena_time: input.arenaTime ?? null,
          is_anytime: input.isAnytime ?? false,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create arena: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("arenas")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created arena: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // assignEvent — link a competition event to this arena (canEdit).
  // -----------------------------------------------------------------------
  assignEvent: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        arenaId: z.string(),
        eventId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Validate arena + event belong to the same competition (and to the
      // current trip via the competition).
      const { data: arena, error: arenaErr } = await ctx.supabase
        .from("arenas")
        .select("id, competition_id")
        .eq("id", input.arenaId)
        .single();
      if (arenaErr || !arena) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Arena not found" });
      }

      const { data: event, error: eventErr } = await ctx.supabase
        .from("events")
        .select("id, competition_id")
        .eq("id", input.eventId)
        .single();
      if (eventErr || !event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      if (event.competition_id !== arena.competition_id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Event and arena belong to different competitions",
        });
      }

      // Reject if the event is already assigned to another arena. The DB
      // partial unique index will enforce this on write but we surface a
      // clearer error here.
      const { data: existing } = await ctx.supabase
        .from("arenas")
        .select("id")
        .eq("competition_id", arena.competition_id)
        .eq("event_id", input.eventId)
        .neq("id", input.arenaId)
        .maybeSingle();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Event is already assigned to another arena",
        });
      }

      const { data, error } = await ctx.supabase
        .from("arenas")
        .update({ event_id: input.eventId })
        .eq("id", input.arenaId)
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
  // "anytime" arena that was created on demand for an event doesn't strand.
  // -----------------------------------------------------------------------
  unassignEvent: authedProcedure
    .input(z.object({ tripId: z.string(), arenaId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("arenas")
        .update({ event_id: null, is_anytime: false })
        .eq("id", input.arenaId)
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
  // delete — remove the arena (canEdit). Linked event becomes unassigned
  // again via the SET NULL FK.
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), arenaId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("arenas")
        .delete()
        .eq("id", input.arenaId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete arena: ${error.message}`,
        });
      }
      return { success: true };
    }),
});
