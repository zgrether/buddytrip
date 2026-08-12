"use client";

import { MapPin, Calendar, Trophy } from "lucide-react";
import { useTheme } from "next-themes";
import { getLocationInfo } from "@/lib/locationUtils";
import { getTripCountdown } from "@/lib/tripCountdown";
import { Spinner } from "@/components/Spinner";

/**
 * A trip in the desktop rail's list column.
 *
 * ── Composition, not reimplementation ───────────────────────────────────────
 * Every element here already existed on the mobile `TripCard` and is reached
 * through the same shared modules: `getLocationInfo` for the state silhouette,
 * its own city pin and the Albers rotation correction; `getTripCountdown` for the
 * countdown; `trip.hasCompetition` for the trophy. A 246px column can't be a card,
 * but the gap between the two used to be far wider than the space forced — the
 * rail carried a two-letter tile, a name and a location, and nothing else.
 *
 * ── Role is one bit, carried on TWO channels ────────────────────────────────
 * "Is this mine to run" — `myRole !== "Member"`, which is Owner OR Organizer.
 * Both mean you can act, and the difference isn't worth a row's width, so the
 * three-state badge collapses to one bit.
 *
 * That bit is carried by an amber 3px edge AND by the title's colour (full
 * `--color-bt-text` for yours, `--color-bt-text-dim` for trips you're only in).
 * The second channel is deliberate: 3px of amber with no label puts "can I act
 * here" on hue alone, which is the one cue that fails for the colour-blind, and a
 * key is read once while the edge is read every time. Lightness carries it
 * independently of hue, costs no horizontal space, and reinforces the edge
 * instead of competing with the trophy mark or the countdown band for a slot.
 *
 * ── Contraction drops the ART first ─────────────────────────────────────────
 * The name is what you scan for; the silhouette is recognition support. Name,
 * location, dates and countdown all survive at the contracted width.
 */

export interface RailTrip {
  id: string;
  title: string;
  location?: string | null;
  locked_destination_location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_at?: string | null;
  myRole?: string | null;
  hasCompetition?: boolean | null;
}

/** Same short form the card uses: "Sep 9 – 13", collapsing a shared month. */
function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "Dates TBD";
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };
  if (start && end) {
    const a = fmt(start);
    const b = fmt(end);
    // "Sep 9 – 13" rather than "Sep 9 – Sep 13" when the month is shared.
    const [am] = a.split(" ");
    const [bm, bd] = b.split(" ");
    return am === bm ? `${a} – ${bd}` : `${a} – ${b}`;
  }
  return fmt((start ?? end)!);
}

