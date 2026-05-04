"use client";

/**
 * CompetitionHeader — placeholder shell. Fully built in Task 5 of
 * CC_COMPETITION_SETUP. Renders the competition name + tagline so CompTab
 * has something to show while the rest of the panels come online.
 */
import { Trophy } from "lucide-react";

interface Props {
  competition: {
    id: string;
    name: string;
    tagline: string | null;
    motto: string | null;
  };
  tripId: string;
  canEdit: boolean;
}

export function CompetitionHeader({ competition }: Props) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Trophy size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {competition.name}
          </p>
          {competition.tagline && (
            <p
              className="mt-0.5 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {competition.tagline}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
