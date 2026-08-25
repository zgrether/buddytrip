import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { CHAT_ACTIVE_VIEWING_WINDOW_MS } from "@/lib/chatViewHeartbeat";
import { sendPushToUsers, type SendPushToUsersResult } from "./sendPushToUsers";
import { recordPushAttempt } from "./recordPushAttempt";

/**
 * The `chat` category's ONE wire point — `messages.send`.
 *
 * This is the FIRST **BATCH**-marked trigger to be wired, and BATCH is the
 * marking that says "genuine, but bursty: never 1:1 per write". Chat is the
 * highest-volume candidate in the app (hundreds/day on a live trip day), so the
 * coalescing rule below is not a refinement of this feature — it IS the feature.
 * Wiring `messages.send` straight to a send helper would put ~30 phones through
 * a hundred buzzes in an afternoon, and the people who then disable
 * notifications at the OS level never come back.
 *
 * ── The coalescing rule: READ-STATE-GATED ───────────────────────────────────
 * A recipient is notified only when they were **caught up before this message
 * arrived** — `previousMessage.created_at <= their chat_reads.last_read_at`.
 *
 *   R is caught up  →  a message lands   →  ONE push
 *   more messages, R still hasn't looked →  R is no longer caught up → SILENCE
 *   R opens chat    →  markRead advances →  RE-ARMED for the next lull
 *
 * So the ceiling is **one push per recipient per read-session**, and a burst of
 * ten messages to sixteen people is sixteen pushes, not a hundred and sixty.
 * It self-heals: reading the chat is what re-arms it, which is exactly the
 * behaviour you want, because someone who never opens chat stops being told
 * about it.
 *
 * This is a per-RECIPIENT silence gate rather than a per-CONVERSATION one, and
 * the difference is the whole reason it was chosen. A conversation-level gate
 * ("notify on the first message after N minutes of quiet") fires at the START
 * of a conversation and then goes quiet through the middle — which is when you
 * would actually want to know. Per-recipient fires when *you* fell behind,
 * which is the question the notification is answering.
 *
 * ── Why this needs no migration, no scheduler, and no new state ─────────────
 * `chat_reads` (migration 010) already stores `last_read_at` per
 * (trip, user, visibility), and `messages.markRead` already maintains it for
 * the unread badge and the new-messages divider. The gate is a comparison
 * between two timestamps this app was already keeping. There is no scheduler
 * anywhere in this codebase — no Vercel cron, no pg_cron, no scheduled send —
 * and this deliberately does not add the first one.
 *
 * ── DO NOT GENERALISE THIS ──────────────────────────────────────────────────
 * It is chat-specific ON PURPOSE. It is free only because `chat_reads` happens
 * to exist; the other BATCH rows in NOTIFICATIONS.md (`games.openCorrection`,
 * the itinerary/logistics batch) have no equivalent read-state, so lifting this
 * into a generic coalescer would mean inventing per-recipient state and a
 * scheduler for them anyway. Generalising a mechanism that works by coincidence
 * of one table's existence produces an abstraction the next caller cannot use.
 * The next BATCH trigger pays for its own mechanism.
 *
 * ── Failure isolation ───────────────────────────────────────────────────────
 * Everything here swallows its own errors: a push failure must never fail
 * `messages.send`. Same posture as `gameFinishNotify` and the broadcast trigger
 * (migration 096). The caller AWAITS rather than firing and forgetting, because
 * un-awaited work can be killed when a serverless function freezes, and a
 * notification that races the response is one that sometimes doesn't happen.
 */

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * How recently `last_read_at` must have moved for us to treat the recipient as
 * WATCHING the channel right now, and skip them.
 *
 * This clause is not optional and not a refinement of the caught-up test — it
 * is what implements "don't notify someone with the chat open". The caught-up
 * test ALONE would push them: the send runs server-side immediately after the
 * INSERT, before their client has even received the realtime event, so at
 * decision time a viewer looks exactly like someone who is up to date and away.
 *
 * Defined in `@/lib/chatViewHeartbeat` alongside the client heartbeat that
 * keeps an open-but-silent panel inside it — the two are a pair and the
 * relationship between them is the actual mechanism. Re-exported here so the
 * gate's own callers and tests read it from the module they're testing.
 */
