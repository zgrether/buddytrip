"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  CalendarRange,
  Check,
  ChevronRight,
  Hotel,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { formatDateRangeCompact, fmtTime12 } from "@/lib/dates";
import type { TripData } from "../types";
import type { TabProps } from "../types";
import { DatePollCard } from "./DatePollCard";
import { CrewTab } from "../CrewTab";
import { LodgingTab } from "../LodgingTab";
import { ScheduleTab } from "../ScheduleTab";

// ── Types ─────────────────────────────────────────────────────────────────

export type TileKey = "dates" | "crew" | "lodging" | "schedule";
export type TileState = "empty" | "complete" | "skipped";
type PanelType = TileKey | null;

export interface PlanningGridProps {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  onTabChange?: (tab: string) => void;
  /** Opens the TripSummaryModal, which fires advanceToGoing. */
  onAdvanceToGoing?: () => void;
}

// ── Tile styling helpers ──────────────────────────────────────────────────

/** CSS class string for the tile wrapper — handles hover states via className
 *  so Tailwind hover variants can override them (style prop can't be hovered).
 *  `anyPanelOpen` dims inactive tiles when a panel is expanded. */
function tileWrapperClass(
  state: TileState,
  isActive: boolean,
  clickable: boolean,
  anyPanelOpen: boolean,
): string {
  const shared =
    "group relative flex flex-col rounded-xl border p-3 transition-all duration-150";
  const cursor = clickable ? "cursor-pointer" : "cursor-default";
  // Inactive tiles dim when any panel is open (skip skipped — already at 60%)
  const dim = anyPanelOpen && !isActive && state !== "skipped" ? "opacity-70" : "";

  if (isActive) {
    // Active: card-raised bg + 2px teal border, fully rounded — no flat-bottom trick.
    return `${shared} ${cursor} bg-[var(--color-bt-card-raised)] border-2 border-[var(--color-bt-accent)]`;
  }
  if (state === "complete") {
    return `${shared} ${cursor} ${dim} bg-[var(--color-bt-card)] border-[var(--color-bt-border)] hover:bg-[var(--color-bt-card-raised)] hover:border-[var(--color-bt-accent-border)]`;
  }
  if (state === "skipped") {
    return `${shared} ${cursor} bg-[var(--color-bt-card)] border-[var(--color-bt-border)] opacity-60`;
  }
  return `${shared} ${cursor} ${dim} bg-[var(--color-bt-card)] border-[var(--color-bt-border)] hover:bg-[var(--color-bt-card-raised)] hover:border-[var(--color-bt-accent-border)]`;
}

/** Icon and label colors only (background/border handled via className above). */
function iconLabelColors(
  state: TileState,
  isActive: boolean,
): { iconBg: string; iconColor: string; labelColor: string } {
  if (isActive) {
    // Solid accent icon square (white icon) + teal label on card bg.
    return {
      iconBg: "var(--color-bt-accent)",
      iconColor: "var(--color-bt-base)",
      labelColor: "var(--color-bt-accent)",
    };
  }
  if (state === "complete") {
    return {
      iconBg: "var(--color-bt-accent-faint)",
      iconColor: "var(--color-bt-accent)",
      labelColor: "var(--color-bt-accent)",
    };
  }
  return {
    iconBg: "var(--color-bt-card-raised)",
    iconColor: "var(--color-bt-text-dim)",
    labelColor: "var(--color-bt-text-dim)",
  };
}

// ── Tile component ────────────────────────────────────────────────────────

interface TileProps {
  icon: LucideIcon;
  label: string;
  state: TileState;
  /** Visual-only override — true when the dates tile has its accordion expanded. */
  isActive?: boolean;
  emptyDescription: string;
  emptyCTA: string;
  completeValue?: string;
  completeSub?: React.ReactNode;
  /** canEdit gates the Skip affordance. */
  canEdit: boolean;
  onClick?: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  skipping: boolean;
  /** Warning shown below "Not needed for this trip" when skipped + crew complete. */
  skippedNudge?: React.ReactNode;
  /**
   * Short action label used in the label row for complete tiles, e.g.
   * "Edit dates", "Manage crew". The " →" arrow is appended automatically.
   */
  editLabel: string;
  /** Rich preview content — rendered on sm+ breakpoint, hidden on mobile. */
  preview?: React.ReactNode;
  /** True when any panel (not necessarily this tile's) is open — dims inactive tiles. */
  anyPanelOpen?: boolean;
  testId?: string;
}

