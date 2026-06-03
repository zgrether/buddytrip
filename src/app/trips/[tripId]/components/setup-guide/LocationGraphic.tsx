"use client";

import { MapPin } from "lucide-react";
import { getLocationInfo } from "@/lib/locationUtils";
import { DOMAIN_COLORS } from "@/lib/domainColors";

// ── LocationGraphic ──────────────────────────────────────────────────────
//
// Stylized destination thumbnail for the FreshTripGuide welcome header.
// US locations render their state silhouette with a teal pin on the
// matching city; everywhere else falls back to a centered MapPin glyph.
// Square tile with a subtle radial glow toward the upper-right so the
// thumbnail reads as raised on the home surface.

export function LocationGraphic({
  location,
  size = 96,
}: {
  /** Trip's destination string — e.g. "Bandon, OR" or "Pinehurst, NC". */
  location: string;
  /** Square tile size in px. Defaults to 96 (desktop / tablet); the mock
   *  uses ~110 on phone-portrait. */
  size?: number;
}) {
  const accent = DOMAIN_COLORS.home.color;
  const accentFaint = DOMAIN_COLORS.home.faint;
  const { outline, cityPin, showPin, rotation } = getLocationInfo(location);

  return (
    <div
      className="relative flex flex-shrink-0 overflow-hidden rounded-2xl"
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(120% 90% at 80% 15%, color-mix(in srgb, var(--color-bt-accent) 14%, transparent) 0%, transparent 70%), var(--color-bt-base)",
        border: "1px solid var(--color-bt-border)",
      }}
      aria-hidden="true"
    >
      {outline ? (
        <svg
          viewBox={outline.viewBox}
          className="absolute inset-0 h-full w-full p-3"
          preserveAspectRatio="xMidYMid meet"
          style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
        >
          <path
            d={outline.path}
            fill="rgba(255,255,255,0.10)"
            stroke="rgba(255,255,255,0.30)"
            strokeWidth={1.2}
          />
          {showPin && cityPin && (
            <>
              {/* Glow halo */}
              <circle
                cx={cityPin.x}
                cy={cityPin.y}
                r={6}
                fill={accentFaint}
              />
              {/* Pin dot */}
              <circle
                cx={cityPin.x}
                cy={cityPin.y}
                r={3}
                fill={accent}
              />
            </>
          )}
        </svg>
      ) : (
        // International / unrecognized fallback — just a centered pin
        // with the same accent glow.
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: accent }}
        >
          <MapPin size={Math.round(size * 0.28)} strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}
