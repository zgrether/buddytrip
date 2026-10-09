import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { findOrphanBlockers, orphanRefusalMessage } from "./ownerGuard";

/**
 * Leaving a trip, or being removed from one, is an ARCHIVE (PR 8d, ruling 19).
 *
 * ONE path for both: `archive_trip_member` (migration 205), a definer function
 * that applies the roster rules, keeps finished games exactly as they are,
 * vacates seats and pick'em sheets in unfinished ones, ends cup assignments and
 * delegate grants, writes the departure record when something in the trip
 * still names the person, and ends the membership — in ONE transaction.
 *
 * It replaces the app-side clean-up (`clearTripParticipation`), which ran with
 * the CALLER's rights after a separate delete. Two problems that design could
 * not fix: a Member leaving on their own has no right to clear seats, and the
 * clean-up was best-effort, so a failed step left a person half-removed. The
 * archive cannot half-happen.
 *
 * Called with the CALLER's client on purpose: the function decides from
 * `auth.uid()` whether this is leaving (self) or removing (someone else), and
 * which roster rules apply. A service-role client would make every call look
 * like infrastructure.
 */

/** The refusals `archive_trip_member` raises, by the code it puts in the message. */
const REFUSALS = [
  "ARCHIVE_NOT_SIGNED_IN",
  "ARCHIVE_NOT_A_MEMBER",
  "ARCHIVE_OWNER_MUST_TRANSFER",
  "ARCHIVE_NOT_ALLOWED",
  "ARCHIVE_CANNOT_REMOVE_OWNER",
  "ARCHIVE_ORGANIZER_REMOVES_MEMBERS_ONLY",
] as const;
export type ArchiveRefusal = (typeof REFUSALS)[number];

/** Which refusal, if any, a database error carries. Exported for tests. */
export function archiveRefusalOf(message: string | undefined): ArchiveRefusal | null {
  if (!message) return null;
  return REFUSALS.find((r) => message.includes(r)) ?? null;
}

/**
 * The sentence for each refusal. Each names something the reader can do
 * (CLAUDE.md: a refusal must name an action that exists).
 *
 * The Owner's is built from `findOrphanBlockers` when it applies, so leaving
 * and account deletion say the same thing about the same trip — including the
 * case where there is nobody to transfer to, where "transfer first" would be a
 * dead end. A trip with a second Owner has no orphan blocker, and the archive
 * still refuses (an Owner never leaves, ruling 3); that case gets the plain
 * sentence, pointing at the transfer `TripSettingsModal` offers.
 */
async function refusalMessage(
  supabase: SupabaseClient,
  refusal: ArchiveRefusal,
  tripId: string,
  userId: string
): Promise<{ code: TRPCError["code"]; message: string }> {
  switch (refusal) {
    case "ARCHIVE_NOT_SIGNED_IN":
      return { code: "UNAUTHORIZED", message: "Sign in to do that." };
    case "ARCHIVE_NOT_A_MEMBER":
      return { code: "NOT_FOUND", message: "That person isn't on this trip." };
    case "ARCHIVE_OWNER_MUST_TRANSFER":
      return { code: "PRECONDITION_FAILED", message: await ownerLeaveRefusal(supabase, tripId, userId) };
    case "ARCHIVE_NOT_ALLOWED":
      return { code: "FORBIDDEN", message: "Only the trip's owner or an organizer can remove people." };
    case "ARCHIVE_CANNOT_REMOVE_OWNER":
      return { code: "FORBIDDEN", message: "The trip's owner can't be removed." };
    case "ARCHIVE_ORGANIZER_REMOVES_MEMBERS_ONLY":
      return {
        code: "FORBIDDEN",
        message:
          "Only the trip owner can remove an organizer. Ask the owner to remove them, or to change their role to Member first.",
      };
  }
}

/**
 * Why the Owner cannot leave, and what to do instead — the ONE sentence for it,
 * shown both by the refusal above and BEFORE the attempt (`tripMembers.leaveCheck`,
 * which the Leave trip button reads), so the two can never say different things.
 */
export async function ownerLeaveRefusal(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<string> {
  const blockers = await findOrphanBlockers(supabase, userId, { tripId });
  return blockers.length > 0
    ? orphanRefusalMessage(blockers, "leave-trip")
    : "You own this trip. Transfer ownership in Trip settings first, then leave.";
}

/**
 * Archive one membership. Throws a readable `TRPCError` for every refusal;
 * any other failure is a 500 that changed nothing (the function is one
 * transaction).
 */
export async function archiveTripMember(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase.rpc("archive_trip_member", {
    p_trip_id: tripId,
    p_user_id: userId,
  });
  if (!error) return;

  const refusal = archiveRefusalOf(error.message);
  if (refusal) {
    const { code, message } = await refusalMessage(supabase, refusal, tripId, userId);
    throw new TRPCError({ code, message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "That couldn't be saved. Nothing changed — try again.",
    cause: error,
  });
}
