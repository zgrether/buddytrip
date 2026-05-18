"use client";

import { useEffect, useMemo, useState } from "react";
import { X, CalendarCheck, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DatePickerPanel } from "../tabs/components/DatePickerPanel";
import { DatePollCard } from "../tabs/components/DatePollCard";
import { ConfirmDatesModal } from "./ConfirmDatesModal";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import type { TripData } from "../tabs/types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  /**
   * When provided and the user taps "Manage crew" inside the poll grid,
   * we hand them off to the Crew tab. Optional — owner-only context.
   */
  onTabChange?: (tab: string) => void;
}

type Mode = "set" | "poll";

// ── Component ────────────────────────────────────────────────────────────

/**
 * DatesSheet — single surface for setting / polling / clearing trip dates.
 *
 * Opens from the "Set dates →" / "Polling crew →" / locked-range link in the
 * trip header. Replaces the home-tab DatesPanel (which has been retired with
 * the basic planning stage).
 *
 *   Mode 1 — Pick dates (default)
 *     Lock dates directly. Pre-filled when dates already locked; offers a
 *     "Clear dates" link in that case. Drops into ConfirmDatesModal when a
 *     date poll exists so the owner can choose to preserve or clear votes.
 *
 *   Mode 2 — Poll the crew
 *     Embeds the existing DatePollCard. Locking a window from the grid
 *     closes the sheet via the same effect that detects dates appearing
 *     in the cache.
 *
 * Renders as a centred modal — same fixed-inset overlay treatment used by
 * DatesModal across the rest of the trip detail page (the trip header lives
 * inside the page content, not the backdrop-filter nav, so position:fixed
 * is anchored to the viewport as expected).
 */
