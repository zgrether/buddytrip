"use client";

import { useState, type CSSProperties } from "react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { MultiplierBadge, SpreadBadge, pickemRowSurface } from "./slateRowVisual";
import { resolvedCount, type SlateResult, type ScoredSlateGame } from "@/lib/pickemScoring";
import { gameLifecycle, type GameLifecycleInput } from "@/lib/gameLifecycle";
import { GameLifecycleActions } from "@/components/games/GameLifecycleActions";
import { confirmUnresolvedFinalize, unresolvedWarning } from "@/lib/pickemFinalize";
import { PickemFinalizePrompt } from "./PickemFinalizePrompt";

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

/**
 * How a resolved row reads. Push and cancelled must not share a label.
 *
 * ── `cancelled` IS NO LONGER ALWAYS "never played" ─────────────────────────
 *
 * That copy was right while a runner pressing Void was the only way to produce
 * the value: they were saying the contest did not happen. Finalizing with
 * contests outstanding is a SECOND producer of the same value, and those games
 * were very likely played — the runner just never entered a result. So
 * "never played" became a claim the row cannot support.
 *
 * `Voided` is true of both producers, and it is what the glossary's own rule
 * gives: decide by asking what the label is ABOUT. This one is about the STAKE
 * — nobody was paid — and not about whether the game happened, which is exactly
 * the question the finalize path cannot answer. (CLAUDE.md's glossary row is
 * updated in the same change; this is a display-string rename, the cosmetic
 * tier, and the DB value is untouched.)
 */
const RESULT_LABEL: Record<SlateResult, string> = {
  away: "Away won",
  home: "Home won",
  push: "Pushed",
  cancelled: "Voided",
};

/**
 * The finalize / correct / re-lock block, as this surface receives it.
 *
 * `GameLifecycleInput` verbatim plus its handlers — the SHARED shape, so pick'em
 * cannot answer "can this be finalized?" differently from the other four without
 * changing `gameLifecycle` itself. CLAUDE.md #24 counts eight incidents of a
 * format that decided it privately.
 *
 * Props only, no tRPC: this component stays persistence-agnostic (#7) and the
 * view above owns the mutations.
 */
export interface PickemRunLifecycle extends GameLifecycleInput {
  finalizePending: boolean;
  correctPending: boolean;
  onFinalize: () => void;
  onCorrect: () => void;
/**
   * Slate games with no result yet.
   *
   * A COUNT rather than a prepared sentence, so the sentence is built in one
   * place (`unresolvedWarning`) and the DECISION in another
   * (`confirmUnresolvedFinalize`) — both pure, both tested, neither derived from
   * the other's output.
   *
   * Never a gate. A postponed Tuesday game must not hold the cup open, which is
   * why `allComplete` above is the picking window rather than the results; this
   * only decides whether the tap stops to ask.
   */
  unresolvedCount: number;
}

