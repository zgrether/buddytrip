"use client";

/**
 * EventsPanel — placeholder shell. Fully built in Task 7 of
 * CC_COMPETITION_SETUP.
 */
import { Calendar } from "lucide-react";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

export function EventsPanel(_: Props) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <Calendar size={16} style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Events
        </p>
      </div>
    </div>
  );
}
