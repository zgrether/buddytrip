import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripRole } from "../middleware";
import { postSystemMessage } from "./messages";

export const ghostCrewRouter = router({
  // -----------------------------------------------------------------------
  // create — Owner-only. Adds a guest user and adds them to the trip.
  //
  // Creates a users row with is_guest=true, then a trip_members row.
  // If email belongs to an existing real account, the trip_members row is
  // inserted against the existing user instead (auto-link).
  //
  // Owner-only as of Task 53 — guest crew creation is roster management.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(1).max(100),
        email: z.string().email().optional(),
        role: z.enum(["Organizer", "Member"]).default("Member"),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Normalize email to lowercase so storage + lookups stay consistent
      // with inviteByEmail (which already lowercases) and the lower-email
      // index. Without this, "Bob@x.com" and "bob@x.com" produce duplicate
      // accounts and miss each other on lookup.
      const email = input.email?.trim().toLowerCase() || null;

      // If email provided, check it against existing accounts
      if (email) {
        const { data: existingUser } = await ctx.supabase
          .from("users")
          .select("id, is_guest")
          .eq("email", email)
          .maybeSingle();

        if (existingUser && !existingUser.is_guest) {
          // Real account exists — check if already a member
          const { data: existingMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (existingMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A crew member with this email already exists.",
            });
          }

          // Auto-link: instead of asking the caller to use a different
          // endpoint, just insert a trip_members row for the existing
          // real account. The composer's single-flow stays single-flow,
          // and the resulting member is Active (matches the email's
          // BT account) rather than a redundant guest record.
          const { error: linkError } = await ctx.supabase
            .from("trip_members")
            .insert({
              id: crypto.randomUUID(),
              trip_id: ctx.tripId,
              user_id: existingUser.id,
              role: input.role,
              status: "in",
              // New members only see crew chat from when they were added.
              chat_visible_from: new Date().toISOString(),
            });

          if (linkError) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to add member to trip: ${linkError.message}`,
            });
          }

          // Best-effort lifecycle line into Crew chat.
          try {
            await postSystemMessage(ctx.supabase, {
              tripId: ctx.tripId,
              visibility: "crew",
              text: `${input.name} joined the crew`,
            });
          } catch {
            /* never block the add on a failed system message */
          }

          return {
            id: existingUser.id,
            name: input.name,
            email,
            is_guest: false,
            created_by: null,
            created_at: null,
            role: input.role,
          };
        }

        if (existingUser && existingUser.is_guest) {
          // Guest with this email already exists — check if they're in this trip
          const { data: existingMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (existingMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A crew member with this email already exists.",
            });
          }

          // Reuse the existing ghost user — just add them to this trip
          const { error: memberError } = await ctx.supabase
            .from("trip_members")
            .insert({
              id: crypto.randomUUID(),
              trip_id: ctx.tripId,
              user_id: existingUser.id,
              role: input.role,
              status: "in",
              // New members only see crew chat from when they were added.
              chat_visible_from: new Date().toISOString(),
            });

          if (memberError) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to add guest to trip: ${memberError.message}`,
            });
          }

          // Best-effort lifecycle line into Crew chat.
          try {
            await postSystemMessage(ctx.supabase, {
              tripId: ctx.tripId,
              visibility: "crew",
              text: `${input.name} joined the crew`,
            });
          } catch {
            /* never block the add on a failed system message */
          }

          return { id: existingUser.id, name: input.name, email, is_guest: true, created_by: null, created_at: null, role: input.role };
        }
      }

      // Create guest users row
      const guestId = `ghost-${crypto.randomUUID()}`;
      const { data: guest, error: guestError } = await ctx.supabase
        .from("users")
        .insert({
          id: guestId,
          name: input.name,
          email,
          is_guest: true,
          created_by: ctx.user!.id,
        })
        .select("id, name, email, is_guest, created_by, created_at")
        .single();

      if (guestError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create guest user: ${guestError.message}`,
        });
      }

      // Insert trip_members row (guests are always "in")
      const { error: memberError } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: guest.id,
          role: input.role,
          status: "in",
          // New members only see crew chat from when they were added.
          chat_visible_from: new Date().toISOString(),
        });

      if (memberError) {
        // Rollback the guest user insert.
        //
        // #782 — error-checked, count NOT asserted, and the ORDER matters: this
        // runs inside an existing failure path, so it must not mask the error it
        // is cleaning up after. assertNoError would throw its own message over
        // memberError's, which is the more useful one — so the rollback's own
        // failure is logged and the original error still propagates below.
        // A failed rollback leaves an orphaned guest row that "can resurface
        // stale name/email later" (audit §4.10); that is worth knowing about and
        // is not worth replacing a better diagnostic with a worse one.
        const { error: rollbackError } = await ctx.supabase
          .from("users")
          .delete()
          .eq("id", guest.id);
        if (rollbackError) {
          console.error(
            `[ghostCrew.create] rollback of orphaned guest ${guest.id} failed: ${rollbackError.message}`
          );
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add guest to trip members: ${memberError.message}`,
        });
      }

      // Best-effort lifecycle line into Crew chat.
      try {
        await postSystemMessage(ctx.supabase, {
          tripId: ctx.tripId,
          visibility: "crew",
          text: `${input.name} joined the crew`,
        });
      } catch {
        /* never block the add on a failed system message */
      }

      return { ...guest, role: input.role };
    }),

  // -----------------------------------------------------------------------
  // update — Owner-only. Edits a guest user's name/email.
  //
  // If `email` is provided and matches an existing real BuddyTrip account,
  // this swaps trip_members.user_id from the ghost to the real user (the
  // "auto-link" path) and returns the real user record with linked: true.
  // The ghost users row is left intact in case it's referenced by other
  // trips — only the trip_members pointer changes.
  //
  // Otherwise, falls through to a plain UPDATE on the ghost users row.
  //
  // Owner-only as of Task 53 — guest crew editing is roster management.
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestUserId: z.string(),
        name: z.string().min(1).max(100).optional(),
        email: z.string().email().nullable().optional(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Normalize to lowercase, preserving null (clear) vs undefined (no change).
      const email =
        input.email == null ? input.email : input.email.trim().toLowerCase();

      // Verify this guest is a member of this trip
      const { data: membership } = await ctx.supabase
        .from("trip_members")
        .select("id, role")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.guestUserId)
        .maybeSingle();

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Guest not found in this trip",
        });
      }

      // ── Auto-link branch: email matches an existing account ───────────
      //
      // The email may already belong to *another* users row — either a real
      // BT account or another guest record (e.g. a guest the owner created on
      // a different trip). users.email is UNIQUE, so a plain UPDATE that sets
      // this ghost's email to a value another row owns throws a 23505
      // violation (surfacing as a 500 the editor couldn't recover from).
      //
      // Instead, when the email belongs to a different existing user we
      // re-point this trip's membership at that user — mirroring
      // ghostCrew.create's "reuse the existing record" path — rather than
      // minting a duplicate email. (When existingUser is this same ghost,
      // the email is unchanged and the plain update below is a safe no-op.)
      if (email) {
        const { data: existingUser } = await ctx.supabase
          .from("users")
          .select("id, name, email, is_guest, created_at")
          .eq("email", email)
          .maybeSingle();

        if (existingUser && existingUser.id !== input.guestUserId) {
          // Reject if that user is already a member of this trip.
          const { data: alreadyMember } = await ctx.supabase
            .from("trip_members")
            .select("id")
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id)
            .maybeSingle();

          if (alreadyMember) {
            throw new TRPCError({
              code: "CONFLICT",
              message: existingUser.is_guest
                ? "A crew member with this email already exists."
                : "A user with this email is already a member of this trip.",
            });
          }

          // FULL MERGE — not just a trip_members swap.
          //
          // This branch used to only repoint trip_members at the matched
          // account and return. That is what produced the reported bug: the
          // ghost survived in `users` (so no FK error) but stopped being a trip
          // member, while team_assignments / game_participants / score_entries /
          // game_results / JSONB match sides all kept pointing at it. The roster
          // reads `memberById.get(user_id) ?? "Unknown"` off tripMembers.list,
          // so those slots rendered "Unknown" — and game_participants still
          // gated scoring for the ghost, so the real person could not enter
          // scores in a game they were rostered in. Production held 123 such
          // rows across 2 trips, including 93 real per-hole scores.
          //
          // Linking an account is the same job the signup trigger does, so it
          // now calls the same merge rather than keeping a second, thinner copy
          // of it. `link_guest_to_account` (mig 095) is the authorized wrapper:
          // the merge core stays revoked from `authenticated` because it would
          // otherwise be an account-takeover primitive.
          //
          // ORDER MATTERS: the merge moves trip_members itself, and the
          // wrapper's guard checks the guest is on THIS trip — both of which
          // require the ghost's membership row to still exist. So merge first,
          // then set status on the row it just repointed. (Role rides along
          // untouched, since the merge only rewrites user_id.)
          const { error: mergeErr } = await ctx.supabase.rpc("link_guest_to_account", {
            p_trip_id: ctx.tripId,
            p_ghost_id: input.guestUserId,
            p_real_id: existingUser.id,
          });
          if (mergeErr) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to link existing account: ${mergeErr.message}`,
            });
          }

          // A real account is Active; guests are always "in" anyway.
          const { error: statusErr } = await ctx.supabase
            .from("trip_members")
            .update({ status: "in" })
            .eq("trip_id", ctx.tripId)
            .eq("user_id", existingUser.id);

          if (statusErr) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Linked the account but failed to set status: ${statusErr.message}`,
            });
          }

          return { ...existingUser, linked: true as const };
        }
      }

      // ── Plain ghost update ────────────────────────────────────────────
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.email !== undefined) update.email = email;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("users")
        .update(update)
        .eq("id", input.guestUserId)
        .eq("is_guest", true)
        .select("id, name, email, is_guest, created_at")
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update guest user",
        });
      }

      return { ...data, linked: false as const };
    }),

  // -----------------------------------------------------------------------
  // remove — remove a guest from a trip (Owner only)
  //
  // Deletes the trip_members row. Then, if this guest is no longer a member
  // of *any* trip, we delete the guest users row entirely so its email is
  // freed for reuse.
  //
  // Why this matters: a guest is just a trip-scoped placeholder. The old
  // behavior kept the orphaned users row around forever, so re-adding the
  // same email later silently resolved back to the stale guest (with its old
  // name) instead of honoring the freshly-typed name — the "ghost name comes
  // back from the dead" bug. Deleting the now-unreferenced guest fixes that.
  //
  // The cleanup is intentionally best-effort and guarded:
  //   • Only guests (is_guest = true) are ever deleted — real BT accounts
  //     are never touched here.
  //   • Only when the guest has zero remaining trip_members rows — a guest
  //     shared across trips stays put.
  //   • Expense/score rows reference users with ON DELETE RESTRICT, so a
  //     guest who actually participated can't be hard-deleted; that delete
  //     errors and we simply leave the row in place. The trip removal itself
  //     still succeeds.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        guestUserId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // #782 — count asserted. Removing a guest is an explicit act on a row the
      // caller just saw in the roster, so zero rows means the id was stale or
      // foreign, not a benign race — and the old code reported success either
      // way, leaving the guest visibly still on the trip. This gate is one of
      // #786's remaining ten and will widen when the trip_members role-column
      // trigger lands, so it is checked before that rather than after.
      const { error, count } = await ctx.supabase
        .from("trip_members")
        .delete({ count: "exact" })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.guestUserId);

      if (!error && count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That crew member is not on this trip",
        });
      }

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove guest",
        });
      }

      // Free the email: if this guest is now on no trip, hard-delete the
      // users row. RLS blocks the user-scoped client from deleting users, so
      // this runs through a SECURITY DEFINER function that re-checks is_guest
      // and the orphan condition atomically, and no-ops for guests with
      // expense/score history (ON DELETE RESTRICT). Best-effort — a failure
      // here must not fail the removal the owner already saw succeed.
      await ctx.supabase.rpc("delete_orphan_guest_user", {
        p_user_id: input.guestUserId,
      });

      return { success: true };
    }),
});
