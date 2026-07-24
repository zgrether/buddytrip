import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  isTypeEnabled,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notificationTypes";
import { getWebPush, pushConfigured } from "./vapid";

/**
 * The shared push send helper (Push Phase 2). Phase 3 calls this from domain
 * write points; NOTHING wires a real event yet (one dev-only test send does).
 *
 * Contract:
 *  - PREFERENCE-GATED: checks the recipient's effective on/off for `typeKey`
 *    (stored pref, else registry default). OFF → no send, full stop.
 *  - PER-DEVICE FAN-OUT: sends to every subscription the user has.
 *  - LIFECYCLE: a 404/410 from the push service means the subscription is dead
 *    (uninstalled / permission revoked) → delete that row so endpoints don't
 *    accumulate forever. Other errors are logged, not fatal.
 *  - FIRE-AND-FORGET: never throws to the caller; a failed push must not affect
 *    the domain write that triggered it. Returns a small summary for tests/logs.
 *  - NO-OP when VAPID isn't configured (local/CI/preview without keys).
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link path opened on notificationclick (e.g. "/trips/abc"). */
  url?: string;
  /** Coalescing tag — a newer push with the same tag replaces the old one. */
  tag?: string;
}

export interface SendPushResult {
  sent: number;
  skippedPreferenceOff: boolean;
  removedDead: number;
  notConfigured: boolean;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** HTTP status codes from the push service that mean "this endpoint is gone". */
function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410;
}

export async function sendPush(
  userId: string,
  typeKey: NotificationKey,
  payload: PushPayload,
  /** Injectable for tests; defaults to the service-role admin client. */
  admin: SupabaseClient = createAdminClient()
): Promise<SendPushResult> {
  const result: SendPushResult = {
    sent: 0,
    skippedPreferenceOff: false,
    removedDead: 0,
    notConfigured: false,
  };

  try {
    // 1 · Preference gate — the recipient's effective on/off for this type.
    const { data: userRow } = await admin
      .from("users")
      .select("notification_prefs")
      .eq("id", userId)
      .maybeSingle();
    const prefs = (userRow?.notification_prefs ?? null) as NotificationPrefs | null;
    if (!isTypeEnabled(prefs, typeKey)) {
      result.skippedPreferenceOff = true;
      return result;
    }

    // 2 · No keys → nothing to send with. Not an error (graceful degrade).
    const wp = getWebPush();
    if (!wp || !pushConfigured()) {
      result.notConfigured = true;
      return result;
    }

    // 3 · Fan out to every device.
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    const body = JSON.stringify(payload);
    const deadIds: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (s: SubRow) => {
        try {
          await wp.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          );
          result.sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (isGoneStatus(status)) {
            deadIds.push(s.id); // uninstalled / revoked → prune
          } else {
            console.error("[sendPush] delivery failed", {
              userId,
              typeKey,
              status,
            });
          }
        }
      })
    );

    // 4 · Prune dead endpoints so they don't accumulate forever.
    if (deadIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", deadIds);
      result.removedDead = deadIds.length;
    }
  } catch (err) {
    // Fire-and-forget: a push failure must never surface to the domain write.
    console.error("[sendPush] unexpected error", { userId, typeKey, err });
  }

  return result;
}