export { CHAT_ACTIVE_VIEWING_WINDOW_MS };

/** Why a recipient did or didn't get this one. */
export type ChatGateVerdict =
  /** Caught up and not watching — send. */
  | "notify"
  /** `last_read_at` moved within the window — they're looking at it. */
  | "active"
  /** Already behind, so they were notified earlier this read-session. */
  | "behind";

/**
 * The gate, as a pure function of three timestamps — no DB, no clock.
 *
 * Deliberately reads `messageAt` rather than `Date.now()` as "now". The send
 * runs microseconds after the insert so they are the same instant in practice,
 * and using the message's own timestamp makes every case below deterministic
 * and directly assertable instead of racing a wall clock in tests.
 *
 * Clause order is load-bearing: `active` is checked FIRST, because a watcher is
 * caught up by definition and would otherwise fall straight through to
 * `notify`.
 */
export function chatGateVerdict(args: {
  /**
   * How far this recipient has SEEN the channel — already resolved by the
   * caller, and null only if even the fallbacks were missing.
   *
   * Not the raw `chat_reads.last_read_at`: see `resolveLastSeen`. Someone who
   * has never opened this channel has no read row, and treating that absence as
   * "caught up" is a trap — with nothing to compare against they are caught up
   * FOREVER, so they get notified for every message in the trip. That is the
   * firehose this whole module exists to prevent, arriving through the one case
   * nobody pictures. The read mark falls back to the member's chat visibility
   * floor, then to `joined_at`, which is a real answer to the same question:
   * you are up to date as of the moment you joined, because nothing before that
   * was yours to read.
   */
  lastSeenAt: string | null;
  /** The newest non-system message in this channel BEFORE this one, or null if
   *  this is the channel's first. */
  prevMessageAt: string | null;
  /** The message that just landed. */
  messageAt: string;
}): ChatGateVerdict {
  const { lastSeenAt: lastReadAt, prevMessageAt, messageAt } = args;
  const messageMs = Date.parse(messageAt);

  // 1 · Watching right now? A read mark inside the window means their panel is
  //     open. Note the ABSOLUTE value: `last_read_at` can legitimately land
  //     AFTER `messageAt` when their client received the realtime insert and
  //     marked read before this server-side read ran — which is the strongest
  //     possible evidence they are watching, so it must not read as a negative
  //     age and fall through.
  if (lastReadAt !== null) {
    const age = Math.abs(messageMs - Date.parse(lastReadAt));
    if (age < CHAT_ACTIVE_VIEWING_WINDOW_MS) return "active";
  }

  // 2 · First message in the channel — nobody can be behind on nothing.
  if (prevMessageAt === null) return "notify";

  // 3 · No position at all, even after the fallbacks — a member row with no
  //     read mark, no visibility floor and no join time, which should not be
  //     reachable. FAIL CLOSED. The two possible defaults are not symmetric:
  //     defaulting to silence costs one missed notification, defaulting to
  //     "caught up" costs a push on EVERY message forever, to someone whose
  //     state we could not read. Silence is the recoverable mistake.
  if (lastReadAt === null) return "behind";

  // 4 · The gate proper. Caught up before this message → notify. Behind → they
  //     were already told when they fell behind.
  return Date.parse(lastReadAt) >= Date.parse(prevMessageAt) ? "notify" : "behind";
}

// ── Copy ────────────────────────────────────────────────────────────────────

/**
 * The notification, built from the trip, the channel and the SENDER'S NAME —
 * and from nothing else.
 *
 * **There is no message-text parameter, and that is the point.** A lock-screen
 * preview of trip chat is a real leak, and `push_send_log`'s own rule (ids and
 * counts, never content) says the same thing one layer down. A test asserting
 * "the payload doesn't contain the text" only proves it for the text the test
 * chose; a builder that never RECEIVES the text cannot leak any of them. The
 * absence is the guarantee — see `ChatNotifyInput`, which has no `text` field
 * either, so the omission holds all the way up to the call site.
 *
 * Naming the sender is deliberate and is the most this may say: "Brad sent a
 * message" tells you whether to look without telling your lock screen what was
 * said.
 *
 * No count, because at send time there is exactly one message to speak of — the
 * gate fires on the message that put you behind, not on a window's worth. No
 * emoji and no "tap to read", for `gameFinishNotify`'s reasons: titles get cut
 * around 40-50 characters, and everyone already knows notifications are
 * tappable.
 */
