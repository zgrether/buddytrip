import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { createAdminClient } from "@/lib/supabase-admin";
import { findOrphanBlockers, orphanRefusalMessage } from "../lib/ownerGuard";

export const usersRouter = router({
  // -----------------------------------------------------------------------
  // getMe — return the current user's profile
  // -----------------------------------------------------------------------
  getMe: authedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("users")
      .select("id, name, email, avatar_url, avatar_icon")
      .eq("id", ctx.user.id)
      .single();

    if (error || !data) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User profile not found",
      });
    }

    return data;
  }),

  // -----------------------------------------------------------------------
  // updateMe — update current user's name/avatar_url
  // -----------------------------------------------------------------------
  updateMe: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200).optional(),
        avatar_url: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.name && input.avatar_url === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one field must be provided",
        });
      }

      const update: Record<string, string | null> = {};
      if (input.name) update.name = input.name;
      if (input.avatar_url !== undefined) update.avatar_url = input.avatar_url;

      const { data, error } = await ctx.supabase
        .from("users")
        .update(update)
        .eq("id", ctx.user.id)
        .select("id, name, email, avatar_url, avatar_icon")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update profile",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // updateAvatar — set or clear the current user's Tabler avatar icon
  //   Pass a string (e.g. "flag-2") to set; pass null to revert to initials.
  //   Returns the updated row so the client can refresh its `getMe` cache.
  // -----------------------------------------------------------------------
  updateAvatar: authedProcedure
    .input(
      z.object({
        avatarIcon: z.string().max(50).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("users")
        .update({ avatar_icon: input.avatarIcon })
        .eq("id", ctx.user.id)
        .select("id, name, email, avatar_url, avatar_icon")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update avatar",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // search — email-exact lookup only (used by invite flow)
  // -----------------------------------------------------------------------
  search: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = input.query.trim().toLowerCase();
      if (!query.includes("@")) return [];

      // The one read of `users` that genuinely crosses trip boundaries: the
      // address may belong to someone the caller shares no trip with, which is
      // the entire reason `users_select` was `USING (true)`. It now goes
      // through `lookup_user_by_email` (migration 133), a definer that answers
      // exactly this question — one row, exact address — so the narrowed
      // policy (migration 134) doesn't have to admit a table scan to serve it.
      const { data, error } = await ctx.supabase.rpc("lookup_user_by_email", {
        p_email: query,
      });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Same verdict the old `.neq`/`.eq` filters expressed, applied here
      // because the definer deliberately returns the row rather than
      // pre-filtering it: a real account that isn't the caller.
      const row = (data ?? [])[0];
      if (!row || row.is_guest || row.id === ctx.user.id) return [];

      // `email` is echoed from the input it matched on — the definer does not
      // return it (the caller already has it), and `CrewSearchInput` renders
      // `name ?? email`, so the response shape stays byte-identical.
      return [
        {
          id: row.id,
          name: row.name,
          email: query,
          is_guest: row.is_guest,
          avatar_icon: row.avatar_icon,
        },
      ];
    }),

  // -----------------------------------------------------------------------
  // deletionBlockers — trips that would be orphaned if the caller deleted
  // their account, for the UI to state the blocker BEFORE the button is
  // pressed (#957 §4.5). Read-only; the refusal itself is enforced in
  // `deleteMe` below, which is the authoritative check — this is the courtesy
  // on top of it, never a substitute for it.
  // -----------------------------------------------------------------------
  deletionBlockers: authedProcedure.query(async ({ ctx }) => {
    const blockers = await findOrphanBlockers(ctx.supabase, ctx.user.id);
    return {
      blockers,
      message: blockers.length > 0 ? orphanRefusalMessage(blockers, "delete-account") : null,
    };
  }),

  // -----------------------------------------------------------------------
  // deleteMe — permanently delete the CALLER's own account.
  //
  // Deletes the auth.users row via the service-role admin client. The
  // on_auth_user_deleted trigger (migration 025) then CONVERTS the matching
  // public.users row to a placeholder rather than deleting it (migration 130):
  // name "Deleted User", email + avatar nulled, is_guest true. They can never
  // sign in again, and every shared record that references them — scores,
  // match sides, results, expenses and the splits OTHER people owe — keeps
  // resolving. Only rows that are about the person alone (push subscriptions,
  // read receipts) are deleted. Always self — it never accepts an id, so a
  // caller can only ever delete their own account.
  //
  // The old comment here described migration 027's FK fan-out ("the user's
  // expenses + transient rows go"). That was accurate and was the bug:
  // deleting one account removed 2 expenses and the 14 splits owed by 14 other
  // people. Their balances changed because someone else left.
  //
  // #957 — REFUSED when it would orphan a trip. STILL REQUIRED after migration
  // 130, and for a changed reason worth writing down, because the obvious read
  // is that keeping the row makes this guard unnecessary. It does not: the
  // membership row now SURVIVES, so a sole Owner's trip keeps an Owner who is
  // a placeholder and can never sign in. `trips.delete` (Owner-only) is just
  // as unsatisfiable as it was when the row vanished — the orphan mode moved
  // from "zero Owners" to "an Owner nobody can act as", which is the same dead
  // end. The guard is shared with `ghostCrew.remove` — see
  // `server/lib/ownerGuard.ts` for why it lives in application code rather
  // than a DB trigger.
  // -----------------------------------------------------------------------
  deleteMe: authedProcedure.mutation(async ({ ctx }) => {
    const blockers = await findOrphanBlockers(ctx.supabase, ctx.user.id);
    if (blockers.length > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: orphanRefusalMessage(blockers, "delete-account"),
      });
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to delete account: ${error.message}`,
      });
    }
    return { ok: true };
  }),

});
