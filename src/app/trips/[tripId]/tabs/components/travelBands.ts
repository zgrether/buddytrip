import { fmtTime12 } from "@/lib/dates";

// ── travelBands — time-of-day banding + chip merging ───────────────────────
//
// The pure half of the per-day travel summary (TravelGroup / TravelChip).
// No React, no tRPC, no tokens — everything here is a function of the
// ArrivalEvent / DepartureEvent list the itinerary already builds. No schema
// change, no new query, no new field.
//
// Bands are DISPLAY-ONLY buckets: nothing here is persisted, nothing is
// user-editable, and the windows stay local to this surface.

export type TravelMode = "driving" | "flying" | "other";

/** The slice of an ArrivalEvent / DepartureEvent this module reads. */
export interface TravelPerson {
  memberId: string;
  displayName: string;
  /** HH:MM (24h) or null for an untimed leg. */
  time: string | null;
  mode: TravelMode;
  subtitle?: string | null;
}

export type BandKey = "morning" | "midday" | "afternoon" | "evening" | "unset";

export interface TravelChipModel {
  /** Stable React key — the merge key itself. */
  key: string;
  time: string | null;
  mode: TravelMode;
  /** Trimmed detail text, or null. */
  detail: string | null;
  /** Rendered names ("Brad", or "Sean B." when two Seans collide here). */
  names: string[];
  /** People behind this chip — names.length, spelled out for the band count. */
  personCount: number;
}

export interface TravelBand {
  key: BandKey;
  label: string;
  /** Dim text after the count; null for "Not set", where the count stands alone. */
  window: string | null;
  /** PEOPLE in the band, not chips. */
  count: number;
  chips: TravelChipModel[];
}

export interface TravelGroupMeta {
  /** People in the whole group. */
  count: number;
  /** "9:00 AM – 7:45 PM", or null when there is no span to state. */
  range: string | null;
  /** Modes actually present, in legend order — the legend IS the icon key. */
  modes: TravelMode[];
}

interface BandDef {
  key: BandKey;
  label: string;
  window: string | null;
  /** Exclusive upper bound, minutes from midnight. */
  endMinutes: number;
}

// Fixed order; "Not set" is always last. Render only bands that have people.
const BAND_DEFS: BandDef[] = [
  { key: "morning", label: "Morning", window: "before noon", endMinutes: 12 * 60 },
  { key: "midday", label: "Midday", window: "12–2 PM", endMinutes: 14 * 60 },
  { key: "afternoon", label: "Afternoon", window: "2–6 PM", endMinutes: 18 * 60 },
  { key: "evening", label: "Evening", window: "after 6 PM", endMinutes: Number.POSITIVE_INFINITY },
];

const UNSET_BAND: BandDef = {
  key: "unset",
  label: "Not set",
  window: null,
  endMinutes: Number.POSITIVE_INFINITY,
};

/** Legend order — also the order modes are reported in. */
const MODE_ORDER: TravelMode[] = ["flying", "driving", "other"];

/** First token of a name ("Zach Grether" → "Zach"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Sean Buchanan" → "B"; a single-token name has no last initial → null. */
function lastInitial(name: string): string | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return parts[parts.length - 1].charAt(0).toUpperCase() || null;
}

/** HH:MM → minutes from midnight; null for anything unparseable or absent. */
function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const parts = time.split(":");
  const h = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Which band a time falls in. `null` (and unparseable) → "Not set". */
export function bandOf(time: string | null | undefined): BandKey {
  const mins = minutesOf(time);
  if (mins === null) return "unset";
  for (const def of BAND_DEFS) {
    if (mins < def.endMinutes) return def.key;
  }
  return "evening";
}

/**
 * Names for ONE chip. First names only; when two people inside this chip share
 * a first name, BOTH fall back to "First L." — not just the second instance,
 * which would read as though only one of them were ambiguous.
 */
function renderNames(people: TravelPerson[]): string[] {
  const firsts = people.map((p) => firstName(p.displayName));
  const counts = new Map<string, number>();
  for (const f of firsts) counts.set(f, (counts.get(f) ?? 0) + 1);
  return people.map((p, i) => {
    const f = firsts[i];
    if ((counts.get(f) ?? 0) < 2) return f;
    const initial = lastInitial(p.displayName);
    return initial ? `${f} ${initial}.` : f;
  });
}

/**
 * Merge people into chips. Two people share a chip only when they share the
 * exact stored HH:MM (no rounding), the mode, and the detail text — "SW 1403
 * from BNA" and "riding with Brad" are different facts and both stay reachable.
 * An untimed leg never merges; otherwise every TBD would collapse into one blob.
 */
function buildChips(people: TravelPerson[]): TravelChipModel[] {
  const order: string[] = [];
  const groups = new Map<string, TravelPerson[]>();

  for (const p of people) {
    const detail = p.subtitle?.trim() || "";
    const key = p.time ? `t:${p.time}|${p.mode}|${detail}` : `u:${p.memberId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(p);
    } else {
      groups.set(key, [p]);
      order.push(key);
    }
  }

  const chips = order.map((key) => {
    // Merged order is ascending by display name — the names, and the "First L."
    // fallback, are both computed off this one ordering.
    const members = [...(groups.get(key) as TravelPerson[])].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
    const first = members[0];
    return {
      key,
      time: first.time,
      mode: first.mode,
      detail: first.subtitle?.trim() || null,
      names: renderNames(members),
      personCount: members.length,
    };
  });

  // Ascending by time within the band. HH:MM is zero-padded, so a string
  // compare is chronological. Untimed chips only ever occur in "Not set",
  // where the comparator is inert and Array#sort's stability keeps source order.
  return chips.sort((a, b) => {
    if (!a.time || !b.time) return 0;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.names[0].localeCompare(b.names[0]);
  });
}

/** Band the group, dropping empty bands. "Not set" is always last. */
export function buildTravelBands(people: TravelPerson[]): TravelBand[] {
  const byBand = new Map<BandKey, TravelPerson[]>();
  for (const p of people) {
    const key = bandOf(p.time);
    const bucket = byBand.get(key);
    if (bucket) bucket.push(p);
    else byBand.set(key, [p]);
  }

  return [...BAND_DEFS, UNSET_BAND]
    .map((def) => {
      const members = byBand.get(def.key) ?? [];
      return {
        key: def.key,
        label: def.label,
        window: def.window,
        count: members.length,
        chips: buildChips(members),
      };
    })
    .filter((b) => b.count > 0);
}

/**
 * Header meta — "16 crew · 9:00 AM – 7:45 PM" plus the modes the legend keys.
 * The range is omitted when there is nothing to span: one person, no timed
 * legs at all, or everyone landing at the same minute.
 */
export function travelGroupMeta(people: TravelPerson[]): TravelGroupMeta {
  const times = people.map((p) => p.time).filter((t): t is string => !!t && minutesOf(t) !== null);
  times.sort();

  const first = times[0];
  const last = times[times.length - 1];
  const range = first && last && first !== last ? `${fmtTime12(first)} – ${fmtTime12(last)}` : null;

  const present = new Set(people.map((p) => p.mode));
  return {
    count: people.length,
    range,
    modes: MODE_ORDER.filter((m) => present.has(m)),
  };
}
