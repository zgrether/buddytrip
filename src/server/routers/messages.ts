import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { createAdminClient } from "@/lib/supabase-admin";
import { notifyChatMessage } from "../lib/chatNotify";
import type { TRPCContext, TripRoleString } from "../trpc";

/**
 * Sub-channel within `messages.channel = 'trip'`:
 *   - "crew"     visible to all trip members (the everyone chat)
 *   - "planning" visible to Owner + Organizer only (Organizers chat)
 *
 * RLS enforces the role gate on read/write. The per-member visibility
 * floor (chat_visible_from / planning_visible_from on trip_members) is
 * enforced here in the query layer because RLS can't trivially reach the
 * requester's own trip_members row.
 */
const Visibility = z.enum(["crew", "planning"]);

/**
 * Post a server-authored lifecycle line into a trip chat channel
 * (member added, promoted, etc.). message_type='system', no author.
 *
 * Uses the service-role admin client, NOT the caller's session: the
 * messages_insert RLS policy only allows a member to insert their own
 * (`user_id = auth.uid()`) `message_type='user'` rows, so a system row
 * (user_id=null, message_type='system') is rejected through the user client.
 * The first arg is ignored, kept only so existing callers (which pass
 * ctx.supabase) don't all have to change at once.
 *
 * Best-effort: callers wrap this so a failed system message never blocks the
 * underlying mutation. Throws on insert error so that wrapper can log it.
 */
export async function postSystemMessage(
  _supabase: unknown,
  args: {
    tripId: string;
    visibility: "crew" | "planning";
    text: string;
    /**
     * Who the line is ABOUT, when it is about a person — written to
     * `messages.user_id`. It is not an author (system rows have none); it is
     * what lets ONE join row render two ways, so the joiner reads a welcome
     * and everyone else reads the notice, without a second row in the
     * transcript (see `src/lib/joinMessage.ts`).
     *
     * Costs nothing elsewhere: unread already excludes system rows outright
     * (`neq("message_type","system")` below), the chat panel branches on
     * `message_type` before it ever looks at `user_id`, and
     * `merge_guest_to_real_user` already repoints `messages.user_id` — so an
     * invitee's join line follows them across the guest→real conversion
     * instead of pointing at a deleted placeholder.
     */
    subjectUserId?: string | null;
  }
) {
  const admin = createAdminClient();
  const { error } = await admin.from("messages").insert({
    id: crypto.randomUUID(),
    trip_id: args.tripId,
    user_id: args.subjectUserId ?? null,
    channel: "trip",
    team_id: null,
    text: args.text,
    visibility: args.visibility,
    message_type: "system",
  });
  if (error) {
    throw new Error(`postSystemMessage failed: ${error.message}`);
  }
}

/**
 * Per-channel unread breakdown (Crew always; Organizers zeroed for
 * non-Owner/Organizer callers), computed server-side so no badge ever has
 * to ship message rows to compute an integer (DATA_FRESHNESS_AUDIT.md
 * §8-F3). The extra work here is forced by chat's shape, not invented
 * complexity: TWO visibility channels, each with its OWN last_read_at
 * (chat_reads) and its OWN per-member visibility floor
 * (chat_visible_from / planning_visible_from on trip_members) — list()
 * already applies that floor, so a message from before a member
 * joined/was promoted must not count as unread just because it's newer
 * than their (null) read mark.
 *
 * #982 — the floor is ALSO what makes "unread is zero right after joining"
 * true, with no extra write anywhere. A brand-new member has no `chat_reads`
 * row (lastReadAt = null), so without it they would show unread for the
 * trip's ENTIRE prior history on their first visit. Seeding a `chat_reads`
 * row at join instead was considered and rejected: `chat_reads` is
 * cascade-deleted by an uncovered `merge_guest_to_real_user` write (see
 * CLAUDE.md's guest-conversion section), so a row seeded for a still-guest
 * invitee would vanish the moment they signed up — gone exactly when it
 * would start mattering, and on the most common way people arrive. The
 * floor has no such gap: it lives on `trip_members`, which the merge DOES
 * repoint.
 *
 * A plain function, not a procedure, so both `unreadCountByChannel` (the
 * Chat tab's per-segment dots) and `unreadCount` (the summed total used by
 * the combined Chat tab / TopNav badges) run the SAME query — they can't
 * disagree.
 */
