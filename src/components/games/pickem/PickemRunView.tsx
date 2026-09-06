"use client";

import { useState } from "react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
/* `pickemRowSurface` is gone from this file: the entered row used to build its
   own surface and now renders the shared `PickemGameCard`, which owns it. */
import { type SideEmphasis, type StatusTone } from "./slateRowVisual";
import { PickemGameCard, PickemSegments, segmentStyle } from "./PickemGameCard";

/**
 * Re-exported so the results page stays the place its own tests import from.
 * The DEFINITION moved to `PickemGameCard` with r7 §12, because the picks sheet
 * now paints its two segments the same way and a second copy of the accent
 * rule is a second thing to keep in step.
 */
export { segmentStyle };
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
 * ── Four outcomes, two ROWS ────────────────────────────────────────────────
 *
 * One segmented control, because the four are alternatives and a control that
 * looks like a choice is easier to read than two tiers of buttons that are.
 * They no longer share a LINE, though: the two teams take a full-width row and
 * Push / Cancelled sit beneath it. `1fr 1fr 52px 52px` gave each team about
 * 115px at 390px, which holds "Toledo" and loses "Michigan State Spartans" —
 * the reported truncation, on the surface where the names matter most because
 * the runner is matching them against a scoreboard.
 *
 * They differ in COLOUR too, and that is the load-bearing part: a selected team
 * is accent, a selected Push or Cancelled is a neutral fill. Push and cancelled
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
 * ── `Cancelled`, and this REVERSES the `Void`/`Voided` rename ─────────────
 *
 * The previous decision here was that `cancelled` cannot claim "never played":
 * a runner pressing the button IS asserting the contest did not happen, but
 * finalizing with contests outstanding produces the same value for games that
 * probably WERE played and simply never got a result. That reasoning stands
 * and is not what changed — the surviving fact is still about the stake.
 *
 * What changed is who the word is FOR. `Voided` is the accurate term for
 * "the stake is gone" and it is also jargon: the crew reading this screen are
 * not database users, and "Void"/"Voided" reads as a form-processing word
 * rather than a thing that happened to a football game. `Cancelled` is what a
 * person would say, and the small loss of precision — it hints the game did
 * not happen, which is only sometimes true — costs less than a word half the
 * readers have to translate.
 *
 * So this deliberately reverses R3 #1132 and R4 #1133, on a ground neither of
 * them weighed: both argued about WHAT the label is about, and this one is
 * about who is reading it. ONE word everywhere, including the segment and the
 * head-to-head cells, since the width argument that produced the original
 * `Void`/`Voided` split is also gone — the segment is full-width now.
 *
 * Display-string tier. `pickem_slate_games.result` is still `'cancelled'` and
 * no migration is involved. CLAUDE.md's glossary row moves in this same PR.
 *
 * ── `away`/`home` both read "Final" ───────────────────────────────────────
 *
 * They used to read "Away won" / "Home won", which named a SLOT rather than a
 * team — so the runner mapped "Away" back onto a name sitting inches away, and
 * a list of settled games was a column of near-identical pills. The winner is
 * now carried by the NAMES (see `resultEmphasis`), which leaves this line free
 * to say only what KIND of outcome it was.
 */
/** Exported so the PICKS SHEET can name a settled game with the same word the
 *  runner used. Two surfaces describing one row must not word it differently. */
export const RESULT_LABEL: Record<SlateResult, string> = {
  away: "Final",
  home: "Final",
  push: "Pushed",
  cancelled: "Cancelled",
};

