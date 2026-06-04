"use client";

import { Check, X } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";
import {
  STYLE_COMPONENTS,
  STYLE_META,
  type ScoreboardData,
  type ScoreboardStyleId,
} from "./scoreboard-styles";

interface Props {
  current: ScoreboardStyleId;
  /** Sample data so each card can show a miniature live preview of the
   *  style with the trip's real teams and events. */
  data: ScoreboardData;
  onPick: (id: ScoreboardStyleId) => void;
  onClose: () => void;
}

/**
 * ScoreboardStyleChooser — bottom-sheet on mobile, centered modal on
 * larger screens. Renders each of the 8 styles as a clickable card with
 * a live miniature preview using the actual teams/events from this
 * competition. The chosen style applies immediately and the sheet stays
 * open so the owner can compare without re-opening it.
 */
export function ScoreboardStyleChooser({
  current,
  data,
  onPick,
  onClose,
}: Props) {
  const ids = Object.keys(STYLE_META) as ScoreboardStyleId[];

  return (
    <ScrollLock>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <div>
            <h3
              className="text-base font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Scoreboard style
            </h3>
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Pick how the official scoreboard renders for the crew
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          {ids.map((id) => {
            const meta = STYLE_META[id];
            const active = id === current;
            const PreviewComponent = STYLE_COMPONENTS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                className="overflow-hidden rounded-xl text-left transition-all"
                style={{
                  background: "var(--color-bt-card)",
                  border: active
                    ? "2px solid var(--color-bt-accent)"
                    : "1px solid var(--color-bt-border)",
                }}
                data-testid={`scoreboard-style-${id}`}
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {meta.label}
                    </p>
                    <p
                      className="truncate text-[11px]"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {meta.description}
                    </p>
                  </div>
                  {active && (
                    <span
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: "var(--color-bt-accent)",
                        color: "var(--color-bt-base)",
                      }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div
                  className="pointer-events-none relative max-h-44 overflow-hidden"
                  style={{
                    borderTop: "1px solid var(--color-bt-border)",
                    // Shrink the preview content so a full style fits in
                    // a compact card without horizontal scroll.
                    transform: "scale(0.78)",
                    transformOrigin: "top left",
                    width: "128.2%",
                  }}
                >
                  <PreviewComponent data={data} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
    </ScrollLock>
  );
}