export function RailTripRow({
  trip,
  current,
  pending,
  expanded,
  onOpen,
}: {
  trip: RailTrip;
  current: boolean;
  pending: boolean;
  /** Expanded shows the art; contracted drops it (and only it). */
  expanded: boolean;
  onOpen: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const dest = trip.locked_destination_location ?? trip.location ?? "";
  const { outline, cityPin, showPin, rotation } = getLocationInfo(dest);
  const mine = trip.myRole === "Owner" || trip.myRole === "Organizer";

  // `idea` / `no_dates` return no countdown, which is what keeps a dateless trip
  // from growing an empty band. Ideas don't reach this list at all, but a locked
  // trip with no dates does.
  const result = getTripCountdown(trip.start_date, trip.end_date, !trip.locked_destination_at);
  const countdown = result.type === "idea" || result.type === "no_dates" ? null : result;

  return (
    <button
      type="button"
      aria-current={current || undefined}
      aria-busy={pending || undefined}
      onClick={onOpen}
      disabled={pending}
      data-testid="rail-trip"
      data-pending={pending || undefined}
      data-mine={mine || undefined}
      className="relative mb-1 block w-full overflow-hidden rounded-[10px] text-left transition-[background-color,border-color,transform] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)] disabled:opacity-60"
      style={{
        background: current ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        border: `1px solid ${current ? "var(--color-bt-accent-border)" : "transparent"}`,
      }}
    >
      {/* Role edge — channel one. Inset vertically so it reads as a marker on the
          row rather than a border of it. */}
      {mine && (
        <span
          aria-hidden="true"
          className="absolute left-0"
          style={{
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: "0 3px 3px 0",
            background: "var(--color-bt-warning)",
          }}
        />
      )}

      <div className="flex items-start gap-2.5 py-2.5 pl-3 pr-2.5">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px] font-semibold"
            // Role edge, channel two — see the note at the top of this file.
            style={{ color: mine ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
          >
            {trip.title}
          </div>
          {dest && (
            <div
              className="mt-[3px] flex items-center gap-1 truncate text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <MapPin size={10} className="shrink-0" />
              <span className="truncate">{dest}</span>
            </div>
          )}
          <div
            className="mt-[2px] flex items-center gap-1 truncate text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Calendar size={10} className="shrink-0" />
            <span className="truncate">{formatDateRange(trip.start_date, trip.end_date)}</span>
          </div>
        </div>

        {/* Art — silhouette + city pin + trophy. Dropped whole on contraction.
            `outline` is null for anything `getLocationInfo` can't resolve to a US
            state (international, or an unset destination), so there is no broken
            silhouette to render — the row just has no art. */}
        {expanded && (outline || trip.hasCompetition) && (
          <div className="relative w-[46px] shrink-0 self-stretch" aria-hidden="true">
            {outline && (
              <svg
                viewBox={outline.viewBox}
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="xMidYMid meet"
                style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
              >
                <path
                  d={outline.path}
                  style={{ fill: isDark ? "rgba(255,255,255,0.10)" : "var(--color-bt-state-fill)" }}
                  stroke="none"
                />
                {showPin && cityPin && (
                  <>
                    <circle cx={cityPin.x} cy={cityPin.y} r="7" fill="rgba(0,212,170,0.25)" />
                    <circle cx={cityPin.x} cy={cityPin.y} r="3.5" fill="#00d4aa" />
                  </>
                )}
              </svg>
            )}
            {trip.hasCompetition && (
              <span
                className="absolute -right-1 -top-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                  border: "1px solid var(--color-bt-accent-border)",
                }}
              >
                <Trophy size={8} strokeWidth={2.5} />
              </span>
            )}
          </div>
        )}

        {pending && <Spinner size={13} />}
      </div>

      {/* Countdown — its OWN band across the bottom, not text appended to the
          dates line. Survives contraction. */}
      {countdown && (
        <div
          className="text-center text-[10.5px] font-semibold"
          style={{
            padding: expanded ? "5px 8px" : "4px 6px",
            color: "var(--color-bt-accent)",
            background: "var(--color-bt-accent-faint)",
            borderTop: "1px solid var(--color-bt-border)",
          }}
        >
          {countdown.label}
        </div>
      )}
    </button>
  );
}

/**
 * A past trip — reduced fidelity, deliberately. Name, then `location · dates` on
 * one line: no art, no card background, muted. A finished trip is a thing you
 * navigate to occasionally, not a thing you scan; giving it the same weight as a
 * live one is what made the old list long without making it more useful.
 */
export function RailPastTripRow({
  trip,
  current,
  pending,
  onOpen,
}: {
  trip: RailTrip;
  current: boolean;
  pending: boolean;
  onOpen: () => void;
}) {
  const dest = trip.locked_destination_location ?? trip.location ?? "";
  const meta = [dest, formatDateRange(trip.start_date, trip.end_date)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      aria-current={current || undefined}
      aria-busy={pending || undefined}
      onClick={onOpen}
      disabled={pending}
      data-testid="rail-trip-past"
      className="mb-0.5 block w-full rounded-[10px] px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-bt-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)] disabled:opacity-60"
      style={{ background: current ? "var(--color-bt-accent-faint)" : undefined }}
    >
      <div className="truncate text-[12.5px] font-semibold" style={{ color: "var(--color-bt-text-dim)" }}>
        {trip.title}
      </div>
      {meta && (
        <div className="truncate text-[10.5px]" style={{ color: "var(--color-bt-text-dim)", opacity: 0.8 }}>
          {meta}
        </div>
      )}
    </button>
  );
}
