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
        .eq("recipient_id", ctx.user!.id)
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
      // Get all notification IDs for this trip addressed to the current user.
      // (Unavoidable — notification_reads keys off notification_id.)
      const { data: notifications } = await ctx.supabase
        .from("notification_events")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .eq("recipient_id", ctx.user!.id);

      if (!notifications || notifications.length === 0) {
        return { marked: 0 };
      }

      // Single upsert with ON CONFLICT DO NOTHING (ignoreDuplicates) replaces
      // the prior read-existing / diff / insert dance. .select() after an
      // ignoreDuplicates upsert returns only the rows actually inserted, so
      // `marked` stays accurate (0 when everything was already read).
      const rows = notifications.map((n) => ({
        notification_id: n.id,
        user_id: ctx.user!.id,
      }));

      const { data: inserted, error } = await ctx.supabase
        .from("notification_reads")
        .upsert(rows, {
          onConflict: "notification_id,user_id",
          ignoreDuplicates: true,
        })
        .select("notification_id");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to mark notifications as read",
        });
      }

      return { marked: inserted?.length ?? 0 };
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
    recipientId: string;
    type: string;
    payload: Record<string, unknown>;
  }
) {
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await supabase.from("notification_events").insert({
    id,
    trip_id: params.tripId,
    actor_id: params.actorId,
    recipient_id: params.recipientId,
    type: params.type,
    payload: params.payload,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Helper: create the SAME notification for many recipients in ONE insert.
//
// Replaces `for (member) { await createNotification(...) }` fan-out loops,
// which fired one round-trip per recipient (O(N) — felt immediately on
// 6-16 member trips). A single bulk insert is one round-trip regardless of
// crew size. Each row still gets a unique id (random suffix differentiates
// rows that share the same Date.now() millisecond).
// ---------------------------------------------------------------------------
export async function createNotifications(
  supabase: SupabaseClient,
  params: {
    tripId: string;
    actorId: string;
    recipientIds: string[];
    type: string;
    payload: Record<string, unknown>;
  }
) {
  if (params.recipientIds.length === 0) return [];
  const rows = params.recipientIds.map((recipientId) => ({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trip_id: params.tripId,
    actor_id: params.actorId,
    recipient_id: recipientId,
    type: params.type,
    payload: params.payload,
  }));
  await supabase.from("notification_events").insert(rows);
  return rows.map((r) => r.id);
}
