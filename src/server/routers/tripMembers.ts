import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assertAffected } from "@/server/lib/assertAffected";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { postSystemMessage } from "./messages";
import { joinNoticeText } from "@/lib/joinMessage";
import { clearTripTeamAssignments } from "../lib/leaveTrip";
import {
  findContributionBlockers,
  contributionRefusalMessage,
  hasContributions,
} from "../lib/participationGuard";

/** Resolve a member's trip display name (nickname → account name) for
 *  system chat lines. Best-effort; falls back to "Someone". */
async function memberDisplayName(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<string> {
  const { data: tm } = await supabase
    .from("trip_members")
    .select("nickname")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  if (tm?.nickname) return tm.nickname as string;
  const { data: u } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  return (u?.name as string) || "Someone";
}

/** Shared between tripMembers.list and competitions.hydrate. */
export async function listMembers(
  ctx: { supabase: SupabaseClient },
  tripId: string,
) {
  const { data, error } = await ctx.supabase
    .from("trip_members")
    .select(
      "id, trip_id, user_id, role, status, joined_at, nickname, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared, departure_mode, departure_detail, departure_time, last_emailed_at, email_count",
    )
    .eq("trip_id", tripId)
    .order("joined_at", { ascending: true });

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch members",
    });
  }

  const rows = data ?? [];
  const userIds = rows.map((m) => m.user_id).filter(Boolean) as string[];

  const usersResult =
    userIds.length > 0
      ? await ctx.supabase
          .from("users")
          .select("id, name, email, is_guest, avatar_url, avatar_icon")
          .in("id", userIds)
      : {
          data: [] as {
            id: string;
            name: string | null;
            email: string | null;
            is_guest: boolean;
            avatar_url: string | null;
            avatar_icon: string | null;
          }[],
        };

  const userMap = new Map((usersResult.data ?? []).map((u) => [u.id, u]));

  return rows.map((m) => {
    const user = m.user_id ? userMap.get(m.user_id) ?? null : null;
    const isGuest = user?.is_guest ?? false;
    const memberId = m.user_id as string;
    // Display priority: trip_members.nickname (trip-scoped override) →
    // users.name → email → short-id fallback.
    const displayName = user
      ? m.nickname ?? user.name ?? user.email ?? `User ${memberId.slice(0, 6)}`
      : `Unknown ${memberId.slice(0, 6)}`;

    return { ...m, user, memberId, isGuest, displayName };
  });
}

