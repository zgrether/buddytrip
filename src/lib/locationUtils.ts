/**
 * Shared location-parsing utilities.
 *
 * Used by LocationHero and dashboard TripCard to extract US state info,
 * city pin coordinates, and Albers-projection rotation corrections.
 */

import { STATE_OUTLINES } from '@/data/stateOutlines';
import { CITY_PINS } from '@/data/cityPins';

// ─── US State lookup ─────────────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_NAME_TO_ABBR: Record<string, string> = {};
for (const [abbr, name] of Object.entries(US_STATES)) {
  STATE_NAME_TO_ABBR[name.toLowerCase()] = abbr;
}

// ─── Albers projection rotation corrections ─────────────────────────────────
//
// The state outlines use an Albers Equal-Area Conic projection (standard
// parallels 29.5°N / 45.5°N, central meridian 96°W).  When a state is
// rendered in isolation the projection's meridian convergence makes it look
// tilted.  The correction angle is:
//
//   θ = n × (λ − λ₀)    where n ≈ 0.6, λ₀ = −96°
//
// Applied as a CSS rotation on the SVG element to make the state look upright.

const ALBERS_N = 0.6;
const ALBERS_CENTRAL_MERIDIAN = -96;

const STATE_CENTER_LON: Record<string, number> = {
  AL: -86.8, AK: -153.4, AZ: -111.7, AR: -92.4, CA: -119.4,
  CO: -105.5, CT: -72.7, DE: -75.5, FL: -81.7, GA: -83.4,
  HI: -155.5, ID: -114.7, IL: -89.2, IN: -86.3, IA: -93.5,
  KS: -98.3, KY: -84.3, LA: -91.9, ME: -69.2, MD: -76.6,
  MA: -71.8, MI: -84.5, MN: -94.3, MS: -89.7, MO: -92.6,
  MT: -109.6, NE: -99.8, NV: -116.8, NH: -71.6, NJ: -74.7,
  NM: -106.2, NY: -75.5, NC: -79.8, ND: -100.5, OH: -82.8,
  OK: -97.4, OR: -120.5, PA: -77.8, RI: -71.5, SC: -80.9,
  SD: -100.2, TN: -86.3, TX: -99.3, UT: -111.5, VT: -72.6,
  VA: -79.4, WA: -120.7, WV: -80.6, WI: -89.8, WY: -107.6,
};

/** Rotation correction (degrees) to visually un-tilt a state from Albers. */
function getStateRotation(abbr: string): number {
  const lon = STATE_CENTER_LON[abbr];
  if (lon == null) return 0;
  return Math.round(ALBERS_N * (lon - ALBERS_CENTRAL_MERIDIAN) * 10) / 10;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function parseStateAbbr(location: string): string | null {
  if (!location) return null;
  const trimmed = location.trim();

  // ", XX" or ", xx" at end — case-insensitive (most common: "Myrtle Beach, SC")
  const commaMatch = trimmed.match(/,\s*([A-Za-z]{2})\s*$/);
  if (commaMatch) {
    const abbr = commaMatch[1].toUpperCase();
    if (US_STATES[abbr]) return abbr;
  }

  // Full state name after last comma (case-insensitive)
  const parts = trimmed.split(',');
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1].trim().toLowerCase();
    if (STATE_NAME_TO_ABBR[lastPart]) return STATE_NAME_TO_ABBR[lastPart];
    // Also check if it's a lowercase abbreviation that didn't have a comma-space pattern
    const asAbbr = lastPart.toUpperCase();
    if (asAbbr.length === 2 && US_STATES[asAbbr]) return asAbbr;
  }

  // Standalone state name
  const lower = trimmed.toLowerCase();
  if (STATE_NAME_TO_ABBR[lower]) return STATE_NAME_TO_ABBR[lower];

  // Standalone abbreviation (case-insensitive)
  if (trimmed.length === 2 && US_STATES[trimmed.toUpperCase()]) return trimmed.toUpperCase();

  return null;
}

