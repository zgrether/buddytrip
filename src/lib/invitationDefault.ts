import { formatDateRange } from "@/lib/dates";

/**
 * Short-and-sweet single-paragraph invitation built from trip fields —
 * shown on the going-stage Home tab when the owner hasn't saved a custom
 * message. Falls back gracefully when a field is missing.
 */
export function buildCannedInvitation(trip: {
  title?: string | null;
  location?: string | null;
  /** Real-world location string ("Bandon, OR"); preferred over the cute idea title. */
  locked_destination_location?: string | null;
  locked_destination_title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}): string {
  const title = trip.title ?? "";
  // Prefer the geographic location over the idea title — "join me in Bandon, OR"
  // reads better than "join me in Bandon Dunes" for an invitation.
  const destination =
    trip.locked_destination_location?.trim() ||
    trip.locked_destination_title?.trim() ||
    trip.location?.trim() ||
    "";
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  const headline = title || destination || "Our trip";
  const where = destination && destination !== title ? ` in ${destination}` : "";
  const when = dateRange ? ` ${dateRange}` : "";
  if (!where && !when) {
    return `${headline} is on. Let me know if you're in.`;
  }
  return `${headline}${where}${when}. Let me know if you're in.`;
}

/**
 * Planning-stage invitation — used in the idea zone when the owner is still
 * deciding where to go and wants help shaping the trip. Unlike
 * buildCannedInvitation (a "it's on, are you in?" confirmation vibe), this
 * reads as "I'm starting to plan a trip and could use your help" so invitees
 * understand they're being pulled in to brainstorm and vote, not RSVP to a
 * settled plan.
 */
export function buildPlanningInvitation(trip: {
  title?: string | null;
}): string {
  const title = trip.title?.trim() || "";
  const tripName = title || "a trip";
  return `Hey! I'm starting to plan ${tripName} and could use your help deciding where we should go. Jump in to add ideas, vote on your favorites, and help shape the trip before we lock it in.`;
}
