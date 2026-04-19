"use client";

import type { ReactNode } from "react";
import { MapPin, Sparkles } from "lucide-react";

export type DestinationMode = null | "known" | "exploring";

interface DestinationPickerProps {
  /** When true, the whole picker is greyed out and non-interactive */
  disabled?: boolean;
  mode: DestinationMode;
  onModeChange: (mode: DestinationMode) => void;
  destinationText: string;
  onDestinationTextChange: (text: string) => void;
  /** Optional element rendered inline to the right of the "known" destination input
   *  (e.g. a Create Trip button so it lives with the location field instead of
   *  as a separate full-width action below the form). */
  knownTrailing?: ReactNode;
  /** Optional element rendered below the "exploring" tab when selected
   *  (e.g. an inline Add Destination Ideas component in the new-trip flow). */
  exploringContent?: ReactNode;
}

export function DestinationPicker({
  disabled,
  mode,
  onModeChange,
  destinationText,
  onDestinationTextChange,
  knownTrailing,
  exploringContent,
}: DestinationPickerProps) {
  return (
    <div
      aria-disabled={disabled || undefined}
      style={disabled ? { opacity: 0.4, pointerEvents: "none" } : undefined}
    >
      <label
        className="mb-1.5 block text-xl font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        Where are you headed?
      </label>

      <div className="space-y-3">
        {/* ── Segmented control: I Know Where | Compare Ideas ─────────── */}
        <div
          className="flex overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={() => onModeChange("known")}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
            style={
              mode === "known"
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
            <MapPin size={16} />
            I Know Where
          </button>
          <div
            className="w-px self-stretch"
            style={{ background: "var(--color-bt-border)" }}
          />
          <button
            type="button"
            onClick={() => onModeChange("exploring")}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
            style={
              mode === "exploring"
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
            <Sparkles size={16} />
            Compare Ideas
          </button>
        </div>

        {/* ── Known content: header + location input + trailing slot ── */}
        {mode === "known" && (
          <>
            <h2
              className="mb-1 text-lg font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Destination
            </h2>
            <div className="flex items-stretch gap-2">
            <input
              autoFocus
              type="text"
              value={destinationText}
              onChange={(e) => onDestinationTextChange(e.target.value)}
              placeholder="Bandon Dunes, OR"
              className="flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
              style={{
                background: "var(--color-bt-card)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            {knownTrailing}
            </div>
          </>
        )}

        {/* ── Exploring content slot ────────────────────────────────── */}
        {mode === "exploring" && exploringContent}
      </div>
    </div>
  );
}