function Tile({
  icon: Icon,
  label,
  state,
  isActive,
  emptyDescription,
  emptyCTA,
  completeValue,
  completeSub,
  canEdit,
  onClick,
  onSkip,
  onUnskip,
  skipping,
  skippedNudge,
  editLabel,
  preview,
  anyPanelOpen,
  testId,
}: TileProps) {
  const colors = iconLabelColors(state, !!isActive);
  // All tiles always navigable — checkmark means "addressed", not locked.
  const clickable = !!onClick;

  return (
    <div
      data-testid={testId}
      data-state={state}
      data-active={isActive ? "true" : undefined}
      onClick={clickable ? onClick : undefined}
      className={tileWrapperClass(state, !!isActive, clickable, !!anyPanelOpen)}
      style={{ minHeight: 130 }}
    >
      {/* ── Top row: icon + status badge (ml-auto) ───────────────────── */}
      <div className="mb-2 flex items-center">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: colors.iconBg, color: colors.iconColor }}
        >
          <Icon size={22} strokeWidth={1.75} />
        </span>

        {state === "complete" && (
          <span
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            aria-label="Complete"
          >
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {state === "skipped" && (
          <span
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
            }}
            aria-label="Skipped"
          >
            <X size={11} strokeWidth={2.5} />
          </span>
        )}
      </div>

      {/* ── Label row: LABEL (left) + Edit link (right, complete-only) ── */}
      <div className="mb-1 flex items-center justify-between gap-1">
        <p
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: colors.labelColor }}
        >
          {label}
        </p>
        {/* Edit link — visible on mobile, fades in on desktop hover */}
        {state === "complete" && (
          <span
            className="flex-shrink-0 text-[11px] opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {editLabel} →
          </span>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      {state === "complete" ? (
        <>
          {completeValue && (
            <p
              className="truncate text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {completeValue}
            </p>
          )}
          {completeSub && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {completeSub}
            </p>
          )}
        </>
      ) : state === "skipped" ? (
        <div className="space-y-1">
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Not needed for this trip
          </p>
          {skippedNudge}
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
          {emptyDescription}
        </p>
      )}

      {/* ── Rich preview — hidden mobile, shown sm+ ───────────────────── */}
      {preview && (
        <div className="mt-2 hidden min-h-0 flex-1 flex-col gap-1.5 sm:flex">
          {preview}
        </div>
      )}

      {/* ── Footer: CTA + Skip (empty) | Undo skip (skipped) ─────────── */}
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        {state === "empty" && (
          <>
            {clickable ? (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: "var(--color-bt-accent)" }}
              >
                {emptyCTA}
                <ChevronRight size={10} />
              </span>
            ) : (
              <span />
            )}
            {canEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkip();
                }}
                disabled={skipping}
                className="text-[11px] disabled:opacity-40"
                style={{
                  color: "var(--color-bt-text-dim)",
                  background: "transparent",
                  border: "none",
                  textDecoration: "underline dotted",
                  textUnderlineOffset: 2,
                }}
              >
                Opt out
              </button>
            )}
          </>
        )}
        {state === "skipped" && canEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnskip();
            }}
            disabled={skipping}
            className="ml-auto text-[11px] disabled:opacity-40"
            style={{
              color: "var(--color-bt-text-dim)",
              background: "transparent",
              border: "none",
              textDecoration: "underline dotted",
              textUnderlineOffset: 2,
            }}
          >
            Opt in
          </button>
        )}
      </div>
    </div>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]!.toUpperCase();
  return (words[0][0]! + words[1][0]!).toUpperCase();
}

// ── Typed shapes for local casts ──────────────────────────────────────────

interface GridMember {
  memberId: string;
  user_id: string | null;
  displayName: string;
  role: string;
  isGuest: boolean;
}

interface GridLogisticsItem {
  id?: string;
  type: string;
  property_name?: string | null;
  is_confirmed?: boolean | null;
}

