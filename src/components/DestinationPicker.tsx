"use client";

import { useState, type ReactNode } from "react";
import { Check, MapPin, Sparkles } from "lucide-react";

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
        Destination Options
      </label>

      <div className="space-y-3">
        {/* ── Path chooser tiles — two side-by-side cards ────────────────── */}
        <div className="mb-7 grid grid-cols-2 gap-2.5">
          <PathTile
            selected={mode === "known"}
            onClick={() => onModeChange("known")}
            icon={<MapPin size={18} />}
            title="I Know Where"
            description="Already decided — jump straight into planning."
          />
          <PathTile
            selected={mode === "exploring"}
            onClick={() => onModeChange("exploring")}
            icon={<Sparkles size={18} />}
            title="Explore Options"
            description="Not sure yet — add ideas and let the crew vote."
          />
        </div>

        {/* ── Known content: header + location input + trailing slot ── */}
        {mode === "known" && (
          <>
            <h2
              className="mb-1 text-lg font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Location
            </h2>
            <div className="flex items-stretch gap-2">
              <input
                autoFocus
                type="text"
                value={destinationText}
                onChange={(e) => onDestinationTextChange(e.target.value)}
                placeholder="Bandon Dunes, OR"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
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

// ── PathTile ──────────────────────────────────────────────────────────────
// Side-by-side card-style chooser. Replaces the old segmented control
// with a more descriptive treatment so the trade-off between paths reads
// at a glance. Selected tile gets accent border + accent-faint bg + a
// teal check pip in the top-right corner.

function PathTile({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const [hover, setHover] = useState(false);
  const showHover = hover && !selected;

  const tileStyle: React.CSSProperties = selected
    ? {
        background: "var(--color-bt-accent-faint)",
        border: "1.5px solid var(--color-bt-accent)",
      }
    : showHover
      ? {
          background: "var(--color-bt-card-raised)",
          border: "1.5px solid var(--color-bt-accent-border)",
        }
      : {
          background: "var(--color-bt-card)",
          border: "1.5px solid var(--color-bt-border)",
        };

  const iconStyle: React.CSSProperties = selected
    ? {
        background: "var(--color-bt-accent-faint)",
        color: "var(--color-bt-accent)",
      }
    : {
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text-dim)",
      };

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative cursor-pointer rounded-xl px-4 py-4 text-left transition-colors"
      style={tileStyle}
    >
      {selected && (
        <div
          className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--color-bt-accent)" }}
          aria-hidden
        >
          <Check size={9} color="var(--color-bt-base)" strokeWidth={3} />
        </div>
      )}
      <div
        className="mb-3 flex h-[38px] w-[38px] items-center justify-center rounded-xl"
        style={iconStyle}
      >
        {icon}
      </div>
      <p
        className="text-sm font-bold"
        style={{
          color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text)",
        }}
      >
        {title}
      </p>
      <p
        className="mt-1 text-xs"
        style={{ color: "var(--color-bt-text-dim)", lineHeight: 1.4 }}
      >
        {description}
      </p>
    </button>
  );
}
