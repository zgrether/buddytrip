"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { MapPin } from "lucide-react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";

/** US states TopoJSON (10m resolution) from us-atlas CDN */
const US_GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

/** US bounding box — used to detect whether coords are within the US */
const US_BOUNDS = { lonMin: -125, lonMax: -66, latMin: 24, latMax: 50 };

interface LocationHeroProps {
  /** Location string used to derive the gradient color and geocode the pin */
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

async function geocodeLocation(query: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const data: Array<{ lon: string; lat: string }> = await res.json();
    if (!data.length) return null;
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } catch {
    return null;
  }
}

function isWithinUS(coords: [number, number]): boolean {
  const [lon, lat] = coords;
  return (
    lon >= US_BOUNDS.lonMin &&
    lon <= US_BOUNDS.lonMax &&
    lat >= US_BOUNDS.latMin &&
    lat <= US_BOUNDS.latMax
  );
}

/**
 * A hero card that shows a US state-border SVG map with a pin on the destination city.
 * Falls back to a gradient card for non-US or unrecognised locations.
 */
export function LocationHero({ location, tripName, children }: LocationHeroProps) {
  const hueSource = location || tripName;
  const hue = hashToHue(hueSource.toLowerCase());
  const { city, region } = parseLocation(location);

  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [geocodeDone, setGeocodeDone] = useState(false);

  useEffect(() => {
    if (!location) {
      setGeocodeDone(true);
      return;
    }
    const query = region ? `${city}, ${region}` : city;
    let cancelled = false;
    geocodeLocation(query).then((result) => {
      if (cancelled) return;
      setCoords(result && isWithinUS(result) ? result : null);
      setGeocodeDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [location, city, region]);

  const showUSMap = geocodeDone && coords !== null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 30) % 360}, 45%, 25%) 100%)`,
      }}
      data-testid="location-hero"
    >
      {/* US state-border map overlay */}
      {showUSMap && (
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <ComposableMap
            projection="geoAlbersUsa"
            style={{ width: "100%", height: "100%" }}
          >
            <Geographies geography={US_GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    style={{
                      default: {
                        fill: "rgba(255,255,255,0.08)",
                        stroke: "rgba(255,255,255,0.45)",
                        strokeWidth: 0.6,
                        outline: "none",
                      },
                      hover: {
                        fill: "rgba(255,255,255,0.08)",
                        stroke: "rgba(255,255,255,0.45)",
                        strokeWidth: 0.6,
                        outline: "none",
                      },
                      pressed: {
                        fill: "rgba(255,255,255,0.08)",
                        stroke: "rgba(255,255,255,0.45)",
                        strokeWidth: 0.6,
                        outline: "none",
                      },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* City pin */}
            <Marker coordinates={coords}>
              {/* Outer ring */}
              <circle r={6} fill="rgba(0,212,170,0.3)" stroke="#00d4aa" strokeWidth={1.5} />
              {/* Center dot */}
              <circle r={3} fill="#00d4aa" />
            </Marker>
          </ComposableMap>
        </div>
      )}

      {/* Fallback large pin icon (shown while geocoding or for non-US locations) */}
      {!showUSMap && (
        <MapPin
          size={140}
          className="pointer-events-none absolute -right-4 -top-4 opacity-[0.08]"
          style={{ color: "#fff" }}
          aria-hidden="true"
        />
      )}

      <div className="relative z-10 px-5 pb-5 pt-5">
        {children}
      </div>
    </div>
  );
}
