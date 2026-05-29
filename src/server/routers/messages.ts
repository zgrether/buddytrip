import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * Sub-channel within `messages.channel = 'trip'`:
 *   - "crew"     visible to all trip members (the everyone chat)
 *   - "planning" visible to Owner + Planner only (Organizers chat)
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
  args: { tripId: string; visibility: "crew" | "planning"; text: string }
) {
  const admin = createAdminClient();
  const { error } = await admin.from("messages").insert({
    id: crypto.randomUUID(),
    trip_id: args.tripId,
    user_id: null,
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

export const messagesRouter = router({
  // -----------------------------------------------------------------------
  // list — Crew chat: any member. Organizers chat: Owner/Planner only.
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
      // Organizers chat is Owner/Planner only. Throw here for a clean
      // error rather than relying on RLS to silently return nothing.
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Planner") {
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
  // send — Crew chat: any member. Organizers chat: Owner/Planner only.
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

      // Organizers chat is Owner/Planner only.
      if (input.visibility === "planning") {
        if (ctx.tripRole !== "Owner" && ctx.tripRole !== "Planner") {
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to send message: ${error.message}`,
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
