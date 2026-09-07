"use client";

import { Avatar } from "@/components/Avatar";
import { ordinalShort } from "@/components/competition/CompetitionGamesPanel";
import { thruLabel } from "@/lib/thruLabel";
import type { StrokeTeamStanding } from "@/lib/strokePlay";
import type { SkinsStanding } from "@/lib/skins";
import type { Participant } from "../types";

/**
 * SkinsBoard — Stableford's board, with SKINS where Stableford has PTS.
 *
 * ── It is deliberately the SAME board, not a cousin ───────────────────────
 *
 * Team totals on top, the flat individual leaderboard below it, the group tiles
 * under that (rendered by the view, not here). Same eyebrows, same row anatomy,
 * same ordinals, same empty states. A reader who has used the Stableford board
 * knows this one without being taught it, and the two cannot drift into looking
 * like different products.
 *
 * ── What was here and was REMOVED, so it does not come back ───────────────
 *
 * A "GROUPS · N SKINS EACH" strip carrying each group's carry state, and a
 * group chip on every row.
 *
 * The strip's only real content was the carry — "4 on hole 17" — and that
 * belongs on the ENTRY screen's pot banner, which already answers exactly that
 * question at the moment it is being asked. On the board it was a second home
 * for one fact, and the board is not where anyone decides what to do about it.
 *
 * The chips were an answer to "these are independent contests, so a single
 * ordering compares strangers". That is true, and it is not worth a column:
 * Stableford's board does not carry one, every group plays for the same total,
 * and the group tiles below already say who is with whom. A chip per row is a
 * permanent cost paid for an occasional question.
 *
 * ── The columns ───────────────────────────────────────────────────────────
 *
 * THRU and SKINS. Stableford's RND and TO PAR are absent because skins has
 * neither — no strokes are stored, so there is no round score and nothing to be
 * over par by. `thruLabel` is the shared formatter (F for a finished round), so
 * this reads identically to the other three boards.
 *
 * Presentation-only (CLAUDE.md #7): rows arrive ordered and this file never
 * sorts.
 */
export function SkinsBoard({
  rows,
  teamRows,
  teams,
  participants,
  unitCount,
  thruOf,
}: {
  /** From `computeSkinsStandings` — already ordered. */
  rows: SkinsStanding[];
  /** From `computeStrokeTeamStandings` over those rows — the SAME roll-up
   *  Stableford banks, which is what makes the two sections agree. */
  teamRows: StrokeTeamStanding[];
  /** id → display, for the teams in the competition. */
  teams: { id: string; name: string; color: string }[];
  participants: Participant[];
  /** The round's real length, for `thruLabel`'s F. Never a literal 18. */
  unitCount: number;
  /** How many holes this player's GROUP has recorded — progress is a property of
   *  the group here, not of the person, because a hole is decided for all of
   *  them at once. */
  thruOf: (groupingId: string) => number;
}) {
  const pById = new Map(participants.map((p) => [p.id, p]));
  const tById = new Map(teams.map((t) => [t.id, t]));
  const anyStarted = rows.some((r) => r.started);

  return (
    <>
      {/* ── TEAM TOTALS ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 12px 4px" }} data-testid="skins-team-totals">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Team totals
          </span>
          {teamRows.length > 0 && (
            <span className="w-12 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Skins
            </span>
          )}
        </div>

        {teamRows.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-6 text-center"
            style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
            data-testid="skins-team-totals-empty"
          >
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>No team has started</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              Totals appear as each team&rsquo;s players win holes.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {teamRows.map((r, i) => {
              const t = tById.get(r.teamId);
              const isFirst = i === 0;
              return (
                <div
                  key={r.teamId}
                  className="flex items-center gap-3"
                  style={{
                    paddingTop: isFirst ? 0 : 8,
                    paddingBottom: 8,
                    borderTop: isFirst ? undefined : "1px solid var(--color-bt-subtle-border)",
                  }}
                  data-testid={`skins-team-row-${r.teamId}`}
                >
                  <span className="w-6 flex-shrink-0 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                    {ordinalShort(r.position)}
                  </span>
                  <span
                    style={{ width: 10, height: 10, borderRadius: "50%", background: t?.color ?? "var(--color-bt-text-dim)", flexShrink: 0 }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                    {t?.name ?? "Team"}
                  </span>
                  <span
                    className="w-12 text-right text-sm font-bold tabular-nums"
                    style={{ color: "var(--color-bt-text)" }}
                    data-testid={`skins-team-total-${r.teamId}`}
                  >
                    {r.total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── LEADERBOARD ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 12px 4px" }} data-testid="skins-board">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Leaderboard
          </span>
          {anyStarted && (
            <div className="flex items-center gap-4">
              <span className="w-10 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Thru
              </span>
              <span
                className="w-11 text-right text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
                data-testid="skins-lb-col-skins"
              >
                Skins
              </span>
            </div>
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
                  className="@container flex items-center gap-3"
                  style={{
                    paddingTop: isFirst ? 0 : 8,
                    paddingBottom: 8,
                    borderTop: isFirst ? undefined : "1px solid var(--color-bt-subtle-border)",
                    opacity: r.started ? 1 : 0.6, // not-started reads as pending
                  }}
                  data-testid={`skins-row-${r.entityId}`}
                >
                  <span className="w-6 flex-shrink-0 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                    {r.started ? ordinalShort(r.position) : "—"}
                  </span>
                  <Avatar
                    name={p?.name ?? "Player"}
                    avatarIcon={p?.avatarIcon ?? null}
                    teamColor={p?.color ?? null}
                    sizePx={30}
                    collapse
                    collapseAt="dense"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                    {p?.name ?? "Player"}
                  </span>
                  <span
                    className="w-10 text-right text-[13px] tabular-nums"
                    style={{ color: "var(--color-bt-text-dim)" }}
                    data-testid={`skins-thru-${r.entityId}`}
                  >
                    {r.started ? thruLabel(thruOf(r.groupingId), unitCount) : "—"}
                  </span>
                  <span
                    className="w-11 text-right text-sm font-bold tabular-nums"
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
    </>
  );
}
