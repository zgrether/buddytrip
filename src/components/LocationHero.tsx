"use client";

import type { ReactNode } from "react";
import { MapPin } from "lucide-react";

interface LocationHeroProps {
  /** Location string used to derive the gradient color */
  location: string;
  /** Trip name, used as fallback for hue if location is empty */
  tripName: string;
  /** Content rendered inside the hero card */
  children: ReactNode;
}

/**
 * Generates a consistent hue from a string via simple hash.
 * Same destination always produces the same color.
 */
export function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function parseLocation(location: string): { city: string; region: string } {
  const parts = location.split(",").map((s) => s.trim());
  return {
    city: parts[0] || location,
    region: parts.slice(1).join(", ") || "",
  };
}

/**
 * A visual gradient card with a subtle pin icon background.
 * The gradient hue is deterministic — same location = same color.
 * Content is passed via children so TripHeader can compose freely.
 */
export function LocationHero({ location, tripName, children }: LocationHeroProps) {
  const hueSource = location || tripName;
  const hue = hashToHue(hueSource.toLowerCase());

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 30) % 360}, 45%, 25%) 100%)`,
      }}
      data-testid="location-hero"
    >
      {/* Subtle pin icon background */}
      <MapPin
        size={140}
        className="absolute -right-4 -top-4 opacity-[0.08]"
        style={{ color: "#fff" }}
      />

      <div className="relative z-10 px-5 pb-5 pt-5">
        {children}
      </div>
    </div>
  );
}
