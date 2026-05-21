import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createClient as createServiceClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * Sub-channel within `messages.channel = 'trip'`:
 *   - "crew"     visible to all trip members (existing behavior)
 *   - "planning" visible only to Owner + Planner (Organizers chat — new)
 *
 * RLS enforces the role gate. The `chat_visible_from` / `planning_visible_from`
 * floor on `trip_members` is enforced at the query layer here because RLS
 * can't trivially reach the requester's trip_members row.
 */
const Visibility = z.enum(["crew", "planning"]);

export const messagesRouter = router({
  // -----------------------------------------------------------------------
  // list — Crew chat: any member. Organizers chat: canEdit (owner/planner).
  // Both honor the per-member visibility floor (chat_visible_from / planning_visible_from)
  // so members added or promoted later don't see prior history.
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
      // Organizers chat is canEdit-gated. We could let RLS reject the
      // query, but throwing here gives a cleaner error and short-circuits
      // the visibility-floor lookup below.
      if (input.visibility === "planning") {
        const role = ctx.membershipCache.get(ctx.tripId);
        if (role !== "Owner" && role !== "Planner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organizers chat is owner/planner only.",
          });
        }
      }

      // Visibility floor lookup. NULL = sees all history; a timestamp means
      // the member was added (chat) or promoted (planning) at that point
      // and only sees messages from there on.
      let visibilityFloor: string | null = null;
      const floorCol =
        input.visibility === "crew" ? "chat_visible_from" : "planning_visible_from";
      const { data: memberRow } = await ctx.supabase
        .from("trip_members")
        .select(floorCol)
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .maybeSingle();
      if (memberRow) {
        const row = memberRow as Record<string, string | null>;
        visibilityFloor = row[floorCol] ?? null;
      }

      let query = ctx.supabase
        .from("messages")
        .select(
          "id, trip_id, user_id, channel, team_id, text, created_at, visibility, message_type"
        )
        .eq("trip_id", ctx.tripId)
        .eq("channel", input.channel)
        .eq("visibility", input.visibility)
        .order("created_at", { ascending: false })
        .limit(input.limit);

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

      if (visibilityFloor) {
        query = query.gte("created_at", visibilityFloor);
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
  // send — Crew chat: any member. Organizers chat: canEdit.
  // RLS also enforces the role gate; this is a defense-in-depth check that
  // throws a clearer error than a generic RLS rejection.
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

      if (input.visibility === "planning") {
        const role = ctx.membershipCache.get(ctx.tripId);
        if (role !== "Owner" && role !== "Planner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only organizers can post to the Organizers chat.",
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
          visibility: input.visibility,
          // message_type defaults to 'user' at the DB level. RLS also
          // enforces this for INSERT — system messages are server-only.
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
  // markPlanningRead — placeholder for future "last-seen" wiring. Left as
  // a no-op surface so the chat UI can wire it now and we backfill later.
  // -----------------------------------------------------------------------
  // (intentionally not implemented yet — keep this file focused on the
  // visibility split.)
});

// ── postSystemMessage — server-only helper ────────────────────────────────
//
// RLS blocks message_type='system' inserts from authenticated clients
// (see migration 004). System messages — member added / removed /
// promoted / demoted / invited — are posted via the service role client
// which bypasses RLS.
//
// Callers should be other tRPC mutations inside src/server/routers/ that
// have already validated permissions. Never invoke from a client-side
// procedure body that takes attacker-controlled text directly.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Typed as the untyped SupabaseClient (no Database<> generic) so it matches
// the rest of the codebase's tRPC ctx.supabase shape. Without the explicit
// annotation TS infers a stricter generic that rejects `from('messages')
// .insert(…)` as `never`.
let serviceClient: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createServiceClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return serviceClient;
}

export async function postSystemMessage(params: {
  tripId: string;
  visibility: "crew" | "planning";
  text: string;
}): Promise<void> {
  const supabase = getServiceClient();
  // Failure here is logged but never thrown — a missed lifecycle message
  // should not roll back the underlying member operation that triggered it.
  const { error } = await supabase.from("messages").insert({
    id: crypto.randomUUID(),
    trip_id: params.tripId,
    user_id: null,
    channel: "trip",
    team_id: null,
    text: params.text,
    visibility: params.visibility,
    message_type: "system",
  });
  if (error) {
    console.error(
      `[postSystemMessage] Failed to insert system message for trip ${params.tripId}:`,
      error
    );
  }
}

// Silence unused-import for requireTripRole — kept available for future
// router additions; remove if still unused after the crew overhaul lands.
void requireTripRole;
