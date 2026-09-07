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
  /**
   * SCRAMBLE: the tile IS a team, so it wears the team's colour and the player
   * dots go. A dot per player inside a team-coloured card says there is
   * something to tell apart, and there is not — one score, one team.
   *
   * `null` for every other format, which keeps its neutral card and its
   * per-player dots: there the group is a convenience (a cart, a foursome) and
   * the people in it are genuinely different competitors.
   */
  teamColor?: string | null;
  /** Every hole scored. Recedes the card — the group needs nothing further, so it
   *  stops competing for attention with the ones still out on the course. The
   *  CALLER decides this: only it knows the round's unit count. */
  finished?: boolean;
}

export function FoursomeEntry({ groups, onEnter }: { groups: FoursomeGroupView[]; onEnter: (groupId: string) => void }) {
  return (
    <div style={{ padding: "12px 12px 4px" }}>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Groups · tap to enter scores
      </span>
      {/* items-start: when one card is taller (a wrapped name / longer roster),
          the shorter column top-aligns to its row instead of stretching or
          floating mid-height (W3-Rack3). */}
      <div className="mt-2 grid grid-cols-2 items-start gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onEnter(g.id)}
            data-testid="group-enter-row"
            className="min-w-0 rounded-xl border text-left"
            style={{
              padding: "10px 12px",
              // A finished group RECEDES via the surface hierarchy — dropped to
              // `base`, the recessed surface below `card`, rather than an opacity
              // value (STYLE_GUIDE §1). Opacity would fade the team dots and the
              // text unevenly and stack badly with `mine`'s accent wash; a surface
              // token keeps every colour inside intact and still reads as "done".
              // `mine` still wins — the group you're scoring stays emphasized even
              // when complete, because it's still the one you might correct.
              // A team tile is tinted FROM the team colour rather than filled
              // with it: `color-mix` against the card keeps the text contrast the
              // surface hierarchy already guarantees, where a saturated fill
              // would need `teamTextColor` and a second set of rules for five
              // different team colours. The border carries the identity at full
              // strength, which is where the eye reads it anyway.
              background: g.teamColor
                ? `color-mix(in srgb, ${g.teamColor} 14%, var(--color-bt-card))`
                : g.mine
                  ? "var(--color-bt-accent-faint)"
                  : g.finished
                    ? "var(--color-bt-base)"
                    : "var(--color-bt-card)",
              borderColor: g.teamColor
                ? `color-mix(in srgb, ${g.teamColor} 55%, transparent)`
                : g.mine
                  ? "var(--color-bt-accent-border)"
                  : g.finished
                    ? "var(--color-bt-subtle-border)"
                    : "var(--color-bt-border)",
            }}
          >
            <div className="flex items-center justify-between gap-1">
              {/* A TEAM NAME WRAPS; a group label truncates. "Do Dead Hookahs
                  Float" is the whole identity of the tile and reading "Do Dead
                  Hookahs Fl..." tells you almost nothing, where "Group 3" loses
                  nothing to an ellipsis. `items-start` on the grid above already
                  lets one card be taller than its neighbour. */}
              <span
                className={g.teamColor ? "min-w-0" : "min-w-0 truncate"}
                style={{ fontSize: 15, fontWeight: 600, color: g.finished && !g.mine ? "var(--color-bt-text-dim)" : "var(--color-bt-text)" }}
              >{g.name}</span>
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
                  {!g.teamColor && (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.teamColor, flexShrink: 0 }} />
                  )}
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
