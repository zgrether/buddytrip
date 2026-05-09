import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/** Shared between events.list and competitions.hydrate. */
export async function listEvents(
  ctx: { supabase: SupabaseClient },
  competitionId: string,
) {
  const { data, error } = await ctx.supabase
    .from("events")
    .select(`
      *,
      point_distributions:event_point_distributions(*),
      agenda_item:schedule_items!events_agenda_item_id_fkey(id, title, item_type, course_name, scheduled_date)
    `)
    .eq("competition_id", competitionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch events: ${error.message}`,
    });
  }
  return data ?? [];
}

/**
 * events — scored activities within a competition (golf rounds, side games).
 *
 * Replaces the legacy "events as competition container" usage; that role
 * is now `competitions`. See migration 062.
 */

const EVENT_TYPE = z.enum(["GOLF", "GENERIC"]);
const SCORING_FORMAT = z.enum([
  "scramble",
  "stableford",
  "skins",
  "match_play",
  "singles",
  "sabotage",
  "other",
]);
const EVENT_STATUS = z.enum(["upcoming", "active", "completed"]);


export const eventsRouter = router({
  // -----------------------------------------------------------------------
  // list — all events for a competition (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => listEvents(ctx, input.competitionId)),

  // -----------------------------------------------------------------------
  // create — add a scored activity (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        type: EVENT_TYPE,
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        scoringFormat: SCORING_FORMAT.optional(),
        courseId: z.string().uuid().optional(),
        isPractice: z.boolean().optional(),
        pointsAvailable: z.number().min(0).optional(),
        day: z.number().int().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // RLS INSERT RETURNING split
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("events")
        .insert({
          competition_id: input.competitionId,
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          scoring_format: input.scoringFormat ?? null,
          course_id: input.courseId ?? null,
          is_practice: input.isPractice ?? false,
          points_available: input.pointsAvailable ?? null,
          day: input.day ?? null,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create event: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("events")
        .select("*, point_distributions:event_point_distributions(*)")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created event: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — modify an event (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        scoringFormat: SCORING_FORMAT.nullable().optional(),
        courseId: z.string().uuid().nullable().optional(),
        isPractice: z.boolean().optional(),
        pointsAvailable: z.number().min(0).nullable().optional(),
        day: z.number().int().nullable().optional(),
        status: EVENT_STATUS.optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.scoringFormat !== undefined) patch.scoring_format = input.scoringFormat;
      if (input.courseId !== undefined) patch.course_id = input.courseId;
      if (input.isPractice !== undefined) patch.is_practice = input.isPractice;
      if (input.pointsAvailable !== undefined)
        patch.points_available = input.pointsAvailable;
      if (input.day !== undefined) patch.day = input.day;
      if (input.status !== undefined) patch.status = input.status;

      const { data, error } = await ctx.supabase
        .from("events")
        .update(patch)
        .eq("id", input.eventId)
        .select("*, point_distributions:event_point_distributions(*)")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update event: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove an event (canEdit; cascades to point dists + groups)
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("events")
        .delete()
        .eq("id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete event: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // reorder — set new `day` ordering (canEdit). Accepts the desired full
  // sequence; the index in orderedIds becomes the new day value.
  // -----------------------------------------------------------------------
  reorder: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        orderedIds: z.array(z.string()).min(1),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // One UPDATE per row keeps things simple and stays within RLS scope.
      for (let i = 0; i < input.orderedIds.length; i++) {
        const id = input.orderedIds[i];
        const { error } = await ctx.supabase
          .from("events")
          .update({ sort_order: i, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("competition_id", input.competitionId);
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to reorder events: ${error.message}`,
          });
        }
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // linkToAgendaItem — link/unlink a competition event to a schedule item.
  // Syncs both sides: events.agenda_item_id and schedule_items.competition_event_id.
  // Pass agendaItemId: null to unlink.
  // -----------------------------------------------------------------------
  linkToAgendaItem: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        agendaItemId: z.string().uuid().nullable(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // 1. Find any schedule_item currently linked to this event, clear it.
      const { data: oldItem } = await ctx.supabase
        .from("schedule_items")
        .select("id")
        .eq("competition_event_id", input.eventId)
        .maybeSingle();

      if (oldItem) {
        await ctx.supabase
          .from("schedule_items")
          .update({ competition_event_id: null })
          .eq("id", oldItem.id);
      }

      // 2. If linking to a new item, clear any event currently on that item.
      if (input.agendaItemId) {
        const { data: targetItem } = await ctx.supabase
          .from("schedule_items")
          .select("competition_event_id")
          .eq("id", input.agendaItemId)
          .maybeSingle();

        if (targetItem?.competition_event_id && targetItem.competition_event_id !== input.eventId) {
          await ctx.supabase
            .from("events")
            .update({ agenda_item_id: null })
            .eq("id", targetItem.competition_event_id);
        }
      }

      // 3. Update events.agenda_item_id.
      const { error: eventErr } = await ctx.supabase
        .from("events")
        .update({ agenda_item_id: input.agendaItemId })
        .eq("id", input.eventId);

      if (eventErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update event: ${eventErr.message}`,
        });
      }

      // 4. Update schedule_items.competition_event_id.
      if (input.agendaItemId) {
        const { error: siErr } = await ctx.supabase
          .from("schedule_items")
          .update({ competition_event_id: input.eventId })
          .eq("id", input.agendaItemId);

        if (siErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update schedule item: ${siErr.message}`,
          });
        }
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // setPointDistributions — replace the point distribution rows for an
  // event in a single transaction-like sequence (canEdit).
  //
  // The UI builds up positions client-side and posts the full set; we wipe
  // and re-insert rather than diff-patching so the order/labels stay
  // consistent with what the user sees.
  // -----------------------------------------------------------------------
  setPointDistributions: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        positions: z
          .array(
            z.object({
              position: z.number().int().min(1),
              label: z.string().min(1).max(100),
              points: z.number().min(0),
            })
          )
          .max(64),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error: deleteErr } = await ctx.supabase
        .from("event_point_distributions")
        .delete()
        .eq("event_id", input.eventId);

      if (deleteErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to clear point distributions: ${deleteErr.message}`,
        });
      }

      if (input.positions.length === 0) {
        return { success: true, count: 0 };
      }

      const rows = input.positions.map((p) => ({
        event_id: input.eventId,
        position: p.position,
        label: p.label,
        points: p.points,
      }));

      const { error: insertErr } = await ctx.supabase
        .from("event_point_distributions")
        .insert(rows);

      if (insertErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save point distributions: ${insertErr.message}`,
        });
      }

      return { success: true, count: rows.length };
    }),
});