export function buildChatPayload(args: {
  tripId: string;
  tripTitle: string;
  senderName: string;
  visibility: "crew" | "planning";
}) {
  const { tripId, tripTitle, senderName, visibility } = args;
  return {
    // The Organizers channel is a different room, and someone in both needs to
    // know which one lit up before deciding whether it can wait.
    title: visibility === "planning" ? `${tripTitle} · Organizers` : tripTitle,
    body: `${senderName} sent a message`,
    /**
     * The trip, NOT the chat. Chat open/closed is deliberately not a URL param
     * (`AppShell`: "not a view and not a URL param... chat is orthogonal to
     * which tab is selected"), and inventing `?chat=1` to save one tap would
     * override a deliberate design decision for a notification's convenience.
     * If deep-linking to chat is wanted generally, that is its own decision.
     */
    url: `/trips/${tripId}`,
    /**
     * Replaces rather than stacks, per channel. Largely belt-and-braces given
     * the gate already caps this at one per read-session — but the two mechanisms
     * are independent, and this one costs nothing.
     */
    tag: `bt-chat-${tripId}-${visibility}`,
  };
}

// ── The wire point ──────────────────────────────────────────────────────────

/**
 * Everything the notifier is allowed to know about the message.
 *
 * **No `text`.** See `buildChatPayload`. The call site in `messages.send` has
 * the text in hand and does not pass it, so the leak is not merely untested —
 * it is unrepresentable.
 */
export interface ChatNotifyInput {
  tripId: string;
  visibility: "crew" | "planning";
  /** The row just inserted — used to exclude it when finding its predecessor. */
  messageId: string;
  messageCreatedAt: string;
  senderId: string;
}

export interface ChatNotifyResult {
  /** Channel membership, before the gate and after excluding the sender. */
  audience: number;
  /** Who passed the gate. */
  eligible: string[];
  /** Skipped: read mark inside the viewing window — they're looking at it. */
  suppressedActive: number;
  /** Skipped: already behind, so already notified earlier this read-session. */
  suppressedBehind: number;
  /** Null when the gate emptied the audience — nothing was handed to the sender. */
  send: SendPushToUsersResult | null;
}

const EMPTY: ChatNotifyResult = {
  audience: 0,
  eligible: [],
  suppressedActive: 0,
  suppressedBehind: 0,
  send: null,
};

/**
 * Resolve who is in this channel, apply the gate, and send.
 *
 * Returns a summary so callers and tests can assert each clause SEPARATELY —
 * "sixteen in the channel, four watching, eleven already behind, one notified"
 * rather than a single number that several different bugs could produce.
 *
 * Never throws.
 */
