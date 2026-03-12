import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const notificationsRouter = router({
  // -----------------------------------------------------------------------
  // list — all notifications for a trip (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: notifications, error } = await ctx.supabase
        .from("notification_events")
        .select("id, type, trip_id, actor_id, payload, created_at")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch notifications",
        });
      }

      // Get read state for current user
      const notifIds = (notifications ?? []).map((n) => n.id);
      let readSet = new Set<string>();
      if (notifIds.length > 0) {
        const { data: reads } = await ctx.supabase
          .from("notification_reads")
          .select("notification_id")
          .eq("user_id", ctx.user!.id)
          .in("notification_id", notifIds);
        readSet = new Set((reads ?? []).map((r) => r.notification_id));
      }

      return (notifications ?? []).map((n) => ({
        ...n,
        read: readSet.has(n.id),
      }));
    }),

  // -----------------------------------------------------------------------
  // markAllRead — mark all trip notifications as read for current user
  // -----------------------------------------------------------------------
  markAllRead: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx }) => {
      // Get all unread notification IDs for this trip
      const { data: notifications } = await ctx.supabase
        .from("notification_events")
        .select("id")
        .eq("trip_id", ctx.tripId);

      if (!notifications || notifications.length === 0) {
        return { marked: 0 };
      }

      // Get already-read ones
      const notifIds = notifications.map((n) => n.id);
      const { data: existing } = await ctx.supabase
        .from("notification_reads")
        .select("notification_id")
        .eq("user_id", ctx.user!.id)
        .in("notification_id", notifIds);

      const alreadyRead = new Set((existing ?? []).map((r) => r.notification_id));
      const unread = notifIds.filter((id) => !alreadyRead.has(id));

      if (unread.length === 0) {
        return { marked: 0 };
      }

      const rows = unread.map((notificationId) => ({
        notification_id: notificationId,
        user_id: ctx.user!.id,
      }));

      const { error } = await ctx.supabase
        .from("notification_reads")
        .insert(rows);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to mark notifications as read",
        });
      }

      return { marked: unread.length };
    }),
});

// ---------------------------------------------------------------------------
// Helper: create a notification event (used by other routers/triggers)
// ---------------------------------------------------------------------------
export async function createNotification(
  supabase: SupabaseClient,
  params: {
    tripId: string;
    actorId: string;
    type: string;
    payload: Record<string, unknown>;
  }
) {
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await supabase.from("notification_events").insert({
    id,
    trip_id: params.tripId,
    actor_id: params.actorId,
    type: params.type,
    payload: params.payload,
  });
  return id;
}
