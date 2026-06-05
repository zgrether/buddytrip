import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { newsBlocksSchema, type NewsBlock, type NewsPost } from "@/lib/news";

// ── news router ────────────────────────────────────────────────────────────
//
// The Trip Board: owner/organizer announcement posts. PR1 is read-only —
// list / readState / unreadCount / markRead. Create / update / delete / pin
// land in a follow-up PR with the composer.
//
// Read tracking mirrors the chat_reads model (messages.readState/markRead):
// one news_reads row per (trip, user); unread = posts authored by someone
// else, newer than the caller's last_read_at. RLS gates everything; the
// role checks here just produce clean errors instead of silent empties.

interface NewsPostRow {
  id: string;
  trip_id: string;
  author_id: string;
  blocks: NewsBlock[] | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

function toPost(row: NewsPostRow): NewsPost {
  return {
    id: row.id,
    tripId: row.trip_id,
    authorId: row.author_id,
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const newsRouter = router({
  // -----------------------------------------------------------------------
  // list — every post for a trip, feed order: pinned first, then newest.
  // Any trip member may read.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }): Promise<NewsPost[]> => {
      const { data, error } = await ctx.supabase
        .from("news_posts")
        .select("id, trip_id, author_id, blocks, pinned, created_at, updated_at")
        .eq("trip_id", ctx.tripId!)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load news",
        });
      }

      return ((data ?? []) as NewsPostRow[]).map(toPost);
    }),

  // -----------------------------------------------------------------------
  // readState — the caller's own last-read timestamp for a trip's news.
  // null = never opened on any device.
  // -----------------------------------------------------------------------
  readState: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }): Promise<{ lastReadAt: string | null }> => {
      const { data, error } = await ctx.supabase
        .from("news_reads")
        .select("last_read_at")
        .eq("trip_id", ctx.tripId!)
        .eq("user_id", ctx.user!.id)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load news read state",
        });
      }

      return { lastReadAt: (data?.last_read_at as string | undefined) ?? null };
    }),

  // -----------------------------------------------------------------------
  // unreadCount — posts authored by someone else, newer than the caller's
  // last_read_at. Drives the title-bar News badge; kept separate from list()
  // so the badge never has to ship the full block payload.
  // -----------------------------------------------------------------------
  unreadCount: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }): Promise<number> => {
      const { data: readRow } = await ctx.supabase
        .from("news_reads")
        .select("last_read_at")
        .eq("trip_id", ctx.tripId!)
        .eq("user_id", ctx.user!.id)
        .maybeSingle();
      const lastReadAt = (readRow?.last_read_at as string | undefined) ?? null;

      let query = ctx.supabase
        .from("news_posts")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", ctx.tripId!)
        .neq("author_id", ctx.user!.id);
      if (lastReadAt) {
        query = query.gt("created_at", lastReadAt);
      }

      const { count, error } = await query;
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to count unread news",
        });
      }
      return count ?? 0;
    }),

  // -----------------------------------------------------------------------
  // markRead — record that the caller has seen the news up to now(). Upserts
  // one (trip, user) row. Server clock (not a client timestamp) so it's
  // monotonic and a stale device can't roll the marker backward.
  // -----------------------------------------------------------------------
  markRead: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx }): Promise<{ lastReadAt: string }> => {
      const { data, error } = await ctx.supabase
        .from("news_reads")
        .upsert(
          {
            trip_id: ctx.tripId!,
            user_id: ctx.user!.id,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "trip_id,user_id" }
        )
        .select("last_read_at")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark news read: ${error.message}`,
        });
      }

      return { lastReadAt: (data as { last_read_at: string }).last_read_at };
    }),

  // -----------------------------------------------------------------------
  // create — Owner / Planner posts an announcement. blocks validated against
  // the closed six-type schema (the DB stores them as opaque JSON, so this is
  // the only guard on the invariant). INSERT then SELECT separately — the
  // RLS-RETURNING race pattern (CLAUDE.md #4).
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        blocks: newsBlocksSchema,
        pinned: z.boolean().default(false),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }): Promise<NewsPost> => {
      const id = crypto.randomUUID();
      const { error: insErr } = await ctx.supabase.from("news_posts").insert({
        id,
        trip_id: ctx.tripId!,
        author_id: ctx.user!.id,
        blocks: input.blocks,
        pinned: input.pinned,
      });
      if (insErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create post: ${insErr.message}`,
        });
      }

      const { data, error: selErr } = await ctx.supabase
        .from("news_posts")
        .select("id, trip_id, author_id, blocks, pinned, created_at, updated_at")
        .eq("id", id)
        .single();
      if (selErr || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Post created but could not be read back",
        });
      }
      return toPost(data as NewsPostRow);
    }),

  // -----------------------------------------------------------------------
  // update — edit a post's blocks (and pin state). Owner/Planner may edit any
  // post; since only Owner/Planner can author, this also covers "author edits
  // own". Scoped to (id, trip_id) so a postId can't be edited cross-trip.
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        postId: z.string(),
        blocks: newsBlocksSchema,
        pinned: z.boolean().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }): Promise<NewsPost> => {
      const patch: Record<string, unknown> = {
        blocks: input.blocks,
        updated_at: new Date().toISOString(),
      };
      if (input.pinned !== undefined) patch.pinned = input.pinned;

      const { error: updErr } = await ctx.supabase
        .from("news_posts")
        .update(patch)
        .eq("id", input.postId)
        .eq("trip_id", ctx.tripId!);
      if (updErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update post: ${updErr.message}`,
        });
      }

      const { data, error: selErr } = await ctx.supabase
        .from("news_posts")
        .select("id, trip_id, author_id, blocks, pinned, created_at, updated_at")
        .eq("id", input.postId)
        .eq("trip_id", ctx.tripId!)
        .single();
      if (selErr || !data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      }
      return toPost(data as NewsPostRow);
    }),

  // -----------------------------------------------------------------------
  // setPinned — quick pin/unpin (the ⋯ menu shortcut). Folded separately from
  // update so the menu toggle doesn't have to round-trip the whole block stack.
  // -----------------------------------------------------------------------
  setPinned: authedProcedure
    .input(z.object({ tripId: z.string(), postId: z.string(), pinned: z.boolean() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }): Promise<{ pinned: boolean }> => {
      const { error } = await ctx.supabase
        .from("news_posts")
        .update({ pinned: input.pinned, updated_at: new Date().toISOString() })
        .eq("id", input.postId)
        .eq("trip_id", ctx.tripId!);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update pin: ${error.message}`,
        });
      }
      return { pinned: input.pinned };
    }),

  // -----------------------------------------------------------------------
  // delete — remove a post. Owner/Planner only (RLS also enforces).
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), postId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { error } = await ctx.supabase
        .from("news_posts")
        .delete()
        .eq("id", input.postId)
        .eq("trip_id", ctx.tripId!);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete post: ${error.message}`,
        });
      }
      return { id: input.postId };
    }),
});
