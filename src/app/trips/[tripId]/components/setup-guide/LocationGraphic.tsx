"use client";

import { useTheme } from "next-themes";
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
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
            /* THE ONLY ONE OF FOUR SILHOUETTE CONSUMERS THAT NEVER JOINED THE
             * TOKEN SYSTEM. TripCard, RailTripRow and LocationHero all resolve
             * their fill through --color-bt-state-fill; this was a white literal
             * in both modes, so on a light card it composited to a delta of
             * 2/255 against its own ground — the shape simply was not there.
             *
             * The fill now uses the siblings expression verbatim, so dark is
             * byte-identical (0.10 white) and light gets the token.
             *
             * THE STROKE IS THEMED RATHER THAN DROPPED, which is where this
             * deliberately diverges from the siblings. They are stroke="none"
             * because they are ~43x66 in a card corner, where an outline that
             * size is noise. This is the welcome tiles hero at 96px, and its
             * ground is NOT flat — a radial accent wash over the base — so the
             * outline is separating the shape from a gradient the siblings never
             * sit on. Uniformity across the four is not the goal; each rendering
             * correctly on its own surface is.
             *
             * 0.30 mirrors the dark alpha, and the mirror was measured rather
             * than assumed: delta from ground is 215 in dark against 222 in
             * light, and stroke-against-its-own-fill is 2.07 dark against 1.75
             * light. Light is the SOFTER of the two, not the harder — dropping
             * to 0.25 would take that separation to 1.53. */
            fill={isDark ? "rgba(255,255,255,0.10)" : "var(--color-bt-state-fill)"}
            stroke={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
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