/**
 * Which name is saying what, once a contest is settled.
 *
 * ── The status line names the KIND; the names carry the RESULT ─────────────
 *
 * "Away won" and "Home won" were doing both jobs badly. They named a SLOT
 * rather than a team, so a runner reading a settled row had to map "Away" back
 * onto a name that was sitting right there — and the status line was the only
 * thing on the row that changed when a result landed, so a list of settled
 * games was a column of near-identical two-word pills.
 *
 * Splitting it: the STATUS says what kind of outcome this was (Final / Pushed
 * / Cancelled) and the NAMES say who won, by weight. That makes the winner
 * readable without reading anything — which is the whole treatment.
 *
 * ── Push is not a faded final, and cancelled is not a push ────────────────
 *
 * `level` gives a push BOTH names at the loser's weight and the winner's
 * colour: the absence of contrast is the signal. It cannot be confused with a
 * decided game, because a decided game always has exactly one bold name and
 * one dim one — so "no contrast" is a state the win case can never produce.
 *
 * `struck` is cancelled, and the ONLY thing separating it from a played game
 * is `textDecoration`. No value, no text and no attribute differs. That is why
 * its guard mutates the style rather than the data.
 */
export function resultEmphasis(result: SlateResult | null): {
  away: SideEmphasis;
  home: SideEmphasis;
} {
  if (result == null) return { away: "none", home: "none" };
  if (result === "push") return { away: "level", home: "level" };
  if (result === "cancelled") return { away: "struck", home: "struck" };
  return result === "away"
    ? { away: "won", home: "lost" }
    : { away: "lost", home: "won" };
}

/** The status line's tone — `SlateResult` narrowed to the three things a
 *  reader needs to tell apart. */
export function resultTone(result: SlateResult): StatusTone {
  return result === "push" ? "push" : result === "cancelled" ? "cancelled" : "final";
}

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
export function PickemRunView({
  slate,
  canEdit,
  busyId,
  ridingOn,
  matchesPending,
  onSetResult,
}: {
  slate: RunSlateGame[];
  canEdit: boolean;
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
            {/* "cancelled", matching the button it names. This said "void"
                after the label had moved — the instruction and the control
                disagreeing about what the reader is looking for, which is the
                refusal rule's failure mode in an ordinary sentence. */}
            Mark the winner of the game, or if it resulted in a push. If a game
            needs to be removed from the scoring, mark it as cancelled.
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

      {/* ── THE FINALIZE IS NOT HERE ANY MORE (r7 §10) ────────────────────
          It sat at the end of this list, and the argument was that entering the
          last result and finalizing are one continuous act, so a CTA anywhere
          else would be a second place to look for it.

          What that argument did not have available: the runner's panel — the
          one carrying Start picking and Close picking — has an EMPTY action
          slot in exactly this state. Both moves are spent by the time results
          are being entered, so the finalize is not competing for the space; it
          is the only thing left that belongs in it.

          And the panel is where the runner's OTHER standing controls are, which
          is the stronger reading of "a second place to look": the second place
          was this one. See `PickemPhaseStrip`. */}
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
    <PickemGameCard
      testId="pickem-run-row"
      /* THE SHARED CARD (r7 §12). This used to build its own two-line head —
         matchup and badges inline on the left, kickoff pushed to the right —
         which put the same contest in a different arrangement from the sheet
         and the slate modal. The kickoff is now the SUB-line, beside the note,
         which is where the other two surfaces have always had it.
         "TBD" survives the move: a game with no time is a fact worth stating on
         a page about what has and has not happened. */
      game={{ ...g, kickoff: g.kickoff ?? "TBD" }}
    >
      {canEdit && (
        <PickemSegments
          values={RESULT_VALUES}
          awayTeam={g.awayTeam}
          homeTeam={g.homeTeam}
          selected={(g.result as SlateResult | null) ?? null}
          busy={busy}
          onSelect={(value) => onSetResult(g.id, value)}
          testIdPrefix="pickem-run"
        />
      )}

      {ridingWorthSaying && (
        <span
          data-testid="pickem-run-riding"
          className="block"
          style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)" }}
        >
          {riding} match{riding === 1 ? " is" : "es are"} still riding on this
        </span>
      )}
      {busy && (
        <span
          className="block"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          Saving…
        </span>
      )}
    </PickemGameCard>
  );
}

