"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { parseLocalDate } from "@/lib/dates";

export interface ConfirmDatesModalProps {
  startDate: string;
  endDate: string;
  /**
   * True when the dates come from selecting a poll window directly (not manual
   * entry). In this case poll data is always preserved and no warning is shown.
   */
  fromPollWindow?: boolean;
  /** Whether a date poll is currently active. */
  hasPoll: boolean;
  /**
   * Existing poll windows. Used to detect an exact match against manually-
   * entered dates so we can offer to preserve votes.
   */
  pollWindows?: Array<{ id: string; start_date: string; end_date: string }>;
  isPending: boolean;
  /** Called with true if poll data should be kept, false if it should clear. */
  onConfirm: (preservePoll: boolean) => void;
  onCancel: () => void;
}

function formatLong(d: string): string {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ConfirmDatesModal({
  startDate,
  endDate,
  fromPollWindow = false,
  hasPoll,
  pollWindows = [],
  isPending,
  onConfirm,
  onCancel,
}: ConfirmDatesModalProps) {
  // Only relevant for manual-entry: check if the typed dates exactly match a
  // poll window so we can offer to preserve votes.
  const matchingWindow = !fromPollWindow
    ? (pollWindows.find(
        (w) => w.start_date === startDate && w.end_date === endDate
      ) ?? null)
    : null;

  // Default preserve=true when there's a match, false otherwise.
  const [preservePoll, setPreservePoll] = useState(matchingWindow !== null);

  useModalBackButton(onCancel);

  const showPreservedNote = fromPollWindow;
  const showPreserveToggle = hasPoll && !fromPollWindow && matchingWindow !== null;
  const showClearWarning = hasPoll && !fromPollWindow && matchingWindow === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        {/* Title */}
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Set trip dates
        </p>

        {/* Date range chip */}
        <div
          className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
          style={{ background: "var(--color-bt-card-raised)" }}
        >
          <Calendar
            size={15}
            style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
          />
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {formatLong(startDate)}
            <span style={{ color: "var(--color-bt-text-dim)" }}> – </span>
            {formatLong(endDate)}
          </p>
        </div>

        {/* Poll-window path: always preserves data, show confirmation note */}
        {showPreservedNote && (
          <div
            className="mt-3 rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <p className="text-[12px]" style={{ color: "var(--color-bt-text)" }}>
              Poll data and votes will be preserved.
            </p>
          </div>
        )}

        {/* Manual-entry path, matching window: offer preserve toggle */}
        {showPreserveToggle && (
          <div
            className="mt-3 space-y-2 rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <p className="text-[12px] font-medium" style={{ color: "var(--color-bt-text)" }}>
              These dates match a poll option.
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={preservePoll}
                onChange={(e) => setPreservePoll(e.target.checked)}
                style={{ accentColor: "var(--color-bt-accent)" }}
              />
              <span className="text-[12px]" style={{ color: "var(--color-bt-text)" }}>
                Preserve poll votes
              </span>
            </label>
          </div>
        )}

        {/* Manual-entry path, no match, poll active: warn about clearing */}
        {showClearWarning && (
          <div
            className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
          >
            <span style={{ color: "var(--color-bt-warning)", flexShrink: 0 }}>⚠</span>
            <p className="text-[12px]" style={{ color: "var(--color-bt-warning)" }}>
              This will clear the poll and all votes.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(fromPollWindow || preservePoll)}
            disabled={isPending}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            Set dates
          </button>
        </div>
      </div>
    </div>
  );
}
