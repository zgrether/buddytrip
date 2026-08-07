import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Record one push send ATTEMPT — the durable half of the observability Part B
 * adds (migration 105), alongside a structured log line.
 *
 * ── The one rule this file exists to hold ───────────────────────────────────
 * THE RECORD MUST NEVER FAIL THE SEND. An observability improvement that can
 * throw inside a notification path is a new failure mode wearing a diagnostic's
 * clothes — and this subsystem has just produced two silent failures in a week;
 * it does not need a third that we introduced.
 *
 * So the posture is the broadcast trigger's (migration 096): defensive,
 * swallowed, never blocking. Everything here is wrapped, the return type is
 * `void`, and there is deliberately no way for a caller to `await` a failure
 * into their own error path. A recording failure degrades to a `console.error`
 * and the send proceeds exactly as it would have.
 *
 * ── Why the helpers call this, and not the triggers ─────────────────────────
 * Sender-scoped: `sendPush` and `sendPushToUsers` record, so every caller —
 * including ones nobody has written yet — is covered. Wiring it per-trigger
 * would go blind the moment a fifth trigger lands, which is the exact shape of
 * how a merged-away path's behaviour gets lost.
 *
 * ── NO MESSAGE CONTENT ──────────────────────────────────────────────────────
 * Ids and counts. The payload is never touched here — not the title, not the
 * body, not the URL. A notification body carries scores and names; this answers
 * "did it go, and to how many", which needs none of that.
 */

/** What the send helpers know about the event they're sending for. Everything
 *  is optional because a single-user send (`testSend`) has no game or trip. */
export interface PushAttemptContext {
  /** Free-text label owned by the caller: 'game_finished', 'cup_clinched',
   *  'test_send'. Not an enum — see the migration's note on why a CHECK here
   *  would mean a migration per notification type. */
  trigger: string;
  tripId?: string | null;
  gameId?: string | null;
  competitionId?: string | null;
  /** The user who caused the event, and who is excluded from the audience. */
  actorUserId?: string | null;
}

/** The measured outcome. Mirrors the send helpers' result shapes, plus the
 *  counts they don't currently expose (`subscriptionsFound`, `failed`). */
export interface PushAttemptOutcome {
  typeKey: string;
  recipients: number;
  skippedPreferenceOff: number;
  subscriptionsFound: number;
  sent: number;
  failed: number;
  removedDead: number;
  notConfigured: boolean;
  /** Message text only, never a payload. Null on a clean run. */
  error?: string | null;
}

export async function recordPushAttempt(
  admin: SupabaseClient,
  context: PushAttemptContext,
  outcome: PushAttemptOutcome
): Promise<void> {
  // The structured log line: the IMMEDIATE signal, visible in Vercel while the
  // incident is live. The row below is the one still there in November — the
  // two are complementary, which is why Part B is both rather than either.
  //
  // A single object so it lands as one structured entry rather than an
  // interpolated string nobody can filter on.
  console.info("[push] attempt", {
    trigger: context.trigger,
    typeKey: outcome.typeKey,
    gameId: context.gameId ?? null,
    competitionId: context.competitionId ?? null,
    recipients: outcome.recipients,
    skippedPreferenceOff: outcome.skippedPreferenceOff,
    subscriptionsFound: outcome.subscriptionsFound,
    sent: outcome.sent,
    failed: outcome.failed,
    removedDead: outcome.removedDead,
    notConfigured: outcome.notConfigured,
    error: outcome.error ?? null,
  });

  try {
    const { error } = await admin.from("push_send_log").insert({
      trigger: context.trigger,
      type_key: outcome.typeKey,
      trip_id: context.tripId ?? null,
      game_id: context.gameId ?? null,
      competition_id: context.competitionId ?? null,
      actor_user_id: context.actorUserId ?? null,
      recipients: outcome.recipients,
      skipped_preference_off: outcome.skippedPreferenceOff,
      subscriptions_found: outcome.subscriptionsFound,
      sent: outcome.sent,
      failed: outcome.failed,
      removed_dead: outcome.removedDead,
      not_configured: outcome.notConfigured,
      error: outcome.error ?? null,
    });
    // The error is CHECKED, not destructured-and-ignored — the swallowing shape
    // that hid a missing relation for six weeks (CLAUDE.md #16) is the specific
    // thing this table exists to stop, so it must not be reproduced here. It is
    // logged and dropped: loud, but never fatal.
    if (error) {
      console.error("[push] recording failed", {
        trigger: context.trigger,
        message: error.message,
      });
    }
  } catch (err) {
    // A throw here (client construction, network) must be as harmless as a
    // failed insert. Same reason: the record is never worth the send.
    console.error("[push] recording threw", { trigger: context.trigger, err });
  }
}
