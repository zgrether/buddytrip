"use client";

import { PointsAtStake } from "./PointsAtStake";
import { Table2 } from "lucide-react";
import { matchState, type DecidedHole } from "@/lib/matchPlay";
import { NO_GLORIOUS, isGloriousHole, type GloriousConfig } from "@/lib/gloriousHoles";
import { teamTextColor } from "@/lib/teamTextColor";
import type { SidePlayer } from "./MatchSides";
import { fitName, CARD_NAME_CAPACITY_EM } from "@/lib/nameLadder";
import type { Participant } from "./types";

/**
 * MatchCard — the team-agnostic match board (Spec Addendum B-3, supersedes the
 * old MatchStrip). One card per match. Neutral by default (place-1 green leader
 * emphasis + a value-ramp history); pass `leftColor`/`rightColor` for team
 * context (Slice D) and the margins/tints/history/identity-bars switch to team
 * colors. This is presentation only — `matchState` is unchanged.
 *
 * Layout (exact): header (label · centered THRU/DORMIE/FINAL · spacer) → row
 * ([Margin][Name A][IdBar][hole #][IdBar][Name B][Margin]) → 18-segment history.
 * No avatars, no strokes badge (the stroke pip lives on the entry cell). Names
 * lean inward; the colored margin block (not weight/teal) is the leader cue.
 */

const WIN_GREEN = "#22c55e"; // = --color-bt-place-1 base; neutral "winning" color (NOT teal)
// Neutral history ramp — value/lightness, not hue (the hue budget is for teams).
const NEU_WON_L = "#eaeef4"; // left won — bright
const NEU_WON_R = "#566275"; // right won — dark (wide gap)
const NEU_HALF = "#8c97a8"; // halved — mid

/**
 * THE NAME SIZE IS KEYED TO THE VIEWPORT, exactly as the chrome below is.
 *
 * Was a flat 17px, which on a 375px phone put the LARGEST font in the
 * NARROWEST cell — "Zach Grether" (12 chars, so the old length ladder left it
 * at step 1) rendered 100px wide into an 85px slot and truncated, while
 * "Bill Giesler" at the same 12 characters and the same 17px measured 81px and
 * fit. The ladder was contributing nothing there; the viewport was the missing
 * input.
 *
 * This is NOT the per-name scaling that is ruled out: every name on the screen
 * gets the same size, and only the screen width changes it. 3.7vw resolves to
 * ~13.9px at 375 and reaches the old 17px at ~460 and above, so larger phones
 * are unchanged.
 */
const NAME_FONT = "clamp(13px, 3.7vw, 17px)";

/**
 * THE CARD'S FIXED CHROME WAS 53% OF A 375px PHONE, and that — not the names —
 * is why they did not fit.
 *
 * The row is [Margin][Name][bar][hole][bar][Name][Margin]. Every piece except
 * the names was a fixed pixel value: two 56px margin chips, a 40px centre, two
 * 3px bars, and 10px of padding on each side of each name cell. 198px of
 * furniture before a single letter renders, leaving `(375 − 198) / 2 = 88px`
 * per name — at which "Matt Facchine" (89px at 14px) truncates.
 *
 * Measured against the real font stack rather than guessed:
 *
 *   widest margin chip content   "10 UP"  41.3px   (typical "2 UP"/"3&2" ≈ 34)
 *   widest centre content        "18"     21.9px
 *
 * So the floors sit just above what the content actually needs, and the
 * ceilings keep today's exact geometry on anything wider than ~430px — the
 * device this was reported on is unchanged, and only narrow phones reclaim
 * space. At 375px this returns ~25px to the row, ~12px per name.
 *
 * ── The chips MUST stay symmetric ─────────────────────────────────────────
 *
 * Both edges render the same `Margin` component reading the same constant, so
 * they cannot drift apart. A card with a 56px chip on one side and 48px on the
 * other looks broken in a way nobody can name — deliberately ONE value, not two
 * that happen to agree.
 *
 * ── Why this lands BEFORE the name ladder's width estimate ────────────────
 *
 * Its failure mode is VISIBLE: shrink the chrome too far and the chips look
 * cramped the moment the card opens. A per-character width estimate fails
 * QUIETLY, on one untested name, on a font that cannot be measured from here.
 * Fix the loud one first — and it makes the quiet one's job smaller.
 */
const MARGIN_CHIP_W = "clamp(46px, 13vw, 56px)";
const CENTRE_W = "clamp(30px, 9vw, 40px)";
const NAME_PAD_X = "clamp(6px, 2.4vw, 10px)";

