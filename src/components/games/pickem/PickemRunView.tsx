"use client";

import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { MatchupLine, pickemRowSurface } from "./slateRowVisual";
import { resolvedCount, type SlateResult, type ScoredSlateGame } from "@/lib/pickemScoring";

/**
 * Run — the runner enters each slate game's outcome as it finishes.
 *
 * ── Any order, and the layout has to mean it ───────────────────────────────
 *
 * Games resolve when they resolve: a Thursday nighter, two on Friday, the bulk
 * on Saturday. Nothing waits on the row above it, so every row is independently
 * actionable and none is disabled by the state of another. The server agrees —
 * `set_pickem_result` never reads `display_order`.
 *
 * ── The status line is a COUNT ─────────────────────────────────────────────
 *
 * "11 of 16 in", never "thru 11". There is no order to be eleven-deep into, and
 * "thru" would assert a sequence the runner does not work in.
 *
 * ── Four outcomes, two weights ─────────────────────────────────────────────
 *
 * Away and Home are the primary buttons — the common case, and the one worth a
 * thumb. Push and Cancelled are secondary, at the same weight as Clear, because
 * all three are rare and all three are corrections of a sort.
 *
 * Push and cancelled score identically (zero for everyone) and are DIFFERENT
 * FACTS: one happened and nobody covered, the other never happened. The screen
 * says which, which is the entire reason they are two values rather than one.
 */

export interface RunSlateGame extends ScoredSlateGame {
  awayTeam: string;
  homeTeam: string;
  spread: string | null;
  kickoff: string | null;
  note: string | null;
}

/** How a resolved row reads. Push and cancelled must not share a label. */
const RESULT_LABEL: Record<SlateResult, string> = {
  away: "Away won",
  home: "Home won",
  push: "Push — nobody covered",
  cancelled: "Cancelled — never played",
};

export function PickemRunView({
  slate,
  canEdit,
  busyId,
  blockedReason,
  onSetResult,
}: {
  slate: RunSlateGame[];
  canEdit: boolean;
  /** The slate game currently being written, so only ITS row shows pending. */
  busyId: string | null;
  /**
   * Why results cannot be entered yet — the completeness gate (§6.1), already
   * knowable when this renders.
   *
   * A banner beats a rejection: the state is derivable before the runner taps,
   * so telling them first is strictly better than letting them find out. The
   * surface is NOT blocked — they may want to read the slate — so this sits
   * above rows that stay visible.
   */
  blockedReason: string | null;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  const { resolved, total } = resolvedCount(slate);

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-run">
      <div className="flex items-baseline justify-between px-1" style={EYEBROW}>
        <span>Results</span>
        {/* A COUNT, not a position. */}
        <span
          data-testid="pickem-run-count"
          style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}
        >
          {resolved} of {total} in
        </span>
      </div>

      {blockedReason && (
        <p
          data-testid="pickem-run-blocked"
          className="mx-1 rounded-xl px-3 py-2.5"
          style={{
            fontSize: TYPE_SCALE.caption,
            lineHeight: 1.5,
            fontWeight: 600,
            color: "var(--color-bt-warning)",
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-warning-border)",
          }}
        >
          {blockedReason}
        </p>
      )}

      {slate.map((g) => {
        const busy = busyId === g.id;
        const done = g.result != null;
        return (
          <div
            key={g.id}
            data-testid="pickem-run-row"
            className="mx-1 flex flex-col gap-2 rounded-xl px-3 py-2.5"
            style={pickemRowSurface({ weighted: (g.multiplier ?? 1) > 1 })}
          >
            <MatchupLine
              game={{
                awayTeam: g.awayTeam,
                homeTeam: g.homeTeam,
                spread: g.spread,
                // An unplayed row shows its KICKOFF, not "Not played" — the time
                // is what the runner wants; "not played" is what they can
                // already see. A resolved row shows the outcome instead.
                kickoff: done ? RESULT_LABEL[g.result as SlateResult] : (g.kickoff ?? "TBD"),
                note: done ? null : g.note,
                multiplier: g.multiplier ?? 1,
              }}
            />

            {canEdit && (
              <>
                <div className="flex gap-2">
                  {(["away", "home"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      disabled={busy}
                      onClick={() => onSetResult(g.id, g.result === side ? null : side)}
                      data-testid={`pickem-run-${side}`}
                      className="flex-1 rounded-lg px-3 py-2 disabled:opacity-40"
                      style={{
                        fontSize: TYPE_SCALE.bodyDense,
                        fontWeight: 700,
                        minHeight: 44,
                        background:
                          g.result === side ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                        color: g.result === side ? "var(--color-bt-base)" : "var(--color-bt-text)",
                        border:
                          g.result === side
                            ? "1px solid var(--color-bt-accent-border)"
                            : "1px solid var(--color-bt-border)",
                      }}
                    >
                      {side === "away" ? g.awayTeam : g.homeTeam}
                    </button>
                  ))}
                </div>

                {/* Secondary tier: the two rare outcomes and the undo, at one
                    weight — they are all corrections of a sort, and giving push
                    a thumb-sized button would advertise it as common. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {(["push", "cancelled"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => onSetResult(g.id, g.result === r ? null : r)}
                      data-testid={`pickem-run-${r}`}
                      style={{
                        fontSize: TYPE_SCALE.caption,
                        fontWeight: g.result === r ? 700 : 600,
                        color: g.result === r ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                        textDecoration: g.result === r ? "none" : "underline",
                        minHeight: 32,
                      }}
                    >
                      {r === "push" ? "Push" : "Cancelled"}
                    </button>
                  ))}
                  {done && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSetResult(g.id, null)}
                      data-testid="pickem-run-clear"
                      style={{
                        fontSize: TYPE_SCALE.caption,
                        fontWeight: 600,
                        color: "var(--color-bt-text-dim)",
                        textDecoration: "underline",
                        minHeight: 32,
                      }}
                    >
                      Clear
                    </button>
                  )}
                  {busy && (
                    <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
                      Saving…
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