function parseCityName(location: string): string | null {
  if (!location) return null;
  const parts = location.split(',');
  if (parts.length >= 2) return parts[0].trim().toLowerCase();
  return null;
}

/**
 * Fuzzy city pin lookup.
 *
 * Tries exact match first, then normalizes common variations:
 *  - Drop trailing "island", "beach", "city", "springs", "park"
 *  - "saint" ↔ "st."
 *  - "fort" ↔ "ft."
 *  - "mount" ↔ "mt."
 */
function lookupCityPin(raw: string): { x: number; y: number; state: string } | null {
  if (!raw) return null;

  // Exact match
  if (CITY_PINS[raw]) return CITY_PINS[raw];

  // Normalize abbreviations: saint ↔ st., fort ↔ ft., mount ↔ mt.
  let normalized = raw
    .replace(/\bsaint\b/g, 'st.')
    .replace(/\bfort\b/g, 'ft.')
    .replace(/\bmount\b/g, 'mt.');
  if (CITY_PINS[normalized]) return CITY_PINS[normalized];

  // Reverse: st. → saint, ft. → fort, mt. → mount
  normalized = raw
    .replace(/\bst\.\s*/g, 'saint ')
    .replace(/\bft\.\s*/g, 'fort ')
    .replace(/\bmt\.\s*/g, 'mount ')
    .trim();
  if (CITY_PINS[normalized]) return CITY_PINS[normalized];

  // Drop common suffixes: "hilton head island" → "hilton head"
  const suffixes = [' island', ' beach', ' city', ' springs', ' park', ' harbor', ' harbour'];
  for (const suffix of suffixes) {
    if (raw.endsWith(suffix)) {
      const trimmed = raw.slice(0, -suffix.length);
      if (CITY_PINS[trimmed]) return CITY_PINS[trimmed];
    }
  }

  return null;
}

// ─── ViewBox expansion ───────────────────────────────────────────────────────

/** Expand a viewBox to include a point, with padding. */
function expandViewBox(
  viewBox: string,
  px: number,
  py: number,
  pad = 5,
): string {
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  let x0 = vx, y0 = vy, x1 = vx + vw, y1 = vy + vh;

  if (px - pad < x0) x0 = px - pad;
  if (px + pad > x1) x1 = px + pad;
  if (py - pad < y0) y0 = py - pad;
  if (py + pad > y1) y1 = py + pad;

  if (x0 === vx && y0 === vy && x1 === vx + vw && y1 === vy + vh) {
    return viewBox; // unchanged
  }
  return `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`;
}

// ─── High-level helper ───────────────────────────────────────────────────────

export interface LocationInfo {
  stateAbbr: string | null;
  stateName: string | null;
  outline: { path: string; viewBox: string } | null;
  cityPin: { x: number; y: number; state: string } | null;
  showPin: boolean;
  rotation: number;
}

export function getLocationInfo(location: string): LocationInfo {
  const stateAbbr = parseStateAbbr(location);
  let outline = stateAbbr ? STATE_OUTLINES[stateAbbr] ?? null : null;
  const stateName = stateAbbr ? US_STATES[stateAbbr] ?? null : null;
  const cityName = parseCityName(location);
  const cityPin = cityName ? lookupCityPin(cityName) : null;

  const showPin = !!(cityPin && stateAbbr && cityPin.state === stateAbbr);
  const rotation = stateAbbr ? getStateRotation(stateAbbr) : 0;

  // Expand viewBox if pin falls outside (e.g. coastal cities on barrier islands)
  if (showPin && outline && cityPin) {
    const adjusted = expandViewBox(outline.viewBox, cityPin.x, cityPin.y);
    if (adjusted !== outline.viewBox) {
      outline = { path: outline.path, viewBox: adjusted };
    }
  }

  return { stateAbbr, stateName, outline, cityPin, showPin, rotation };
}
