import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  isTypeEnabled,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notificationTypes";
import { getWebPush, pushConfigured } from "./vapid";
import { recordPushAttempt, type PushAttemptContext } from "./recordPushAttempt";

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
  /** Device rows found for this user — distinguishes "no device registered"
   *  from "every send failed", which were both `sent: 0` before. */
  subscriptionsFound: number;
  /** Sends that failed for a reason other than a dead endpoint. */
  failed: number;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendPushOptions {
  /** Injectable client (tests / server contexts); defaults to service-role admin. */
  admin?: SupabaseClient;
  /** Skip the preference gate. ONLY for an explicitly user-requested self-test
   *  ("send me a test notification") — a diagnostic must deliver even if the
   *  user has toggled the category off, or it reads as broken. Phase 3 event
   *  wiring NEVER sets this — automated pushes are always preference-gated. */
  bypassPreference?: boolean;
  /** What this send is FOR — recorded to `push_send_log` (migration 105) plus a
   *  structured log line. Same field, same reasoning as `sendPushToUsers`: the
   *  recording is SENDER-scoped so every caller is covered by construction. */
  context?: PushAttemptContext;
}

/** HTTP status codes from the push service that mean "this endpoint is gone". */
function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410;
}

export async function sendPush(
  userId: string,
  typeKey: NotificationKey,
  payload: PushPayload,
  opts: SendPushOptions = {}
): Promise<SendPushResult> {
  const admin = opts.admin ?? createAdminClient();
  const result: SendPushResult = {
    sent: 0,
    skippedPreferenceOff: false,
    removedDead: 0,
    notConfigured: false,
    subscriptionsFound: 0,
    failed: 0,
  };
  let errorMessage: string | null = null;

  // Same shape as `sendPushToUsers`: the work runs in an inner function so its
  // early returns stay natural, and the record below runs on EVERY path.
  await runSend();

  if (opts.context) {
    try {
      await recordPushAttempt(admin, opts.context, {
        typeKey,
        // A single-user send addresses exactly one recipient, unless the
        // preference gate turned it away.
        recipients: result.skippedPreferenceOff ? 0 : 1,
        skippedPreferenceOff: result.skippedPreferenceOff ? 1 : 0,
        subscriptionsFound: result.subscriptionsFound,
        sent: result.sent,
        failed: result.failed,
        removedDead: result.removedDead,
        notConfigured: result.notConfigured,
        outcome: result.skippedPreferenceOff ? "no_recipients" : "sent",
        error: errorMessage,
      });
    } catch (err) {
      console.error("[sendPush] recording failed", { typeKey, err });
    }
  }

  return result;

  async function runSend(): Promise<void> {
  try {
    // 1 · Preference gate — the recipient's effective on/off for this type.
    // Skipped only for an explicit self-test (bypassPreference); Phase 3 events
    // never bypass, so an automated push always respects the user's choice.
    if (!opts.bypassPreference) {
      const { data: userRow } = await admin
        .from("users")
        .select("notification_prefs")
        .eq("id", userId)
        .maybeSingle();
      const prefs = (userRow?.notification_prefs ?? null) as NotificationPrefs | null;
      if (!isTypeEnabled(prefs, typeKey)) {
        result.skippedPreferenceOff = true;
        return;
      }
    }

    // 2 · No keys → nothing to send with. Not an error (graceful degrade).
    const wp = getWebPush();
    if (!wp || !pushConfigured()) {
      result.notConfigured = true;
      return;
    }

    // 3 · Fan out to every device.
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    // Recorded BEFORE the sends: "this user has no device registered" stays a
    // fact in the log even if every send below then throws.
    result.subscriptionsFound = (subs ?? []).length;

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
            result.failed += 1;
            errorMessage ??= `delivery failed (status ${String(status ?? "unknown")})`;
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
    // Fire-and-forget: a push failure must never surface to the domain write —
    // but it IS recorded now rather than only logged into a 1-day retention.
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[sendPush] unexpected error", { userId, typeKey, err });
  }
  }
}
