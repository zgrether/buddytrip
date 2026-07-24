import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  isNotificationKey,
  resolvePrefs,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notificationTypes";
import { pushConfigured } from "../lib/vapid";
import { sendPush } from "../lib/sendPush";

// ── notifications router (Push Phase 2) ─────────────────────────────────────
//
// Subscription lifecycle + per-type preferences. Does NOT wire any real event
// — the one `testSend` procedure is dev/preview-only and gated so it can never
// reach a real user in production. Phase 3 calls `sendPush` from domain writes.

const SubscriptionInput = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(500).optional(),
});

export const notificationsRouter = router({
  /** Is push available at all (VAPID configured)? The client hides the enable
   *  affordance when false so nothing looks broken in an env without keys. */
  status: authedProcedure.query(() => ({ configured: pushConfigured() })),

  /**
   * Upsert this device's subscription, keyed by `endpoint` (per-device).
   * Runs via the admin client so it can REASSIGN an endpoint whose row belongs
   * to a previous account on a shared device — own-row RLS can't express that.
   * We enforce user scoping in code (user_id = caller). Idempotent: same
   * endpoint twice → one row (refreshed), never two.
   */
  subscribe: authedProcedure
    .input(SubscriptionInput)
    .mutation(async ({ ctx, input }) => {
      const admin = createAdminClient();
      const { error } = await admin.from("push_subscriptions").upsert(
        {
          user_id: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          user_agent: input.userAgent ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save subscription: ${error.message}`,
        });
      }
      return { ok: true };
    }),

  /** Remove this device's subscription (the caller's own, by endpoint). */
  unsubscribe: authedProcedure
    .input(z.object({ endpoint: z.string().url().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      // RLS-scoped client: the delete only ever touches the caller's own rows.
      const { error } = await ctx.supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", input.endpoint)
        .eq("user_id", ctx.user.id);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to remove subscription: ${error.message}`,
        });
      }
      return { ok: true };
    }),

  /** Effective on/off for EVERY registry key — stored prefs merged over the
   *  registry defaults (unset keys resolve to their default; no backfill). */
  getPreferences: authedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("users")
      .select("notification_prefs")
      .eq("id", ctx.user.id)
      .maybeSingle();
    const stored = (data?.notification_prefs ?? null) as NotificationPrefs | null;
    return resolvePrefs(stored);
  }),

  /** Set one type on/off. The key is validated against the registry so a typo
   *  can never be persisted (which would silently desync the send filter). */
  setPreference: authedProcedure
    .input(z.object({ key: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!isNotificationKey(input.key)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown notification type: ${input.key}`,
        });
      }
      const key = input.key as NotificationKey;

      // Read-modify-write the jsonb map (merge, don't clobber other keys).
      const { data } = await ctx.supabase
        .from("users")
        .select("notification_prefs")
        .eq("id", ctx.user.id)
        .maybeSingle();
      const prefs = { ...((data?.notification_prefs ?? {}) as NotificationPrefs) };
      prefs[key] = input.enabled;

      const { error } = await ctx.supabase
        .from("users")
        .update({ notification_prefs: prefs })
        .eq("id", ctx.user.id);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save preference: ${error.message}`,
        });
      }
      return { ok: true };
    }),

  /**
   * DEV/PREVIEW-ONLY — prove the pipe. Sends a real test push to the CALLER's
   * own devices. Refused in production so it can never reach a real user (the
   * spec's gate: "remove or gate behind an env flag before it could reach a
   * real user"). Not a domain event — Phase 3 wires those.
   */
  testSend: authedProcedure.mutation(async ({ ctx }) => {
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Test send is disabled in production",
      });
    }
    // Uses `scores` (default ON) so an untouched account still receives it.
    const result = await sendPush(ctx.user.id, "scores", {
      title: "BuddyTrip",
      body: "🔔 Test notification — push is working.",
      url: "/dashboard",
      tag: "bt-test",
    });
    return result;
  }),
});