export function DatesSheet({
  isOpen,
  onClose,
  tripId,
  trip,
  isOwner,
  onTabChange,
}: DatesSheetProps) {
  const utils = trpc.useUtils();

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;

  // Default mode: poll if a poll is already in flight, otherwise pick.
  const [mode, setMode] = useState<Mode>(pollMode && !datesLocked ? "poll" : "set");
  const [pendingStart, setPendingStart] = useState("");
  const [pendingEnd, setPendingEnd] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  // Reset mode whenever the sheet re-opens so the default reflects the
  // *current* server state (e.g. user opened it, started a poll, closed,
  // re-opened — the poll mode should be the default now).
  useEffect(() => {
    if (isOpen) {
      setMode(pollMode && !datesLocked ? "poll" : "set");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useModalBackButton(isOpen ? onClose : () => {});

  // Fetch the active poll only when needed for the ConfirmDatesModal's
  // "preserve poll votes" check. tRPC dedupes against the DatePollCard's
  // identical query in poll mode, so this is free.
  const { data: poll } = trpc.datePoll.get.useQuery(
    { tripId },
    { enabled: isOpen && isOwner && !datesLocked }
  );
  const pollWindows = useMemo(
    () =>
      (poll?.windows ?? []) as Array<{
        id: string;
        start_date: string;
        end_date: string;
      }>,
    [poll?.windows]
  );

  // ── Mutations ──────────────────────────────────────────────────────────

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? {
              ...old,
              start_date: vars.startDate,
              end_date: vars.endDate,
              poll_mode: false,
            }
          : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setShowConfirm(false);
      setPendingStart("");
      setPendingEnd("");
      onClose();
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const clearDatesMutation = trpc.datePoll.unlock.useMutation({
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const setPollActive = trpc.datePoll.setPollMode.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: vars.pollMode } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── Actions ────────────────────────────────────────────────────────────

  /** Called by DatePickerPanel with valid inputs. */
  const handleDatePickerSave = (start: string, end: string) => {
    if (pollMode) {
      // Need ConfirmDatesModal to handle the preserve-or-clear choice.
      setPendingStart(start);
      setPendingEnd(end);
      setShowConfirm(true);
    } else {
      // No poll → straight lock.
      lockDates.mutate({ tripId, startDate: start, endDate: end });
    }
  };

  /** Called by ConfirmDatesModal. */
  const handleConfirmDates = (preservePoll: boolean) => {
    if (!pendingStart || !pendingEnd) return;
    if (pollMode && !preservePoll) {
      setPollActive.mutate({ tripId, pollMode: false });
    }
    lockDates.mutate({
      tripId,
      startDate: pendingStart,
      endDate: pendingEnd,
    });
  };

  const handleClearDates = () => {
    clearDatesMutation.mutate({ tripId });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop + centred container. Click outside to dismiss. */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Trip dates"
      >
        <div
          className="w-full max-w-[480px] overflow-hidden rounded-t-2xl sm:rounded-2xl"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            maxHeight: "min(85dvh, 720px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <p
              className="text-base font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Trip dates
            </p>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body — scrollable when content overflows */}
          <div
            className="overflow-y-auto px-5 pb-5"
            style={{ maxHeight: "calc(85dvh - 70px)" }}
          >
            {/* Mode toggle. Hidden for non-owners — they only ever see the
                poll (DatePollCard) since they can't lock dates anyway. */}
            {isOwner && !datesLocked && (
              <div
                className="mb-4 flex overflow-hidden rounded-xl"
                style={{ border: "1px solid var(--color-bt-border)" }}
              >
                <ModeButton
                  active={mode === "set"}
                  onClick={() => setMode("set")}
                  icon={<CalendarCheck size={15} />}
                  label="Pick dates"
                />
                <div
                  className="w-px self-stretch"
                  style={{ background: "var(--color-bt-border)" }}
                />
                <ModeButton
                  active={mode === "poll"}
                  onClick={() => setMode("poll")}
                  icon={<Users size={15} />}
                  label="Poll the crew"
                  badge={pollMode ? "Active" : undefined}
                />
              </div>
            )}

            {/* Pick dates mode */}
            {mode === "set" && (
              <PickDatesMode
                tripId={tripId}
                datesLocked={datesLocked}
                startDate={trip.start_date ?? null}
                endDate={trip.end_date ?? null}
                isOwner={isOwner}
                isSaving={lockDates.isPending}
                isClearing={clearDatesMutation.isPending}
                onSave={handleDatePickerSave}
                onSwitchToPoll={() => setMode("poll")}
                onClear={handleClearDates}
              />
            )}

            {/* Poll mode */}
            {mode === "poll" && (
              <DatePollCard
                trip={trip}
                isOwner={isOwner}
                onManageCrew={
                  onTabChange
                    ? () => {
                        onClose();
                        onTabChange("crew");
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modal — handles poll-window preserve/clear choice.
          Rendered as a sibling so it stacks above the sheet. */}
      {showConfirm && pendingStart && pendingEnd && (
        <ConfirmDatesModal
          startDate={pendingStart}
          endDate={pendingEnd}
          hasPoll={pollMode}
          pollWindows={pollWindows}
          isPending={lockDates.isPending}
          onConfirm={handleConfirmDates}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

// ── Mode toggle button ──────────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
      style={
        active
          ? {
              background: "var(--color-bt-card-float)",
              color: "var(--color-bt-text)",
            }
          : {
              background: "transparent",
              color: "var(--color-bt-text-dim)",
            }
      }
    >
      {icon}
      {label}
      {badge && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Pick-dates mode ─────────────────────────────────────────────────────

function PickDatesMode({
  tripId,
  datesLocked,
  startDate,
  endDate,
  isOwner,
  isSaving,
  isClearing,
  onSave,
  onSwitchToPoll,
  onClear,
}: {
  tripId: string;
  datesLocked: boolean;
  startDate: string | null;
  endDate: string | null;
  isOwner: boolean;
  isSaving: boolean;
  isClearing: boolean;
  onSave: (start: string, end: string) => void;
  onSwitchToPoll: () => void;
  onClear: () => void;
}) {
  // Members can't lock dates; show them the locked range read-only.
  if (!isOwner) {
    return (
      <div
        className="rounded-xl px-4 py-4"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <p
          className="text-[13px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {datesLocked
            ? "The organizer has locked the trip dates."
            : "The organizer hasn't picked the dates yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DatePickerPanel
        tripId={tripId}
        initialStartDate={startDate}
        initialEndDate={endDate}
        onSave={onSave}
        isSaving={isSaving}
        showDescription={!datesLocked}
      />

      {/* "Poll the crew instead →" — only when dates aren't locked yet. */}
      {!datesLocked && (
        <button
          type="button"
          onClick={onSwitchToPoll}
          className="text-xs font-medium"
          style={{
            color: "var(--color-bt-accent)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Poll the crew instead &rarr;
        </button>
      )}

      {/* "Clear dates" — danger-styled link when dates are locked. */}
      {datesLocked && (
        <button
          type="button"
          onClick={onClear}
          disabled={isClearing}
          className="text-xs font-medium disabled:opacity-50"
          style={{
            color: "var(--color-bt-danger)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {isClearing ? "Clearing…" : "Clear dates"}
        </button>
      )}
    </div>
  );
}
