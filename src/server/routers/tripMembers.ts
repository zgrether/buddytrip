import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { postSystemMessage } from "./messages";

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
      "id, trip_id, user_id, role, status, joined_at, nickname, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared, last_emailed_at, email_count",
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
      const { data, error } = await ctx.supabase
        .from("users")
        .select("id, is_guest")
        .eq("email", email)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check email",
        });
      }

      // A real BT account = users row with is_guest=false. Guest rows
      // exist for placeholders and unaccepted invites; matching one of
      // those shouldn't tell the organizer "already on BuddyTrip".
      if (data && !data.is_guest) {
        return { result: "match" as const };
      }
      return { result: "invite" as const };
    }),

  // -----------------------------------------------------------------------
  // add — Owner-only. Adds a real-account user to the trip.
  // To add ghost crew, use ghostCrew.create instead.
  //
  // Roster management is Owner-only as of Task 53. The UI gates the Crew
  // management view on `isOwner`; this middleware closes the API-level door
  // so a Planner can't bypass the UI by calling tRPC directly.
  // -----------------------------------------------------------------------
  add: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        role: z.enum(["Planner", "Member"]).default("Member"),
        status: z.enum(["draft", "in", "likely", "maybe", "out", "invited"]).default("maybe"),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
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
          text: `${name} joined the crew`,
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
        role: z.enum(["Planner", "Member"]),
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

      // When promoting to Planner, also mark as invited if still in draft
      const update: Record<string, string> = { role: input.role };
      if (input.role === "Planner") {
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
            input.role === "Planner"
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
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Block setting a nickname on the Owner row — Owner controls their own
      // display name through account settings. Without this guard, any
      // Planner could rename the Owner inside the trip context.
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
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself",
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

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // inviteByEmail — Owner-only. Invite someone by email.
  //   - If a real account exists: adds them to the trip + sends notification
  //   - If no account: creates guest row + invites row + sends invite email
  //
  // Roster management is Owner-only as of Task 53 (mirrors the UI gate).
  // -----------------------------------------------------------------------
  inviteByEmail: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        email: z.string().email(),
        role: z.enum(["Planner", "Member"]).default("Planner"),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      // Fetch inviter name and trip name for email content
      const [inviterResult, tripResult] = await Promise.all([
        ctx.supabase.from("users").select("name").eq("id", ctx.user!.id).single(),
        ctx.supabase.from("trips").select("title").eq("id", ctx.tripId).single(),
      ]);
      const inviterName = inviterResult.data?.name ?? "Someone";
      const tripName = tripResult.data?.title ?? "a trip";

      // Check if a real (non-guest) account exists for this email
      const { data: existing } = await ctx.supabase
        .from("users")
        .select("id, name, is_guest")
        .eq("email", email)
        .maybeSingle();

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

        // Add to trip with status 'in'
        await ctx.supabase.from("trip_members").insert({
          trip_id: ctx.tripId,
          user_id: existing.id,
          role: input.role,
          status: "in",
          chat_visible_from: new Date().toISOString(),
        });

        // Crew-chat system line announcing the new member (best-effort).
        try {
          await postSystemMessage(ctx.supabase, {
            tripId: ctx.tripId!,
            visibility: "crew",
            text: `${existing.name ?? email.split("@")[0]} joined the crew`,
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

        // In-app notifications — notify owner about new member, and the added person
        try {
          const { createNotification } = await import("./notifications");
          const memberName = existing.name ?? email;

          // Notify the owner (if the inviter is not the owner)
          const { data: ownerMember } = await ctx.supabase
            .from("trip_members")
            .select("user_id")
            .eq("trip_id", ctx.tripId)
            .eq("role", "Owner")
            .single();

          if (ownerMember && ownerMember.user_id !== ctx.user!.id) {
            await createNotification(ctx.supabase, {
              tripId: ctx.tripId,
              actorId: ctx.user!.id,
              recipientId: ownerMember.user_id,
              type: "crew_added",
              payload: {
                member_name: memberName,
                trip_name: tripName,
                trip_id: ctx.tripId,
                is_self: "false",
              },
            });
          }

          // Notify the added person
          await createNotification(ctx.supabase, {
            tripId: ctx.tripId,
            actorId: ctx.user!.id,
            recipientId: existing.id,
            type: "crew_added",
            payload: {
              adder_name: inviterName,
              trip_name: tripName,
              trip_id: ctx.tripId,
              is_self: "true",
            },
          });
        } catch {
          // Notification failure shouldn't block the mutation
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
      await ctx.supabase.from("trip_members").insert({
        trip_id: ctx.tripId,
        user_id: guestUserId,
        role: input.role,
        status: "invited",
        chat_visible_from: new Date().toISOString(),
      });

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

      // Notify the owner about the new invite (if inviter is not the owner)
      try {
        const { createNotification } = await import("./notifications");
        const { data: ownerMember } = await ctx.supabase
          .from("trip_members")
          .select("user_id")
          .eq("trip_id", ctx.tripId)
          .eq("role", "Owner")
          .single();

        if (ownerMember && ownerMember.user_id !== ctx.user!.id) {
          await createNotification(ctx.supabase, {
            tripId: ctx.tripId,
            actorId: ctx.user!.id,
            recipientId: ownerMember.user_id,
            type: "crew_added",
            payload: {
              member_name: email.split("@")[0],
              trip_name: tripName,
              trip_id: ctx.tripId,
              is_self: "false",
            },
          });
        }
      } catch {
        // Notification failure shouldn't block the mutation
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

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update(update)
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .select("user_id, trip_id, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared")
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
      })
    )
    .use(requireTripRole("Owner"))
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
    .use(requireTripRole("Owner"))
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
        await ctx.supabase
          .from("trip_members")
          .update({ last_emailed_at: now })
          .eq("trip_id", ctx.tripId)
          .in("user_id", sentIds);

        await ctx.supabase.rpc("increment_member_email_count", {
          p_trip_id: ctx.tripId,
          p_user_ids: sentIds,
        });
      }

      return { sent: sentIds.length };
    }),

});
