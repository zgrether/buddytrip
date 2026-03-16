"use client";

import { MapPin, Calendar } from "lucide-react";
import { StatusBadge, type TripStatus } from "@/components/StatusBadge";

interface LocationHeroProps {
  tripName: string;
  status: TripStatus;
  location?: string | null;       // display location (locked or trip.location)
  lockedTitle?: string | null;     // locked destination title
  dateRange?: string;              // formatted date range string
  description?: string | null;
}

/**
 * Generates a consistent hue from a string via simple hash.
 * Same destination always produces the same color.
 */
function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function parseLocation(location: string): { city: string; region: string } {
  const parts = location.split(",").map((s) => s.trim());
  return {
    city: parts[0] || location,
    region: parts.slice(1).join(", ") || "",
  };
}

export function LocationHero({
  tripName,
  status,
  location,
  lockedTitle,
  dateRange,
  description,
}: LocationHeroProps) {
  // Use location for gradient hue, fall back to trip name
  const hueSource = location ?? tripName;
  const hue = hashToHue(hueSource.toLowerCase());
  const parsed = location ? parseLocation(location) : null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 30) % 360}, 45%, 25%) 100%)`,
      }}
    >
      {/* Subtle pin icon background */}
      <MapPin
        size={140}
        className="absolute -right-4 -top-4 opacity-[0.08]"
        style={{ color: "#fff" }}
      />

      <div className="relative z-10 px-5 pb-5 pt-5">
        {/* City name large if we have a location */}
        {parsed && (
          <div className="mb-3">
            <p className="text-2xl font-bold text-white">{parsed.city}</p>
            {parsed.region && (
              <p className="mt-0.5 text-sm font-medium text-white/60">{parsed.region}</p>
            )}
          </div>
        )}

        {/* Divider between city and trip info */}
        {parsed && (
          <div className="mb-3 border-t border-white/15" />
        )}

        {/* Trip title + status */}
        <div className="flex items-center gap-2">
          <h1
            data-testid="trip-title"
            className="text-lg font-bold text-white"
          >
            {tripName}
          </h1>
          <StatusBadge status={status} />
        </div>

        {/* Destination + dates sub-line */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-white/60">
          {lockedTitle ? (
            <span className="flex items-center gap-1">
              <MapPin size={11} />
              {lockedTitle}
              {location && location !== lockedTitle && `, ${location}`}
            </span>
          ) : location ? (
            <span className="flex items-center gap-1">
              <MapPin size={11} />
              {location}
            </span>
          ) : (
            <span className="text-white/40">Destination: TBD</span>
          )}

          {dateRange && dateRange !== "Dates TBD" ? (
            <span className="flex items-center gap-1">
              <Calendar size={11} />
              {dateRange}
            </span>
          ) : (
            <span className="text-white/40">Dates: TBD</span>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="mt-2 text-xs text-white/50">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