export async function notifyChatMessage(
  input: ChatNotifyInput,
  opts: { admin?: SupabaseClient } = {}
): Promise<ChatNotifyResult> {
  const admin = opts.admin ?? createAdminClient();
  const result: ChatNotifyResult = { ...EMPTY, eligible: [] };

  try {
    // 1 · The predecessor — the newest non-system message in this channel
    //     before this one. `message_type='system'` is excluded to match
    //     `countUnreadByChannel`, which does not count system rows as unread:
    //     if a system line cannot make you unread, it must not be able to make
    //     you "behind" either, or a member-joined notice would silence the next
    //     real message for everyone.
    const { data: prevRows, error: prevErr } = await admin
      .from("messages")
      .select("created_at")
      .eq("trip_id", input.tripId)
      .eq("channel", "trip")
      .eq("visibility", input.visibility)
      .neq("message_type", "system")
      .neq("id", input.messageId)
      .lt("created_at", input.messageCreatedAt)
      .order("created_at", { ascending: false })
      .limit(1);
    // Checked, not swallowed. #16's landmine was a read whose error went
    // unexamined, so a missing relation folded a silent `[]` into the result
    // for six weeks. Here an unchecked error would look like "first message in
    // the channel" and notify EVERYONE on every message — the exact failure
    // this module exists to prevent, arriving silently.
    if (prevErr) throw new Error(`prev-message read failed: ${prevErr.message}`);
    const prevMessageAt = (prevRows ?? [])[0]?.created_at ?? null;

    // 2 · The channel's membership. Crew is every member; Organizers is
    //     Owner + Organizer, mirroring `is_trip_planner()` (migration 029) and
    //     the role gate `messages.send` already enforces on the write.
    //     `nickname` rides along so the sender's display name costs no extra
    //     query — it is the same row set.
    //     `joined_at` and the visibility floors ride along because they are the
    //     FALLBACK read position for a member who has never opened this channel
    //     (see `resolveLastSeen`) — same row set, no extra query.
    const { data: memberRows, error: memberErr } = await admin
      .from("trip_members")
      .select("user_id, role, nickname, joined_at, chat_visible_from, planning_visible_from")
      .eq("trip_id", input.tripId);
    if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);

    type MemberRow = {
      user_id: string;
      role: string;
      nickname: string | null;
      joined_at: string | null;
      chat_visible_from: string | null;
      planning_visible_from: string | null;
    };
    const members = (memberRows ?? []) as MemberRow[];

    const inChannel = members.filter((m) =>
      input.visibility === "planning"
        ? m.role === "Owner" || m.role === "Organizer"
        : true
    );

    // The sender is dropped here so `audience` and `eligible` describe real
    // candidates. `sendPushToUsers` is ALSO given `excludeUserId` below — its
    // actor-exclusion is a first-class guarantee of the helper, and it should
    // keep holding even if this filter is ever refactored away.
    const audience = inChannel
      .map((m) => m.user_id)
      .filter((id) => !!id && id !== input.senderId);
    result.audience = audience.length;
    if (audience.length === 0) return result;

    // 3 · Read marks for this channel. One query for the whole audience.
    //     A missing row is a real state (never opened this channel) and stays
    //     null — see clause 3 of the gate.
    const { data: readRows, error: readErr } = await admin
      .from("chat_reads")
      .select("user_id, last_read_at")
      .eq("trip_id", input.tripId)
      .eq("visibility", input.visibility)
      .in("user_id", audience);
    if (readErr) throw new Error(`read-state read failed: ${readErr.message}`);

    const lastReadById = new Map<string, string>(
      (readRows ?? []).map((r: { user_id: string; last_read_at: string }) => [
        r.user_id,
        r.last_read_at,
      ])
    );

    // 4 · The gate.
    const memberById = new Map(inChannel.map((m) => [m.user_id, m]));
    for (const userId of audience) {
      const verdict = chatGateVerdict({
        lastSeenAt: resolveLastSeen(
          lastReadById.get(userId) ?? null,
          memberById.get(userId),
          input.visibility
        ),
        prevMessageAt,
        messageAt: input.messageCreatedAt,
      });
      if (verdict === "notify") result.eligible.push(userId);
      else if (verdict === "active") result.suppressedActive += 1;
      else result.suppressedBehind += 1;
    }

    // 5 · Gate emptied the audience — the COMMON case during a burst, which is
    //     the point. Recorded with its own outcome rather than returning
    //     silently: migration 106 exists because three pre-send exits produced
    //     no row at all and were indistinguishable from each other and from a
    //     failure. "The gate suppressed everyone" and "nobody is in this
    //     channel" must not look the same afterwards.
    //
    //     Note this returns BEFORE reading `push_subscriptions`, so the gate is
    //     cheapest exactly when volume is highest: mid-burst almost everyone is
    //     already behind, the audience empties here, and the expensive half
    //     never runs.
    if (result.eligible.length === 0) {
      await recordPushAttempt(
        admin,
        {
          trigger: "chat_message",
          tripId: input.tripId,
          actorUserId: input.senderId,
        },
        {
          typeKey: "chat",
          recipients: 0,
          skippedPreferenceOff: 0,
          subscriptionsFound: 0,
          sent: 0,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          outcome: "gate_suppressed",
        }
      );
      return result;
    }

    // 6 · Send. Preference gating (`chat`, ON by default) happens inside the
    //     helper, per recipient — this module never reads `notification_prefs`
    //     itself, so there is one preference gate in the codebase rather than
    //     two that must agree.
    const { tripTitle, senderName } = await loadCopyInputs(
      admin,
      input.tripId,
      input.senderId,
      members
    );

    result.send = await sendPushToUsers(
      result.eligible,
      "chat",
      buildChatPayload({
        tripId: input.tripId,
        tripTitle,
        senderName,
        visibility: input.visibility,
      }),
      {
        admin,
        excludeUserId: input.senderId,
        context: {
          trigger: "chat_message",
          tripId: input.tripId,
          actorUserId: input.senderId,
        },
      }
    );

    return result;
  } catch (err) {
    // Fire-and-forget: a push failure must never fail `messages.send`. Recorded
    // rather than only logged, so it is still there in November.
    console.error("[notifyChatMessage] failed", {
      tripId: input.tripId,
      visibility: input.visibility,
      err,
    });
    try {
      await recordPushAttempt(
        admin,
        {
          trigger: "chat_message",
          tripId: input.tripId,
          actorUserId: input.senderId,
        },
        {
          typeKey: "chat",
          recipients: 0,
          skippedPreferenceOff: 0,
          subscriptionsFound: 0,
          sent: 0,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          outcome: "threw",
          error: err instanceof Error ? err.message : String(err),
        }
      );
    } catch {
      /* the record is never worth the send */
    }
    return result;
  }
}

