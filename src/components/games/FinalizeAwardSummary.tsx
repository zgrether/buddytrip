"use client";

import type { FinalizeAward } from "@/lib/finalizeAward";
import { AWARD_WORD } from "@/lib/vocabulary";
import { TeamBadge } from "@/components/TeamBadge";
import { ordinalShort, fmtValue } from "@/components/competition/CompetitionGamesPanel";

/**
 * What a game will award, shown beside "Save results" before it is final
 * (#1639): each finisher's points, then any place in the split that no
 * finisher can occupy, with its reason. Points are awarded, never paid
 * (`AWARD_WORD`).
 *
 * Persistence-agnostic (CLAUDE.md #7): the view computes the award with
 * `src/lib/finalizeAward.ts` and passes it in with the names to show. No
 * confirm step: the summary sits next to the existing button, so finalize keeps
 * the bare CTA it has always had (Zach, 2026-10-19).
 */

const pts = (n: number) => `${fmtValue(n)} ${n === 1 ? "pt" : "pts"}`;

export function FinalizeAwardSummary({
  award,
  units,
  unitWord,
}: {
  award: FinalizeAward;
  /** id → display, for every unit that can appear in `award.lines`. */
  units: Map<string, { name: string; shortName?: string | null; color?: string | null }>;
  /** What a finisher is, for the unawarded reason: "only 2 teams finished", and
   *  when there are none, "no team finished". A stroke round can be played
   *  in full by people on no team, so for teams "nobody finished" is false. */
  unitWord: { one: string; many: string; none: string };
}) {
  const unawardedTotal = award.unawarded.reduce((sum, u) => sum + u.points, 0);
  return (
    <div
      className="rounded-xl border px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
      data-testid="finalize-award"
    >
      <div
        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {AWARD_WORD.label}
      </div>

      {award.lines.map((l) => {
        const u = units.get(l.unitId);
        return (
          <div key={l.unitId} className="flex items-center gap-2.5 py-1" data-testid={`finalize-award-row-${l.unitId}`}>
            <span className="w-7 flex-shrink-0 text-[13px] font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
              {ordinalShort(l.place)}
            </span>
            <TeamBadge teamId={l.unitId} name={u?.name ?? "Team"} shortName={u?.shortName} color={u?.color ?? "var(--color-bt-text-dim)"} size={18} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {u?.name ?? "—"}
            </span>
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{ color: "var(--color-bt-text)" }}
              data-testid={`finalize-award-points-${l.unitId}`}
            >
              {pts(l.points)}
            </span>
          </div>
        );
      })}

      {award.unawarded.length > 0 && (
        <div
          className="mt-1 pt-1.5"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
          data-testid="finalize-award-unawarded"
        >
          <div className="flex items-center gap-2.5 py-0.5">
            <span className="min-w-0 flex-1 text-[13px] font-semibold" style={{ color: "var(--color-bt-text-dim)" }}>
              {AWARD_WORD.unawarded}
            </span>
            <span className="text-[13px] font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
              {pts(unawardedTotal)}
            </span>
          </div>
          {award.unawarded.map((u) => (
            <p key={u.place} className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {ordinalShort(u.place)} place:{" "}
              {u.finishers === 0
                ? `${unitWord.none} finished`
                : `only ${u.finishers} ${u.finishers === 1 ? unitWord.one : unitWord.many} finished`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
