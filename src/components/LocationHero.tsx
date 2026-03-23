"use client";

import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { getLocationInfo } from "@/lib/locationUtils";
import { temporalGradient } from "@/lib/temporalGradient";

interface LocationHeroProps {
  /** Location string used to derive the gradient color and state watermark */
  location: string;
  /** Trip name, used as fallback for hue if location is empty */
  tripName: string;
  /** Trip start date — drives the temporal gradient color temperature */
  tripStartDate?: string | null;
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
 * A hero card showing a gradient background with a semi-transparent SVG
 * outline of the destination state and a pin on the city (US only).
 * Falls back to a subtle large pin icon for unrecognised/international locations.
 */
export function LocationHero({ location, tripName, tripStartDate, children }: LocationHeroProps) {
  const { resolvedTheme } = useTheme();
  const { outline, cityPin, showPin, rotation } = getLocationInfo(location);

  const isDark = resolvedTheme === "dark";

  // Dark mode: temporal gradient background with state watermark
  // Light mode: white card with accent left border — no washed-out gradient
  const darkStyle = {
    background: temporalGradient(tripStartDate ?? null, true),
    boxShadow: "var(--shadow-raised)",
  };
  const lightStyle = {
    background: "var(--color-bt-card)",
    borderLeft: "4px solid var(--color-bt-accent)",
    boxShadow: "var(--shadow-raised)",
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={isDark ? darkStyle : lightStyle}
      data-testid="location-hero"
    >
      {/* State outline watermark */}
      {outline ? (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 flex w-[55%] items-center justify-end overflow-hidden"
          aria-hidden="true"
        >
          <svg
            viewBox={outline.viewBox}
            className="mr-3 h-[85%] w-auto max-w-full"
            preserveAspectRatio="xMidYMid meet"
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          >
            <path
              d={outline.path}
              style={{
                fill: isDark ? "rgba(255,255,255,0.10)" : "var(--color-bt-state-fill)",
              }}
              stroke="none"
            />
            {showPin && cityPin && (
              <>
                <circle cx={cityPin.x} cy={cityPin.y} r="6" fill="rgba(0,212,170,0.30)" />
                <circle cx={cityPin.x} cy={cityPin.y} r="3" fill="#00d4aa" />
              </>
            )}
          </svg>
        </div>
      ) : (
        /* Fallback: subtle MapPin outline for unrecognised / international locations */
        <svg
          className="pointer-events-none absolute -right-4 -top-4 opacity-[0.08]"
          aria-hidden="true"
          width="140"
          height="140"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      )}

      <div className="relative z-10 px-5 pb-5 pt-5">
        {children}
      </div>
    </div>
  );
}
