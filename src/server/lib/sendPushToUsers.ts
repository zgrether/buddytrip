import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  isTypeEnabled,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notificationTypes";
import { getWebPush, pushConfigured } from "./vapid";
import type { PushPayload } from "./sendPush";

/**
 * BATCHED multi-recipient push fan-out (Push Phase 3).
 *
 * `sendPush` is the single-USER path and stays exactly that — it is what
 * `notifications.testSend` uses. This is its audience-shaped sibling, and the
 * reason it exists is cost: `sendPush` does TWO queries per recipient (the
 * preference read, then the subscription read), so a 30-person clinch fan-out
 * would be 60 sequential-ish round-trips inside a mutation the user is waiting
 * on. Here both reads are `.in(...)` over the whole audience — 2 queries total,
 * regardless of audience size — and only the per-device HTTP sends fan out.
 *
 * Everything else is deliberately identical to `sendPush`, because the two must
 * not drift on the properties that matter:
 *  - PREFERENCE-GATED per recipient (stored pref, else registry default). There
 *    is no bypass here at all: `bypassPreference` exists on `sendPush` for an
 *    explicitly user-requested self-test, and a self-test has exactly one
 *    recipient. An automated fan-out must never bypass, so the option is absent
 *    rather than present-and-unused.
 *  - PER-DEVICE within a recipient (push subscriptions are per browser install).
 *  - 404/410 from the push service means the endpoint is dead → prune the row.
 *  - FIRE-AND-FORGET: never throws. A push failure must not roll back the domain
 *    write that triggered it.
 *  - NO-OP when VAPID isn't configured (local/CI/preview without keys).
 *
 * ACTOR EXCLUSION is a first-class parameter, not a caller's responsibility:
 * nobody should be notified about their own action, and making each call site
 * remember to filter is how one of them eventually doesn't.
 */

export interface SendPushToUsersResult {
  /** Total successful per-DEVICE sends (a 2-device recipient counts 2). */
  sent: number;
  /** Recipients who had the category switched off. */
  skippedPreferenceOff: number;
  /** Recipients addressed after actor-exclusion + de-duplication. */
  recipients: number;
  /** Dead subscription rows pruned this run. */
  removedDead: number;
  /** True when VAPID keys are absent — nothing was sent, and that's not an error. */
  notConfigured: boolean;
}

export interface SendPushToUsersOptions {
  /** Injectable client (tests); defaults to the service-role admin client. The
   *  fan-out reads OTHER users' prefs and subscriptions, which own-row RLS
   *  cannot express — so this path is service-role by nature, never ctx.supabase. */
  admin?: SupabaseClient;
  /** The user who caused the event. Excluded from the audience. */
  excludeUserId?: string | null;
}

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** HTTP status codes from the push service that mean "this endpoint is gone". */
function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410;
}

export async function sendPushToUsers(
  userIds: readonly string[],
  typeKey: NotificationKey,
  payload: PushPayload,
  opts: SendPushToUsersOptions = {}
): Promise<SendPushToUsersResult> {
  const result: SendPushToUsersResult = {
    sent: 0,
    skippedPreferenceOff: 0,
    recipients: 0,
    removedDead: 0,
    notConfigured: false,
  };

  try {
    // 1 · Audience: de-duplicate and drop the actor. A user can appear twice in
    // a resolved audience (e.g. on two teams), and sending twice for one event
    // is indistinguishable from a bug to the person holding the phone.
    const audience = [...new Set(userIds)].filter(
      (id) => !!id && id !== opts.excludeUserId
    );
    result.recipients = audience.length;
    if (audience.length === 0) return result;

    const admin = opts.admin ?? createAdminClient();

    // 2 · Preference gate — ONE query for the whole audience. A user row that
    // doesn't come back (deleted mid-flight) resolves through the registry
    // default via isTypeEnabled(null, ...), same as an unset preference.
    const { data: userRows } = await admin
      .from("users")
      .select("id, notification_prefs")
      .in("id", audience);

    const prefsById = new Map<string, NotificationPrefs | null>(
      (userRows ?? []).map((u: { id: string; notification_prefs: unknown }) => [
        u.id,
        (u.notification_prefs ?? null) as NotificationPrefs | null,
      ])
    );

    const eligible = audience.filter((id) => {
      const on = isTypeEnabled(prefsById.get(id) ?? null, typeKey);
      if (!on) result.skippedPreferenceOff += 1;
      return on;
    });
    if (eligible.length === 0) return result;

    // 3 · No keys → nothing to send with. Checked AFTER the preference gate so
    // the returned counts still describe the audience truthfully in CI, where
    // VAPID is absent and every send is a no-op.
    const wp = getWebPush();
    if (!wp || !pushConfigured()) {
      result.notConfigured = true;
      return result;
    }

    // 4 · Devices — ONE query for every eligible recipient.
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", eligible);

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
            console.error("[sendPushToUsers] delivery failed", {
              userId: s.user_id,
              typeKey,
              status,
            });
          }
        }
      })
    );

    // 5 · Prune dead endpoints so every future fan-out stops paying for them.
    if (deadIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", deadIds);
      result.removedDead = deadIds.length;
    }
  } catch (err) {
    // Fire-and-forget: a push failure must never surface to the domain write.
    console.error("[sendPushToUsers] unexpected error", { typeKey, err });
  }

  return result;
}