/**
 * The four outcomes, in the order a runner meets them.
 *
 * A CONSTANT rather than a literal at each call site, because both places that
 * render the control — an unmarked game and a reopened one — must offer the
 * same four, and a correction offered in a different shape from the original
 * entry is two shapes for one decision.
 *
 * The control itself is `PickemSegments` (r7 §12): the picks sheet renders the
 * same grid with the first two values, so there is one segmented control in the
 * feature rather than two that resemble each other.
 */
const RESULT_VALUES = ["away", "home", "push", "cancelled"] as const;

/**
 * A game already marked — the same card as an unmarked one, and a way back in.
 *
 * The way back is the ROW, not a Clear button. Correcting a wrong result by
 * clearing first would pass through a state where the game reads unplayed and
 * every total on every other surface moves — for a mistake that is being fixed
 * in the same breath. Reopening shows the same control the game was marked
 * with, so a correction is one tap and one write.
 *
 * ── IT IS THE SHARED CARD NOW, NOT A PRIVATE ONE-LINER ────────────────────
 *
 * This used to be its own row: the matchup flattened to a dim
 * "Toledo Rockets at Michigan State Spartans" at 12.5px with a small pill
 * reading "Away won". Two things were wrong with it and they compound.
 *
 * First, the SLOT problem — "Away won" names a position, not a team, so the
 * one fact the row exists to record was the one thing it made you work out,
 * from a name printed dim inches to the left. Sixteen settled games were
 * sixteen near-identical pills.
 *
 * Second, the DIVERGENCE — the same contest was drawn one way while it was
 * work and a different way once it was done, which is precisely what r7 §12
 * unified the three surfaces to stop. Being settled is a state of a game, not
 * a reason for a different card.
 *
 * So: the shared `PickemGameCard`, with the result carried by the NAMES
 * (`resultEmphasis`) and the kind carried by the status line in place of the
 * kickoff. A runner scanning the entered list now reads winners by weight
 * without reading words.
 *
 * ── Collapsed, but only HERE ──────────────────────────────────────────────
 *
 * Unmarked games keep their control open. Entering sixteen results is the job
 * this screen exists for and putting a disclosure tap in front of each one
 * would double it; a settled game, by contrast, is a record that only
 * occasionally needs reopening. So the disclosure is on the group that is
 * DONE, which is where it was before — this changes what a collapsed row looks
 * like, not which rows collapse.
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
  const result = g.result as SlateResult;
  const emphasis = resultEmphasis(result);
  return (
    <PickemGameCard
      testId="pickem-run-entered"
      game={g}
      awayEmphasis={emphasis.away}
      homeEmphasis={emphasis.home}
      /* The HEADER is the disclosure, not the card — `children` is what the
         tap reveals, so wrapping the whole card would nest the segments inside
         the button that opens them. */
      onHeaderTap={canEdit ? onToggle : undefined}
      headerTestId="pickem-run-reopen"
      headerOpen={open}
      /* "Saving…" replaces the STATUS rather than sitting beside it: the row is
         mid-write, so the status on screen is the one being replaced and
         showing it next to a spinner would assert a result that may not be the
         one that lands. */
      status={
        busy
          ? { text: "Saving…", tone: "final" }
          : { text: RESULT_LABEL[result], tone: resultTone(result) }
      }
      quiet={!open}
      active={open}
    >
      {canEdit && open && (
        <div className="flex flex-col gap-2">
          <PickemSegments
            values={RESULT_VALUES}
            awayTeam={g.awayTeam}
            homeTeam={g.homeTeam}
            selected={(g.result as SlateResult | null) ?? null}
            busy={busy}
            onSelect={(value) => onSetResult(g.id, value)}
            testIdPrefix="pickem-run"
          />
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
    </PickemGameCard>
  );
}
