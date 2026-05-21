import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { postSystemMessage } from "./messages";

/**
 * Look up a user's display name. Used by member-mutation paths to format
 * lifecycle system messages ("[Name] was added to the trip"). Falls back
 * to a generic label if the user row is missing or has neither field.
 */
async function getDisplayName(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("users")
    .select("name, nickname, email")
    .eq("id", userId)
    .maybeSingle();
  return (
    data?.nickname ??
    data?.name ??
    (data?.email ? data.email.split("@")[0] : null) ??
    "A crew member"
  );
}

/** Shared between tripMembers.list and competitions.hydrate. */
export async function listMembers(
  ctx: { supabase: SupabaseClient },
  tripId: string,
) {
  const { data, error } = await ctx.supabase
    .from("trip_members")
    .select(
      "id, trip_id, user_id, role, status, joined_at, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared, last_invited_at, display_name",
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
          .select("id, name, nickname, email, is_guest, avatar_url, avatar_icon")
          .in("id", userIds)
      : {
          data: [] as {
            id: string;
            name: string | null;
            nickname: string | null;
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
    // Display name resolution order (CC_MODAL_AUDIT.md Part 1.4):
    //   1. trip_members.display_name — trip-local override
    //   2. users.nickname            — preferred personal name
    //   3. users.name                — full name
    //   4. users.email               — fallback for users with no name
    //   5. "Unknown <id-prefix>"     — never expected, defensive
    const trimmedOverride = m.display_name?.trim();
    const displayName =
      trimmedOverride ||
      (user
        ? user.nickname ?? user.name ?? user.email ?? `User ${memberId.slice(0, 6)}`
        : `Unknown ${memberId.slice(0, 6)}`);

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
  // add — Owner or Planner can add real-account members (canEdit)
  // To add ghost crew, use ghostCrew.create instead.
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
    .use(requireTripRole("Planner"))
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

      const now = new Date().toISOString();
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: input.userId,
          role: input.role,
          status: input.status,
          // Visibility floor — new joiners don't see prior Crew chat.
          chat_visible_from: now,
          // Newly-added Planners also get a planning floor so they don't
          // see prior Organizers chat.
          ...(input.role === "Planner" ? { planning_visible_from: now } : {}),
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add member: ${error.message}`,
        });
      }

      // Lifecycle system messages.
      //   Crew chat → only when the member actually joins (status='in'),
      //   wording is "joined the trip" (not "added"). Pending invitees
      //   don't get a crew-chat post here — the invite-acceptance flow
      //   posts that when they sign up.
      //   Organizer chat → every add (regardless of status), plus a
      //   separate "made an organizer" note when role=Planner.
      const displayName = await getDisplayName(ctx.supabase, input.userId);
      await postSystemMessage({
        tripId: ctx.tripId,
        visibility: "planning",
        text: `${displayName} was added to the trip`,
      });
      if (input.status === "in") {
        await postSystemMessage({
          tripId: ctx.tripId,
          visibility: "crew",
          text: `${displayName} joined the trip`,
        });
      }
      if (input.role === "Planner") {
        await postSystemMessage({
          tripId: ctx.tripId,
          visibility: "planning",
          text: `${displayName} was made an organizer`,
        });
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

      // When promoting to Planner, also mark as invited if still in draft.
      // Set planning_visible_from = NOW() so the newly-minted organizer
      // doesn't see prior owner/planner-only chatter.
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

      // Lifecycle system message to Organizers chat — role decisions are
      // internal to organizers, so Crew chat doesn't see this.
      const displayName = await getDisplayName(ctx.supabase, input.userId);
      await postSystemMessage({
        tripId: ctx.tripId,
        visibility: "planning",
        text:
          input.role === "Planner"
            ? `${displayName} was made an organizer`
            : `${displayName} is no longer an organizer`,
      });

      return data;
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

      // Capture display name BEFORE the delete so we can format the
      // system message — once the trip_member row is gone, the user row
      // might still exist but we want the rendering pinned to "who was
      // on this trip when they were removed".
      const displayName = await getDisplayName(ctx.supabase, input.userId);

      // Capture the member's pre-delete status + email-presence so we can
      // decide whether the removal warrants a Crew-chat post. Removing a
      // pending invitee (or a Just Name with no email) is an organizer-
      // only concern; Crew chat only cares about people who actually had
      // chat access.
      const { data: outgoing } = await ctx.supabase
        .from("trip_members")
        .select("status")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();
      const { data: outgoingUser } = await ctx.supabase
        .from("users")
        .select("email")
        .eq("id", input.userId)
        .maybeSingle();
      const hadChatAccess =
        outgoing?.status === "in" && !!outgoingUser?.email;

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

      // Organizer chat sees every removal regardless of status.
      await postSystemMessage({
        tripId: ctx.tripId,
        visibility: "planning",
        text: `${displayName} was removed from the trip`,
      });
      // Crew chat only sees removals of members who actually had access
      // to the crew chat (status='in' AND had an email/account).
      if (hadChatAccess) {
        await postSystemMessage({
          tripId: ctx.tripId,
          visibility: "crew",
          text: `${displayName} was removed from the trip`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // notifyInviteAccepted — fired by the invite-acceptance flow once the
  // signed-up user has been linked into trip_members with status='in'.
  // Posts the "X joined the trip" lifecycle message to Crew chat so the
  // rest of the crew sees the new arrival.
  //
  // Self-call only: the caller must be the user whose invite was just
  // accepted, and they must already be a member of the trip. We don't
  // re-validate the invite token here — that lives in the invite page.
  // -----------------------------------------------------------------------
  notifyInviteAccepted: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx }) => {
      const displayName = await getDisplayName(ctx.supabase, ctx.user!.id);
      await postSystemMessage({
        tripId: ctx.tripId,
        visibility: "crew",
        text: `${displayName} joined the trip`,
      });
      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // inviteByEmail — Planner/Owner can invite someone by email.
  //   - If a real account exists: adds them to the trip + sends notification
  //   - If no account: creates guest row + invites row + sends invite email
  // -----------------------------------------------------------------------
  inviteByEmail: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        email: z.string().email(),
        role: z.enum(["Planner", "Member"]).default("Planner"),
        /**
         * Optional caller-supplied display name. Used only when the
         * invite path creates a brand-new guest user (Path B). Path A
         * (existing-account add) ignores it — the existing user's
         * stored name stays authoritative. Surfaced so the new Add
         * Crew Member modal can carry the user's typed name through.
         */
        name: z.string().min(1).max(100).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      // Fetch inviter name and trip name for email content
      const [inviterResult, tripResult] = await Promise.all([
        ctx.supabase.from("users").select("name, nickname").eq("id", ctx.user!.id).single(),
        ctx.supabase.from("trips").select("title").eq("id", ctx.tripId).single(),
      ]);
      const inviterName = inviterResult.data?.nickname ?? inviterResult.data?.name ?? "Someone";
      const tripName = tripResult.data?.title ?? "a trip";

      // Check if a real (non-guest) account exists for this email
      const { data: existing } = await ctx.supabase
        .from("users")
        .select("id, name, nickname, is_guest")
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
          const displayName = existing.nickname ?? existing.name ?? email;
          return { status: "already_member" as const, displayName };
        }

        // Add to trip with status 'in'. Visibility floor pins them at
        // NOW so they don't see prior Crew chat history (and prior
        // Organizers chat if they're added as a Planner).
        //
        // Trip-local display_name override: write what the caller typed
        // (if anything) so the typed value beats the linked account's
        // global name. Spec 1.2 — display name typed by user is always
        // preserved.
        const now = new Date().toISOString();
        const trimmedTypedName = input.name?.trim();
        await ctx.supabase.from("trip_members").insert({
          trip_id: ctx.tripId,
          user_id: existing.id,
          role: input.role,
          status: "in",
          chat_visible_from: now,
          ...(input.role === "Planner" ? { planning_visible_from: now } : {}),
          ...(trimmedTypedName ? { display_name: trimmedTypedName } : {}),
        });

        // Lifecycle system messages.
        //   Crew chat → status='in' on this path (they have a real
        //   account so they joined immediately), wording is "joined".
        //   Organizer chat → "added" regardless, plus "made an organizer"
        //   when role=Planner.
        const memberDisplayName =
          existing.nickname ?? existing.name ?? email.split("@")[0];
        await postSystemMessage({
          tripId: ctx.tripId,
          visibility: "planning",
          text: `${memberDisplayName} was added to the trip`,
        });
        await postSystemMessage({
          tripId: ctx.tripId,
          visibility: "crew",
          text: `${memberDisplayName} joined the trip`,
        });
        if (input.role === "Planner") {
          await postSystemMessage({
            tripId: ctx.tripId,
            visibility: "planning",
            text: `${memberDisplayName} was made an organizer`,
          });
        }

        // Send notification email (best effort — don't fail on email error)
        try {
          const { sendInviteExistingUser } = await import("@/lib/email");
          await sendInviteExistingUser({
            toEmail: email,
            toName: existing.nickname ?? existing.name ?? email.split("@")[0],
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
          const memberName = existing.nickname ?? existing.name ?? email;

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
          // Use the caller-supplied name when present (preserves what the
          // user typed in the Add Crew Member modal); fall back to the
          // email-stem so existing call sites that omit `name` keep their
          // old behaviour.
          name: input.name?.trim() ?? email.split("@")[0],
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
        const displayName = existing?.nickname ?? existing?.name ?? email;
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

      // Add to trip_members with status 'invited'. Visibility floor
      // pins them at NOW for the same reason as Path A. Display-name
      // override carries the typed name so the crew list shows what
      // the inviter wrote.
      const inviteNow = new Date().toISOString();
      const trimmedTypedNameB = input.name?.trim();
      await ctx.supabase.from("trip_members").insert({
        trip_id: ctx.tripId,
        user_id: guestUserId,
        role: input.role,
        status: "invited",
        chat_visible_from: inviteNow,
        ...(input.role === "Planner"
          ? { planning_visible_from: inviteNow }
          : {}),
        ...(trimmedTypedNameB ? { display_name: trimmedTypedNameB } : {}),
      });

      // Lifecycle system message — Organizer chat only. The invitee
      // hasn't accepted yet so they have no access to crew chat, and
      // crew chat shouldn't surface invite traffic. A "joined" message
      // will land in crew chat once they accept (see
      // tripMembers.notifyInviteAccepted).
      const inviteeName =
        input.name?.trim() ??
        existing?.nickname ??
        existing?.name ??
        email.split("@")[0];
      await postSystemMessage({
        tripId: ctx.tripId,
        visibility: "planning",
        text: `${inviteeName} was invited to the trip`,
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
  // selected subset of crew members. Updates last_invited_at per recipient
  // and last_blast_sent_at on the trip.
  // -----------------------------------------------------------------------
  sendInvitationBlast: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        memberUserIds: z.array(z.string()).min(1),
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
        .select("name, nickname")
        .eq("id", ctx.user!.id)
        .single();
      const ownerName = owner?.nickname ?? owner?.name ?? "Your host";

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
        .select("id, name, nickname, email")
        .in("id", verifiedIds);

      // Build invitation message (custom or canned default)
      const { buildCannedInvitation } = await import("@/lib/invitationDefault");
      const invitationMessage = trip.about_message?.trim() || buildCannedInvitation(trip);

      const { sendInvitationBlast: sendBlast } = await import("@/lib/email");
      const now = new Date().toISOString();
      const sentIds: string[] = [];

      for (const user of users ?? []) {
        if (!user.email) continue;
        try {
          await sendBlast({
            toEmail: user.email,
            toName: user.nickname ?? user.name ?? user.email.split("@")[0],
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

      // Update last_invited_at for each successfully sent recipient
      if (sentIds.length > 0) {
        await ctx.supabase
          .from("trip_members")
          .update({ last_invited_at: now })
          .eq("trip_id", ctx.tripId)
          .in("user_id", sentIds);
      }

      // Update trip.last_blast_sent_at
      await ctx.supabase
        .from("trips")
        .update({ last_blast_sent_at: now })
        .eq("id", ctx.tripId);

      return { sent: sentIds.length };
    }),

  // -----------------------------------------------------------------------
  // setDisplayName — sets the trip-local display_name override on a
  // member row. Spec: CC_MODAL_AUDIT.md Part 1.4.
  //
  // Permissions:
  //   - Anyone can edit their own row (own user_id, "I want to be called
  //     X on this trip")
  //   - canEdit (Owner/Planner) can edit anyone else's display name
  // -----------------------------------------------------------------------
  setDisplayName: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        /** Pass null/empty to clear the override and fall back to global. */
        displayName: z.string().max(100).nullable(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const isSelf = input.userId === ctx.user!.id;
      if (!isSelf) {
        const role = ctx.membershipCache.get(ctx.tripId);
        if (role !== "Owner" && role !== "Planner") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only organizers can edit another member's display name.",
          });
        }
      }

      const normalized = input.displayName?.trim();
      const value = normalized && normalized.length > 0 ? normalized : null;

      const { error } = await ctx.supabase
        .from("trip_members")
        .update({ display_name: value })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update display name: ${error.message}`,
        });
      }

      return { success: true, displayName: value };
    }),

  // -----------------------------------------------------------------------
  // resendInvite — re-emails an already-invited member (status = 'invited').
  // Used by the Invited-row "Resend invite" action in the new CrewTab.
  //
  // Issues a fresh row in `invites` (new token) and emails it. Bumps
  // `trip_members.last_invited_at` so the UI can show "Resent moments ago".
  // -----------------------------------------------------------------------
  resendInvite: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Look up the member + their email
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("status, role")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }
      if (member.status !== "invited") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Member is not in an invited state.",
        });
      }

      const { data: user } = await ctx.supabase
        .from("users")
        .select("email, name, nickname")
        .eq("id", input.userId)
        .maybeSingle();

      if (!user?.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Member has no email on record.",
        });
      }

      // Inviter + trip name for email content
      const [inviterResult, tripResult] = await Promise.all([
        ctx.supabase.from("users").select("name, nickname").eq("id", ctx.user!.id).single(),
        ctx.supabase.from("trips").select("title").eq("id", ctx.tripId).single(),
      ]);
      const inviterName = inviterResult.data?.nickname ?? inviterResult.data?.name ?? "Someone";
      const tripName = tripResult.data?.title ?? "a trip";

      // Issue a new invite row + token (the old one is left as-is for
      // audit; nothing prevents both being valid until they're claimed).
      const { data: invite, error: inviteError } = await ctx.supabase
        .from("invites")
        .insert({
          trip_id: ctx.tripId,
          email: user.email,
          role: member.role,
          created_by: ctx.user!.id,
        })
        .select("token")
        .single();

      if (inviteError || !invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to issue invite token.",
        });
      }

      // Send the email — best-effort; we don't want a transient SMTP
      // hiccup to nuke the timestamp update below.
      try {
        const { sendInviteNewUser } = await import("@/lib/email");
        await sendInviteNewUser({
          toEmail: user.email,
          inviterName,
          tripName,
          token: invite.token,
        });
      } catch {
        // swallow — keep UX optimistic
      }

      // Stamp last_invited_at so the row can show "Resent moments ago"
      await ctx.supabase
        .from("trip_members")
        .update({ last_invited_at: new Date().toISOString() })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId);

      return { success: true };
    }),

});
