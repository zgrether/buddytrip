import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { CHAT_ACTIVE_VIEWING_WINDOW_MS } from "@/lib/chatViewHeartbeat";
import { sendPushToUsers, type SendPushToUsersResult } from "./sendPushToUsers";
import { recordPushAttempt } from "./recordPushAttempt";
import { chatRoomKey, chatRoomReadRow, type ChatRoom } from "@/lib/chatRoom";

/**
 * The `chat` category's ONE wire point — `messages.send`.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 *     Notify every recipient, except: you sent it, or your chat panel is open.
 *
 * That is the whole rule. If a suppression cannot be stated in one sentence, it
 * does not belong here.
 *
 * ── This REVERSES #1054/#1057/#1058, deliberately ──────────────────────────
 * What was here before: a read-state gate (notify only someone who was CAUGHT UP
 * before the message landed) plus a 30-minute time-based re-arm, built because
 * `NOTIFICATIONS.md` marked chat BATCH — "hundreds/day; coalesce hard" — and the
 * fear was notification fatigue.
 *
 * That was the wrong problem, and the measurement is what settles it. With the
 * full design shipped, a real day on the BBMI trip produced **26 crew messages
 * and TWO notification events in four hours**. An app that tells you twice in an
 * afternoon that a conversation is happening is not being restrained; it has
 * failed at the one thing a message notification is for. Meanwhile the cost of
 * being wrong the other way is bounded and already solved by other people: every
 * OS mutes an app, and every recipient has a `chat` switch in the notifications
 * modal (#1056). A person who finds it noisy has a control. A person who gets
 * two notifications a day has nothing to fix.
 *
 * The trade, stated honestly so nobody re-derives "coalesce hard" from first
 * principles later: the same day under this rule is 26 crew messages × ~14
 * recipients ≈ **360 pushes**, against the 2 it actually produced.
 *
 * ── What is gone, and it is gone rather than tuned ─────────────────────────
 *   * the 30-minute re-arm (`CHAT_REARM_AFTER_MS`) — deleted
 *   * the caught-up / behind read-state gate — deleted
 *   * `chat_reads.last_notified_at` — no longer written; dropped in a follow-up
 *     migration, per CLAUDE.md's removal ordering (code stops writing first)
 *   * the predecessor-message lookup that fed "caught up", and the read-position
 *     fallback chain (`resolveLastSeen`) that existed only to answer it
 *
 * ── What the split bought ───────────────────────────────────────────────────
 * The surviving clause still needs a recency-of-looking signal, and it now has
 * its OWN column: `chat_reads.viewing_at` (migration 145), written only by the
 * client heartbeat. `last_read_at` goes back to meaning one thing — the read
 * position for the unread badge and the new-messages divider.
 *
 * Two of this subsystem's three historical bugs stop being possible rather than
 * merely prevented: the heartbeat can no longer mark an undelivered message read
 * (it does not touch that column), and this module can no longer clear a badge
 * for the message it is announcing (it writes nothing at all now).
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
 * How recently `viewing_at` must have moved for a recipient to count as
 * WATCHING the channel right now.
 *
 * Defined in `@/lib/chatViewHeartbeat` alongside the client heartbeat that keeps
 * an open panel inside it — the two are a pair and the relationship between them
 * is the actual mechanism. Re-exported here so the gate's callers and tests read
 * it from the module they're testing.
 */
export { CHAT_ACTIVE_VIEWING_WINDOW_MS };

/** Why a recipient did or didn't get this one. */
export type ChatGateVerdict =
  /** Their panel is not open — send. */
  | "notify"
  /** `viewing_at` moved within the window — they're looking at it. */
  | "active";

