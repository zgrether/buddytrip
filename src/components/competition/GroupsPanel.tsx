"use client";

/**
 * GroupsPanel — placeholder shell. Fully built in Task 8 of
 * CC_COMPETITION_SETUP.
 */
import { LayoutGrid } from "lucide-react";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

export function GroupsPanel(_: Props) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <LayoutGrid size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Play Groups
        </p>
      </div>
    </div>
  );
}
