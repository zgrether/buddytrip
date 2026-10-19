"use client";

import type { FinalizePayout } from "@/lib/finalizePayout";
import { ordinalShort, fmtValue } from "@/components/competition/CompetitionGamesPanel";

/**
 * What a game will pay, shown beside "Save results" before it is final
 * (#1639): each finisher's points, then any share of the split that no
 * finisher can occupy, with its reason.
 *
 * Persistence-agnostic (CLAUDE.md #7): the view computes the payout with
 * `src/lib/finalizePayout.ts` and passes it in with the names to show. No
 * confirm step: the summary sits next to the existing button, so finalize keeps
 * the bare CTA it has always had (Zach, 2026-10-19).
 */

const pts = (n: number) => `${fmtValue(n)} ${n === 1 ? "pt" : "pts"}`;

export function FinalizePayoutSummary({
  payout,
  units,
  unitWord,
}: {
  payout: FinalizePayout;
  /** id → display, for every unit that can appear in `payout.lines`. */
  units: Map<string, { name: string; color?: string | null }>;
  /** What a finisher is, for the unpaid reason: "only 2 teams finished". */
  unitWord: { one: string; many: string };
}) {
  const unpaidTotal = payout.unpaid.reduce((sum, u) => sum + u.points, 0);
  return (
    <div
      className="rounded-xl border px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
      data-testid="finalize-payout"
    >
      <div
        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Payout
      </div>

      {payout.lines.map((l) => {
        const u = units.get(l.unitId);
        return (
          <div key={l.unitId} className="flex items-center gap-2.5 py-1" data-testid={`finalize-payout-row-${l.unitId}`}>
            <span className="w-7 flex-shrink-0 text-[13px] font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
              {ordinalShort(l.place)}
            </span>
            <span
              style={{ width: 9, height: 9, borderRadius: "50%", background: u?.color ?? "var(--color-bt-text-dim)", flexShrink: 0 }}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {u?.name ?? "—"}
            </span>
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{ color: "var(--color-bt-text)" }}
              data-testid={`finalize-payout-points-${l.unitId}`}
            >
              {pts(l.points)}
            </span>
          </div>
        );
      })}

      {payout.unpaid.length > 0 && (
        <div
          className="mt-1 pt-1.5"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
          data-testid="finalize-payout-unpaid"
        >
          <div className="flex items-center gap-2.5 py-0.5">
            <span className="min-w-0 flex-1 text-[13px] font-semibold" style={{ color: "var(--color-bt-text-dim)" }}>
              Not paid
            </span>
            <span className="text-[13px] font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
              {pts(unpaidTotal)}
            </span>
          </div>
          {payout.unpaid.map((u) => (
            <p key={u.place} className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {ordinalShort(u.place)} place:{" "}
              {u.finishers === 0
                ? "nobody finished"
                : `only ${u.finishers} ${u.finishers === 1 ? unitWord.one : unitWord.many} finished`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
