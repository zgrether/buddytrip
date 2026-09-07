"use client";

import { Avatar } from "@/components/Avatar";
import { ordinalShort } from "@/components/competition/CompetitionGamesPanel";
import type { SkinsStanding, SkinsGroupingTally } from "@/lib/skins";
import type { Participant } from "../types";

/**
 * SkinsBoard — individual rows ordered by skins won, with the group each row was
 * competing in beside it.
 *
 * ── The grouping HAS to be visible, and this is one of three ways ──────────
 *
 * A skins game is several independent contests on one round: four A golfers play
 * each other, four B golfers play each other, and a tie in one does not touch
 * the other's pot. So a reader looking at a row has to know which three or four
 * people it was competing against, or the ordering above it is a comparison
 * between people who never met.
 *
 * Three shapes are defensible and this file implements the COLUMN, with the
 * groups' pots carried above it. The other two — a section per group, or a
 * switcher showing one group at a time — are noted here rather than silently
 * discarded, because the choice is a design call and the argument should survive
 * the commit:
 *
 *   · SECTIONS say the independence structurally rather than by annotation, and
 *     give each pot an obvious home. They cost four headers for sixteen rows on
 *     a phone, and they remove the one thing a single ordering is good at —
 *     "who has won the most skins today", which is a real question even across
 *     independent contests, because every group plays for the same total.
 *   · FOUR BOARDS are the truest to the model and cost a tap to see the field.
 *
 * The column keeps the field ordering and pays for it with a chip per row. What
 * it must not do is imply the rows are competing WITH each other, which is why
 * the pots sit above in their own strip: the strip is where the independence is
 * stated, and the chip is what ties a row back to it.
 *
 * Presentation-only (CLAUDE.md #7): rows and tallies arrive as props.
 */
export function SkinsBoard({
  rows,
  participants,
  tallies,
  groupNames,
  perGrouping,
  meId,
}: {
  /** From `computeSkinsStandings` — already ordered, this file never sorts. */
  rows: SkinsStanding[];
  participants: Participant[];
  /** groupingId → tally, for the pot strip. */
  tallies: Record<string, SkinsGroupingTally>;
  /** groupingId → display name. */
  groupNames: Record<string, string>;
  /** What each group plays for over the whole round — the same for all of them. */
  perGrouping: number;
  meId?: string;
}) {
  const pById = new Map(participants.map((p) => [p.id, p]));
  const anyStarted = rows.some((r) => r.started);
  const groupingIds = Object.keys(tallies);

  return (
    <div style={{ padding: "12px 12px 4px" }} data-testid="skins-board">
      {/* ── The pots ──────────────────────────────────────────────────────
          Above the board and separate from it, because these are facts about
          the CONTESTS and the rows below are facts about people. A pot at 4
          going into 17 is the most interesting number on the screen and it
          belongs to a group, not to anybody in it. */}
      {groupingIds.length > 0 && (
        <div className="mb-3" data-testid="skins-pots">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Groups
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              {perGrouping} skins each
            </span>
          </div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {groupingIds.map((gid) => {
              const t = tallies[gid];
              const nextUnplayed = t.lines.find((l) => l.status === "unplayed");
              return (
                <div
                  key={gid}
                  className="flex items-center justify-between"
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                  data-testid={`skins-pot-row-${gid}`}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-bt-text)" }}>
                    {groupNames[gid] ?? "Group"}
                  </span>
                  {/*
                    Three sentences for three states, because the NUMBER cannot
                    tell them apart: a 4 is either what the next hole is playing
                    for or what nobody will ever be paid, and a group that has
                    not teed off has the same 0 as one that has settled every
                    hole cleanly.
                  */}
                  <span
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}
                    data-testid={`skins-pot-state-${gid}`}
                  >
                    {t.potIsDead ? (
                      <span style={{ color: "var(--color-bt-text-dim)" }}>
                        {t.carried} unpaid · {t.awarded} won
                      </span>
                    ) : t.carried > 0 && nextUnplayed ? (
                      <span style={{ color: "var(--color-bt-glorious)", fontWeight: 700 }}>
                        {nextUnplayed.pot} on hole {nextUnplayed.hole}
                      </span>
                    ) : t.awarded === 0 ? (
                      "Not started"
                    ) : (
                      `${t.awarded} of ${perGrouping} won`
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Leaderboard
        </span>
        {anyStarted && (
          <span className="w-12 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Skins
          </span>
        )}
      </div>

      {!anyStarted ? (
        <div
          className="rounded-xl border px-4 py-6 text-center"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
          data-testid="skins-board-empty"
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>No holes recorded</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Tap a group below to start recording — the board fills in as holes land.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => {
            const p = pById.get(r.entityId);
            const isFirst = i === 0;
            return (
              <div
                key={r.entityId}
                className="flex items-center gap-3"
                style={{
                  paddingTop: isFirst ? 0 : 8,
                  paddingBottom: 8,
                  borderTop: isFirst ? undefined : "1px solid var(--color-bt-subtle-border)",
                }}
                data-testid={`skins-row-${r.entityId}`}
              >
                <span
                  className="w-7 shrink-0 text-[12px] font-semibold tabular-nums"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {r.started ? ordinalShort(r.position) : "—"}
                </span>
                <Avatar name={p?.name ?? "Player"} avatarIcon={p?.avatarIcon} teamColor={p?.color} sizePx={28} collapse />
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-text)" }}>
                    {p?.name ?? "Player"}
                    {r.entityId === meId && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-bt-text-dim)" }}> · You</span>
                    )}
                  </div>
                </div>
                {/* The chip is the whole reason a single ordering is honest —
                    it says which three or four people this row was actually
                    playing. Without it the board compares strangers. */}
                <span
                  className="shrink-0 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    maxWidth: 92,
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                  data-testid={`skins-group-chip-${r.entityId}`}
                >
                  {groupNames[r.groupingId] ?? "—"}
                </span>
                <span
                  className="w-12 text-right text-[14px] font-bold tabular-nums"
                  style={{ color: "var(--color-bt-text)" }}
                  data-testid={`skins-count-${r.entityId}`}
                >
                  {/* A player whose GROUP has not begun shows a dash, not a 0:
                      "has won nothing over nine holes" and "has not teed off"
                      are different facts and only one of them is a score. */}
                  {r.started ? r.skins : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
