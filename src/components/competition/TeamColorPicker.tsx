"use client";

import { TEAM_COLORS, type TakenTeamColors } from "@/lib/teamColors";
import { teamTextColor } from "@/lib/teamTextColor";

/**
 * The team editor's color swatches. A color another team holds stays on show,
 * disabled, with that team's short name on it (Zach, 2026-11-05): the reader can
 * see who has it, not just that it is gone. The team's own color is never in
 * `taken`, so it stays selectable.
 */
export function TeamColorPicker({
  selectedIndex,
  taken,
  onSelect,
}: {
  selectedIndex: number;
  taken: TakenTeamColors;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEAM_COLORS.map((c, i) => {
        const owner = taken.get(c.color.toLowerCase());
        const selected = selectedIndex === i && owner == null;
        return (
          <button
            key={c.color}
            type="button"
            onClick={() => onSelect(i)}
            disabled={owner != null}
            aria-label={owner != null ? `${c.label} (taken by ${owner})` : `${c.label}${selected ? " (selected)" : ""}`}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-transform disabled:cursor-not-allowed"
            style={{
              background: c.color,
              opacity: owner != null ? 0.6 : 1,
              transform: selected ? "scale(1.15)" : "scale(1)",
              border: selected ? "2px solid var(--color-bt-text)" : "1px solid var(--color-bt-border)",
            }}
            data-testid={`team-color-${c.label.toLowerCase()}`}
          >
            {owner != null && (
              <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1, color: teamTextColor(c.color) }}>{owner}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
