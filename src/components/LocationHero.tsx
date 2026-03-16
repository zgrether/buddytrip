"use client";

import { MapPin } from "lucide-react";

interface LocationHeroProps {
  location: string; // "Bandon Dunes, OR" or "Scottsdale, AZ"
  tripName: string;
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

export function LocationHero({ location, tripName }: LocationHeroProps) {
  const hue = hashToHue(location.toLowerCase());
  const { city, region } = parseLocation(location);

  return (
    <div
      className="relative overflow-hidden rounded-xl px-5 py-6"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 30) % 360}, 45%, 25%) 100%)`,
      }}
    >
      {/* Subtle pin icon background */}
      <MapPin
        size={120}
        className="absolute -right-4 -top-4 opacity-10"
        style={{ color: "#fff" }}
      />

      <div className="relative z-10">
        <p className="text-2xl font-bold text-white">{city}</p>
        {region && (
          <p className="mt-0.5 text-sm font-medium text-white/70">{region}</p>
        )}
        <p className="mt-2 text-xs font-medium text-white/50">{tripName}</p>
      </div>
    </div>
  );
}