export const tripMembersRouter = router({
  // -----------------------------------------------------------------------
  // list — all members of a trip (any member can view)
  //
  // Returns a unified shape for real users and guests (is_guest=true users).
  // All members have a non-null user_id pointing to a row in the users table.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx }) => listMembers(ctx, ctx.tripId!)),

  // -----------------------------------------------------------------------
  // checkEmail — does this email belong to an Active BuddyTrip account?
  //
  // Used by the Crew tab's member-editor to give live feedback as the
  // organizer types: "Already on BuddyTrip" vs "We'll send an invite".
  // Trip-scoped + auth-required to keep enumeration risk low; returns
  // only the verdict, never the matched user's identity.
  // -----------------------------------------------------------------------
  checkEmail: authedProcedure
    .input(z.object({ tripId: z.string(), email: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      if (!email) return { result: "empty" as const };

      // RFC-5322-ish format check. Server-side gate so a malformed
      // payload can't reach the lookup; the client also pre-validates
      // for instant feedback.
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!ok) return { result: "invalid" as const };

      // Exact match on the normalized (lowercased) email. inviteByEmail
      // already does this; ilike couldn't use a btree and seq-scanned users.
      //
      // Crosses trip boundaries by design — the whole point is to recognise an
      // address that belongs to someone not on this trip — so it goes through
      // `lookup_user_by_email` (migration 133) rather than reading `users`
      // directly, which migration 134 narrows to self-plus-shares-a-trip.
      const { data, error } = await ctx.supabase.rpc("lookup_user_by_email", {
        p_email: email,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check email",
        });
      }

      // A real BT account = users row with is_guest=false. Guest rows
      // exist for placeholders and unaccepted invites; matching one of
      // those shouldn't tell the organizer "already on BuddyTrip".
      // The definer returns rows, so this is `[0]` rather than maybeSingle's
      // row-or-null — the address is UNIQUE, so there is at most one either way.
      const match = (data ?? [])[0];
      if (match && !match.is_guest) {
        return { result: "match" as const };
      }
      return { result: "invite" as const };
    }),

  // -----------------------------------------------------------------------
  // removalBlockers — games this member is playing in / has scores in (#951).
  //
  // Read-only, for the UI to state the blocker BEFORE the remove button rather
  // than after a failed press. `remove` re-checks and is the authority; this is
  // the courtesy on top of it, never a substitute.
  // -----------------------------------------------------------------------
  removalBlockers: authedProcedure
    .input(z.object({ tripId: z.string(), userId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const blockers = await findContributionBlockers(ctx.supabase, ctx.tripId!, input.userId);
      // `blocked` is returned explicitly rather than left for the client to
      // re-derive: the predicate now spans games AND two expense counts, and a
      // client re-implementing it is how the two drift apart.
      const blocked = hasContributions(blockers);
      const message: string | null = !blocked
        ? null
        : contributionRefusalMessage(
            await memberDisplayName(ctx.supabase, ctx.tripId!, input.userId),
            blockers
          );
      return { blocked, blockers, message };
    }),

  // -----------------------------------------------------------------------
  // add — Owner-only. Adds a real-account user to the trip.
  // To add ghost crew, use ghostCrew.create instead.
  //
  // Roster management is Owner-only as of Task 53. The UI gates the Crew
  // management view on `isOwner`; this middleware closes the API-level door
  // so a Organizer can't bypass the UI by calling tRPC directly.
  // -----------------------------------------------------------------------
  add: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        role: z.enum(["Organizer", "Member"]).default("Member"),
        status: z.enum(["draft", "in", "likely", "maybe", "out", "invited"]).default("maybe"),
      })
    )
    // #786/#824 — Organizer may manage the roster now that migration 122
    // defends the `role` column. Adding crew is helping run the trip.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // ...but GRANTING a privileged role is "changing who is trusted"
      // (PERMISSIONS.md exception 1), and stays Owner-only. The migration-122
      // trigger is the authority here and refuses this even via PostgREST; this
      // check exists so the normal path gets a sentence rather than a raw
      // database error.
      if (input.role !== "Member" && ctx.tripRole !== "Owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the trip owner can add someone as an Organizer.",
        });
      }

      // Check if already a member
      const { data: existing } = await ctx.supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this trip",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: input.userId,
          role: input.role,
          status: input.status,
          // History floor: a member added now shouldn't see Crew chat
          // banter from before they joined.
          chat_visible_from: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add member: ${error.message}`,
        });
      }

      // System line in Crew chat announcing the new member (best-effort).
      try {
        const name = await memberDisplayName(ctx.supabase, ctx.tripId!, input.userId);
        await postSystemMessage(ctx.supabase, {
          tripId: ctx.tripId!,
          visibility: "crew",
          text: joinNoticeText(name),
          subjectUserId: input.userId,
        });
      } catch {
        /* system message failure shouldn't block the add */
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // updateRole — Owner only, can promote/demote real members (not self)
  // -----------------------------------------------------------------------
  updateRole: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        role: z.enum(["Organizer", "Member"]),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change your own role",
        });
      }

      // When promoting to Organizer, also mark as invited if still in draft
      const update: Record<string, string> = { role: input.role };
      if (input.role === "Organizer") {
        const { data: current } = await ctx.supabase
          .from("trip_members")
          .select("status")
          .eq("trip_id", ctx.tripId)
          .eq("user_id", input.userId)
          .single();
        if (current?.status === "draft") {
          update.status = "invited";
        }
        // History floor: a newly-promoted organizer shouldn't see the
        // Organizers chat from before they were promoted.
        update.planning_visible_from = new Date().toISOString();
      }

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update(update)
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update role",
        });
      }

      // System line in the Organizers chat for the role change
      // (best-effort). Promote announces the new organizer; demote
      // notes the departure so remaining organizers have context.
      try {
        const name = await memberDisplayName(ctx.supabase, ctx.tripId!, input.userId);
        await postSystemMessage(ctx.supabase, {
          tripId: ctx.tripId!,
          visibility: "planning",
          text:
            input.role === "Organizer"
              ? `${name} is now an organizer`
              : `${name} is no longer an organizer`,
        });
      } catch {
        /* system message failure shouldn't block the role change */
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // updateNickname — Owner-only. Sets a trip-scoped display name for any
  // member except the Owner. Empty string clears the override and falls
  // back to users.name. Lives on trip_members so it doesn't affect the
  // member's name in any other trip they're on.
  //
  // Owner-only as of Task 53 — renaming crew is roster management.
  // -----------------------------------------------------------------------
  updateNickname: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        nickname: z.string().max(80),
      })
    )
    // #786/#824 — Organizer may set a crew nickname. Touches no role column.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // Block setting a nickname on the Owner row — Owner controls their own
      // display name through account settings. Without this guard, any
      // Organizer could rename the Owner inside the trip context.
      const { data: target } = await ctx.supabase
        .from("trip_members")
        .select("role")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found in this trip" });
      }
      if (target.role === "Owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The Owner's display name can only be changed by the Owner from account settings.",
        });
      }

      const trimmed = input.nickname.trim();
      const nextValue = trimmed.length === 0 ? null : trimmed;

      const { error } = await ctx.supabase
        .from("trip_members")
        .update({ nickname: nextValue })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update nickname",
        });
      }

      return { success: true, nickname: nextValue };
    }),

  // -----------------------------------------------------------------------
  // remove — Owner only, removes a real member (not self)
  // To remove ghost crew, use ghostCrew.remove instead.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
      })
    )
    // #786/#824 — Organizer may remove crew, but MEMBERS ONLY. Removing an
    // Owner (migration 122) or a fellow Organizer (migration 123) is refused
    // at the DATABASE, so the rule holds for a PostgREST caller too — an
    // Organizer with a browser JWT is exactly the case tRPC cannot see.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself",
        });
      }

      // The readable half of migration 123. `updateRole` is Owner-only because
      // only the Owner changes who is trusted (PERMISSIONS.md:186), and removal
      // is a stronger form of the same act — without this an Organizer couldn't
      // demote a peer but could delete them. The trigger is the authority and
      // refuses it regardless; this exists so the normal path gets a sentence
      // naming the way forward instead of a raw database error.
      if (ctx.tripRole !== "Owner") {
        const { data: target } = await ctx.supabase
          .from("trip_members")
          .select("role")
          .eq("trip_id", ctx.tripId)
          .eq("user_id", input.userId)
          .maybeSingle();

        if (target && target.role !== "Member") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `Only the trip owner can remove ${target.role === "Owner" ? "the owner" : "an organizer"}. ` +
              `Ask the owner to remove them, or to change their role to Member first.`,
          });
        }
      }

      // #951 — REFUSE rather than orphan. A removal deletes trip_members and
      // nothing else: every scoring table keys to `users`, so nothing cascades
      // and nothing errors, and the participation is silently left behind. The
      // shared predicate is the same one `ghostCrew.remove` runs — the sibling
      // gap #957 was exactly a guard present in one procedure and missing from
      // its twin.
      const blockers = await findContributionBlockers(ctx.supabase, ctx.tripId!, input.userId);
      if (hasContributions(blockers)) {
        const name = await memberDisplayName(ctx.supabase, ctx.tripId!, input.userId);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: contributionRefusalMessage(name, blockers),
        });
      }

      const { error } = await ctx.supabase
        .from("trip_members")
        .delete()
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove member",
        });
      }

      // Leaving the trip means leaving its cups. Without this the member keeps a
      // `team_assignments` row for a trip they are no longer on, and the surfaces
      // that read assignments directly go on counting them while the ones that
      // intersect with the crew do not — see `clearTripTeamAssignments`.
      await clearTripTeamAssignments(ctx.supabase, ctx.tripId, input.userId);

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // inviteByEmail — Organizer for a MEMBER invite, Owner for an ORGANIZER
  // invite. The split lives in the PROCEDURE, not the guard.
  //   - If a real account exists: adds them to the trip + sends notification
  //   - If no account: creates guest row + invites row + sends invite email
  //
  // ── History, because this has gone backwards twice ─────────────────────
  // #788 widened it; #790 reverted (it MINTED THE ROLE IT WAS GATED ON); #823
  // re-landed with the input split below and was reverted AGAIN, that time on
  // CI evidence of a second, deeper problem: the procedure's `trip_members`
  // INSERT was refused by an Owner-only RLS policy, so an Organizer got past
  // the guard and wrote nothing.
  //
  // BOTH are now resolved, which is why this is Organizer again:
  //   (a) minting — the input split below, layered with migration 103, which
  //       narrows `invites_insert` to the same rule at the DB. That layering
  //       matters: `invites.role` is copied into `trip_members` by the
  //       invitee's OWN client (`app/invite/page.tsx`) through the self-insert
  //       arm, so a direct PostgREST insert bypasses this procedure entirely.
  //       #720's rule — a tRPC check is not a policy.
  //   (b) the refused write — migration 122 widened the `trip_members`
  //       policies to `is_trip_planner` once the role column had its own
  //       guard. Verified by probe rather than inference before re-widening:
  //       the INSERT and the `last_emailed_at` UPDATE that CI proved failing
  //       in #823 both now succeed as an Organizer writing directly.
  //
  // The comment that used to sit here said "Owner-only ... until the
  // trip_members role-column trigger lands". That was a CONDITION, and it aged
  // correctly — it stayed true until the condition was met, then told the next
  // reader exactly what had changed. Compare migration 030's "the fix is a
  // trigger on the role column", which described a thing that did not exist and
  // was read for months as though it did. Conditions age well; descriptions of
  // absent machinery do not.
  // -----------------------------------------------------------------------
  inviteByEmail: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        email: z.string().email(),
        // Default flipped from "Organizer" (#790's finding: a surprising and
        // unsafe default for an invite). Dead from the UI either way —
        // `CrewSearchInput` always passes `role` explicitly — so this only
        // governs a direct API call, where "Member" is the safe value.
        role: z.enum(["Organizer", "Member"]).default("Member"),
      })
    )
    // A PROCEDURE THAT TAKES A ROLE AS INPUT CANNOT BE GATED ON ROLE ALONE.
    // That is the rule #790's revert produced, and it is why the guard admits
    // Organizers while the procedure refuses the one thing an Organizer may not
    // grant. The invite is not the trusted act; the role being granted is.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // The input-dependent half of the gate. FORBIDDEN, never UNAUTHORIZED:
      // `authExpiry` treats a 401 as a dead session and hard-navigates to
      // /login, which would log someone out mid-invite (#689). It names the
      // rule and the way forward rather than the state (#809) — "forbidden"
      // leaves the reader guessing which part was refused.
      if (input.role === "Organizer" && ctx.tripRole !== "Owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only the Owner can invite an Organizer. You can invite them as a Member, " +
            "and the Owner can promote them afterwards.",
        });
      }

      const email = input.email.trim().toLowerCase();

      // Fetch inviter name and trip name for email content
      const [inviterResult, tripResult] = await Promise.all([
        ctx.supabase.from("users").select("name").eq("id", ctx.user!.id).single(),
        ctx.supabase.from("trips").select("title").eq("id", ctx.tripId).single(),
      ]);
      const inviterName = inviterResult.data?.name ?? "Someone";
      const tripName = tripResult.data?.title ?? "a trip";

      // Check if a real (non-guest) account exists for this email.
      // Cross-boundary by nature — inviting is precisely how someone who is
      // not yet on this trip gets recognised — so it reads through the definer
      // (migration 133), not `users` (narrowed by migration 134).
      const { data: existingRows } = await ctx.supabase.rpc(
        "lookup_user_by_email",
        { p_email: email }
      );
      const existing = (existingRows ?? [])[0] ?? null;

      // ── Path A: Real account exists — add to trip directly ──────────
      if (existing && !existing.is_guest) {
        // Check if already a member
        const { data: alreadyMember } = await ctx.supabase
          .from("trip_members")
          .select("user_id")
          .eq("trip_id", ctx.tripId)
          .eq("user_id", existing.id)
          .maybeSingle();

        if (alreadyMember) {
          const displayName = existing.name ?? email;
          return { status: "already_member" as const, displayName };
        }

        // Add to trip with status 'in'.
        //
        // #778 — CHECKED, and the check is load-bearing rather than tidy. This
        // insert is refused by `trip_members_insert` for anyone but the Owner,
        // and while it was unchecked #788 widened this procedure's gate past it:
        // an Organizer got `added_existing` back with no roster row written.
        // The gate is Owner-only again (#790) and is queued to widen a second
        // time once the role-input split lands — so this is fixed BEFORE that,
        // not after (SILENT_WRITES_AUDIT.md §4.3).
        //
        // Throwing here also stops the two best-effort side effects below (the
        // crew system message and the notification email), which is the point:
        // neither should fire for someone who was never added.
        assertAffected(
          await ctx.supabase.from("trip_members").insert(
            {
              trip_id: ctx.tripId,
              user_id: existing.id,
              role: input.role,
              status: "in",
              chat_visible_from: new Date().toISOString(),
            },
            { count: "exact" }
          ),
          1,
          "add the invited member to the trip"
        );

        // Crew-chat system line announcing the new member (best-effort).
        try {
          await postSystemMessage(ctx.supabase, {
            tripId: ctx.tripId!,
            visibility: "crew",
            text: joinNoticeText(existing.name ?? email.split("@")[0]),
            subjectUserId: existing.id,
          });
        } catch {
          /* best-effort */
        }

        // Send notification email (best effort — don't fail on email error)
        try {
          const { sendInviteExistingUser } = await import("@/lib/email");
          await sendInviteExistingUser({
            toEmail: email,
            toName: existing.name ?? email.split("@")[0],
            inviterName,
            tripName,
            tripId: ctx.tripId,
          });
        } catch {
          // Email failure shouldn't block the mutation
        }

        return { status: "added_existing" as const };
      }

      // ── Path B: No real account — create guest + invite ─────────────
      let guestUserId: string;

      if (existing?.is_guest) {
        guestUserId = existing.id;
      } else {
        const newId = crypto.randomUUID();
        const { error: userError } = await ctx.supabase.from("users").insert({
          id: newId,
          name: email.split("@")[0],
          email,
          is_guest: true,
          created_by: ctx.user!.id,
        });
        if (userError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create invite. Please try again.",
          });
        }
        guestUserId = newId;
      }

      // Check if already a member
      const { data: alreadyMember } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", guestUserId)
        .maybeSingle();

      if (alreadyMember) {
        const displayName = existing?.name ?? email;
        return { status: "already_member" as const, displayName };
      }

      // Create invite row with token
      const { data: invite, error: inviteError } = await ctx.supabase
        .from("invites")
        .insert({
          trip_id: ctx.tripId,
          email,
          role: input.role,
          created_by: ctx.user!.id,
        })
        .select("token")
        .single();

      if (inviteError || !invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite. Please try again.",
        });
      }

      // Add to trip_members with status 'invited'. The chat floor is set
      // now so once they accept + sign in they only see Crew chat from
      // this point forward.
      //
      // #778 — CHECKED. This is the worse half of the pair: unchecked, a refused
      // insert still fell through to the invite EMAIL below, so someone got a
      // link to a trip they were not on and the failure surfaced only as "my
      // invite doesn't work". Throwing stops the send.
      //
      // NOT made transactional, deliberately: the guest `users` row and the
      // `invites` row were already written above, and a throw here leaves both
      // orphaned. That is pre-existing and unchanged — this commit makes the
      // failure observable, it does not add a rollback (which would be a
      // behaviour change, and the orphan guest is recoverable by re-inviting the
      // same address, which re-uses the existing placeholder).
      assertAffected(
        await ctx.supabase.from("trip_members").insert(
          {
            trip_id: ctx.tripId,
            user_id: guestUserId,
            role: input.role,
            status: "invited",
            chat_visible_from: new Date().toISOString(),
          },
          { count: "exact" }
        ),
        1,
        "add the invited guest to the trip"
      );

      // Send invite email (best effort)
      try {
        const { sendInviteNewUser } = await import("@/lib/email");
        await sendInviteNewUser({
          toEmail: email,
          inviterName,
          tripName,
          token: invite.token,
        });
      } catch {
        // Email failure shouldn't block the mutation
      }

      return { status: "invited_new" as const, userId: guestUserId };
    }),

  // -----------------------------------------------------------------------
  // updateTravel — member updates their own travel info
  // -----------------------------------------------------------------------
  updateTravel: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        travelMode: z.enum(["driving", "flying", "other"]).nullable(),
        travelDetail: z.string().max(500).nullable().optional(),
        flightAirline: z.string().max(100).nullable().optional(),
        flightNumber: z.string().max(50).nullable().optional(),
        flightArrivalTime: z.string().nullable().optional(),
        flightAirport: z.string().max(100).nullable().optional(),
        travelShared: z.boolean().default(true),
        // Departure leg — mirror of the arrival fields (Phase-0 model A).
        departureMode: z.enum(["driving", "flying", "other"]).nullable().optional(),
        departureDetail: z.string().max(500).nullable().optional(),
        departureTime: z.string().nullable().optional(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {
        travel_mode: input.travelMode,
        travel_shared: input.travelShared,
      };
      if (input.travelDetail !== undefined) update.travel_detail = input.travelDetail;
      if (input.flightAirline !== undefined) update.flight_airline = input.flightAirline;
      if (input.flightNumber !== undefined) update.flight_number = input.flightNumber;
      if (input.flightArrivalTime !== undefined) update.flight_arrival_time = input.flightArrivalTime;
      if (input.flightAirport !== undefined) update.flight_airport = input.flightAirport;
      if (input.departureMode !== undefined) update.departure_mode = input.departureMode;
      if (input.departureDetail !== undefined) update.departure_detail = input.departureDetail;
      if (input.departureTime !== undefined) update.departure_time = input.departureTime;

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update(update)
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .select("user_id, trip_id, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared, departure_mode, departure_detail, departure_time")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update travel info",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // updateGuestTravel — Owner sets travel info for a ghost crew member.
  //
  // Ghost members can't log in so they can't use updateTravel themselves.
  // The owner fills it in on their behalf — this keeps the Getting There
  // panel useful even when some crew haven't joined BuddyTrip yet.
  // -----------------------------------------------------------------------
  // updateMemberTravel — Owner sets travel info for any crew member.
  //
  // Ghost members can't log in so the owner fills in their travel.
  // Owners can also correct/fill in for any real member who hasn't yet.
  // -----------------------------------------------------------------------
  updateMemberTravel: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        targetUserId: z.string(),
        travelMode: z.enum(["driving", "flying", "other"]).nullable(),
        travelDetail: z.string().max(500).nullable().optional(),
        flightAirline: z.string().max(100).nullable().optional(),
        flightNumber: z.string().max(50).nullable().optional(),
        flightArrivalTime: z.string().nullable().optional(),
        flightAirport: z.string().max(100).nullable().optional(),
        // Departure leg — mirror of the arrival fields (Phase-0 model A).
        departureMode: z.enum(["driving", "flying", "other"]).nullable().optional(),
        departureDetail: z.string().max(500).nullable().optional(),
        departureTime: z.string().nullable().optional(),
      })
    )
    // #786/#824 — Organizer may record crew travel. Touches no role column.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.targetUserId)
        .maybeSingle();

      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found in this trip" });
      }

      const update: Record<string, unknown> = {
        travel_mode: input.travelMode,
        travel_shared: true,
      };
      if (input.travelDetail !== undefined) update.travel_detail = input.travelDetail;
      if (input.flightAirline !== undefined) update.flight_airline = input.flightAirline;
      if (input.flightNumber !== undefined) update.flight_number = input.flightNumber;
      if (input.flightArrivalTime !== undefined) update.flight_arrival_time = input.flightArrivalTime;
      if (input.flightAirport !== undefined) update.flight_airport = input.flightAirport;
      if (input.departureMode !== undefined) update.departure_mode = input.departureMode;
      if (input.departureDetail !== undefined) update.departure_detail = input.departureDetail;
      if (input.departureTime !== undefined) update.departure_time = input.departureTime;

      const { error } = await ctx.supabase
        .from("trip_members")
        .update(update)
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.targetUserId);

      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update travel info" });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // sendInvitationBlast — Owner sends the trip invitation email to a
  // selected subset of crew members. Stamps last_emailed_at and bumps
  // email_count per recipient (email_count distinguishes a first-contact
  // invite from a follow-up).
  // -----------------------------------------------------------------------
  sendInvitationBlast: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        memberUserIds: z.array(z.string()).min(1),
        /**
         * The exact invitation body to send, as shown in the email panel.
         * Passed explicitly so the sent email always matches what the owner
         * saw — the panel's default varies by stage (planning vs. going) and
         * isn't always persisted to about_message. Falls back to
         * about_message, then the canned default, for any caller that omits
         * it.
         */
        message: z.string().optional(),
      })
    )
    // MOVED WHOLESALE, with no input split — unlike its sibling this procedure
    // takes NO role. Its input is `{ tripId, memberUserIds, message? }`: it
    // sends email and stamps send-tracking, granting nothing, so there is no
    // "role being granted" to gate on and the plain Organizer guard is the
    // whole answer. It was only ever Owner-only as `inviteByEmail`'s sibling.
    //
    // #823's attempt failed in CI on the `last_emailed_at` stamp below — an
    // UPDATE on `trip_members`, then Owner-only, so it matched zero rows for an
    // Organizer ("expected 1 row(s), affected 0"). #796 had made that loud
    // rather than permitted. Migration 122 widened the policy; re-probed as an
    // Organizer writing directly before re-widening, and the UPDATE now affects
    // its row.
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // Fetch trip for email content. locked_destination_location is the
      // real-world location string ("Bandon, OR") that buildCannedInvitation
      // prefers over the cute locked_destination_title ("Bandon Dunes").
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("title, about_message, location, locked_destination_location, locked_destination_title, start_date, end_date")
        .eq("id", ctx.tripId)
        .single();

      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });

      // Fetch owner display name
      const { data: owner } = await ctx.supabase
        .from("users")
        .select("name")
        .eq("id", ctx.user!.id)
        .single();
      const ownerName = owner?.name ?? "Your host";

      // Verify recipients are actual trip members (prevents spoofed IDs)
      const { data: memberRows } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .in("user_id", input.memberUserIds);

      const verifiedIds = (memberRows ?? []).map((m) => m.user_id).filter(Boolean) as string[];
      if (verifiedIds.length === 0) return { sent: 0 };

      // Fetch user records with emails
      const { data: users } = await ctx.supabase
        .from("users")
        .select("id, name, email")
        .in("id", verifiedIds);

      // Build invitation message. Prefer the explicit body the panel sent
      // (so the email matches what the owner saw, including the idea-zone
      // planning-vibe default), then the saved about_message, then the
      // canned default as a last resort.
      const { buildCannedInvitation } = await import("@/lib/invitationDefault");
      const invitationMessage =
        input.message?.trim() || trip.about_message?.trim() || buildCannedInvitation(trip);

      const { sendInvitationBlast: sendBlast } = await import("@/lib/email");
      const now = new Date().toISOString();
      const sentIds: string[] = [];

      for (const user of users ?? []) {
        if (!user.email) continue;
        try {
          await sendBlast({
            toEmail: user.email,
            toName: user.name ?? user.email.split("@")[0],
            ownerName,
            tripTitle: trip.title,
            invitationMessage,
            tripId: ctx.tripId,
          });
          sentIds.push(user.id);
        } catch {
          // Email failure for one recipient shouldn't stop others
        }
      }

      // Stamp last_emailed_at ("when last sent") for each recipient, then
      // atomically bump email_count (0→1 makes the first send an invite;
      // any later send a follow-up). The increment is a SQL function because
      // supabase-js can't express `email_count = email_count + 1`.
      if (sentIds.length > 0) {
        // #778 — CHECKED. Same Owner-only `trip_members` policy as the inserts
        // above, so this went silent for an Organizer under #788 too: the emails
        // sent and the send-tracking never recorded, which turns "when did we
        // last chase them" into a lie. One row per recipient we actually emailed.
        //
        // Ordered AFTER the sends on purpose (unchanged): a stamp failure must
        // not suppress mail that already went out. Throwing here reports a
        // send that happened but wasn't recorded — the honest outcome, and the
        // caller can re-run since the mail path is idempotent per recipient.
        assertAffected(
          await ctx.supabase
            .from("trip_members")
            .update({ last_emailed_at: now }, { count: "exact" })
            .eq("trip_id", ctx.tripId)
            .in("user_id", sentIds),
          sentIds.length,
          "record when the invitation emails were sent"
        );

        await ctx.supabase.rpc("increment_member_email_count", {
          p_trip_id: ctx.tripId,
          p_user_ids: sentIds,
        });
      }

      return { sent: sentIds.length };
    }),

});
