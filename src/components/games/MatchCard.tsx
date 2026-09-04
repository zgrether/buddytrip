"use client";

import { PointsAtStake } from "./PointsAtStake";
import { Table2 } from "lucide-react";
import { matchState, type DecidedHole } from "@/lib/matchPlay";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { teamTextColor } from "@/lib/teamTextColor";
import type { SidePlayer } from "./MatchSides";
import { fitName } from "@/lib/nameLadder";
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

/** The match card's step-1 name size. The ladder steps down from here — see
 *  `nameLadder.ts`. Both the 1v1 and 2v2 branches read this ONE value, so a
 *  doubles pairing can never render smaller than a singles name by accident. */
const NAME_BASE_SIZE = 17;

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
}: MatchCardProps) {
  const st = matchState(results, holeCount, glorious);
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
        <NameCell name={a.name} players={aPlayers} align="right" tinted={aLeads} color={lc} />
        <div style={{ width: 3, background: wonL }} />
        <div className="flex items-center justify-center" style={{ width: CENTRE_W, flexShrink: 0, background: "var(--color-bt-card-raised)", fontSize: 19, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {centerNum}
        </div>
        <div style={{ width: 3, background: wonR }} />
        <NameCell name={b.name} players={bPlayers} align="left" tinted={bLeads} color={rc} />
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
          return <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: bg, opacity: op }} />;
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

/** Name column — leans inward (left col right-justified, right col left-justified);
 *  leading side gets a faint tint of its emphasis color. Uniform 600 weight. */
function NameCell({ name, players, align, tinted, color }: { name: string; players?: SidePlayer[]; align: "left" | "right"; tinted: boolean; color: string }) {
  const bg = tinted ? `${color}29` : "transparent";
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
          const fit = fitName(p.name, NAME_BASE_SIZE);
          return (
            <span
              key={p.id}
              className="max-w-full truncate"
              data-name-step={fit.step}
              style={{ fontSize: fit.fontSize, fontWeight: 600, color: "var(--color-bt-text)", textAlign: align, lineHeight: 1.3 }}
            >
              {fit.text}
            </span>
          );
        })}
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
  const fit = fitName(name, NAME_BASE_SIZE);
  return (
    <div
      className="flex min-w-0 flex-1 items-center"
      style={{ justifyContent: align === "right" ? "flex-end" : "flex-start", padding: `0 ${NAME_PAD_X}`, background: bg }}
    >
      <span
        data-name-step={fit.step}
        style={{ fontSize: fit.fontSize, fontWeight: 600, color: "var(--color-bt-text)", textAlign: align, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {fit.text}
      </span>
    </div>
  );
}
