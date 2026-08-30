"use client";

import { Swords } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Individual matches, and nobody drawn yet.
 *
 * Lives beside the panel it gates rather than inline in the view, because TWO
 * surfaces read it — the Matches tab's waiting panel and the results scrim —
 * and they answer the same question. Two spellings of one question is how one
 * of them ends up covering a game the other calls ready.
 *
 * ── IT TAKES THE RESOLVED FLAG, NOT THE RAW COLUMN ────────────────────────
 *
 * The first version read `rollUp` and `pointsMode` and compared against
 * `"individual_matches"` itself, with points mode checked first so a points cup
 * could not fall through — which is correct, and is still the wrong shape.
 * `pickemRollUpOverride.test.ts` caught it immediately: `pickem_games.roll_up` is
 * INERT in a points competition but still SET, and that guard exists because
 * Phase 7 found five sites branching on the raw column of which four were bugs.
 * Its rule is that the comparison belongs where the override is RESOLVED or
 * where the setting is EDITED, and nowhere else.
 *
 * This is neither. `PickemGameView.individualMatches` already resolves it — it
 * is on the allowlist for doing so — so the honest input is that answer, and
 * adding a sixth raw reader with a good local justification is how the list
 * stops meaning anything.
 *
 * What is left here is small, and small is the point: the two surfaces still
 * cannot disagree about whether this game is paired, and neither of them
 * re-decides what "individual matches" means.
 */
export function noMatchesDrawn(input: {
  /** The RESOLVED flag — points mode already folded in. */
  individualMatches: boolean;
  matchCount: number;
}): boolean {
  return input.individualMatches && input.matchCount === 0;
}

/**
 * Results cannot be entered yet, said BEFORE the runner tries (r7 §11).
 *
 * ── The refusal it replaces arrived too late to be useful ──────────────────
 *
 * Migration 162 freezes `save_pickem_matches` once any contest has a result:
 * pairings must not move under people who have already watched a game resolve.
 * That is correct, and it produces a trap in one order of operations — a runner
 * on an individual-matches game who enters results before drawing the matches
 * can then never draw them. The refusal they meet names a rule they can no
 * longer satisfy, which is the failure mode CLAUDE.md's refusal rule is about:
 * following the message cannot clear the condition.
 *
 * So the prerequisite is stated where the person is, before the door shuts. The
 * same move the settings panel's `Requires:` scrim makes, and for the same
 * reason — a row that says what it needs beats a control that accepts a tap and
 * then explains why it should not have.
 *
 * ── A SCRIM, not a replacement ─────────────────────────────────────────────
 *
 * The slate stays visible underneath. Covering it says "not yet"; removing it
 * would say "there is nothing here", and there is — sixteen games the runner
 * built, which is how they know they are on the right screen.
 *
 * The message pins to the TOP rather than centring, because the list behind it
 * is as long as the slate and a centred panel on a sixteen-game page is below
 * the fold on a phone.
 *
 * ── TEAM TOTALS NEVER SEES THIS ────────────────────────────────────────────
 *
 * That roll-up has no matches and no freeze, so there is no prerequisite to
 * state. The caller gates on the roll-up rather than on `matches.length`, or a
 * team-totals game — which correctly has zero matches, forever — would be
 * covered by a scrim naming a mechanic it does not have.
 */
export function PickemMatchesRequired() {
  return (
    <div
      className="absolute inset-0 z-[2] flex justify-center rounded-xl"
      style={{ background: "var(--color-bt-overlay-row)", cursor: "not-allowed" }}
      /* Absorb the tap and go no further — the same sibling-not-child shape the
         settings scrim uses, for the same reason: a cover nested inside its own
         control still bubbles the click to it. */
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      data-testid="pickem-matches-required"
    >
      <div
        className="m-3 flex h-fit flex-col items-center gap-1.5 px-5 py-6 text-center"
        style={{
          borderRadius: 14,
          maxWidth: 340,
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <Swords size={26} style={{ color: "var(--color-bt-text-dim)", opacity: 0.8 }} />
        <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 700 }}>Draw the matches first</span>
        <span
          style={{
            fontSize: TYPE_SCALE.bodyDense,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.45,
          }}
        >
          {/* The REASON, not just the rule. "You can't yet" invites a runner to
              try the other order; "the pairings freeze" tells them why there is
              only one. */}
          The first result freezes the pairings, so they have to be set before
          any game is marked.
        </span>
        <span
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.45,
          }}
        >
          {/* NAMES WHERE. A refusal has to point at something the reader can
              reach from where they are standing, and the gear is in this game's
              own header on every format. */}
          The gear at the top of this page, then Matches.
        </span>
      </div>
    </div>
  );
}
