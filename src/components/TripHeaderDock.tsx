"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { Bell, Plus, Hash } from "lucide-react";
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
}> = ({ countdown }) => {
  const isHappening = countdown.type === "happening";
  const wrapperClass = "flex flex-col leading-tight";

  // Copy per the spec:
  //   pre-trip → single line "X days to go" / "Tomorrow" / "Today"
  //   happening → "Day N" line above, "X days left" line below
  //   past → "Wrapped"

  if (countdown.type === "happening") {
    const daysLeft = countdown.totalDays - countdown.dayNumber;
    return (
      <div className={wrapperClass}>
        <span
          className="flex items-center gap-1.5 text-[13px] font-medium"
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
          className="text-[11px]"
          style={{ color: "rgba(255,255,255,0.55)" }}
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
          className="text-[13px] font-medium"
          style={{ color: "#ffffff" }}
        >
          Wrapped
        </span>
        <span
          className="text-[11px]"
          style={{ color: "rgba(255,255,255,0.55)" }}
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
        className="text-[13px] font-medium"
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
      className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-2 py-1 transition-colors"
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

// ── Inline [+] add button — discrete ghost ───────────────────────────────
//
// Bare plus icon, no pill background, no border. Sits at the trailing
// edge of the dock (right of the tile rail) and stays out of the way
// visually so the tiles read as the primary content. The tile rail
// has flex-1 alongside [+], so tiles wrap to a new row before colliding
// with the button.

const AddTileButton: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="header-dock-add-tile"
    className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.08)]"
    style={{
      color: "rgba(255,255,255,0.55)",
    }}
    aria-label="Add info tile"
  >
    <Plus size={14} strokeWidth={2.2} />
  </button>
);

// ── Empty-state dashed CTA (full-width, replaces the tile row) ────────────

const EmptyCta: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="header-dock-empty-cta"
    className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[12px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
    style={{
      border: "1px dashed rgba(255,255,255,0.20)",
      color: "rgba(255,255,255,0.70)",
    }}
  >
    <Plus size={13} strokeWidth={2.2} />
    Add door codes, wifi…
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

  // ── Ring-stacking based on tile-rail wrap ─────────────────────────────
  // Watch the tile rail's height. When it wraps onto a second row, flip
  // the ring to stacked (col) so it frees horizontal space; when the
  // viewport widens enough that the rail no longer wraps, return to
  // horizontal. We track the dock width at the moment of stacking and
  // require it to grow by HYSTERESIS_PX before unstacking — otherwise
  // the act of stacking (which shortens the ring section and gives the
  // rail more width) would make the rail fit, instantly un-stack, and
  // we'd ping-pong forever.
  const railRef = useRef<HTMLDivElement | null>(null);
  const [ringStacked, setRingStacked] = useState(false);
  const stackTriggerWidthRef = useRef<number | null>(null);

  // 38px single tile pill + a small fudge for sub-pixel rounding.
  const SINGLE_ROW_PX = 42;
  const HYSTERESIS_PX = 60;

  const measureRail = useRef<() => void>(() => {});
  measureRail.current = () => {
    const rail = railRef.current;
    if (!rail) return;
    const railHeight = rail.offsetHeight;
    const dockWidth = rail.parentElement?.offsetWidth ?? 0;
    const wrapped = railHeight > SINGLE_ROW_PX;

    if (wrapped && !ringStacked) {
      stackTriggerWidthRef.current = dockWidth;
      setRingStacked(true);
    } else if (!wrapped && ringStacked) {
      const trigger = stackTriggerWidthRef.current;
      if (trigger == null || dockWidth > trigger + HYSTERESIS_PX) {
        stackTriggerWidthRef.current = null;
        setRingStacked(false);
      }
    }
  };

  useLayoutEffect(() => {
    measureRail.current();
  }, [sortedTiles.length, ringStacked, canEdit, hasCountdown]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureRail.current());
    ro.observe(rail);
    if (rail.parentElement) ro.observe(rail.parentElement);
    return () => ro.disconnect();
  }, [hasTiles]);

  // Nothing to show? Hide the dock entirely.
  if (!hasCountdown && !hasTiles && !canEdit) {
    return null;
  }

  const showEmptyCta = canEdit && !hasTiles;

  return (
    <div className="relative px-3 pb-3">
      <div
        className="relative flex items-center gap-3 rounded-xl px-2 py-2 sm:gap-4 sm:px-2.5"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.10)",
          // Lighter elevation — sits a touch above the header surface
          // instead of hovering. y-offset 8→3, blur 22→10, opacity 28%→16%.
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), 0 3px 10px rgba(0,0,0,0.16)",
        }}
        data-testid="trip-header-dock"
      >
        {/* ── Left: countdown ring + meta ──────────────────────────────────
            Horizontal by default; stacks vertically (ring above day-text)
            only when the tile rail wraps to a second row — measured at
            runtime via ResizeObserver, with hysteresis so we don't
            ping-pong when stacking frees just enough width to un-wrap. */}
        {hasCountdown && (
          <div
            className={
              ringStacked
                ? "flex flex-shrink-0 flex-col items-center gap-1"
                : "flex flex-shrink-0 items-center gap-2.5"
            }
          >
            <CountdownRing countdown={countdown} />
            <CountdownMeta countdown={countdown as LabelledCountdown} />
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
          <>
            <div
              ref={railRef}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              data-testid="header-dock-tiles"
            >
              {sortedTiles.map((tile) => (
                <TileChip
                  key={tile.id}
                  tile={tile}
                  onClick={canEdit ? () => setEditing(tile) : undefined}
                />
              ))}
            </div>
            {canEdit && <AddTileButton onClick={() => setAddOpen(true)} />}
          </>
        ) : null}
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