export function PickemRunView({
  slate,
  canEdit,
  busyId,
  ridingOn,
  matchesPending,
  lifecycle,
  onSetResult,
}: {
  slate: RunSlateGame[];
  canEdit: boolean;
  /** Absent on a surface with no finalize to offer (a member's view). */
  lifecycle?: PickemRunLifecycle;
  /** The slate game currently being written, so only ITS row shows pending. */
  busyId: string | null;
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

  /**
   * Does the finalize tap stop to ask, and what does it say.
   *
   * Both derived from the ONE count the view passes, through the two pure
   * functions that own the rule and the wording. Computed unconditionally so
   * they cannot fall out of step with each other behind a branch.
   */
  const [confirming, setConfirming] = useState(false);
  const needsConfirm =
    lifecycle != null &&
    confirmUnresolvedFinalize({
      unresolved: lifecycle.unresolvedCount,
      canFinalize: gameLifecycle(lifecycle).canFinalize,
    });
  const confirmMessage = lifecycle ? unresolvedWarning(lifecycle.unresolvedCount) : null;

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-run">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 700 }}>Game results</span>
          {/* The RUNNER badge is gone. It labelled the READER on a screen the
              reader had chosen to open, and it did it under a tab that already
              said "Enter results" — a person who can act arrives here knowing
              they can, and the controls under every row say so again. */}
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

        {/* WHAT THE CONTROL DOES, in place of a count of what is left.
            The line here used to read "9 games still to mark · 4 matches hang
            on them" — both halves already on screen. The count is the 7/16 to
            its right and the progress bar under it, and the unmarked games are
            the rows themselves; a sentence restating two things the reader is
            looking at is the third instance in this feature of copy labelling
            content that announces itself.
            What was NOT on screen is the meaning of the four segments — that
            Push and Void are different facts, and which one removes a game
            from the scoring. So the space says that instead. */}
        {canEdit && pending.length > 0 && (
          <span
            data-testid="pickem-run-howto"
            style={{
              fontSize: TYPE_SCALE.caption,
              lineHeight: 1.5,
              color: "var(--color-bt-text-dim)",
            }}
          >
            Mark the winner of the game, or if it resulted in a push. If a game
            needs to be removed from the scoring, mark it as void.
          </span>
        )}
      </div>

      {/* NO "set the matches first" banner. Results no longer depend on
          pairings (migration 167) — a result is a fact about the world — so
          there is nothing here to be blocked by, and the amber banner that said
          so was half of a double treatment with the RPC's own refusal. */}

      {/* NO eyebrow over the first group. A card with four unpressed buttons
          on it is a game needing a result, and the count was the same number
          the header carries. "Entered" keeps its eyebrow because that group IS
          a change of subject: it is the same slate, already dealt with, and
          without a heading the two groups read as one list where the rows
          inexplicably change shape half way down. */}
      {pending.length > 0 && (
        <>
          {pending.map((g) => (
            <PendingCard
              key={g.id}
              game={g}
              busy={busyId === g.id}
              canEdit={canEdit}
              riding={ridingOn?.get(g.id) ?? 0}
              matchesPending={matchesPending ?? 0}
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

      {/* THE END OF THE RUNNER'S JOB, at the end of the list they were working
          down. Entering the last result and finalizing are one continuous act,
          and a CTA anywhere else would be a second place to look for it.

          `GameLifecycleActions`, not a private button: the eighth CLAUDE.md #24
          incident was match rendering its own copy of this markup, agreeing with
          the shared one only by coincidence of nobody having changed either. */}
      {lifecycle && (
        <>
          <GameLifecycleActions
            canEdit={lifecycle.canEdit}
            status={lifecycle.status}
            correctionsOpen={lifecycle.correctionsOpen}
            allComplete={lifecycle.allComplete}
            finalizePending={lifecycle.finalizePending}
            correctPending={lifecycle.correctPending}
            /* Intercepted, not replaced: the confirm is a question ABOUT this
               action, so it sits in front of the same handler rather than
               becoming a second finalize path. */
            onFinalize={needsConfirm ? () => setConfirming(true) : lifecycle.onFinalize}
            onCorrect={lifecycle.onCorrect}
            /* "Correct a score" is golf's word for it and pick'em has no
               scores — the runner corrects a RESULT, which is the word every
               other control on this screen already uses. */
            correctLabel="Correct a result"
          />
          {confirming && confirmMessage && (
            <PickemFinalizePrompt
              title="Some games have no result"
              message={confirmMessage}
              confirmLabel="Void and save results"
              pendingLabel="Saving results…"
              cancelLabel="Keep entering results"
              pending={lifecycle.finalizePending}
              onConfirm={() => {
                setConfirming(false);
                lifecycle.onFinalize();
              }}
              onCancel={() => setConfirming(false)}
            />
          )}
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
  matchesPending,
  onSetResult,
}: {
  game: RunSlateGame;
  busy: boolean;
  canEdit: boolean;
  riding: number;
  /** What the header already said, so this line can decline to repeat it. */
  matchesPending: number;
  onSetResult: (slateGameId: string, result: SlateResult | null) => void;
}) {
  const mult = g.multiplier ?? 1;
  /**
   * Said only where it DIFFERS from every other row.
   *
   * Measured on the live slate: nine unmarked games, four live matches, and
   * every single game read "4 matches are still riding on this" — nine
   * identical sentences carrying no information between them.
   *
   * That is the normal case rather than a fluke. A game's count drops below
   * `matchesPending` only when some live match has no stake on it at all, which
   * needs both sides to have taken the same team at the same rank; with
   * distinct confidence ranks across sixteen games that is rare. So the line
   * earns its place exactly when it is surprising, and printing the common
   * number beside every row is what makes the surprising one hard to see.
   *
   * NOTE — the comparison used to be against the HEADER, which said
   * `matchesPending` out loud. The header line is gone, so the justification
   * is no longer "the header already said it": it is that the other eight rows
   * say it. Same test, same number, different reason — and the reason matters,
   * because it is what decides that removing the header does not oblige this
   * line to start repeating.
   */
  const ridingWorthSaying = riding > 0 && riding !== matchesPending;
  return (
    <div
      data-testid="pickem-run-row"
      className="flex flex-col gap-2"
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

      {ridingWorthSaying && (
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
      className="flex flex-col"
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