async function countUnreadByChannel(
  ctx: TRPCContext & { tripId: string; tripRole: TripRoleString }
): Promise<{ crew: number; planning: number }> {
  const canSeeOrganizers = ctx.tripRole === "Owner" || ctx.tripRole === "Organizer";

  const [{ data: memberRow }, { data: readRows }] = await Promise.all([
    ctx.supabase
      .from("trip_members")
      .select("chat_visible_from, planning_visible_from")
      .eq("trip_id", ctx.tripId)
      .eq("user_id", ctx.user!.id)
      .maybeSingle(),
    ctx.supabase
      .from("chat_reads")
      .select("visibility, last_read_at")
      .eq("trip_id", ctx.tripId)
      .eq("user_id", ctx.user!.id),
  ]);

  const floors = (memberRow ?? {}) as {
    chat_visible_from?: string | null;
    planning_visible_from?: string | null;
  };
  const readMarks: Record<"crew" | "planning", string | null> = {
    crew: null,
    planning: null,
  };
  for (const row of (readRows ?? []) as { visibility: string; last_read_at: string }[]) {
    if (row.visibility === "crew" || row.visibility === "planning") {
      readMarks[row.visibility] = row.last_read_at;
    }
  }

  // One COUNT per visible channel — others' non-system messages, newer
  // than my read mark, no older than my visibility floor. Matches the
  // client derivation this replaced exactly: `m.user_id !== currentUser.id
  // && m.message_type !== "system"`, filtered by created_at > lastReadAt.
  const countChannel = (visibility: "crew" | "planning", floor: string | null | undefined) => {
    let query = ctx.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", ctx.tripId)
      .eq("channel", "trip")
      .eq("visibility", visibility)
      .neq("message_type", "system")
      .neq("user_id", ctx.user!.id);
    if (floor) query = query.gte("created_at", floor);
    const lastReadAt = readMarks[visibility];
    if (lastReadAt) query = query.gt("created_at", lastReadAt);
    return query;
  };

  const [crewResult, planningResult] = await Promise.all([
    countChannel("crew", floors.chat_visible_from),
    canSeeOrganizers
      ? countChannel("planning", floors.planning_visible_from)
      : Promise.resolve({ count: 0, error: null }),
  ]);

  if (crewResult.error || planningResult.error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to count unread messages",
    });
  }

  return { crew: crewResult.count ?? 0, planning: planningResult.count ?? 0 };
}

