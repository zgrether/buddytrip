"use client";

import { MapPin, Sparkles } from "lucide-react";

export type DestinationMode = null | "known" | "exploring";

interface DestinationPickerProps {
  /** When true, hides the "(optional)" label — used in edit mode */
  required?: boolean;
  mode: DestinationMode;
  onModeChange: (mode: DestinationMode) => void;
  destinationText: string;
  onDestinationTextChange: (text: string) => void;
}

export function DestinationPicker({
  required,
  mode,
  onModeChange,
  destinationText,
  onDestinationTextChange,
}: DestinationPickerProps) {
  return (
    <div>
      <label
        className="mb-1.5 block text-sm font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        Where are you headed?
        {!required && (
          <>
            {" "}
            <span style={{ color: "var(--color-bt-text-dim)" }}>(optional)</span>
          </>
        )}
      </label>

      <div className="flex flex-col gap-2">
        {/* Known destination */}
        <button
          type="button"
          onClick={() => onModeChange(mode === "known" ? null : "known")}
          className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all"
          style={{
            background: mode === "known" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
            borderColor: mode === "known" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
          }}
        >
          <MapPin size={18} style={{ color: mode === "known" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", flexShrink: 0 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              I know where we&apos;re going
            </p>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Lock in a destination now
            </p>
          </div>
        </button>

        {mode === "known" && (
          <input
            autoFocus
            type="text"
            value={destinationText}
            onChange={(e) => onDestinationTextChange(e.target.value)}
            placeholder="Bandon Dunes, OR"
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        )}

        {/* Exploring */}
        <button
          type="button"
          onClick={() => onModeChange(mode === "exploring" ? null : "exploring")}
          className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all"
          style={{
            background: mode === "exploring" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
            borderColor: mode === "exploring" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
          }}
        >
          <Sparkles size={18} style={{ color: mode === "exploring" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", flexShrink: 0 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              Not sure yet — let&apos;s figure it out
            </p>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Browse ideas and vote with the crew
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
