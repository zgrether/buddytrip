"use client";

import { MapPin, Calendar, Trophy } from "lucide-react";
import { useTheme } from "next-themes";
import { getLocationInfo } from "@/lib/locationUtils";
import { getTripCountdown } from "@/lib/tripCountdown";
import { Spinner } from "@/components/Spinner";
import { ROLE_COLOR, badgedRole } from "@/lib/roleColor";

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
 * ── Role is TWO edges, matching the badges ──────────────────────────────────
 * This used to be ONE amber edge meaning "Owner or Organizer", on the argument
 * that both mean you can act and the difference isn't worth a row's width. That
 * flattened a distinction the rest of the app preserves — the trip header, the
 * dashboard card and the crew roster all show three states — and it left the key
 * needing a word for the grouping, which is where "Admin" came from: a name for
 * a rights tier this app does not have.
 *
 * So: amber Owner, blue Organizer, from `@/lib/roleColor` — the SAME values
 * `RoleBadge` and `RolePill` paint, so the two surfaces agree by construction
 * rather than by inspection. Organizer is blue rather than the accent because at
 * 3px a teal band competes with the selected-row treatment and the trophy mark,
 * both already teal on this very row; the colour history is in `roleColor.ts`.
 *
 * The TITLE COLOUR stays one bit (`--color-bt-text` if either, `-text-dim` if
 * neither) and that asymmetry is deliberate. It is the redundant channel for
 * "can I act here", which is the question that has a yes/no answer; putting the
 * three-state distinction on lightness too would need a third text colour, and
 * the reason a second channel exists at all is that 3px of hue with no label is
 * the one cue that fails for the colour-blind. Which role, in colour, is a
 * refinement; whether it's yours to run is the part that must not depend on hue.
 *
 * ── Contraction drops the ART first ─────────────────────────────────────────
 * The name is what you scan for; the silhouette is recognition support. Name,
 * location, dates and countdown all survive at the contracted width.
 *
 * ── Titles WRAP to two lines, then truncate ─────────────────────────────────
 * `line-clamp-2`, not `truncate`. A single clamped line makes a long name a
 * width REQUIREMENT — "International Federation of Having Fun 2026" measures
 * wider than any sensible rail, and #902 found a 38-character name froze the
 * drag entirely, because the floor was derived from the widest untruncated
 * name and so landed above the ceiling. Two lines is roughly twice the
 * characters at half the width, and it changes what the floor is allowed to
 * be: a wrapping name's real minimum is its longest WORD, not the whole
 * string, which is what `ContextRail.measureFloor` now measures. The floor
 * stops being hostage to the longest name.
 *
 * `break-words` is the fallback for the one case wrapping can't help — a
 * single unbreakable token wider than the column. Without it the clamp's
 * `overflow: hidden` clips it mid-glyph with no ellipsis.
 *
 * NOTHING OVERLAPS when the row grows, and each element is a separate reason:
 * the art is `self-stretch` inside an `items-start` flex row, so it grows with
 * the text column and its `preserveAspectRatio` silhouette scales rather than
 * distorts; the countdown is its own block BELOW that row, so it is pushed
 * down; the role edge is `top: 8 / bottom: 8` absolute, so it spans whatever
 * height the row ends up with. All three were already written against the
 * row's height rather than a fixed one.
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
  /** Candidates under consideration — the Ideas row's only variable content. */
  ideaCount?: number | null;
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
  const role = badgedRole(trip.myRole);
  const mine = role !== null;

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
      {role && (
        <span
          aria-hidden="true"
          data-role-edge={role}
          className="absolute left-0"
          style={{
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: "0 3px 3px 0",
            background: ROLE_COLOR[role].text,
          }}
        />
      )}

      <div className="flex items-start gap-2.5 py-2.5 pl-3 pr-2.5">
        <div className="min-w-0 flex-1">
          <div
            className="line-clamp-2 break-words text-[15px] font-semibold"
            data-rail-name
            // Role edge, channel two — see the note at the top of this file.
            style={{ color: mine ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
          >
            {trip.title}
          </div>
          {dest && (
            <div
              className="mt-[3px] flex items-center gap-1 truncate text-[12.5px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <MapPin size={10} className="shrink-0" />
              <span className="truncate">{dest}</span>
            </div>
          )}
          <div
            className="mt-[2px] flex items-center gap-1 truncate text-[12.5px]"
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
          className="text-center text-[12px] font-semibold"
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
 * An IDEA-phase trip — a trip with no destination locked yet.
 *
 * Name and a count of ideas under consideration. That is the whole row, and the
 * reduction is honest rather than a compromise: there is very little true about a
 * trip that hasn't been placed, and the count is the only thing that meaningfully
 * varies. "4 ideas" says a real comparison is happening; "1 idea" says someone has
 * nearly decided.
 *
 * Deliberately absent, each for its own reason:
 *   - No image. Images only exist if the trip started from one of the curated
 *     twenty, so the row would be inconsistent between trips for no gain.
 *   - No vote count. Voting is optional, often nobody has been invited yet, and a
 *     single owner's vote conveys nothing.
 *   - No destination names. A comparison can hold ten candidates before anyone
 *     starts narrowing, and there is no honest way to pick which to show.
 *
 * The role edge applies exactly as it does on a placed trip — an idea-phase trip
 * still has an owner and organizers, and "can I act here" is the same question.
 * Both edges, same two colours, same shared source.
 */
export function RailIdeaTripRow({
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
  const role = badgedRole(trip.myRole);
  const mine = role !== null;
  const count = trip.ideaCount ?? 0;
  return (
    <button
      type="button"
      aria-current={current || undefined}
      aria-busy={pending || undefined}
      onClick={onOpen}
      disabled={pending}
      data-testid="rail-trip-idea"
      data-mine={mine || undefined}
      className="relative mb-1 block w-full rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)] disabled:opacity-60"
      style={{
        background: current ? "var(--color-bt-accent-faint)" : undefined,
      }}
    >
      {role && (
        <span
          aria-hidden="true"
          data-role-edge={role}
          className="absolute left-0"
          style={{
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: "0 3px 3px 0",
            background: ROLE_COLOR[role].text,
          }}
        />
      )}
      <div
        className="line-clamp-2 break-words text-[14px] font-semibold"
        data-rail-name
        // Second channel for the role bit — same reasoning as the placed row.
        style={{ color: mine ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
      >
        {trip.title}
      </div>
      <div className="truncate text-[12px]" style={{ color: "var(--color-bt-text-dim)", opacity: 0.8 }}>
        {count === 1 ? "1 idea" : `${count} ideas`}
      </div>
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
      <div
        className="line-clamp-2 break-words text-[14px] font-semibold"
        data-rail-name
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {trip.title}
      </div>
      {meta && (
        <div className="truncate text-[12px]" style={{ color: "var(--color-bt-text-dim)", opacity: 0.8 }}>
          {meta}
        </div>
      )}
    </button>
  );
}