interface MatchCardProps {
  a: Participant;
  b: Participant;
  /** Decided holes, A's perspective — {hole, W/L/H}, in play order. */
  results: DecidedHole[];
  /** Glorious Finishing Holes weight (2× the last N). Omit for standard match play. */
  glorious?: GloriousConfig;
  label?: string;
  /** Team colors (Slice D). Omit for the neutral standalone default. */
  leftColor?: string;
  rightColor?: string;
  holeCount?: number;
  onClick?: () => void;
  /** Per-side players (Match-Play Parity item 3) — when a side has 2+ players
   *  (a 2v2), the name cell renders the shared stacked `SideChips` instead of the
   *  collapsed single-line "R & B" name; the row grows to fit. Omit / single-entry
   *  for a 1v1 (keeps the compact single-name strip). */
  aPlayers?: SidePlayer[];
  bPlayers?: SidePlayer[];
  /**
   * Current user's id — highlights the whole card when they are in this match.
   *
   * It used to append "(you)" to their name. The card colour says the same
   * thing from further away, and "(you)" cost six characters on precisely the
   * row where the name was already tightest — it was competing with the fix.
   *
   * "(you)" is UNCHANGED on the five other surfaces that use it (CrewRoster,
   * DatePollStackedCards, ExpensesSection, SplitPanel, FloatingChatPanel).
   * None of those has a colour treatment, so they stay consistent with each
   * other; this card diverges because it is the one surface that gained a
   * better signal.
   */
  youId?: string;
  /** Hide the "· 1v1" suffix in the header (entry page shows just "MATCH #"). */
  hideFormat?: boolean;
  /** Opens this match's scorecard — renders a compact button on the RIGHT of the
   *  header row (the MATCH # · THRU/FINAL row). Only pass when the card itself is
   *  NOT a tap target (no `onClick`) — nesting a button in a button is invalid. */
  onScorecard?: () => void;
  /** What THIS match is worth — its own `point_value` override, else the game's
   *  even share. Shown in the header so the person playing it can see what's at
   *  stake; the board has always shown the game total and this surface showed
   *  nothing. Omit (or 0) for a standalone match with no competition points. */
  pointValue?: number;
  /**
   * Which units are WEIGHTED, when that cannot be answered positionally.
   *
   * Golf answers it from `glorious` (a trailing window) and passes nothing
   * here. Pick'em's multiplier belongs to a game wherever it sits on the slate,
   * so it passes a predicate. Same amber treatment either way — this decides
   * WHICH segments get it, never what it looks like.
   */
  isWeightedUnit?: (unit: number) => boolean;
  /**
   * Units that carry NO STAKE, and why — 1-based, sparse.
   *
   * Golf has no such unit: a hole is always played and always contested, so
   * this is omitted and every segment is won/lost/halved. Pick'em has two
   * kinds and they must not look like each other or like a halve — see the
   * segment loop for the reasoning.
   */
  decidedStake?: Record<number, "void" | "none">;
  /**
   * A per-side line UNDER that side's name, and a flag that dims the name.
   *
   * Generic on purpose. Pick'em uses them to say a player submitted no sheet —
   * a notice that used to sit outside this card as a sibling, where it escaped
   * its container on a phone and overlapped the next card. A `noPicks` boolean
   * would have put a format-specific state in the one component both formats
   * read; a NODE plus "this side is not scoring" is equally true of a
   * withdrawal or a DQ, and teaches this card nothing about sheets.
   */
  aNote?: React.ReactNode;
  bNote?: React.ReactNode;
  aMuted?: boolean;
  bMuted?: boolean;
}