/**
 * How far a recipient has SEEN this channel, with fallbacks.
 *
 * ── Why a plain `last_read_at` is not enough ────────────────────────────────
 * `chat_reads` only has a row once someone has OPENED the channel. Feeding that
 * null straight into the gate as "caught up" reads as harmless — it looks like
 * "give them one, then let the normal rule take over" — but there is no normal
 * rule to take over: with no read mark, nothing ever moves them into `behind`,
 * so they are caught up on message 1 and on message 400. A member who never
 * opens chat would be notified for every message in the trip, which is precisely
 * the outcome the whole read-state gate exists to prevent, reached through the
 * one recipient nobody pictures when reasoning about it.
 *
 * ── The fallbacks, and why they mean something ──────────────────────────────
 * 1. `chat_reads.last_read_at` — they have opened this channel; use it.
 * 2. The per-member visibility FLOOR for this channel (`chat_visible_from` /
 *    `planning_visible_from`, migration 008). This is already the line before
 *    which `messages.list` refuses to show them anything, so it is the exact
 *    point from which they could have been reading.
 * 3. `joined_at`. You are up to date the moment you join, because nothing older
 *    than that was ever yours to read.
 *
 * Each is a real answer to "how far have you seen", not a stand-in, which is why
 * the chain converges on the intended behaviour instead of approximating it: the
 * first message after you arrive notifies you, and then you are behind like
 * everybody else until you read.
 */
function resolveLastSeen(
  lastReadAt: string | null,
  member:
    | {
        joined_at: string | null;
        chat_visible_from: string | null;
        planning_visible_from: string | null;
      }
    | undefined,
  visibility: "crew" | "planning"
): string | null {
  if (lastReadAt) return lastReadAt;
  if (!member) return null;
  const floor =
    visibility === "planning" ? member.planning_visible_from : member.chat_visible_from;
  return floor ?? member.joined_at ?? null;
}

/**
 * Trip title + the sender's display name.
 *
 * The name resolution is `trip_members.nickname ?? users.name`, which is what
 * `tripMembers.ts` already does — so the notification calls someone what the
 * chat transcript calls them. A different resolution here would mean "Brad sent
 * a message" for a person the chat shows as "Bradley".
 *
 * Falls back rather than throwing: a missing title or name must degrade the
 * copy, never lose the notification.
 */
async function loadCopyInputs(
  admin: SupabaseClient,
  tripId: string,
  senderId: string,
  members: { user_id: string; nickname: string | null }[]
): Promise<{ tripTitle: string; senderName: string }> {
  const nickname = members.find((m) => m.user_id === senderId)?.nickname ?? null;

  const [tripRes, userRes] = await Promise.all([
    admin.from("trips").select("title").eq("id", tripId).maybeSingle(),
    nickname
      ? Promise.resolve({ data: null })
      : admin.from("users").select("name").eq("id", senderId).maybeSingle(),
  ]);

  return {
    tripTitle: (tripRes.data as { title?: string } | null)?.title || "Your trip",
    senderName:
      nickname || (userRes.data as { name?: string } | null)?.name || "Someone",
  };
}