/**
 * The gate, as a pure function of two timestamps — no DB, no clock.
 *
 * ── There is one clause, and that is the design ─────────────────────────────
 * It previously had five, and four of them existed to answer "have they already
 * been told about this conversation" — a question this rule no longer asks. What
 * is left is the only thing a person cannot judge for themselves from the
 * outside: whether they are already looking at the screen the message lands on.
 *
 * Deliberately reads `messageAt` rather than `Date.now()` as "now". The send
 * runs microseconds after the insert so they are the same instant in practice,
 * and using the message's own timestamp makes every case deterministic and
 * directly assertable instead of racing a wall clock in tests.
 */
export function chatGateVerdict(args: {
  /**
   * `chat_reads.viewing_at` (migration 145) — when this recipient's panel for
   * this channel was last confirmed open and visible, or null if never.
   *
   * NOT `last_read_at`. Reading a message and looking at a panel are different
   * facts, they now live in different columns, and the whole history of bugs
   * here is what happened when one column tried to mean both.
   *
   * Null is the PERMISSIVE value — a recipient nobody has ever seen viewing is
   * notified. That is the safe direction: being wrong costs one extra buzz,
   * where the old gate's fail-closed default cost a message nobody heard about.
   */
  viewingAt: string | null;
  /** The message that just landed. */
  messageAt: string;
}): ChatGateVerdict {
  const { viewingAt, messageAt } = args;
  if (viewingAt === null) return "notify";

  // ABSOLUTE difference: `viewing_at` can legitimately land AFTER `messageAt`
  // when the recipient's heartbeat fires between the insert and this read —
  // which is the strongest possible evidence they are watching, so it must not
  // read as a negative age and fall through to `notify`.
  const age = Math.abs(Date.parse(messageAt) - Date.parse(viewingAt));
  return age < CHAT_ACTIVE_VIEWING_WINDOW_MS ? "active" : "notify";
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
  room: ChatRoom;
  /**
   * The team's name, for the team room's title. Optional and falls back to
   * "Team" — a push must not fail because a name lookup did, and the team's
   * name is not a secret from its own members.
   */
  teamName?: string | null;
}) {
  const { tripId, tripTitle, senderName, room, teamName } = args;
  const roomKey = chatRoomKey(room);
  return {
    // Every room but Crew is a different room, and someone in several needs to
    // know which one lit up before deciding whether it can wait. Crew stays
    // bare because it is the trip's default room — a title of "Cabo · Crew"
    // would add a word to every notification to disambiguate the common case
    // from the rare one.
    title:
      room.kind === "planning"
        ? `${tripTitle} · Organizers`
        : room.kind === "team"
          ? `${tripTitle} · ${teamName ?? "Team"}`
          : tripTitle,
    body: `${senderName} sent a message`,
    /**
     * The trip, WITH a one-shot instruction to open chat on this channel.
     *
     * ── This reverses the comment that used to be here ─────────────────────
     * It read: "Chat open/closed is deliberately not a URL param... inventing
     * `?chat=1` to save one tap would override a deliberate design decision."
     * That was protecting the principle at the cost of the thing a chat
     * notification exists for — tapping "Rob sent a message" and NOT landing on
     * the message is broken in the one interaction where the destination is
     * unambiguous.
     *
     * The principle survives anyway: "orthogonal to which tab is selected"
     * means chat is not itself a tab, not that nothing may ever open it. A link
     * that opens chat and lands on whichever tab is selected (`?view=`,
     * untouched) uses that property rather than contradicting it — chat open,
     * Trip tab, both true at once, same as tapping the toggle by hand.
     *
     * `?chat=1` is consumed and stripped on mount (`AppShell`), so a shared or
     * bookmarked copy of this URL does not force chat open forever — it is an
     * instruction for the NEXT paint, not a state.
     *
     * `channel` rides along because the payload already knows which room lit
     * up, and an Organizers notification landing in Crew would be the same
     * "wrong destination" bug this exists to fix, just one tap further in.
     */
    url: `/trips/${tripId}?chat=1&channel=${roomKey}`,
    /**
     * Replaces rather than stacks, per ROOM. Largely belt-and-braces given the
     * gate already caps this at one per read-session — but the two mechanisms
     * are independent, and this one costs nothing.
     *
     * `roomKey` rather than a hand-built string so the tag and the URL cannot
     * describe the same room differently — two rooms sharing a tag would have
     * each replaced the other's notification.
     */
    tag: `bt-chat-${tripId}-${roomKey}`,
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
  room: ChatRoom;
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
  /** Skipped: `viewing_at` inside the window — they're looking at it. */
  suppressedActive: number;
  /** Null when the gate emptied the audience — nothing was handed to the sender. */
  send: SendPushToUsersResult | null;
}

const EMPTY: ChatNotifyResult = {
  audience: 0,
  eligible: [],
  suppressedActive: 0,
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
    // 1 · The channel's membership. Crew is every member; Organizers is
    //     Owner + Organizer, mirroring `is_trip_planner()` (migration 029) and
    //     the role gate `messages.send` already enforces on the write.
    //     `nickname` rides along so the sender's display name costs no extra
    //     query — it is the same row set.
    //
    //     `joined_at` and the visibility floors are NO LONGER selected. They
    //     existed to reconstruct a read position for someone who had never
    //     opened the channel, which the caught-up test needed and this rule does
    //     not ask. A member who has never opened chat is simply not viewing it.
    const { data: memberRows, error: memberErr } = await admin
      .from("trip_members")
      .select("user_id, role, nickname")
      .eq("trip_id", input.tripId);
    if (memberErr) throw new Error(`member read failed: ${memberErr.message}`);

    type MemberRow = {
      user_id: string;
      role: string;
      nickname: string | null;
    };
    const members = (memberRows ?? []) as MemberRow[];

    // The TEAM room's audience is the team's roster, not the trip's — and this
    // is the one place in the notifier where "who is in this room" is not a
    // function of trip role.
    //
    // Read from `team_assignments` rather than reusing the role filter, because
    // a team's membership has nothing to do with role: an Owner who is not on
    // the team must not be in this audience, which is the same rule the RLS
    // policy enforces on the read. Two mechanisms, one rule — and if they ever
    // disagree, the person gets a notification for a chat they cannot open.
    let teamRoster: Set<string> | null = null;
    let teamName: string | null = null;
    if (input.room.kind === "team") {
      const [{ data: assignRows, error: assignErr }, { data: teamRow }] = await Promise.all([
        admin
          .from("team_assignments")
          .select("user_id")
          .eq("team_id", input.room.teamId),
        admin.from("teams").select("name").eq("id", input.room.teamId).maybeSingle(),
      ]);
      // Checked, not swallowed — an unchecked error here would produce an empty
      // roster, which reads as "nobody is on this team" and silently notifies
      // no one. A team chat that never notifies is the failure this whole
      // subsystem was rebuilt to stop.
      if (assignErr) throw new Error(`team roster read failed: ${assignErr.message}`);
      teamRoster = new Set(
        ((assignRows ?? []) as { user_id: string }[]).map((r) => r.user_id)
      );
      teamName = ((teamRow ?? null) as { name: string } | null)?.name ?? null;
    }

    const inChannel = members.filter((m) => {
      if (input.room.kind === "planning") {
        return m.role === "Owner" || m.role === "Organizer";
      }
      if (input.room.kind === "team") {
        return teamRoster!.has(m.user_id);
      }
      return true;
    });

    // The sender is dropped here so `audience` and `eligible` describe real
    // candidates. `sendPushToUsers` is ALSO given `excludeUserId` below — its
    // actor-exclusion is a first-class guarantee of the helper, and it should
    // keep holding even if this filter is ever refactored away.
    const audience = inChannel
      .map((m) => m.user_id)
      .filter((id) => !!id && id !== input.senderId);
    result.audience = audience.length;
    if (audience.length === 0) return result;

    // 2 · Viewing state for this channel. One query for the whole audience.
    //     A missing row means nobody has ever had this panel open here, which
    //     is a real state and reads as "not viewing" — the permissive value.
    //
    //     `last_read_at` is NOT selected. This module no longer has any business
    //     with the read position: it does not read it, and it does not write it.
    //
    //     Filtered by the room's OWN read row (`chatRoomReadRow`), so a team's
    //     viewing state cannot be read off the Crew row. Before migration 172
    //     those were the same row — see that migration for why "reading Team
    //     marks Crew read" was a property of the key rather than a bug in a
    //     caller.
    const readRow = chatRoomReadRow(input.room);
    let viewQuery = admin
      .from("chat_reads")
      .select("user_id, viewing_at")
      .eq("trip_id", input.tripId)
      .eq("visibility", readRow.visibility)
      .in("user_id", audience);
    // `.is()` not `.eq()` for the trip rooms: team_id is NULL there, and
    // `eq(col, null)` does not match a NULL in PostgREST — it would return no
    // rows, read as "nobody is viewing", and notify people staring at the panel.
    viewQuery =
      readRow.team_id === null
        ? viewQuery.is("team_id", null)
        : viewQuery.eq("team_id", readRow.team_id);
    const { data: viewRows, error: viewErr } = await viewQuery;
    // Checked, not swallowed — #16's landmine was a read whose error went
    // unexamined for six weeks. An unchecked error here would read as "nobody is
    // viewing" and notify everyone including the people staring at the panel.
    if (viewErr) throw new Error(`viewing-state read failed: ${viewErr.message}`);

    type ViewRow = { user_id: string; viewing_at: string | null };
    const viewingById = new Map<string, string | null>(
      (viewRows ?? []).map((r: ViewRow) => [r.user_id, r.viewing_at])
    );

    // 3 · The gate. One clause.
    for (const userId of audience) {
      const verdict = chatGateVerdict({
        viewingAt: viewingById.get(userId) ?? null,
        messageAt: input.messageCreatedAt,
      });
      if (verdict === "notify") result.eligible.push(userId);
      else result.suppressedActive += 1;
    }

    // 4 · Everyone in the channel is looking at it. Recorded with its own
    //     outcome rather than returning silently: migration 106 exists because
    //     pre-send exits produced no row at all and were indistinguishable from
    //     a failure.
    //
    //     `gate_mixed` and `gate_behind` are gone with the clauses that produced
    //     them. There is one way to be suppressed now, so there is one outcome,
    //     and `recipients` carries the audience that was turned away.
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
          recipients: result.audience,
          skippedPreferenceOff: 0,
          subscriptionsFound: 0,
          sent: 0,
          failed: 0,
          removedDead: 0,
          notConfigured: false,
          outcome: "gate_active",
        }
      );
      return result;
    }

    // 5 · Send. Preference gating (`chat`, ON by default) happens inside the
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
        room: input.room,
        teamName,
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

    // NOTHING IS WRITTEN HERE, and that absence is load-bearing.
    //
    // This module used to stamp `chat_reads` after sending — the re-arm clock,
    // plus a `last_read_at` for any row it had to CREATE. That second write is
    // the one that mattered: it meant the code announcing a message also had to
    // decide what read position to invent for the person it was announcing to,
    // and getting it wrong cleared their unread badge for a message they had not
    // seen. The fix was a careful derivation reused from the gate.
    //
    // Now there is no derivation to get wrong. The re-arm is gone, so there is
    // no clock to stamp; `viewing_at` is written only by the recipient's own
    // heartbeat; and `last_read_at` is written only by `markRead`. A push cannot
    // clear a badge because the push path no longer touches the badge's column.
    //
    // If a future change needs this module to write to `chat_reads`, that is the
    // moment to ask whether it is re-creating the coupling migration 145 removed.

    return result;
  } catch (err) {
    // Fire-and-forget: a push failure must never fail `messages.send`. Recorded
    // rather than only logged, so it is still there in November.
    console.error("[notifyChatMessage] failed", {
      tripId: input.tripId,
      room: chatRoomKey(input.room),
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
