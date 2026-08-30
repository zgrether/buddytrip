import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { newsPreview, type NewsBlock } from "@/lib/news";
import { sendPushToUsers, type SendPushToUsersResult } from "./sendPushToUsers";
import { recordPushAttempt } from "./recordPushAttempt";

/**
 * The `news` category's ONE wire point — `news.create` on post, and
 * `news.resend` on request.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 *     Notify every trip member, except the author.
 *
 * Simpler than chat's rule, deliberately: News has no `viewing_at` heartbeat
 * (`news_reads` carries only `last_read_at` — migration 022), so there is no
 * "is their panel open right now" signal to suppress on. That is not a gap to
 * fill; it is the right shape for the volume. Chat's suppression exists
 * because a live conversation can put ten pushes in front of someone already
 * looking at the screen they'd land on. News is ~1-5 posts per TRIP, not per
 * day — the base rate that made a suppression gate worth building for chat
 * does not exist here, and adding one now would be inventing a mechanism for
 * a problem this category doesn't have.
 *
 * ── Why the SAME function serves both call sites ────────────────────────────
 *
 * `news.create`'s notify and `news.resend`'s notify are the same event from a
 * recipient's point of view — "here is this post" — so they are the same
 * function call with the same inputs, not two copies that could drift. The
 * only thing that differs between them is WHEN they're called and WHY
 * (transition vs. an organizer asking again), which is exactly what `trigger`
 * in the push-attempt record is for — see the two call sites in `news.ts`.
 *
 * ── Failure isolation ────────────────────────────────────────────────────
 * Swallows its own errors, same posture as `chatNotify`/`gameFinishNotify`: a
 * push failure must never fail the post (create) or the resend action itself.
 * The caller awaits rather than firing-and-forgetting, because un-awaited work
 * can be killed when a serverless function freezes.
 */

// ── Copy ─────────────────────────────────────────────────────────────────

/**
 * The notification copy, built from the trip, the author, and a short preview
 * of the post's own content.
 *
 * Unlike `chatNotify`'s payload builder — which deliberately carries NO
 * message text, because casual chat banter previewed on a lock screen is a
 * real privacy leak — News is organizer-authored and meant to be seen widely;
 * withholding its content would make the push say only "someone posted",
 * which answers nothing a recipient wants to know before they tap. `newsPreview`
 * already draws the line for what's safe/useful to preview (skips photo-only
 * and team-draw-only posts, which have no sentence to show).
 */
export function buildNewsPayload(args: {
  tripId: string;
  tripTitle: string;
  authorName: string;
  postId: string;
  blocks: NewsBlock[];
}) {
  const { tripId, tripTitle, authorName, postId, blocks } = args;
  const preview = newsPreview(blocks);
  return {
    // "· News" always, unlike chat's bare-title-for-Crew convention — News is
    // never the trip's "default" room the way Crew is, so there is no common
    // case to keep unlabeled.
    title: `${tripTitle} · News`,
    body: preview ? `${authorName}: ${preview}` : `${authorName} posted an update`,
    url: `/trips/${tripId}?chat=1&channel=news`,
    // Per-POST, not per-trip: two distinct announcements should both surface,
    // and a resend of the SAME post correctly replaces its own earlier notice
    // rather than stacking a second copy of it.
    tag: `bt-news-${postId}`,
  };
}

// ── The wire point ───────────────────────────────────────────────────────

export interface NewsNotifyInput {
  tripId: string;
  /** The post being announced — its id (the coalescing tag) and blocks (the
   *  preview). */
  postId: string;
  blocks: NewsBlock[];
  /** Who authored the post. Excluded from the audience. */
  authorId: string;
  /**
   * What this call is FOR, recorded to `push_send_log` — 'news_posted' from
   * `news.create`'s transition, 'news_resend' from an organizer manually
   * asking again. Free-text, like every other trigger label (migration 105) —
   * see `recordPushAttempt`'s note on why this is not an enum.
   */
  trigger: "news_posted" | "news_resend";
  /** Injectable for tests; defaults to the service-role admin client. */
  admin?: SupabaseClient;
}

export interface NewsNotifyResult {
  /** Trip members addressed after author-exclusion. */
  audience: number;
  send: SendPushToUsersResult | null;
}

const EMPTY: NewsNotifyResult = { audience: 0, send: null };

/**
 * Resolve who is on the trip, build the copy, and send. Never throws.
 */
export async function notifyNewsPost(input: NewsNotifyInput): Promise<NewsNotifyResult> {
  const admin = input.admin ?? createAdminClient();
  const result: NewsNotifyResult = { ...EMPTY };

  try {
    // 1 · The trip's membership, minus the author. Everyone on the trip is in
    //     this audience — News has no sub-channel the way Crew/Organizers do.
    const { data: memberRows, error: memberErr } = await admin
      .from("trip_members")
      .select("user_id, nickname")
      .eq("trip_id", input.tripId);
    if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);

    type MemberRow = { user_id: string; nickname: string | null };
    const members = (memberRows ?? []) as MemberRow[];

    const audience = members
      .map((m) => m.user_id)
      .filter((id) => !!id && id !== input.authorId);
    result.audience = audience.length;
    if (audience.length === 0) return result;

    // 2 · Copy inputs — trip title + author's display name, same resolution
    //     chat uses (`trip_members.nickname ?? users.name`), so the push calls
    //     someone what the app calls them everywhere else.
    const nickname = members.find((m) => m.user_id === input.authorId)?.nickname ?? null;
    const [tripRes, authorRes] = await Promise.all([
      admin.from("trips").select("title").eq("id", input.tripId).maybeSingle(),
      nickname
        ? Promise.resolve({ data: null as { name?: string } | null })
        : admin.from("users").select("name").eq("id", input.authorId).maybeSingle(),
    ]);

    const tripTitle = (tripRes.data as { title?: string } | null)?.title || "Your trip";
    const authorName =
      nickname || (authorRes.data as { name?: string } | null)?.name || "Someone";

    // 3 · Send.
    result.send = await sendPushToUsers(
      audience,
      "news",
      buildNewsPayload({
        tripId: input.tripId,
        tripTitle,
        authorName,
        postId: input.postId,
        blocks: input.blocks,
      }),
      {
        excludeUserId: input.authorId,
        context: {
          trigger: input.trigger,
          tripId: input.tripId,
          actorUserId: input.authorId,
        },
      }
    );

    return result;
  } catch (err) {
    console.error("[notifyNewsPost] failed", { tripId: input.tripId, postId: input.postId, err });
    try {
      await recordPushAttempt(
        admin,
        { trigger: input.trigger, tripId: input.tripId, actorUserId: input.authorId },
        {
          typeKey: "news",
          recipients: result.audience,
          skippedPreferenceOff: 0,
          subscriptionsFound: 0,
          sent: 0,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          // "threw" — the documented free-text value for exactly this case
          // (`recordPushAttempt`'s own list: sent / no_clincher /
          // already_claimed / threw / no_recipients).
          outcome: "threw",
          error: err instanceof Error ? err.message : String(err),
        }
      );
    } catch {
      // Recording the failure failed too — nothing left to do but have
      // already logged above.
    }
    return result;
  }
}