interface GridScheduleItem {
  id: string;
  title: string;
  scheduled_time?: string | null;
  is_confirmed: boolean;
}

interface GridPollVote {
  window_id: string;
  user_id: string;
  answer: string;
}

interface GridPollWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: GridPollVote[];
}

// ── Mobile planning tabs (below sm breakpoint) ────────────────────────────

const PLANNING_MOBILE_TABS = [
  { id: "dates" as const, label: "Dates", Icon: CalendarRange },
  { id: "crew" as const, label: "Crew", Icon: Users },
  { id: "lodging" as const, label: "Lodging", Icon: Hotel },
  { id: "schedule" as const, label: "Schedule", Icon: Calendar },
];

// ── Main grid ─────────────────────────────────────────────────────────────

/**
 * PlanningGrid — the Home tab surface during the PLANNING stage.
 *
 * Four tiles (Dates / Crew / Lodging / Schedule) in a responsive grid:
 * 1-col on mobile, 2×2 on tablet, 4×1 on desktop.
 * Each tile has three states: empty, complete, skipped.
 * The Dates tile opens an inline accordion below the grid.
 */
export function PlanningGrid({
  trip,
  canEdit,
  isOwner,
  onTabChange,
  onAdvanceToGoing,
}: PlanningGridProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: logisticsItems = [] } = trpc.logistics.list.useQuery({ tripId });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });

  // ── Typed casts ────────────────────────────────────────────────────────
  const typedMembers = members as unknown as GridMember[];
  const typedLogistics = logisticsItems as unknown as GridLogisticsItem[];
  const typedSchedule = scheduleItems as unknown as GridScheduleItem[];

  // ── Derived counts ─────────────────────────────────────────────────────
  const crewCount = typedMembers.length;
  const hasCrew = crewCount > 1;
  const plannerCount = typedMembers.filter((m) => m.role === "Planner").length;
  const noEmailCount = typedMembers.filter((m) => m.isGuest).length;

  const lodgingItems = typedLogistics.filter((r) => r.type === "lodging");
  const lodgingCount = lodgingItems.length;
  const lodgingConfirmed = lodgingItems.filter((r) => r.is_confirmed).length;
  const lodgingPending = lodgingCount - lodgingConfirmed;

  const scheduleCount = typedSchedule.length;

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;
  const lockedDateLabel = useMemo(
    () => (datesLocked ? formatDateRangeCompact(trip.start_date, trip.end_date) : null),
    [datesLocked, trip.start_date, trip.end_date],
  );

  // ── Tile states ────────────────────────────────────────────────────────
  const planningSkipped: string[] = Array.isArray(
    (trip as unknown as { planning_skipped?: unknown }).planning_skipped,
  )
    ? ((trip as unknown as { planning_skipped: string[] }).planning_skipped ?? [])
    : [];

  const stateFor = (tile: TileKey, complete: boolean): TileState => {
    if (complete) return "complete";
    if (planningSkipped.includes(tile)) return "skipped";
    return "empty";
  };

  const datesState = stateFor("dates", datesLocked);
  const crewState = stateFor("crew", hasCrew);
  const lodgingState = stateFor("lodging", lodgingCount > 0);
  const scheduleState = stateFor("schedule", scheduleCount > 0);

  const allResolved = [datesState, crewState, lodgingState, scheduleState].every(
    (s) => s === "complete" || s === "skipped",
  );

  // ── Date poll (for dates tile preview when poll is active) ─────────────
  const { data: datePoll } = trpc.datePoll.get.useQuery(
    { tripId },
    { enabled: pollMode && datesState !== "complete" },
  );

  // ── Active panel — unified state replacing datesPanelOpen ────────────
  // Dates panel persists to localStorage; crew/lodging/schedule do not.
  const datesStorageKey = `bt-dates-panel-open-${tripId}`;
  const [activePanel, setActivePanel] = useState<PanelType>(() => {
    try {
      return localStorage.getItem(datesStorageKey) === "true" ? "dates" : null;
    } catch {
      return null;
    }
  });

  const handleTileClick = (tile: PanelType) => {
    setActivePanel((prev) => {
      const next = prev === tile ? null : tile;
      try {
        if (next === "dates") {
          localStorage.setItem(datesStorageKey, "true");
        } else {
          localStorage.removeItem(datesStorageKey);
        }
      } catch {}
      return next;
    });
    // Keep mobile tab in sync so resizing preserves the selection.
    if (tile !== null) setMobileActiveTab(tile);
  };

  const [dateMode, setDateMode] = useState<"set" | "poll">(pollMode ? "poll" : "set");

  // ── Mobile active tab — synced with desktop activePanel ──────────────────
  const [mobileActiveTab, setMobileActiveTab] = useState<TileKey>(() => {
    // Initialise from localStorage so first render matches desktop.
    try {
      return localStorage.getItem(datesStorageKey) === "true" ? "dates" : "dates";
    } catch {
      return "dates";
    }
  });

  /** Select a mobile tab and mirror the choice to the desktop panel state. */
  const handleMobileTabChange = (tab: TileKey) => {
    setMobileActiveTab(tab);
    // Open the matching desktop panel so resizing up preserves the selection.
    setActivePanel(tab);
    try {
      if (tab === "dates") {
        localStorage.setItem(datesStorageKey, "true");
      } else {
        localStorage.removeItem(datesStorageKey);
      }
    } catch {}
  };

  // Auto-close the active panel when its tile is skipped, or when dates are locked in.
  useEffect(() => {
    if (activePanel === null) return;
    const stateMap: Record<TileKey, TileState> = {
      dates: datesState,
      crew: crewState,
      lodging: lodgingState,
      schedule: scheduleState,
    };
    const panelState = stateMap[activePanel];
    if (panelState === "skipped" || (activePanel === "dates" && panelState === "complete")) {
      setActivePanel(null);
      try { localStorage.removeItem(datesStorageKey); } catch {}
    }
  }, [datesState, crewState, lodgingState, scheduleState, activePanel, datesStorageKey]);

  // Pick-your-dates form state
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");
  const [confirmClearPoll, setConfirmClearPoll] = useState(false);

  const lockDates = trpc.trips.lockDates.useMutation({
    onSuccess() {
      setDirectStart("");
      setDirectEnd("");
      setConfirmClearPoll(false);
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });
  const setPollActive = trpc.datePoll.setPollMode.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const handleSet = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    if (pollMode && !confirmClearPoll) {
      setConfirmClearPoll(true);
      return;
    }
    if (pollMode) setPollActive.mutate({ tripId, pollMode: false });
    lockDates.mutate({ tripId, startDate: directStart, endDate: directEnd });
  };

  // ── Skip / unskip ──────────────────────────────────────────────────────
  const [pendingTile, setPendingTile] = useState<TileKey | null>(null);
  const skipTile = trpc.trips.skipPlanningTile.useMutation({
    onSettled() {
      setPendingTile(null);
      utils.trips.getById.invalidate({ tripId });
    },
  });
  const unskipTile = trpc.trips.unskipPlanningTile.useMutation({
    onSettled() {
      setPendingTile(null);
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const handleSkip = (tile: TileKey) => {
    setPendingTile(tile);
    skipTile.mutate({ tripId, tile });
  };
  const handleUnskip = (tile: TileKey) => {
    setPendingTile(tile);
    unskipTile.mutate({ tripId, tile });
  };

  // ── Rich tile previews ─────────────────────────────────────────────────

  // Dates: per-member vote pips when poll is active.
  const datesPreview = useMemo(() => {
    if (!pollMode || !datePoll) return null;
    const pollWindows = datePoll.windows as unknown as GridPollWindow[];
    if (pollWindows.length === 0) return null;
    // Only members with an account can vote.
    const votableMembers = typedMembers.filter((m) => m.user_id !== null);
    return (
      <div className="space-y-1">
        {pollWindows.slice(0, 3).map((w) => (
          <div
            key={w.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <span
              className="flex-1 truncate text-[11px] font-medium"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {formatDateRangeCompact(w.start_date, w.end_date)}
            </span>
            <div className="flex gap-0.5">
              {votableMembers.slice(0, 6).map((m) => {
                const vote = w.votes.find((v) => v.user_id === m.user_id);
                const answer = vote?.answer ?? null;
                const pipBg =
                  answer === "yes"
                    ? "var(--color-bt-accent-faint)"
                    : answer === "maybe"
                      ? "var(--color-bt-warning-faint)"
                      : answer === "no"
                        ? "var(--color-bt-danger-faint)"
                        : "var(--color-bt-card-raised)";
                const pipColor =
                  answer === "yes"
                    ? "var(--color-bt-accent)"
                    : answer === "maybe"
                      ? "var(--color-bt-warning)"
                      : answer === "no"
                        ? "var(--color-bt-danger)"
                        : "var(--color-bt-text-dim)";
                const pipLabel =
                  answer === "yes" ? "✓" : answer === "maybe" ? "~" : answer === "no" ? "✗" : "?";
                return (
                  <div
                    key={m.memberId}
                    className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold"
                    style={{ background: pipBg, color: pipColor }}
                    title={m.displayName}
                  >
                    {pipLabel}
                  </div>
                );
              })}
              {votableMembers.length > 6 && (
                <span
                  className="text-[10px]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  +{votableMembers.length - 6}
                </span>
              )}
            </div>
          </div>
        ))}
        {pollWindows.length > 3 && (
          <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            +{pollWindows.length - 3} more options
          </p>
        )}
      </div>
    );
  }, [pollMode, datePoll, typedMembers]);

  // Crew: avatar chips + planner count + missing email tally.
  const crewPreview = useMemo(() => {
    if (crewCount === 0) return null;
    const visible = typedMembers.slice(0, 6);
    const extra = crewCount - visible.length;
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {visible.map((m) => (
            <span
              key={m.memberId}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-accent)",
              }}
              title={m.displayName}
            >
              {initials(m.displayName)}
            </span>
          ))}
          {extra > 0 && (
            <span
              className="flex h-6 items-center justify-center rounded-full px-1.5 text-[9px] font-bold"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px dashed var(--color-bt-border)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              +{extra}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {plannerCount > 0 && (
            <span style={{ color: "var(--color-bt-text-dim)" }}>
              {plannerCount} {plannerCount === 1 ? "planner" : "planners"}
            </span>
          )}
          {noEmailCount > 0 && (
            <span style={{ color: "var(--color-bt-warning)" }}>
              {noEmailCount} missing email
            </span>
          )}
        </div>
      </div>
    );
  }, [typedMembers, crewCount, plannerCount, noEmailCount]);

  // Lodging: first 2 properties with confirmed/pending distinction.
  const lodgingPreview = useMemo(() => {
    if (lodgingItems.length === 0) return null;
    const visible = lodgingItems.slice(0, 2);
    const extra = lodgingItems.length - visible.length;
    return (
      <div className="space-y-1">
        {visible.map((item, i) => (
          <div
            key={item.id ?? i}
            className="flex items-center gap-2 rounded-lg px-2 py-1"
            style={{
              background: item.is_confirmed
                ? "var(--color-bt-accent-faint)"
                : "var(--color-bt-warning-faint)",
              border: `1px solid ${
                item.is_confirmed
                  ? "var(--color-bt-accent-border)"
                  : "var(--color-bt-warning-border)"
              }`,
            }}
          >
            <div
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{
                background: item.is_confirmed
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-warning)",
              }}
            />
            <span
              className="flex-1 truncate text-xs font-medium"
              style={{ color: "var(--color-bt-text)" }}
            >
              {item.property_name ?? "Lodging option"}
            </span>
            <span
              className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: item.is_confirmed
                  ? "var(--color-bt-accent-faint)"
                  : "var(--color-bt-warning-faint)",
                color: item.is_confirmed
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-warning)",
                border: `1px solid ${
                  item.is_confirmed
                    ? "var(--color-bt-accent-border)"
                    : "var(--color-bt-warning-border)"
                }`,
              }}
            >
              {item.is_confirmed ? "confirmed" : "pending"}
            </span>
          </div>
        ))}
        {extra > 0 && (
          <span className="pl-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            +{extra} more
          </span>
        )}
      </div>
    );
  }, [lodgingItems]);

  // Schedule: first 3 items with confirmed/unconfirmed dots.
  const schedulePreview = useMemo(() => {
    if (typedSchedule.length === 0) return null;
    const visible = typedSchedule.slice(0, 3);
    const extra = typedSchedule.length - visible.length;
    return (
      <div className="space-y-1">
        {visible.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <div
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{
                background: item.is_confirmed
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-border)",
              }}
            />
            <span
              className="flex-1 truncate text-xs"
              style={{
                color: item.is_confirmed
                  ? "var(--color-bt-text)"
                  : "var(--color-bt-text-dim)",
              }}
            >
              {item.title}
            </span>
            {item.scheduled_time && (
              <span
                className="flex-shrink-0 text-[11px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {fmtTime12(item.scheduled_time)}
              </span>
            )}
          </div>
        ))}
        {extra > 0 && (
          <span className="pl-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            +{extra} more
          </span>
        )}
      </div>
    );
  }, [typedSchedule]);

  // ── Dates panel body — shared by desktop panel and mobile tab ─────────────
  const datesPanelBody = canEdit ? (
    <div data-testid="planning-dates-panel">
      {/* Segmented control */}
      <div className="p-3">
        <div
          className="flex rounded-xl p-1"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <button
            type="button"
            onClick={() => setDateMode("set")}
            data-active={dateMode === "set"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold"
            style={
              dateMode === "set"
                ? {
                    background: "var(--color-bt-card)",
                    color: "var(--color-bt-text)",
                    boxShadow: "var(--shadow-card)",
                  }
                : { background: "transparent", color: "var(--color-bt-text-dim)" }
            }
          >
            <CalendarRange size={12} />
            Pick your Dates
          </button>
          <button
            type="button"
            onClick={() => hasCrew && setDateMode("poll")}
            disabled={!hasCrew}
            data-active={dateMode === "poll"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={
              dateMode === "poll" && hasCrew
                ? {
                    background: "var(--color-bt-card)",
                    color: "var(--color-bt-text)",
                    boxShadow: "var(--shadow-card)",
                  }
                : { background: "transparent", color: "var(--color-bt-text-dim)" }
            }
          >
            <Users size={12} />
            Poll the Crew
          </button>
        </div>

        {!hasCrew && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Add crew members first —{" "}
            <button
              type="button"
              onClick={() => handleTileClick("crew")}
              className="font-semibold underline"
              style={{
                color: "var(--color-bt-accent)",
                background: "transparent",
                border: "none",
              }}
            >
              open Crew →
            </button>
          </p>
        )}
      </div>

      {/* Body */}
      {dateMode === "set" ? (
        <div
          className="border-t px-3 pb-3 pt-3"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          <p className="mb-2 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Already know the dates? Lock them in directly.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[140px] flex-1">
              <label
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Start date
              </label>
              <input
                type="date"
                value={directStart}
                onChange={(e) => setDirectStart(e.target.value)}
                className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>
            <div className="min-w-[140px] flex-1">
              <label
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                End date
              </label>
              <input
                type="date"
                value={directEnd}
                onChange={(e) => setDirectEnd(e.target.value)}
                className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>
            {!confirmClearPoll && (
              <button
                type="button"
                onClick={handleSet}
                disabled={
                  !directStart ||
                  !directEnd ||
                  directStart >= directEnd ||
                  lockDates.isPending
                }
                className="flex-shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Set
              </button>
            )}
          </div>

          {confirmClearPoll && (
            <div
              className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]"
              style={{
                background: "var(--color-bt-warning-faint)",
                borderColor: "var(--color-bt-warning-border)",
              }}
            >
              <span style={{ color: "var(--color-bt-text)" }}>
                This will clear the poll. Are you sure?
              </span>
              <button
                type="button"
                onClick={() => setConfirmClearPoll(false)}
                className="ml-auto rounded-lg px-3 py-1 text-xs font-semibold"
                style={{
                  color: "var(--color-bt-text-dim)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSet}
                disabled={lockDates.isPending || setPollActive.isPending}
                className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      ) : hasCrew ? (
        <div
          className="border-t px-3 pb-3 pt-3"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          <DatePollCard
            trip={trip}
            isOwner={isOwner}
            onManageCrew={canEdit ? () => handleTileClick("crew") : undefined}
          />
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Section header — visible on all breakpoints ──────────────────── */}
      <div>
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Planning
        </h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          Destination locked in — now let&apos;s get the details sorted.
        </p>
      </div>

      {/* ── DESKTOP / TABLET: tile grid + expanded panel (sm+) ──────────── */}
      <div className="hidden sm:block">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          testId="planning-tile-dates"
          icon={CalendarRange}
          label="Dates"
          state={datesState}
          isActive={activePanel === "dates"}
          anyPanelOpen={!!activePanel}
          emptyDescription="Not set yet"
          emptyCTA="Set dates"
          completeValue={lockedDateLabel ?? undefined}
          editLabel="Edit dates"
          preview={datesPreview}
          canEdit={canEdit}
          onClick={datesState !== "skipped" ? () => handleTileClick("dates") : undefined}
          onSkip={() => handleSkip("dates")}
          onUnskip={() => handleUnskip("dates")}
          skipping={pendingTile === "dates"}
        />
        <Tile
          testId="planning-tile-crew"
          icon={Users}
          label="Crew"
          state={crewState}
          isActive={activePanel === "crew"}
          anyPanelOpen={!!activePanel}
          emptyDescription="No one added yet"
          emptyCTA="Add crew"
          completeValue={`${crewCount} ${crewCount === 1 ? "person" : "people"}`}
          editLabel="Manage crew"
          preview={crewPreview}
          canEdit={canEdit}
          onClick={crewState !== "skipped" ? () => handleTileClick("crew") : undefined}
          onSkip={() => handleSkip("crew")}
          onUnskip={() => handleUnskip("crew")}
          skipping={pendingTile === "crew"}
        />
        <Tile
          testId="planning-tile-lodging"
          icon={Hotel}
          label="Lodging"
          state={lodgingState}
          isActive={activePanel === "lodging"}
          emptyDescription="Nothing added yet"
          emptyCTA="Add property"
          completeValue={`${lodgingCount} ${lodgingCount === 1 ? "option" : "options"}`}
          completeSub={
            lodgingCount > 0 ? (
              <>
                <span style={{ color: "var(--color-bt-accent)" }}>
                  {lodgingConfirmed} confirmed
                </span>
                {" · "}
                <span style={{ color: "var(--color-bt-warning)" }}>
                  {lodgingPending} pending
                </span>
              </>
            ) : null
          }
          editLabel="Manage lodging"
          preview={lodgingPreview}
          anyPanelOpen={!!activePanel}
          canEdit={canEdit}
          onClick={lodgingState !== "skipped" ? () => handleTileClick("lodging") : undefined}
          onSkip={() => handleSkip("lodging")}
          onUnskip={() => handleUnskip("lodging")}
          skipping={pendingTile === "lodging"}
          skippedNudge={
            lodgingState === "skipped" && crewState === "complete" ? (
              <span
                className="mt-1 block text-[11px]"
                style={{ color: "var(--color-bt-warning)" }}
              >
                Your crew won&apos;t know where you&apos;re staying
              </span>
            ) : undefined
          }
        />
        <Tile
          testId="planning-tile-schedule"
          icon={Calendar}
          label="Schedule"
          state={scheduleState}
          isActive={activePanel === "schedule"}
          emptyDescription="Nothing planned yet"
          emptyCTA="Add items"
          completeValue={`${scheduleCount} ${scheduleCount === 1 ? "item" : "items"}`}
          editLabel="Manage schedule"
          preview={schedulePreview}
          anyPanelOpen={!!activePanel}
          canEdit={canEdit}
          onClick={scheduleState !== "skipped" ? () => handleTileClick("schedule") : undefined}
          onSkip={() => handleSkip("schedule")}
          onUnskip={() => handleUnskip("schedule")}
          skipping={pendingTile === "schedule"}
          skippedNudge={
            scheduleState === "skipped" && crewState === "complete" ? (
              <span
                className="mt-1 block text-[11px]"
                style={{ color: "var(--color-bt-warning)" }}
              >
                Your crew won&apos;t know what&apos;s planned
              </span>
            ) : undefined
          }
        />
      </div>

        {/* ── Expanded panel — only one open at a time ──────────────────── */}
        {activePanel !== null && (
          <div
            className="mt-2 overflow-hidden rounded-xl"
            style={{ border: "1px solid var(--color-bt-border)" }}
            data-testid="planning-expanded-panel"
          >
            {activePanel === "crew" && (
              <div className="px-4 py-4">
                <CrewTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )}
            {activePanel === "lodging" && (
              <div className="px-4 py-4">
                <LodgingTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )}
            {activePanel === "schedule" && (
              <div className="px-4 py-4">
                <ScheduleTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )}
            {activePanel === "dates" && datesPanelBody}
          </div>
        )}
      </div>

      {/* ── MOBILE: tab bar + content (hidden sm+) ──────────────────────── */}
      <div className="sm:hidden">
        {/* Inline mobile tab bar — tile-style icon squares */}
        <div className="flex">
          {PLANNING_MOBILE_TABS.map(({ id, label, Icon }) => {
            const active = mobileActiveTab === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`mobile-planning-tab-${id}`}
                onClick={() => handleMobileTabChange(id)}
                className="flex flex-1 flex-col items-center gap-1.5 py-3"
                style={{ background: "transparent", border: "none" }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{
                    background: active
                      ? "var(--color-bt-accent)"
                      : "var(--color-bt-card-raised)",
                    color: active
                      ? "var(--color-bt-base)"
                      : "var(--color-bt-text-dim)",
                  }}
                >
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        {/* Tab content — same panel structure as desktop expanded panel */}
        <div
          className="mt-3 overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--color-bt-border)" }}
          data-testid="planning-mobile-panel"
        >
          {mobileActiveTab === "dates" && (
            datesState === "skipped" ? (
              <div className="flex flex-col items-center gap-3 px-6 py-8">
                <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Opted out of dates</p>
                {canEdit && (
                  <button type="button" onClick={() => handleUnskip("dates")} disabled={pendingTile === "dates"}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >Opt in</button>
                )}
              </div>
            ) : (
              datesPanelBody ?? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm italic" style={{ color: "var(--color-bt-text-dim)" }}>
                    {datesLocked ? lockedDateLabel : "Dates not yet confirmed"}
                  </p>
                </div>
              )
            )
          )}
          {mobileActiveTab === "crew" && (
            crewState === "skipped" ? (
              <div className="flex flex-col items-center gap-3 px-6 py-8">
                <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Opted out of crew</p>
                {canEdit && (
                  <button type="button" onClick={() => handleUnskip("crew")} disabled={pendingTile === "crew"}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >Opt in</button>
                )}
              </div>
            ) : (
              <div className="px-4 py-4">
                <CrewTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )
          )}
          {mobileActiveTab === "lodging" && (
            lodgingState === "skipped" ? (
              <div className="flex flex-col items-center gap-3 px-6 py-8">
                <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Opted out of lodging</p>
                {canEdit && (
                  <button type="button" onClick={() => handleUnskip("lodging")} disabled={pendingTile === "lodging"}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >Opt in</button>
                )}
              </div>
            ) : (
              <div className="px-4 py-4">
                <LodgingTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )
          )}
          {mobileActiveTab === "schedule" && (
            scheduleState === "skipped" ? (
              <div className="flex flex-col items-center gap-3 px-6 py-8">
                <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>Opted out of schedule</p>
                {canEdit && (
                  <button type="button" onClick={() => handleUnskip("schedule")} disabled={pendingTile === "schedule"}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >Opt in</button>
                )}
              </div>
            ) : (
              <div className="px-4 py-4">
                <ScheduleTab trip={trip} role={null} canEdit={canEdit} isOwner={isOwner} embedded={true} />
              </div>
            )
          )}
        </div>
      </div>

      {/* ── View Itinerary — always visible, all breakpoints ────────────── */}
      {isOwner && (
        <div className="flex items-center justify-between gap-3">
          <p className="flex-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {allResolved ? (
              <>
                Everything&apos;s set —{" "}
                <span style={{ color: "var(--color-bt-accent)" }}>
                  let&apos;s make it official
                </span>
              </>
            ) : (
              "Complete or skip all four areas to continue"
            )}
          </p>
          <button
            type="button"
            data-testid="view-itinerary-btn"
            disabled={!allResolved}
            onClick={allResolved ? onAdvanceToGoing : undefined}
            className="flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={
              allResolved
                ? {
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                    cursor: "pointer",
                  }
                : {
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "0.5px solid var(--color-bt-border)",
                    cursor: "not-allowed",
                  }
            }
          >
            View Itinerary
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
