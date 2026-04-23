import { formatDateRange } from "@/lib/dates";

/**
 * Short-and-sweet single-paragraph invitation built from trip fields —
 * shown on the going-stage Home tab when the owner hasn't saved a custom
 * message. Falls back gracefully when a field is missing.
 */
export function buildCannedInvitation(trip: {
  title?: string | null;
  location?: string | null;
  locked_destination_title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}): string {
  const title = trip.title ?? "";
  const destination =
    trip.locked_destination_title?.trim() || trip.location?.trim() || "";
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  const headline = title || destination || "Our trip";
  const where = destination && destination !== title ? ` in ${destination}` : "";
  const when = dateRange ? ` ${dateRange}` : "";
  if (!where && !when) {
    return `${headline} is on. Let me know if you're in.`;
  }
  return `${headline}${where}${when}. Let me know if you're in.`;
}
