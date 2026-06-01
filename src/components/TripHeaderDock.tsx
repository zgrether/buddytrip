"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { Bell, ChevronDown, Plus, Hash } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { CountdownResult } from "@/lib/tripCountdown";

// The dock only renders countdown copy for the labelled states; the upstream
// header filters out "idea"/"no_dates" before passing. Narrowing here keeps
// each branch type-safe without a discriminator soup.
type LabelledCountdown = Exclude<
  CountdownResult,
  { type: "idea" } | { type: "no_dates" }
>;
import { InfoTileModal, iconFor, type QuickTile } from "@/components/InfoTileModal";

// ── Constants ─────────────────────────────────────────────────────────────

// Sized to match the tile pill height (icon chip 24px + label/value text +
// vertical padding ≈ 38px) so the ring sits on the same baseline as the
// rail and the dock container doesn't grow taller than it needs to.
const RING_PX = 38;
const RING_STROKE = 3;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Resolve a tile's glyph. Explicit `icon` wins; otherwise label-infer some
 *  obvious entries so common tiles (wifi, door, address) get a recognizable
 *  chip without the owner having to pick. Falls back to a neutral hash. */
function dockGlyphFor(tile: QuickTile) {
  if (tile.icon) return iconFor(tile.icon);
  const l = tile.label.toLowerCase();
  if (/wi-?fi|network|password|ssid/.test(l)) return iconFor("wifi");
  if (/lockbox|key/.test(l)) return iconFor("key");
  if (/door|code|gate|garage|pin/.test(l)) return iconFor("lock");
  if (/car|valet|parking|uber/.test(l)) return iconFor("car");
  return Hash;
}

// ── Countdown ring ────────────────────────────────────────────────────────
//
// Conic-gradient progress ring. Filled fraction:
//   - happening: dayNumber / totalDays
//   - past:      1.0 (full)
//   - pre-trip:  0 (empty teal outline, day count inside)
// Inside text: big day number ("3" mid-trip, days-until pre-trip, ✓ post-trip).

