"use client";

import { useState, type CSSProperties } from "react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { MultiplierBadge, SpreadBadge, pickemRowSurface } from "./slateRowVisual";
import { resolvedCount, type SlateResult, type ScoredSlateGame } from "@/lib/pickemScoring";

/**
 * Screen E — the runner enters each slate game's outcome as it finishes.
 *
 * ── Two groups, because only one of them is work ───────────────────────────
 *
 * A flat list of sixteen makes the runner scan for the five that still need
 * them. Splitting it puts the work at the top and collapses the done ones to a
 * line each — and the two groups answer different questions, so they earn
 * different shapes rather than the same row twice.
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
 * One segmented control, because the four are alternatives and a control that
 * looks like a choice is easier to read than two tiers of buttons that are.
 * The two teams take the width; Push and Void get 52px each, since they are
 * rare and their size should say so.
 *
 * They differ in COLOUR too, and that is the load-bearing part: a selected team
 * is accent, a selected Push or Void is a neutral fill. Push and cancelled
 * score identically (zero for everyone) and are DIFFERENT FACTS — one happened
 * and nobody covered, the other never happened — but neither is a win, and
 * painting them like one would say a team did something.
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
  ridingOn,
  matchesPending,
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
  /**
   * Unresolved slate game id -> live matches it can still move (`ridingOn`).
   *
   * Empty on a team-totals game, which has no matches — and the line is then
   * absent rather than reading "0 matches", which would be a fact about a
   * mechanic that is not in play.
   */
  ridingOn?: Map<string, number>;
  /** Distinct matches hanging on anything still unmarked. */
  matchesPending?: number;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  const { resolved, total } = resolvedCount(slate);
  const pending = slate.filter((g) => g.result == null);
  const entered = slate.filter((g) => g.result != null);
  /**
   * Which entered game is open for correction, if any.
   *
   * It expands IN PLACE rather than moving up to the other group. A row that
   * jumps to a different heading when you tap it makes the runner re-find what
   * they were looking at, and the reason they tapped is that this row is the
   * one they wanted.
   *
   * One at a time: reopening is a correction, and two open corrections is a
   * state nobody asked for.
   */
  const [reopened, setReopened] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-run">
      <div className="mx-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 700 }}>Game results</span>
          {/* Only for somebody who can act. A member reading the same screen is
              not a runner, and a badge saying otherwise would be the start of
              them looking for controls that are not there. */}
          {canEdit && (
            <span
              data-testid="pickem-run-runner-pill"
              className="shrink-0 rounded-full"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "2px 7px",
                color: "var(--color-bt-owner)",
                background: "var(--color-bt-warning-faint)",
              }}
            >
              Runner
            </span>
          )}
          <span className="flex-1" />
          <span
            data-testid="pickem-run-count"
            style={{
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-bt-text-dim)",
            }}
          >
            {resolved}/{total}
          </span>
        </div>

        <span
          className="block overflow-hidden"
          style={{ height: 4, borderRadius: 2, background: "var(--color-bt-card-raised)" }}
        >
          <span
            data-testid="pickem-run-progress"
            className="block"
            style={{
              width: total > 0 ? `${(resolved / total) * 100}%` : "0%",
              height: 4,
              borderRadius: 2,
              background: "var(--color-bt-accent)",
              transition: "width 250ms ease-out",
            }}
          />
        </span>

        {canEdit && pending.length > 0 && (
          <span
            data-testid="pickem-run-hangs"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            {pending.length} game{pending.length === 1 ? "" : "s"} still to mark
            {matchesPending != null && matchesPending > 0 && (
              <> · {matchesPending} match{matchesPending === 1 ? "" : "es"} hang on them</>
            )}
          </span>
        )}
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

      {pending.length > 0 && (
        <>
          <div className="px-1" style={EYEBROW}>
            Needs a result · {pending.length}
          </div>
          {pending.map((g) => (
            <PendingCard
              key={g.id}
              game={g}
              busy={busyId === g.id}
              canEdit={canEdit}
              riding={ridingOn?.get(g.id) ?? 0}
              onSetResult={onSetResult}
            />
          ))}
        </>
      )}

      {entered.length > 0 && (
        <>
          <div className="mt-1 px-1" style={EYEBROW}>
            Entered · {entered.length}
          </div>
          {entered.map((g) => (
            <EnteredRow
              key={g.id}
              game={g}
              busy={busyId === g.id}
              canEdit={canEdit}
              open={reopened === g.id}
              onToggle={() => setReopened((cur) => (cur === g.id ? null : g.id))}
              onSetResult={onSetResult}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** A game still to be marked — the runner's actual work. */
function PendingCard({
  game: g,
  busy,
  canEdit,
  riding,
  onSetResult,
}: {
  game: RunSlateGame;
  busy: boolean;
  canEdit: boolean;
  riding: number;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  const mult = g.multiplier ?? 1;
  return (
    <div
      data-testid="pickem-run-row"
      className="mx-1 flex flex-col gap-2"
      style={{
        ...pickemRowSurface({ weighted: mult > 1 }),
        borderRadius: 13,
        padding: "9px 11px 10px 13px",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
          {g.awayTeam} <span style={{ color: "var(--color-bt-text-dim)" }}>at</span> {g.homeTeam}
          {g.spread && (
            <>
              {" "}
              <SpreadBadge spread={g.spread} />
            </>
          )}
          {mult > 1 && (
            <>
              {" "}
              <MultiplierBadge multiplier={mult} />
            </>
          )}
        </span>
        <span
          className="shrink-0"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {g.kickoff ?? "TBD"}
        </span>
      </div>

      {canEdit && <ResultSegments game={g} busy={busy} onSetResult={onSetResult} />}

      {riding > 0 && (
        <span
          data-testid="pickem-run-riding"
          style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)" }}
        >
          {riding} match{riding === 1 ? " is" : "es are"} still riding on this
        </span>
      )}
      {busy && (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          Saving…
        </span>
      )}
      {!canEdit && g.note && (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {g.note}
        </span>
      )}
    </div>
  );
}

/**
 * The four outcomes as one control — shared by an unmarked game and a reopened
 * one, so a correction is offered in exactly the same shape as the original
 * entry. Two copies of this would be two places for the four values to drift.
 */
function ResultSegments({
  game: g,
  busy,
  onSetResult,
}: {
  game: RunSlateGame;
  busy: boolean;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  return (
    <div
      className="grid gap-0.5"
      style={{
        gridTemplateColumns: "1fr 1fr 52px 52px",
        background: "var(--color-bt-card-raised)",
        borderRadius: 11,
        padding: 2,
      }}
    >
      {(
        [
          ["away", g.awayTeam],
          ["home", g.homeTeam],
          ["push", "Push"],
          ["cancelled", "Void"],
        ] as const
      ).map(([value, label]) => (
        <Segment
          key={value}
          value={value}
          label={label}
          selected={g.result === value}
          busy={busy}
          onSelect={() => onSetResult(g.id, g.result === value ? null : value)}
        />
      ))}
    </div>
  );
}

/**
 * How a segment looks, given what it is and whether it is chosen.
 *
 * Exported and tested directly because the DIFFERENCE between the two selected
 * states is the whole point and it lives entirely in these three values. A
 * selected team is accent; a selected Push or Void is a neutral fill.
 *
 * Push and cancelled score identically to each other (zero for everyone) and
 * are different FACTS — one happened and nobody covered, the other never
 * happened — but neither is a win, and painting them the way a team win is
 * painted would say a team did something.
 */
export function segmentStyle(value: SlateResult, selected: boolean): CSSProperties {
  const team = value === "away" || value === "home";
  if (!selected) {
    return {
      background: "transparent",
      border: "1px solid transparent",
      color: "var(--color-bt-text)",
    };
  }
  return {
    background: team ? "var(--color-bt-accent-faint)" : "var(--color-bt-hover)",
    border: `1px solid ${team ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
    color: team ? "var(--color-bt-accent)" : "var(--color-bt-text)",
  };
}

/** One quarter of the control. */
function Segment({
  value,
  label,
  selected,
  busy,
  onSelect,
}: {
  value: SlateResult;
  label: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onSelect}
      data-testid={`pickem-run-${value}`}
      data-selected={selected ? "true" : "false"}
      className="truncate px-1 disabled:opacity-40"
      style={{
        height: 34,
        borderRadius: 9,
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: selected ? 700 : 600,
        ...segmentStyle(value, selected),
      }}
    >
      {label}
    </button>
  );
}

/**
 * A game already marked — one line, and a way back into it.
 *
 * The way back is the ROW, not a Clear button. Correcting a wrong result by
 * clearing first would pass through a state where the game reads unplayed and
 * every total on every other surface moves — for a mistake that is being fixed
 * in the same breath. Reopening shows the same control the game was marked
 * with, so a correction is one tap and one write.
 */
function EnteredRow({
  game: g,
  busy,
  canEdit,
  open,
  onToggle,
  onSetResult,
}: {
  game: RunSlateGame;
  busy: boolean;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  const line = (
    <>
      <span
        className="min-w-0 flex-1 truncate text-left"
        style={{ fontSize: TYPE_SCALE.captionPlus, color: "var(--color-bt-text-dim)" }}
      >
        {g.awayTeam} at {g.homeTeam}
      </span>
      <span
        className="shrink-0 rounded"
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          padding: "2px 6px",
          color: open ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          background: open ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
        }}
      >
        {busy ? "Saving…" : RESULT_LABEL[g.result as SlateResult]}
      </span>
    </>
  );

  return (
    <div
      data-testid="pickem-run-entered"
      className="mx-1 flex flex-col"
      style={{
        ...pickemRowSurface({ weighted: (g.multiplier ?? 1) > 1, quiet: !open }),
        borderRadius: 11,
      }}
    >
      {canEdit ? (
        <button
          type="button"
          onClick={onToggle}
          data-testid="pickem-run-reopen"
          data-open={open ? "true" : "false"}
          className="flex items-center gap-2 px-3"
          style={{ minHeight: 40 }}
        >
          {line}
        </button>
      ) : (
        <span className="flex items-center gap-2 px-3" style={{ minHeight: 40 }}>
          {line}
        </span>
      )}

      {canEdit && open && (
        <div className="flex flex-col gap-2 px-3 pb-2.5">
          <ResultSegments game={g} busy={busy} onSetResult={onSetResult} />
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetResult(g.id, null)}
            data-testid="pickem-run-clear"
            className="self-start disabled:opacity-40"
            style={{
              fontSize: TYPE_SCALE.caption,
              fontWeight: 600,
              color: "var(--color-bt-text-dim)",
              textDecoration: "underline",
              minHeight: 32,
            }}
          >
            Clear this result
          </button>
        </div>
      )}
    </div>
  );
}
