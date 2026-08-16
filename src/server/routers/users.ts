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

      const { data, error } = await ctx.supabase
        .from("users")
        .select("id, name, email, is_guest, avatar_icon")
        .eq("email", query)
        .neq("id", ctx.user.id)
        .eq("is_guest", false)
        .limit(1);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return data ?? [];
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
  // Deletes the auth.users row via the service-role admin client; the
  // on_auth_user_deleted trigger (migration 025) removes the matching
  // public.users row, and the FK behaviors set in migration 027 cascade /
  // anonymize the rest (the user's expenses + transient rows go; trip content
  // they authored survives with created_by nulled). Always self — it never
  // accepts an id, so a caller can only ever delete their own account.
  //
  // #957 — REFUSED when it would orphan a trip. `trip_members.user_id` is
  // ON DELETE CASCADE to `public.users`, so deleting the account removes the
  // membership but NOT the trip: a sole Owner's trip survives populated with
  // zero Owners, and `trips.delete` (Owner-only) can then never be satisfied
  // by anyone. Verified empirically, not just by reading. The guard is shared
  // with `ghostCrew.remove` — see `server/lib/ownerGuard.ts` for why it lives
  // in application code rather than a DB trigger.
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
