import { getEffectiveStatus, type TripDisplayStatus, type TripStatusFields } from "@/lib/tripStatus";

export type TripStatus = TripDisplayStatus;

// The visual status badge was retired — trip status now reads through the
// temporal countdown bar and surface treatment, not a discrete chip. This
// module is kept as the shared status-derivation entry point.
export function getTripStatus(trip: TripStatusFields): TripStatus {
  return getEffectiveStatus(trip);
}