export const messagesRouter = router({
  // -----------------------------------------------------------------------
  // list — Crew chat: any member. Organizers chat: Owner/Organizer only.
  // Both honor the per-member visibility floor so members added (crew) or
  // promoted (planning) later don't see history from before they joined.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        channel: z.enum(["trip", "team"]).default("trip"),
        visibility: Visibility.default("crew"),
        teamId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      // Organizers chat is Owner/Organizer only. Throw here for a clean
      // error rather than relying on RLS to silently return nothing.
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organizers chat is owner/organizer only.",
          });
        }
      }

      // Visibility floor: NULL = sees all history; a timestamp = only
      // messages from that point forward (set when added/promoted).
      const floorCol =
        input.visibility === "crew" ? "chat_visible_from" : "planning_visible_from";
      let visibilityFloor: string | null = null;
      if (input.channel === "trip") {
        const { data: memberRow } = await ctx.supabase
          .from("trip_members")
          .select(floorCol)
          .eq("trip_id", ctx.tripId)
          .eq("user_id", ctx.user!.id)
          .maybeSingle();
        if (memberRow) {
          visibilityFloor = (memberRow as Record<string, string | null>)[floorCol] ?? null;
        }
      }

      let query = ctx.supabase
        .from("messages")
        .select(
          "id, trip_id, user_id, channel, team_id, text, created_at, visibility, message_type"
        )
        .eq("trip_id", ctx.tripId)
        .eq("channel", input.channel)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      // visibility only partitions the trip channel; team chat is flat.
      if (input.channel === "trip") {
        query = query.eq("visibility", input.visibility);
        if (visibilityFloor) {
          query = query.gte("created_at", visibilityFloor);
        }
      }

      if (input.channel === "team") {
        if (!input.teamId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "teamId is required for team channel",
          });
        }
        query = query.eq("team_id", input.teamId);
      }

      if (input.cursor) {
        query = query.lt("created_at", input.cursor);
      }

      const { data, error } = await query;

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch messages",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // unreadCountByChannel — per-channel unread breakdown (Crew always;
  // Organizers zeroed for non-Owner/Organizer callers). See
  // `countUnreadByChannel` above for why this needs two channel-scoped
  // queries instead of one. Shared with `unreadCount` (the summed total,
  // used for the combined Chat tab / TopNav badges) and the Chat tab's
  // per-segment (Crew/Planning) dots — one query, two shapes, so they can't
  // drift.
  // -----------------------------------------------------------------------
  unreadCountByChannel: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx }) => countUnreadByChannel(ctx)),

  // -----------------------------------------------------------------------
  // unreadCount — total unread across the channels the caller can see.
  // Mirrors news.unreadCount's shape and posture (authedProcedure +
  // requireTripMember, a plain COUNT) for the combined badges (TopNav,
  // Chat tab). Sums `countUnreadByChannel` rather than re-querying, so the
  // total and the per-segment breakdown can never disagree.
  // -----------------------------------------------------------------------
  unreadCount: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }): Promise<number> => {
      const byChannel = await countUnreadByChannel(ctx);
      return byChannel.crew + byChannel.planning;
    }),

  // -----------------------------------------------------------------------
  // readState — the caller's own per-channel last-read timestamps for a trip.
  // Returns { crew, planning }, each an ISO string or null (never read on any
  // device). Source of truth for the unread badge + the new-messages divider,
  // so read state follows the account across devices (was localStorage-only).
  // -----------------------------------------------------------------------
  readState: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("chat_reads")
        .select("visibility, last_read_at")
        .eq("trip_id", ctx.tripId!)
        .eq("user_id", ctx.user!.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load chat read state",
        });
      }

      const out: { crew: string | null; planning: string | null } = {
        crew: null,
        planning: null,
      };
      for (const row of (data ?? []) as {
        visibility: string;
        last_read_at: string;
      }[]) {
        if (row.visibility === "crew" || row.visibility === "planning") {
          out[row.visibility] = row.last_read_at;
        }
      }
      return out;
    }),

  // -----------------------------------------------------------------------
  // markRead — record that the caller has seen a channel up to now(). Upserts
  // one (trip, user, visibility) row. Uses now() server-side (not a client
  // timestamp) so it's monotonic and a stale device can't roll a read marker
  // backward. Organizers chat is Owner/Organizer only, mirroring list/send.
  // -----------------------------------------------------------------------
  markRead: authedProcedure
    .input(z.object({ tripId: z.string(), visibility: Visibility }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organizers chat is owner/organizer only.",
          });
        }
      }

      // Return the DB-stored value (not the JS toISOString form) so callers and
      // readState agree on the exact string representation: Postgres timestamptz
      // serializes as "...+00:00", JS's toISOString as "...Z". Same instant, but
      // the divider/unread logic compares these as strings, so they must match.
      const { data, error } = await ctx.supabase
        .from("chat_reads")
        .upsert(
          {
            trip_id: ctx.tripId!,
            user_id: ctx.user!.id,
            visibility: input.visibility,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "trip_id,user_id,visibility" }
        )
        .select("last_read_at")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark chat read: ${error.message}`,
        });
      }

      return { last_read_at: (data as { last_read_at: string }).last_read_at };
    }),

  // -----------------------------------------------------------------------
  // markViewing — "my chat panel for this channel is open right now"
  // -----------------------------------------------------------------------
  /**
   * The viewing heartbeat's write, and the ONLY writer of `chat_reads.viewing_at`.
   *
   * ── Why this is not just `markRead` ─────────────────────────────────────────
   * It used to be. The heartbeat called `markRead`, which made one column mean
   * both "how far have they read" and "were they just looking" — and every bug
   * this subsystem produced came from those two meanings diverging (a
   * glance-and-close buying minutes of silence; a heartbeat marking messages
   * READ that the device had never received). Migration 145 split them, and this
   * procedure is the read-position-free half.
   *
   * ── It deliberately returns nothing and invalidates nothing ────────────────
   * No UI renders `viewing_at`. It exists for one server-side comparison in
   * `chatNotify`. That is what makes a 15-second heartbeat affordable: the old
   * one went through `markRead`, whose success handler invalidates three queries,
   * so a beat cost one write and three refetches. A beat is now one write.
   *
   * ── The one place the two columns still touch, and it is a DEFAULT ─────────
   * `chat_reads.last_read_at` is NOT NULL DEFAULT now(), so a row CREATED by this
   * upsert takes a read position nobody asked for. That is reachable only when no
   * row exists yet — i.e. the person has never read this channel — and in
   * practice only on an EMPTY channel, because `markRead` fires on the first
   * confirmed render with messages and always beats a 15s timer to it. On an
   * empty channel there are no messages for `now()` to falsely mark read, so the
   * default is harmless there.
   *
   * On CONFLICT (the overwhelmingly common path) PostgREST updates only the
   * columns named here, so an existing `last_read_at` is untouched. That is the
   * property worth guarding, and `messages.chatReadsColumns.test.ts` pins it.
   */
  markViewing: authedProcedure
    .input(z.object({ tripId: z.string(), visibility: Visibility }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Same role gate as `markRead`: Organizers is Owner/Organizer only, and a
      // non-organizer must not be able to write a viewing mark for a channel
      // they cannot see.
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organizers chat is owner/organizer only.",
          });
        }
      }

      const { error } = await ctx.supabase.from("chat_reads").upsert(
        {
          trip_id: ctx.tripId!,
          user_id: ctx.user!.id,
          visibility: input.visibility,
          viewing_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,user_id,visibility" }
      );
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark chat viewing: ${error.message}`,
        });
      }
      return { ok: true };
    }),

  // -----------------------------------------------------------------------
  // send — Crew chat: any member. Organizers chat: Owner/Organizer only.
  // -----------------------------------------------------------------------
  send: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        channel: z.enum(["trip", "team"]).default("trip"),
        visibility: Visibility.default("crew"),
        teamId: z.string().optional(),
        text: z.string().min(1).max(5000),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      if (input.channel === "team" && !input.teamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "teamId is required for team channel",
        });
      }

      // Organizers chat is Owner/Organizer only.
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organizers chat is owner/organizer only.",
          });
        }
      }

      const { data, error } = await ctx.supabase
        .from("messages")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          user_id: ctx.user!.id,
          channel: input.channel,
          team_id: input.channel === "team" ? input.teamId : null,
          text: input.text,
          // Team chat is always crew-visibility; only the trip channel
          // splits into crew / planning.
          visibility: input.channel === "team" ? "crew" : input.visibility,
          message_type: "user",
        })
        .select()
        .single();

      if (error) {
        /**
         * A UNIQUE VIOLATION HERE MEANS THE MESSAGE ALREADY LANDED.
         *
         * `id` is minted client-side and this is a plain INSERT into a table
         * whose primary key is that column — so a retry reusing the id cannot
         * duplicate the message; the key refuses it. That is the property the
         * client's retry depends on, and it is why a retry must never mint a
         * fresh id.
         *
         * But the refusal is indistinguishable, as a 500, from a send that
         * genuinely failed — so the one case where the user's message IS safely
         * stored would report failure and invite them to try again forever.
         * `CONFLICT` lets the client recognise it by tRPC error CODE rather than
         * by parsing this string, which is the difference between a contract and
         * a coincidence of wording.
         *
         * DELIBERATELY RETURNS NO ROW. Fetching and returning the existing
         * message would turn a client-chosen id into an oracle: send with
         * someone else's message id, read their text out of the error path. The
         * client needs to know only that the write is done, and the row reaches
         * it through the normal read path under RLS.
         */
        if (error.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This message has already been sent.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to send message: ${error.message}`,
        });
      }

      /**
       * The `chat` category's one wire point. NOT 1:1 with this write —
       * `notifyChatMessage` is read-state-gated, so a recipient hears about
       * the message that put them BEHIND and then nothing until they read.
       * Chat is the highest-volume event in the app; the gate is what makes
       * wiring it survivable at all (NOTIFICATIONS.md marks it BATCH).
       *
       * NOTE WHAT IS NOT PASSED: `input.text`. The notifier has no parameter
       * for it, so a lock-screen preview of trip chat is unrepresentable
       * rather than merely avoided.
       *
       * Awaited, not fired and forgotten: un-awaited work can be killed when a
       * serverless function freezes. It never throws — a push failure must not
       * fail a sent message — and it returns before touching push_subscriptions
       * whenever the gate empties the audience, which mid-burst is almost
       * always.
       *
       * TEAM CHANNEL IS DELIBERATELY NOT NOTIFIED, and the reason is structural
       * rather than unfinished work: the gate reads `chat_reads`, which is keyed
       * (trip_id, user_id, visibility) and has NO team dimension (migration 010),
       * so there is no read state to gate on. Team chat also has no UI — every
       * caller in the app sends `channel: "trip"`. If team chat is ever built,
       * it needs read tracking first, and the gate then follows for free.
       */
      if (input.channel === "trip") {
        const row = data as { id: string; created_at: string };
        await notifyChatMessage({
          tripId: ctx.tripId!,
          visibility: input.visibility,
          messageId: row.id,
          messageCreatedAt: row.created_at,
          senderId: ctx.user!.id,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // clearChannel — Owner-only. Permanently deletes every message in one
  // sub-channel of a trip (Crew or Organizers), for privacy. Uses the
  // service-role admin client because there's no per-user DELETE RLS policy
  // on messages — the Owner gate is enforced here at the procedure layer.
  // Leaves a single system marker so connected clients refresh via Realtime
  // (which only fires on INSERT) and everyone sees the chat was cleared on
  // purpose rather than silently emptied.
  // -----------------------------------------------------------------------
  clearChannel: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        visibility: Visibility,
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const admin = createAdminClient();

      const { error, count } = await admin
        .from("messages")
        .delete({ count: "exact" })
        .eq("trip_id", ctx.tripId!)
        .eq("channel", "trip")
        .eq("visibility", input.visibility);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to clear chat: ${error.message}`,
        });
      }

      try {
        await postSystemMessage(admin, {
          tripId: ctx.tripId!,
          visibility: input.visibility,
          text:
            input.visibility === "crew"
              ? "Crew chat history was cleared by the owner"
              : "Organizers chat history was cleared by the owner",
        });
      } catch {
        /* marker is best-effort — the delete already succeeded */
      }

      return { deleted: count ?? 0 };
    }),
});
