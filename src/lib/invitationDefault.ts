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
