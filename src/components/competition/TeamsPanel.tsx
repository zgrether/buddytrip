"use client";

/**
 * TeamsPanel — placeholder shell. Fully built in Task 6 of
 * CC_COMPETITION_SETUP.
 */
import { Users } from "lucide-react";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  isOwner?: boolean;
}

export function TeamsPanel(_: Props) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <Users size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Teams
        </p>
      </div>
    </div>
  );
}