export function MatchCard({
  a,
  b,
  results,
  glorious = NO_GLORIOUS,
  label = "Match",
  leftColor,
  rightColor,
  holeCount = 18,
  onClick,
  aPlayers,
  bPlayers,
  youId,
  hideFormat,
  pointValue,
  onScorecard,
  isWeightedUnit,
  decidedStake,
  aNote,
  bNote,
  aMuted,
  bMuted,
}: MatchCardProps) {
  const st = matchState(results, holeCount, glorious);
  /* Golf answers "is this unit weighted?" from its trailing window; a caller
     that weights per unit passes its own predicate. One default, so the loop
     below never branches on which format it is drawing. */
  const weightedUnit = isWeightedUnit ?? ((unit: number) => isGloriousHole(unit, glorious));
  const teams = !!(leftColor && rightColor);
  const lc = leftColor || WIN_GREEN; // left emphasis color
  const rc = rightColor || WIN_GREEN; // right emphasis color
  const wonL = teams ? lc : NEU_WON_L;
  const wonR = teams ? rc : NEU_WON_R;
  const halfC = teams ? "var(--color-bt-text-dim)" : NEU_HALF;

  const aLeads = st.leader === "A";
  const bLeads = st.leader === "B";
  const square = st.leader === null;
  const headerWord = st.over ? "FINAL" : st.dormie ? "DORMIE" : "THRU";
  /**
   * DORMIE IS NOT FINAL, AND THEY NO LONGER SHARE A COLOUR.
   *
   * Both used to read `place-1-text`. They are different states: dormie can
   * still be halved, final is over — so a glance that cannot separate them is
   * telling you the match is decided when it is not. Amber (`bt-warning`, the
   * existing token) for the one still in play, the place-1 green kept for the
   * one that is done.
   */
  const headerColor = st.over
    ? "var(--color-bt-place-1-text)"
    : st.dormie
      ? "var(--color-bt-warning)"
      : "var(--color-bt-text-dim)";
  const centerNum = st.over ? "F" : String(st.thru);
  // Leader margin text: closed margin ("3&2") or won-18 ("2 UP") from matchState,
  // else the live lead while in progress.
  const leadText = st.over ? (st.margin ?? "") : `${st.up} UP`;

  /**
   * THE VIEWER'S OWN MATCH. Same treatment as the rack's group rows
   * (`rack/FoursomeEntry.tsx`) — `accent-faint` fill, `accent-border` edge —
   * reused rather than re-invented, because two teal treatments for "yours" is
   * how surfaces start disagreeing about what teal means.
   *
   * NO "Enter" affordance, deliberately: the rack row has one because tapping
   * it is how you get into scoring, and this card is already a tap target when
   * `onClick` is passed.
   *
   * A 2v2's `a.id` is the play_group id, not a person, so membership has to be
   * checked against the PLAYERS as well — checking the side ids alone would
   * silently never match on the doubles cards this whole change is about.
   */
  const mine =
    !!youId &&
    (a.id === youId ||
      b.id === youId ||
      (aPlayers ?? []).some((p) => p.id === youId) ||
      (bPlayers ?? []).some((p) => p.id === youId));

  const Container = onClick ? "button" : "div";
  return (
    <Container
      onClick={onClick}
      data-mine={mine || undefined}
      className={`block w-full text-left ${onClick ? "transition-transform active:scale-[0.99]" : ""}`}
      style={{
        background: mine ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        border: `1px solid ${mine ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* 1 · Header */}
      <div className="flex items-center" style={{ height: 26, padding: "0 12px", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
        <span className="flex-1" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
          {hideFormat ? label : `${label} · 1v1`}
        </span>
        <span
          className="flex-1 text-center"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: headerColor }}
        >
          {headerWord}
        </span>
        {/* Scorecard affordance + what this match is worth — right of the header
            row. The points sit BEFORE the scorecard button so the glyph stays the
            outermost element, matching the board's row where the value column is
            pinned right of the scorecard affordance. */}
        <span className="flex flex-1 items-center justify-end gap-2">
          {!!pointValue && pointValue > 0 && (
            <PointsAtStake value={pointValue} className="!text-[10px]" />
          )}
          {onScorecard && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onScorecard(); }}
              aria-label="Scorecard"
              data-testid="match-scorecard"
              className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
            >
              <Table2 size={14} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          )}
        </span>
      </div>

      {/* 2 · Row — `minHeight` (not a fixed 50) so a 2v2's stacked SideChips grow
          the strip instead of clipping (item 3); a 1v1 keeps the 50px single-name row. */}
      <div className="flex" style={{ minHeight: 50, alignItems: "stretch" }}>
        <Margin active={aLeads} square={square} text={aLeads ? leadText : "AS"} color={lc} closed={st.closed} />
        <NameCell name={a.name} players={aPlayers} align="right" tinted={aLeads} color={lc} note={aNote} muted={aMuted} />
        <div style={{ width: 3, background: wonL }} />
        <div className="flex items-center justify-center" style={{ width: CENTRE_W, flexShrink: 0, background: "var(--color-bt-card-raised)", fontSize: 19, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {centerNum}
        </div>
        <div style={{ width: 3, background: wonR }} />
        <NameCell name={b.name} players={bPlayers} align="left" tinted={bLeads} color={rc} note={bNote} muted={bMuted} />
        <Margin active={bLeads} square={square} text={bLeads ? leadText : "AS"} color={rc} closed={st.closed} />
      </div>

      {/* 3 · History */}
      <div className="flex items-center" style={{ gap: 2, padding: "8px 12px 10px", borderTop: "1px solid var(--color-bt-subtle-border)" }}>
        {Array.from({ length: holeCount }, (_, i) => {
          let bg = "var(--color-bt-card-raised)";
          let op = 0.5;
          if (i < st.thru) {
            const r = results[i]?.result;
            bg = r === "W" ? wonL : r === "L" ? wonR : halfC;
            op = 1;
          } else if (st.closed) {
            op = 0.25; // dead — past close-out
          }

          /**
           * ── THREE SHAPES, NOT FIVE ────────────────────────────────────────
           *
           * The bar answers ONE question: did this unit move the match. Golf
           * has two answers (someone gained / it was halved) because a hole is
           * always played and always contested. A pick'em slate has a third —
           * there was no stake here — and it arrives two different ways:
           *
           *   grey fill   played, contested, nobody moved. Both right, both
           *               wrong, or a push. This IS golf's halve.
           *   outlined    the game was CANCELLED. Something was here and its
           *               stake was struck, so the segment keeps its edge and
           *               loses its fill — the outline is the ghost of it.
           *   empty       NOBODY PICKED it. Nothing was ever placed, so there
           *               is no edge either.
           *
           * Grey would be wrong for both: it claims a contest that did not
           * happen. That is the empty-is-not-unknown split, in a 4px block —
           * and the reason the two absences must not look like each other is
           * the same reason, one level down.
           *
           * NOT a colour. A team colour is user-chosen and could be any hue, so
           * spending red on "cancelled" risks colliding with a red team's own
           * won segments. Fill-versus-outline-versus-nothing survives any
           * palette.
           */
          const stake = decidedStake?.[i + 1];
          const bar =
            stake === "none" ? (
              <div
                data-testid={`match-history-nostake-${i + 1}`}
                style={{ height: 4, borderRadius: 2, background: "var(--color-bt-card-raised)", opacity: 0.35 }}
              />
            ) : stake === "void" ? (
              <div
                data-testid={`match-history-void-${i + 1}`}
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "transparent",
                  border: `1px solid ${halfC}`,
                  opacity: 0.75,
                }}
              />
            ) : (
              <div style={{ height: 4, borderRadius: 2, background: bg, opacity: op }} />
            );
          /**
           * Glorious marker — a SECOND AXIS, not a colour swap. The segment
           * already spends blue/red/grey on who won the hole (`bg` above), so
           * doubling has to live somewhere else: the scorecard's own answer
           * (`ScorecardChrome`'s per-cell wash) is a tint + border layered
           * UNDER the content, reused here rather than invented twice. Shown
           * for an UNPLAYED hole too (glorious is about what's coming, not
           * what happened) — the wrapper is keyed on the hole number alone,
           * never on `results`.
           *
           * The wrapper insets the bar with padding so the wash is actually
           * visible as a ring around the (opaque) bar rather than painted
           * fully underneath and hidden by it — worth stating because on the
           * scorecard the wash sits under a transparent-background number
           * cell where that question doesn't arise.
           *
           * ── THE SELECTOR IS PER-UNIT, THE TREATMENT IS BINARY ────────────
           *
           * `weighted` replaces the direct `isGloriousHole` call, because that
           * predicate is POSITIONAL — `hole > 18 − n`, a trailing window — and
           * a pick'em multiplier belongs to a game wherever it sits on the
           * slate. Same visual, different selector; golf still supplies its
           * window through `weightedUnit` below.
           *
           * The wash does NOT carry intensity, though pick'em multipliers run
           * to 4×. Four ambers in an 18×4px segment is a distinction nobody
           * can read — decorative by construction — and the multiplier CHIP
           * already prints the number. Marked-or-not here, how-much there.
           */
          if (!weightedUnit(i + 1)) {
            return (
              <div key={i} style={{ flex: 1 }}>
                {bar}
              </div>
            );
          }
          return (
            <div
              key={i}
              data-testid={`match-history-glorious-${i + 1}`}
              style={{
                flex: 1,
                padding: 2,
                borderRadius: 4,
                background: "var(--color-bt-glorious-faint)",
                border: "1px solid var(--color-bt-glorious-border)",
              }}
            >
              {bar}
            </div>
          );
        })}
      </div>
    </Container>
  );
}

/** Outer status margin — solid emphasis color iff this side leads; grey "AS" on
 *  both when square; empty otherwise. */
function Margin({ active, square, text, color, closed }: { active: boolean; square: boolean; text: string; color: string; closed: boolean }) {
  return (
    <div className="flex items-center justify-center" style={{ width: MARGIN_CHIP_W, flexShrink: 0, background: active ? color : "transparent" }}>
      {(active || square) && (
        <span style={{ fontSize: closed && active ? 14 : 15, fontWeight: 800, color: active ? teamTextColor(color) : NEU_HALF, whiteSpace: "nowrap" }}>
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * Name column — leans inward (left col right-justified, right col left-justified);
 * leading side gets a faint tint of its emphasis color. Uniform 600 weight.
 *
 * ── `note` and `muted` are GENERIC, and deliberately so ────────────────────
 *
 * They exist because pick'em needs to say a side submitted no sheet, and that
 * notice used to sit OUTSIDE the card as a sibling — where it escaped its
 * container on a phone and overlapped the next card.
 *
 * The comment that put it there was right about the cost: "a missing SHEET is a
 * pick'em concept with no golf analogue, and pushing it into the shared card
 * would put a format-specific state in the one place both formats read." So
 * what comes in is not a `noPicks` boolean — it is a NODE under the name and a
 * flag that dims it. This card learns "this side has something to say about
 * itself, and is not scoring", which is true of a withdrawal or a DQ as much as
 * of an absent sheet, and it learns nothing about pick'em.
 *
 * `muted` matters as much as the note: a side scoring nothing should read that
 * way before a badge says so. The badge confirms; the weight tells you first.
 */
function NameCell({ name, players, align, tinted, color, note, muted }: { name: string; players?: SidePlayer[]; align: "left" | "right"; tinted: boolean; color: string; note?: React.ReactNode; muted?: boolean }) {
  const bg = tinted ? `${color}29` : "transparent";
  const nameColor = muted ? "var(--color-bt-text-dim)" : "var(--color-bt-text)";
  // 2v2 → two stacked NAMES, NO avatar disks (item 6). Avatars on the scoreboard
  // were a mistake; the 1v1's avatar-free single line is the reference — this just
  // wraps it to two lines for the two players. Leans inward like the 1v1; the
  // team-tint reads through. (Score-entry choice rows keep their avatars — item 2.)
  if (players && players.length > 1) {
    return (
      <div
        className="flex min-w-0 flex-1 flex-col justify-center"
        style={{ alignItems: align === "right" ? "flex-end" : "flex-start", padding: `8px ${NAME_PAD_X}`, background: bg }}
      >
        {/* THE LADDER, PER NAME. Only the name that does not fit steps down, so
            a short partner beside a long one keeps full size. The `truncate` is
            a backstop that should now never fire. */}
        {players.map((p) => {
          const fit = fitName(p.name, CARD_NAME_CAPACITY_EM);
          return (
            <span
              key={p.id}
              className="max-w-full truncate"
              data-name-step={fit.step}
              style={{ fontSize: NAME_FONT, fontWeight: 600, color: nameColor, textAlign: align, lineHeight: 1.3 }}
            >
              {fit.text}
            </span>
          );
        })}
        {note}
      </div>
    );
  }
  /**
   * 1v1 → the same ladder, from the same module.
   *
   * This branch is where the ladder came FROM: it read
   * `len > 16 ? 13 : len > 12 ? 15 : 17`, and the 2v2 branch above never got
   * it — which is the whole reason a 2v2 truncated where a 1v1 shrank. The
   * sizes move slightly (15/13 → a single 14, the rack group tile's existing
   * size) so that one rule serves both branches and a 2v2 cannot read smaller
   * than a 1v1 by accident.
   */
  const fit = fitName(name, CARD_NAME_CAPACITY_EM);
  return (
    <div
      // `flex-col` + `justify-center` rather than `items-center`: with a note
      // the cell stacks name-over-note, and without one a single centred child
      // renders identically to the row it replaces.
      className="flex min-w-0 flex-1 flex-col justify-center"
      style={{ alignItems: align === "right" ? "flex-end" : "flex-start", padding: `0 ${NAME_PAD_X}`, background: bg }}
    >
      <span
        className="max-w-full"
        data-name-step={fit.step}
        style={{ fontSize: NAME_FONT, fontWeight: 600, color: nameColor, textAlign: align, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {fit.text}
      </span>
      {note}
    </div>
  );
}
