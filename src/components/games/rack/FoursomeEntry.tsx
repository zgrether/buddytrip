"use client";

import { ChevronRight } from "lucide-react";

/**
 * Groups (entry) for rack-n-stack (addendum §3). One card per foursome; tapping
 * opens that group's stroke-play scorecard. The viewer's own group is emphasized
 * (accent) with an "Enter ›" CTA. A group that hasn't teed off reads "not
 * started" here — so there's no separate "haven't teed off" list on the rack.
 *
 * Presentational: composed onto the rack page (NOT part of the display board).
 */

export interface FoursomePlayer {
  id: string;
  name: string;
  teamColor: string;
}
export interface FoursomeGroupView {
  id: string;
  name: string;
  teeLabel: string | null; // e.g. "7:40" — null when no tee set
  thru: number | null; // null = not started
  players: FoursomePlayer[];
  mine: boolean;
}

export function FoursomeEntry({ groups, onEnter }: { groups: FoursomeGroupView[]; onEnter: (groupId: string) => void }) {
  return (
    <div style={{ padding: "12px 12px 4px" }}>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Groups · tap to enter scores
      </span>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onEnter(g.id)}
            className="min-w-0 rounded-xl border text-left"
            style={{
              padding: "10px 12px",
              background: g.mine ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
              borderColor: g.mine ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
            }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{g.name}</span>
              {g.mine ? (
                <span className="flex items-center gap-0.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-accent)" }}>
                  Enter <ChevronRight size={15} />
                </span>
              ) : (
                <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
              )}
            </div>
            <div className="truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 1, whiteSpace: "nowrap" }}>
              {g.teeLabel ? `${g.teeLabel} tee · ` : ""}
              {g.thru == null ? "not started" : `thru ${g.thru}`}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {g.players.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.teamColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "var(--color-bt-text)" }}>{p.name}</span>
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
