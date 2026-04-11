import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

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
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .select("id, trip_id, user_id, role, status, rsvp_status, joined_at, travel_mode, travel_detail, flight_airline, flight_number, flight_arrival_time, flight_airport, travel_shared")
        .eq("trip_id", ctx.tripId)
        .order("joined_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch members",
        });
      }

      const rows = data ?? [];
      const userIds = rows.map((m) => m.user_id).filter(Boolean) as string[];

      const usersResult = userIds.length > 0
        ? await ctx.supabase.from("users").select("id, name, nickname, email, is_guest").in("id", userIds)
        : { data: [] as { id: string; name: string | null; nickname: string | null; email: string | null; is_guest: boolean }[] };

      const userMap = new Map((usersResult.data ?? []).map((u) => [u.id, u]));

      return rows.map((m) => {
        const user = m.user_id ? (userMap.get(m.user_id) ?? null) : null;
        const isGuest = user?.is_guest ?? false;
        const memberId = m.user_id as string;
        const displayName = user
          ? (user.nickname ?? user.name ?? user.email ?? `User ${memberId.slice(0, 6)}`)
          : `Unknown ${memberId.slice(0, 6)}`;

        return {
          ...m,
          user,
          memberId,
          isGuest,
          displayName,
        };
      });
    }),

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

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .insert({
          id: crypto.randomUUID(),
          trip_id: ctx.tripId,
          user_id: input.userId,
          role: input.role,
          status: input.status,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add member: ${error.message}`,
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

        // Add to trip with status 'in'
        await ctx.supabase.from("trip_members").insert({
          trip_id: ctx.tripId,
          user_id: existing.id,
          role: input.role,
          status: "in",
        });

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

      // Add to trip_members with status 'invited'
      await ctx.supabase.from("trip_members").insert({
        trip_id: ctx.tripId,
        user_id: guestUserId,
        role: input.role,
        status: "invited",
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
  // updateRsvp — any real member can update their own RSVP status
  // Ghost crew always stay "in" — no RSVP for ghosts.
  // -----------------------------------------------------------------------
  updateRsvp: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        status: z.enum(["in", "likely", "maybe", "out"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update({ status: input.status })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update RSVP",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // setRsvpStatus — member sets their own RSVP status
  // Only works when trip is in 'going' stage
  // -----------------------------------------------------------------------
  setRsvpStatus: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        rsvpStatus: z.enum(["in", "maybe", "out"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Verify trip is in going stage
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("stage, title")
        .eq("id", ctx.tripId)
        .single();

      if (!trip || trip.stage !== "going") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "RSVP can only be set when the trip is in the going stage.",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update({ rsvp_status: input.rsvpStatus })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", ctx.user!.id)
        .select("user_id, trip_id, rsvp_status")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update RSVP status",
        });
      }

      // Fire notification to owner (unless owner is setting their own RSVP)
      try {
        const { data: ownerMember } = await ctx.supabase
          .from("trip_members")
          .select("user_id")
          .eq("trip_id", ctx.tripId)
          .eq("role", "Owner")
          .single();

        if (ownerMember && ownerMember.user_id !== ctx.user!.id) {
          const { data: currentUserData } = await ctx.supabase
            .from("users")
            .select("name")
            .eq("id", ctx.user!.id)
            .single();

          const { createNotification } = await import("./notifications");
          await createNotification(ctx.supabase, {
            tripId: ctx.tripId,
            actorId: ctx.user!.id,
            recipientId: ownerMember.user_id,
            type: "rsvp_response",
            payload: {
              responder_name: currentUserData?.name ?? "Someone",
              rsvp_status: input.rsvpStatus,
              trip_name: trip.title,
              trip_id: ctx.tripId,
            },
          });
        }
      } catch {
        // Notification failure shouldn't block the mutation
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // setRsvpStatusForMember — owner/planner sets RSVP for any member
  // Used for ghost members who have no app access
  // -----------------------------------------------------------------------
  setRsvpStatusForMember: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
        rsvpStatus: z.enum(["in", "maybe", "out"]).nullable(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trip_members")
        .update({ rsvp_status: input.rsvpStatus })
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .select("user_id, trip_id, rsvp_status")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update RSVP status",
        });
      }

      return data;
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
  // nudgeCrewMember — resend RSVP email to a specific crew member
  // -----------------------------------------------------------------------
  nudgeCrewMember: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Verify trip is in going stage
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("stage, title")
        .eq("id", ctx.tripId)
        .single();

      if (!trip || trip.stage !== "going") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Trip is not in going stage." });
      }

      // Fetch target member + user data
      const { data: member } = await ctx.supabase
        .from("trip_members")
        .select("user_id, rsvp_status, users(name, email, is_guest)")
        .eq("trip_id", ctx.tripId)
        .eq("user_id", input.userId)
        .single();

      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      const user = member.users as unknown as { name: string | null; email: string | null; is_guest: boolean } | null;

      if (!user?.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Member has no email on file." });
      }

      if (member.rsvp_status === "in" || member.rsvp_status === "out") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Member has already responded." });
      }

      // Fetch inviter name
      const { data: inviter } = await ctx.supabase
        .from("users")
        .select("name, nickname")
        .eq("id", ctx.user!.id)
        .single();

      try {
        const { sendNudgeEmail } = await import("@/lib/email");
        await sendNudgeEmail({
          toEmail: user.email,
          toName: user.name ?? user.email.split("@")[0],
          inviterName: inviter?.nickname ?? inviter?.name ?? "Your trip organizer",
          tripName: trip.title,
          tripId: ctx.tripId,
        });
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send nudge email." });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // nudgeAllPending — send nudge to all pending members with email
  // -----------------------------------------------------------------------
  nudgeAllPending: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx }) => {
      // Verify trip is in going stage
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("stage, title")
        .eq("id", ctx.tripId)
        .single();

      if (!trip || trip.stage !== "going") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Trip is not in going stage." });
      }

      // Fetch all pending members (rsvp_status IS NULL) with user details
      const { data: members } = await ctx.supabase
        .from("trip_members")
        .select("user_id, rsvp_status, users(name, email, is_guest)")
        .eq("trip_id", ctx.tripId)
        .is("rsvp_status", null);

      if (!members || members.length === 0) {
        return { sent: 0, skipped: 0 };
      }

      // Fetch inviter name
      const { data: inviter } = await ctx.supabase
        .from("users")
        .select("name, nickname")
        .eq("id", ctx.user!.id)
        .single();

      const inviterName = inviter?.nickname ?? inviter?.name ?? "Your trip organizer";
      let sent = 0;
      let skipped = 0;

      const { sendNudgeEmail } = await import("@/lib/email");

      for (const member of members) {
        const user = member.users as unknown as { name: string | null; email: string | null; is_guest: boolean } | null;
        if (!user?.email) {
          skipped++;
          continue;
        }

        try {
          await sendNudgeEmail({
            toEmail: user.email,
            toName: user.name ?? user.email.split("@")[0],
            inviterName,
            tripName: trip.title,
            tripId: ctx.tripId,
          });
          sent++;
        } catch {
          skipped++;
        }
      }

      return { sent, skipped };
    }),

  // -----------------------------------------------------------------------
  // notifyCrewAboutUpdate — Owner/Planner fires in-app notifications to
  // all crew members (except themselves) about an About panel update
  // -----------------------------------------------------------------------
  notifyCrewAboutUpdate: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx }) => {
      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("stage, title")
        .eq("id", ctx.tripId)
        .single();

      if (!trip || trip.stage !== "going") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Trip is not in going stage." });
      }

      const { data: currentUser } = await ctx.supabase
        .from("users")
        .select("name")
        .eq("id", ctx.user!.id)
        .single();

      const updaterName = currentUser?.name ?? "Someone";

      // All members except the sender
      const { data: members } = await ctx.supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", ctx.tripId)
        .neq("user_id", ctx.user!.id);

      if (!members || members.length === 0) {
        return { notified: 0 };
      }

      const { createNotification } = await import("./notifications");
      let notified = 0;

      for (const member of members) {
        try {
          await createNotification(ctx.supabase, {
            tripId: ctx.tripId,
            actorId: ctx.user!.id,
            recipientId: member.user_id,
            type: "about_update",
            payload: {
              updater_name: updaterName,
              trip_name: trip.title,
              trip_id: ctx.tripId,
            },
          });
          notified++;
        } catch {
          // Notification failure for one member shouldn't stop others
        }
      }

      return { notified };
    }),
});
