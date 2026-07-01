"use client";

import { ChevronLeft, ChevronRight, Check } from "lucide-react";

/**
 * Shared chrome for the per-hole entry views (Slice A `ScoreEntryView` and
 * Slice B `MatchEntryView`) — the segmented progress bar, the nav arrows, and
 * the bottom CTA. One copy so the stroke-play and match-play surfaces stay
 * visually identical (the Slice B reuse boundary: "hole nav + segmented
 * progress — none" changed).
 */

/**
 * Segmented hole-progress bar. `completed` is the set of fully-scored hole
 * NUMBERS (not a count) — so a GAP before the furthest-reached hole renders
 * AMBER (= skipped). Done = quiet slate, current = teal, future = faint.
 */
export function HoleProgress({
  count,
  currentHole,
  completed,
  maxWidth = 232,
}: {
  count: number;
  currentHole: number;
  completed: number[];
  /** Cap the bar width (default 232, centered). Pass "100%" for edge-to-edge. */
  maxWidth?: number | string;
}) {
  const reached = Math.max(currentHole, ...(completed.length ? completed : [currentHole]));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2.5,
        height: 4,
        width: "100%",
        maxWidth,
        margin: "0 auto",
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const h = i + 1;
        const isDone = completed.includes(h);
        const isCurrent = h === currentHole;
        const isMissing = !isDone && !isCurrent && h < reached;
        let bg = "var(--color-bt-card-raised)"; // future
        let op = 0.6;
        if (isDone) {
          bg = "var(--color-bt-text-dim)"; // slate — quiet
          op = 0.85;
        } else if (isMissing) {
          bg = "var(--color-bt-warning)"; // amber — skipped
          op = 1;
        } else if (isCurrent) {
          bg = "var(--color-bt-accent)"; // teal — you are here
          op = 1;
        }
        return <div key={h} style={{ flex: 1, height: 4, borderRadius: 2, background: bg, opacity: op }} />;
      })}
    </div>
  );
}

export function NavArrow({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous hole" : "Next hole"}
      className="flex items-center justify-center"
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: disabled ? "transparent" : "var(--color-bt-card)",
        border: disabled ? "1px solid transparent" : "1px solid var(--color-bt-border)",
        color: disabled ? "transparent" : "var(--color-bt-text)",
      }}
    >
      {dir === "prev" ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}

export function BottomCTA({
  label,
  onClick,
  subtext,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  subtext?: string;
  icon?: boolean;
  /** Spec 1a — honest advance: the CTA is held (dimmed, non-interactive) while
   *  the current hole's scores aren't CONFIRMED saved. `subtext` names the reason. */
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--color-bt-card-float)",
        borderTop: "1px solid var(--color-bt-border)",
        padding: "12px 16px 24px",
      }}
    >
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:cursor-default"
        style={{
          height: 54,
          borderRadius: 12,
          background: disabled ? "var(--color-bt-card-raised)" : "var(--color-bt-accent)",
          color: disabled ? "var(--color-bt-text-dim)" : "#0d1f1a",
          fontSize: 17,
          fontWeight: 600,
          opacity: disabled ? 0.75 : 1,
        }}
      >
        {icon && !disabled && <Check size={20} strokeWidth={2.2} />}
        {label}
      </button>
      {subtext && (
        <div className="text-center" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 8 }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