const CountdownRing: FC<{ countdown: CountdownResult | null }> = ({
  countdown,
}) => {
  if (!countdown || countdown.type === "idea" || countdown.type === "no_dates") {
    return null;
  }

  let pct = 0;
  let insideText: string = "";
  let dim = false;

  if (countdown.type === "happening") {
    pct = Math.max(
      0.04,
      Math.min(1, countdown.dayNumber / Math.max(1, countdown.totalDays)),
    );
    insideText = String(countdown.dayNumber);
  } else if (countdown.type === "past" || countdown.type === "past_distant") {
    pct = 1;
    insideText = "✓";
    dim = true;
  } else if (countdown.type === "today") {
    pct = 0.04;
    insideText = "0";
  } else if (countdown.type === "days") {
    pct = 0;
    insideText = String(countdown.days);
  } else if (countdown.type === "weeks") {
    pct = 0;
    insideText = String(countdown.weeks) + "w";
  }

  const trackColor = "rgba(255,255,255,0.13)";
  const fillColor = dim
    ? "var(--color-bt-text-dim)"
    : "var(--color-bt-accent)";

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: RING_PX, height: RING_PX }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${fillColor} ${pct * 360}deg, ${trackColor} 0deg)`,
        }}
      />
      {/* Inner punch-out so we get a ring, not a disc. */}
      <div
        className="absolute rounded-full"
        style={{
          top: RING_STROKE,
          left: RING_STROKE,
          right: RING_STROKE,
          bottom: RING_STROKE,
          background:
            "radial-gradient(circle, rgba(15,23,42,0.96), rgba(15,23,42,0.92))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center font-semibold"
        style={{
          color: dim ? "rgba(255,255,255,0.45)" : "#ffffff",
          fontSize: 12,
          lineHeight: 1,
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {insideText}
      </div>
    </div>
  );
};

// ── Countdown meta block (Day N / X days left) ────────────────────────────

const CountdownMeta: FC<{
  countdown: LabelledCountdown;
  stack: boolean;
}> = ({ countdown, stack }) => {
  const isHappening = countdown.type === "happening";
  const wrapperClass = stack
    ? "flex flex-col items-center text-center leading-tight"
    : "flex flex-col leading-tight";

  // Copy per the spec:
  //   pre-trip → single line "X days to go" / "Tomorrow" / "Today"
  //   happening → "Day N" line above, "X days left" line below
  //   past → "Wrapped"

  if (countdown.type === "happening") {
    const daysLeft = countdown.totalDays - countdown.dayNumber;
    return (
      <div className={wrapperClass}>
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "#ffffff" }}
        >
          {isHappening && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: "var(--color-bt-accent)" }}
            />
          )}
          Day {countdown.dayNumber}
        </span>
        <span
          className="text-[12px]"
          style={{ color: "rgba(255,255,255,0.70)" }}
        >
          {daysLeft <= 0
            ? "Last day"
            : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
        </span>
      </div>
    );
  }

  if (countdown.type === "past" || countdown.type === "past_distant") {
    return (
      <div className={wrapperClass}>
        <span
          className="text-[12px] font-medium"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          Wrapped
        </span>
        <span
          className="text-[11px]"
          style={{ color: "rgba(255,255,255,0.40)" }}
        >
          {countdown.label}
        </span>
      </div>
    );
  }

  // pre-trip: days / today / weeks
  let line: string;
  if (countdown.type === "today") line = "Today";
  else if (countdown.type === "days")
    line = countdown.days === 1 ? "Tomorrow" : `${countdown.days} days to go`;
  else line = `${countdown.weeks} week${countdown.weeks === 1 ? "" : "s"} to go`;

  return (
    <div className={wrapperClass}>
      <span
        className="text-[13px] font-semibold"
        style={{ color: "#ffffff" }}
      >
        {line}
      </span>
    </div>
  );
};

// ── Tile chip ─────────────────────────────────────────────────────────────

const TileChip: FC<{
  tile: QuickTile;
  onClick?: () => void;
}> = ({ tile, onClick }) => {
  const alert = !!tile.is_alert;
  const Glyph = alert ? Bell : dockGlyphFor(tile);
  const clickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      data-tile-id={tile.id}
      className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
      style={{
        background: alert
          ? "rgba(251,191,36,0.12)"
          : "rgba(255,255,255,0.06)",
        border: `1px solid ${alert ? "rgba(251,191,36,0.40)" : "rgba(255,255,255,0.09)"}`,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
        style={{
          background: alert
            ? "rgba(251,191,36,0.18)"
            : "var(--color-bt-accent-faint)",
          color: alert ? "#fbbf24" : "var(--color-bt-accent)",
        }}
      >
        <Glyph size={13} strokeWidth={1.9} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.10em]"
          style={{
            color: alert ? "#fbbf24" : "rgba(255,255,255,0.50)",
          }}
        >
          {tile.label}
        </span>
        <span
          className="font-mono text-[13px] truncate max-w-[160px]"
          style={{ color: "#ffffff" }}
        >
          {tile.value}
        </span>
      </span>
    </button>
  );
};

// ── Inline [+] add button (tile-styled, NOT teal) ─────────────────────────

const AddTileButton: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="header-dock-add-tile"
    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.10)]"
    style={{
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.09)",
      color: "rgba(255,255,255,0.70)",
    }}
    aria-label="Add info tile"
  >
    <Plus size={16} strokeWidth={2.2} />
  </button>
);

// ── Empty-state dashed CTA (full-width, replaces the tile row) ────────────

const EmptyCta: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="header-dock-empty-cta"
    className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
    style={{
      border: "1px dashed rgba(255,255,255,0.20)",
      color: "rgba(255,255,255,0.70)",
    }}
  >
    <Plus size={13} strokeWidth={2.2} />
    Add door codes, wifi…
  </button>
);

// ── Expand handle (bottom-edge pull, only when there's overflow) ──────────

const ExpandHandle: FC<{
  expanded: boolean;
  onClick: () => void;
}> = ({ expanded, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={expanded ? "Collapse info dock" : "Expand info dock"}
    aria-expanded={expanded}
    data-testid="header-dock-expand"
    className="absolute left-1/2 flex h-5 w-9 -translate-x-1/2 items-center justify-center rounded-full transition-colors hover:opacity-90"
    style={{
      bottom: -9,
      // Solid surface — the handle straddles the bottom edge and overlaps
      // whatever sits below, so it must not be see-through.
      background: "var(--color-bt-card-float)",
      border: "1px solid var(--color-bt-border)",
      boxShadow: "0 2px 6px rgba(0,0,0,0.30)",
      color: "var(--color-bt-text)",
    }}
  >
    <ChevronDown
      size={13}
      strokeWidth={2.2}
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 150ms ease",
      }}
    />
  </button>
);

// ── TripHeaderDock ────────────────────────────────────────────────────────
//
// The "ring dock" — countdown ring + meta on the left, divider, then the
// tile rail on the right. Replaces the old standalone countdown ribbon AND
// the home-tab QuickInfo panel; both surfaces fold into this one card.

export interface TripHeaderDockProps {
  tripId: string;
  countdown: CountdownResult | null;
  /** Owner / Planner — gates the [+] button and tile click-to-edit. */
  canEdit: boolean;
}

export function TripHeaderDock({
  tripId,
  countdown,
  canEdit,
}: TripHeaderDockProps) {
  const { data: tiles = [] } =
    trpc.quickInfoTiles.list.useQuery({ tripId });

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<QuickTile | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Alerts sort to the front; otherwise leave server order.
  const sortedTiles = useMemo(
    () =>
      [...(tiles as QuickTile[])].sort((a, b) => {
        const aA = a.is_alert ? 1 : 0;
        const bA = b.is_alert ? 1 : 0;
        return bA - aA;
      }),
    [tiles],
  );

  const hasTiles = sortedTiles.length > 0;
  const hasCountdown =
    !!countdown &&
    countdown.type !== "idea" &&
    countdown.type !== "no_dates";

  // Detect tile-row overflow so we can decide whether to show the expand
  // handle. We compare scrollHeight vs the single-row max-height after layout
  // settles on each width change.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measureOverflow = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    // Compare full flex-wrap scrollHeight to the height of a single row
    // (clientHeight when collapsed). When they differ, content wraps.
    if (expanded) {
      // While expanded, peek at intrinsic vs the "1-row equivalent" via a
      // synthetic measurement — we cache the first child's offsetHeight.
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) {
        setOverflowing(false);
        return;
      }
      setOverflowing(el.scrollHeight > first.offsetHeight + 4);
    } else {
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    }
  }, [expanded]);

  useLayoutEffect(() => {
    measureOverflow();
  }, [measureOverflow, sortedTiles.length, canEdit, expanded]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureOverflow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureOverflow]);

  // Nothing to show? Hide the dock entirely.
  if (!hasCountdown && !hasTiles && !canEdit) {
    return null;
  }

  // Mobile compression rule: ring stacks above day text only when sharing
  // the row with tiles. With no tiles, keep horizontal at every width.
  const stackOnMobile = hasTiles;

  const showEmptyCta = canEdit && !hasTiles;

  return (
    <div className="relative px-4 pt-3 pb-3 sm:px-5">
      <div
        className="relative flex items-center gap-3 rounded-xl px-3 py-2 sm:gap-4 sm:px-3.5 sm:py-2"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 22px rgba(0,0,0,0.28)",
        }}
        data-testid="trip-header-dock"
      >
        {/* ── Left: countdown ring + meta ───────────────────────────────── */}
        {hasCountdown && (
          <div
            className={
              stackOnMobile
                ? "flex flex-shrink-0 flex-col items-center gap-1 sm:flex-row sm:gap-2.5"
                : "flex flex-shrink-0 items-center gap-2.5"
            }
          >
            <CountdownRing countdown={countdown} />
            <CountdownMeta
              countdown={countdown as LabelledCountdown}
              stack={stackOnMobile}
            />
          </div>
        )}

        {/* ── Divider (only when both halves are present) ───────────────── */}
        {hasCountdown && (hasTiles || canEdit) && (
          <div
            className="self-stretch"
            style={{
              width: 1,
              background: "rgba(255,255,255,0.10)",
            }}
            aria-hidden="true"
          />
        )}

        {/* ── Right: tile row OR empty CTA ──────────────────────────────── */}
        {showEmptyCta ? (
          <div className="min-w-0 flex-1">
            <EmptyCta onClick={() => setAddOpen(true)} />
          </div>
        ) : hasTiles ? (
          <div
            ref={rowRef}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden"
            style={{
              // One-row clamp: tile pill height ≈ 38px. Slight buffer to
              // avoid sub-pixel rounding clipping the bottom border.
              maxHeight: expanded ? undefined : 40,
            }}
            data-testid="header-dock-tiles"
          >
            {sortedTiles.map((tile) => (
              <TileChip
                key={tile.id}
                tile={tile}
                onClick={canEdit ? () => setEditing(tile) : undefined}
              />
            ))}
            {canEdit && <AddTileButton onClick={() => setAddOpen(true)} />}
          </div>
        ) : null}

        {/* ── Expand handle ─────────────────────────────────────────────── */}
        {overflowing && hasTiles && (
          <ExpandHandle
            expanded={expanded}
            onClick={() => setExpanded((p) => !p)}
          />
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {addOpen && (
        <InfoTileModal tripId={tripId} onClose={() => setAddOpen(false)} />
      )}
      {editing && (
        <InfoTileModal
          tripId={tripId}
          tile={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
