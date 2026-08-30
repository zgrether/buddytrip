"use client";

import { OutcomeChoiceRow } from "./OutcomeChoiceRow";
import { PointsAtStake } from "./PointsAtStake";
import type { SidePlayer } from "./MatchSides";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

type Result = "a_win" | "b_win" | "halve";

/**
 * Pure — extracted so the tap-again-to-clear rule is unit-testable without a
 * DOM (this repo has no RTL/jsdom; `renderToStaticMarkup` cannot fire a click).
 * Tapping the currently-selected choice clears it; tapping anything else
 * (including a fresh, undecided match) selects it.
 */
export function toggleMatchResult(current: Result | null, tapped: Result): Result | null {
  return current === tapped ? null : tapped;
}

/** One match, ready for result entry — resolved players + its current result. */
export interface MatchScoreRow {
  id: string;
  number: number;
  aPlayers: SidePlayer[];
  bPlayers: SidePlayer[];
  result: Result | null;
  /** What THIS match is worth — its own `point_value` override, else the
   *  game's live-derived even share. Same field, same fallback, same
   *  `PointsAtStake` renderer as golf's `MatchCard` header (feedback: "should
   *  show the value of the match like the header line of golf match play") —
   *  `null`/0 renders nothing, same as there. */
  pointValue: number | null;
}

/**
 * Non-golf Matches' result entry — the scoreboard-page counterpart to the
 * settings-page pairing grid (`MatchesAccordionRow`) and override panel
 * (`MatchPointsRow`), same reuse instinct as both of those: `OutcomeChoiceRow`
 * is the shared three-way picker `MatchOutcomeEntryView` uses for a HOLE
 * (side A / Halved / side B); this is that exact component, once per MATCH
 * instead of once per hole — golf resolves a hole, this resolves a match, same
 * question about a different subject (Phase 0 §2.1).
 *
 * ── Why this is a list of rows, not a single control ────────────────────────
 * The Simple format's `NonGolfMatchControl` (same file, `OutcomeChoiceRow` x3)
 * declares ONE outcome for the whole game. Matches declares N of them — one
 * per match — so this is N copies of that exact shape stacked, not a
 * generalisation of it. Each match keeps its own `selected`/`dim` state,
 * independent of every other match's.
 *
 * ── Card boundary + header (feedback: matches read together without one) ────
 * Each match is now its OWN bordered card — background, border, radius,
 * matching golf's `MatchCard` container — with a header row inside it
 * ("MATCH N" · FINAL once decided · what it's worth) rather than a bare
 * eyebrow floating above three unbounded rows. That header is also where the
 * separation complaint and the missing-points complaint turned out to be the
 * SAME fix: a visible card boundary is what tells two adjacent matches apart,
 * and its right-hand slot is where golf already shows the points. Not the
 * full `MatchCard` itself — that component computes THRU/DORMIE/margin from a
 * hole sequence Matches doesn't have; only the header shape is shared.
 *
 * ── Tap-to-select, tap-again-to-clear ────────────────────────────────────
 * Feedback: a mis-tapped match had no way back except guessing another result
 * and noticing it was still wrong. Tapping the ALREADY-selected choice again
 * un-declares it (`onPick(id, null)`) rather than being a no-op — `setResult`
 * accepts `null` for exactly this (see that procedure's own comment).
 *
 * ── What it does NOT do ──────────────────────────────────────────────────
 * No outbox (CLAUDE.md #15) — a match declaration is a discrete, idempotent
 * write (tap again to change or clear it), not the per-hole gross-score
 * stream #15's outbox exists to protect against losing mid-entry. It DOES get
 * the same immediate local feedback golf's own hole-outcome entry gets
 * (`useOutcomeSaver`'s `onChange` sets its local `values` before the mutation
 * resolves) — the caller (`NonGolfGameView`) patches the query cache
 * optimistically before calling `onPick`'s mutation, the documented pattern
 * for this directory (CLAUDE.md Enforced Pattern #1), rather than this
 * component waiting on a round trip to show anything. An earlier version of
 * this comment claimed golf's hole entry has no optimism at all — it does;
 * what it doesn't have is the FULL localStorage outbox, which is the
 * distinction that actually matters here.
 */
export function MatchesScoreboard({
  matches,
  onPick,
  canEdit,
}: {
  matches: MatchScoreRow[];
  onPick: (matchId: string, result: Result | null) => void;
  canEdit: boolean;
}) {
  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-1" data-testid="matches-scoreboard-empty">
        <span style={EYEBROW}>Matches</span>
        <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          No matches paired yet — set them up in Settings.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="matches-scoreboard">
      {matches.map((m) => {
        const pick = (r: Result) => onPick(m.id, toggleMatchResult(m.result, r));
        return (
          <div
            key={m.id}
            data-testid={`matches-scoreboard-match-${m.id}`}
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", borderRadius: 14, overflow: "hidden" }}
          >
            <div
              className="flex items-center"
              style={{ height: 26, padding: "0 12px", borderBottom: "1px solid var(--color-bt-subtle-border)" }}
            >
              <span className="flex-1" style={EYEBROW}>
                Match {m.number}
              </span>
              <span
                className="flex-1 text-center"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: m.result != null ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)",
                }}
              >
                {m.result != null ? "FINAL" : ""}
              </span>
              <span className="flex flex-1 justify-end">
                <PointsAtStake value={m.pointValue ?? 0} className="!text-[10px]" />
              </span>
            </div>
            <div role="radiogroup" aria-label={`Match ${m.number} outcome`} className="flex flex-col" style={{ gap: 9, padding: 10 }}>
              <OutcomeChoiceRow
                selected={m.result === "a_win"}
                dim={m.result != null && m.result !== "a_win"}
                color={m.aPlayers[0]?.teamColor ?? undefined}
                avatarName={m.aPlayers[0]?.name}
                label={m.aPlayers.length > 1 ? m.aPlayers.map((p) => p.name).join(" & ") : (m.aPlayers[0]?.name ?? "Side A")}
                players={m.aPlayers}
                onClick={() => pick("a_win")}
                disabled={!canEdit}
                testId={`match-${m.id}-win-a`}
              />
              <OutcomeChoiceRow
                selected={m.result === "halve"}
                dim={m.result != null && m.result !== "halve"}
                neutral
                label="Halved"
                onClick={() => pick("halve")}
                disabled={!canEdit}
                testId={`match-${m.id}-draw`}
              />
              <OutcomeChoiceRow
                selected={m.result === "b_win"}
                dim={m.result != null && m.result !== "b_win"}
                color={m.bPlayers[0]?.teamColor ?? undefined}
                avatarName={m.bPlayers[0]?.name}
                label={m.bPlayers.length > 1 ? m.bPlayers.map((p) => p.name).join(" & ") : (m.bPlayers[0]?.name ?? "Side B")}
                players={m.bPlayers}
                onClick={() => pick("b_win")}
                disabled={!canEdit}
                testId={`match-${m.id}-win-b`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
