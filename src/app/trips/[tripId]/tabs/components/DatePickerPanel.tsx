"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { parseLocalDate } from "@/lib/dates";

// ── Types ────────────────────────────────────────────────────────────────

export interface DatePickerPanelProps {
  /** Passed through for context; parent owns the mutation. */
  tripId: string;
  initialStartDate: string | null;
  initialEndDate: string | null;
  /** Called when the user clicks "Set dates" with valid inputs. */
  onSave: (startDate: string, endDate: string) => void;
  /** True while the parent's mutation is in-flight. */
  isSaving: boolean;
  /** When provided, renders a ghost "Cancel" button. */
  onCancel?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nightsBetween(start: string, end: string): number {
  return Math.round(
    (parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86400000
  );
}

function fmtShort(d: string): string {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * DatePickerPanel — shared "Pick your Dates" primitive.
 *
 * Renders two date inputs + a nights preview + Set dates / Cancel buttons.
 * Validation is self-contained; the parent supplies `onSave`/`isSaving`
 * and owns the actual mutation.
 */
export function DatePickerPanel({
  tripId: _tripId,
  initialStartDate,
  initialEndDate,
  onSave,
  isSaving,
  onCancel,
}: DatePickerPanelProps) {
  const [directStart, setDirectStart] = useState(initialStartDate ?? "");
  const [directEnd, setDirectEnd] = useState(initialEndDate ?? "");

  const bothFilled = !!directStart && !!directEnd;
  const valid = bothFilled && directStart < directEnd;
  const invalid = bothFilled && !valid;

  const nights = valid ? nightsBetween(directStart, directEnd) : null;

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    border: "1px solid var(--color-bt-border)",
    color: "var(--color-bt-text)",
    colorScheme: "dark" as const,
  };

  return (
    <div className="space-y-3">
      {/* Description */}
      <p className="text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
        Already know the dates? Lock them in directly.
      </p>

      {/* Date inputs */}
      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Start date
          </label>
          <input
            type="date"
            value={directStart}
            onChange={(e) => setDirectStart(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm"
            style={inputStyle}
          />
        </div>
        <div className="flex-1 space-y-1">
          <label
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            End date
          </label>
          <input
            type="date"
            value={directEnd}
            onChange={(e) => setDirectEnd(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Nights preview when valid; error when both filled but invalid */}
      {valid && nights !== null && (
        <p className="text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {fmtShort(directStart)} → {fmtShort(directEnd)} ·{" "}
          <span style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>
            {nights}
          </span>{" "}
          night{nights !== 1 ? "s" : ""}
        </p>
      )}
      {invalid && (
        <p className="text-center text-xs" style={{ color: "var(--color-bt-danger)" }}>
          End date must be after start date
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!valid || isSaving}
          onClick={() => valid && onSave(directStart, directEnd)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {isSaving && <Loader2 size={14} className="animate-spin" />}
          Set dates
        </button>
      </div>
    </div>
  );
}
