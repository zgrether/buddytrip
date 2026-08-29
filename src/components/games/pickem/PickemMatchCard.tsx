"use client";

import { TYPE_SCALE } from "@/lib/typeScale";
import type { MatchStanding } from "@/lib/pickemBoard";

/**
 * One head-to-head match, as a card.
 *
 * ── The margin bar is the point ────────────────────────────────────────────
 *
 * Two totals side by side tell you who is ahead only after you subtract them.
 * The bar fills outward from a centre tick, so a blowout and a coin flip look
 * different before you have read a number — which is the question actually
 * being asked when someone scrolls a list of eight matches.
 *
 * Scaled against `max(30, |margin|)` rather than the totals: what matters is the
 * SIZE OF THE LEAD, and a fixed denominator would make every early margin look
 * identical while a total-relative one would make a 2-point lead in a low-
 * scoring match look like a rout.
 *
 * ── Nothing here computes ─────────────────────────────────────────────────
 *
 * Every figure arrives as a `MatchStanding` from `matchStanding()`. `clinched`
 * especially is not re-derived: it is false once nothing is left, because a
 * finished match is DECIDED rather than clinched, and putting a live-sounding
 * word on a settled result is exactly the kind of drift that comes from a second
 * implementation.
 */

export type MatchPill = "not-started" | "live" | "clinched" | "final" | "no-picks";

/**
 * Whether each side actually submitted. Not a count — a sheet is all-or-nothing
 * (`_pickem_write_sheet` refuses an incomplete one), so "has picks" is the whole
 * question.
 */
export interface SidesPicked {
  a: boolean;
  b: boolean;
}

/**
 * Which pill this standing earns.
 *
 * ── NO PICKS is not a clinch, and calling it one was wrong ─────────────────
 *
 * Someone with no sheet has zero upside, so `matchStanding` correctly reports
 * the opponent's lead as beyond reach from the first result. The maths is
 * right; CLINCHED was the wrong WORD for it.
 *
 * A clinch is a contest won. Beating an empty sheet is not a contest, and the
 * difference is not pedantry: a clinched match is DECIDED, while this one is
 * decided only because nobody entered — and it can be undecided by the person
 * picking, or by a captain proxying for them, any time before the lock.
 *
 * Reading "CLINCHED · only 0 in play" with nine games left, a person concludes
 * the app is broken rather than that their opponent never picked.
 *
 * Ranked above clinch and below final: once nothing is left it stops being
 * reversible and is simply the result.
 */
export function matchPill(
  s: MatchStanding,
  resolvedCount: number,
  picked: SidesPicked
): MatchPill {
  if (s.remaining === 0) return "final";
  if (!picked.a || !picked.b) return "no-picks";
  if (resolvedCount === 0) return "not-started";
  return s.clinched ? "clinched" : "live";
}

const PILL_LABEL: Record<MatchPill, string> = {
  "not-started": "Not started",
  live: "Live",
  clinched: "Clinched",
  final: "Final",
  "no-picks": "No picks",
};

/**
 * What the match reads like in one line, in order of precedence.
 *
 * The order is the design's and it is deliberate: a dead heat and a match with
 * nothing played both show 0–0, so the two must be separated before anything
 * else is said about them — the empty-versus-unknown split, in copy.
 */
export function matchNote(
  s: MatchStanding,
  resolvedCount: number,
  leaderName: string,
  picked: SidesPicked,
  names: { a: string; b: string }
): string {
  const lead = Math.abs(s.margin);

  if (s.remaining === 0) {
    return s.margin === 0
      ? "Dead even — half a point each"
      : `${leaderName} takes it by ${lead}`;
  }

  // Said BEFORE anything about margins, because a missing sheet explains the
  // numbers rather than being explained by them — and it is the one state here
  // that somebody can still act on.
  if (!picked.a || !picked.b) {
    if (!picked.a && !picked.b) return "Neither has picked yet";
    const missing = picked.a ? names.b : names.a;
    const other = picked.a ? names.a : names.b;
    return `${missing} hasn't picked — ${other} takes it unless that changes`;
  }

  if (resolvedCount === 0) return "No games in yet";
  if (s.margin === 0) return `Level with ${s.remaining} to play`;
  if (s.clinched) {
    return `${leaderName} is safe — only ${s.trailingUpside} in play against a ${lead} lead`;
  }
  return `${leaderName} by ${lead} · ${s.trailingUpside} still in play`;
}

/**
 * The same line, for the head-to-head screen.
 *
 * ── Delegates rather than duplicates, except in one branch ────────────────
 *
 * Every state but the ordinary mid-match one reads identically on both screens
 * — a clinch is a clinch, a final is a final — and two sentences that must
 * always agree are two sentences that eventually will not. So this calls
 * `matchNote` for all of them and overrides exactly one case.
 *
 * That case flips the SUBJECT. The card is scanned in a list of eight and
 * answers "who is winning this one", so it names the leader. The head-to-head
 * is opened deliberately by somebody who already knows the score and is asking
 * what it would take, so it names the TRAILER and what they need: the reader
 * has changed, and the sentence follows them.
 */
export function h2hNote(
  s: MatchStanding,
  resolvedCount: number,
  leaderName: string,
  picked: SidesPicked,
  names: { a: string; b: string }
): string {
  const ordinary =
    s.remaining > 0 &&
    picked.a &&
    picked.b &&
    resolvedCount > 0 &&
    s.margin !== 0 &&
    !s.clinched;

  if (!ordinary) return matchNote(s, resolvedCount, leaderName, picked, names);

  const trailer = s.margin > 0 ? names.b : names.a;
  const needs = Math.abs(s.margin) + 1;
  const games = `${s.remaining} game${s.remaining === 1 ? "" : "s"}`;
  return `${trailer} needs ${needs} from ${games} · ${s.trailingUpside} in play`;
}

function Pill({ kind }: { kind: MatchPill }) {
  // "No picks" is not good news for anyone, so it does not take the accent that
  // Live and Clinched use to mean "something is happening here".
  const accent = kind === "live" || kind === "clinched";
  return (
    <span
      data-testid={`pickem-match-pill-${kind}`}
      className="shrink-0 rounded-full"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "2px 7px",
        color: accent ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        background: accent ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
      }}
    >
      {PILL_LABEL[kind]}
    </span>
  );
}

/**
 * The margin bar — two half-tracks either side of a centre tick.
 *
 * The leader's half fills from the centre OUTWARD, so the eye reads direction
 * and size in one glance without matching a colour to a name.
 */
function MarginBar({ margin, live }: { margin: number; live: boolean }) {
  const lead = Math.abs(margin);
  const pct = lead === 0 ? 0 : Math.min(100, (lead / Math.max(30, lead)) * 100);
  const fill = live ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)";

  const half = (side: "a" | "b") => {
    const filled = (side === "a" && margin > 0) || (side === "b" && margin < 0);
    return (
      <span
        className="relative flex-1 overflow-hidden"
        style={{ height: 5, borderRadius: 3, background: "var(--color-bt-card-raised)" }}
      >
        {filled && (
          <span
            className="absolute top-0"
            style={{
              // A's half grows leftward from the centre, B's rightward — the
              // centre is the shared origin, which is what makes the two halves
              // read as one instrument rather than two meters.
              [side === "a" ? "right" : "left"]: 0,
              width: `${pct}%`,
              height: 5,
              borderRadius: 3,
              background: fill,
              transition: "width 250ms ease-out",
            }}
          />
        )}
      </span>
    );
  };

  return (
    <span className="flex items-center gap-1" data-testid="pickem-margin-bar">
      {half("a")}
      <span
        aria-hidden
        style={{ width: 1, height: 9, background: "var(--color-bt-border)", flexShrink: 0 }}
      />
      {half("b")}
    </span>
  );
}

export function PickemMatchCard({
  aName,
  bName,
  standing,
  resolvedCount,
  picked,
  mine,
  youSide,
  note,
  selected,
  onOpen,
}: {
  aName: string;
  bName: string;
  standing: MatchStanding;
  /** Slate games with a result — separates "level" from "nothing played". */
  resolvedCount: number;
  /**
   * Whether each side submitted at all. Zero-because-nobody-picked and
   * zero-because-they-were-beaten look identical in the totals and mean
   * opposite things about whether anything can still change.
   */
  picked: SidesPicked;
  mine: boolean;
  /** Which side the viewer is on, for the YOU tag. Null when neither. */
  youSide: "a" | "b" | null;
  /** The runner's per-match note, if any. Ellipsised beside the status. */
  note?: string | null;
  selected?: boolean;
  onOpen: () => void;
}) {
  const s = standing;
  const aLead = s.margin > 0;
  const leaderName = aLead ? aName : bName;
  const pill = matchPill(s, resolvedCount, picked);
  const live = pill === "live" || pill === "clinched";

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={mine ? "pickem-board-match-mine" : "pickem-board-match"}
      className="mx-1 flex flex-col gap-1.5 px-3 py-2.5 text-left active:scale-[0.98]"
      style={{
        borderRadius: 13,
        background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        border:
          selected || mine
            ? "1px solid var(--color-bt-accent-border)"
            : "1px solid var(--color-bt-border)",
      }}
    >
      {/* Line 1 — names either side of the score. The LEADER is white and bold,
          the trailer dim: the weight says who is ahead before the numbers do. */}
      <span className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate"
          style={{
            fontSize: TYPE_SCALE.bodyDense,
            fontWeight: aLead ? 700 : 500,
            color: aLead ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          }}
        >
          {aName}
          {youSide === "a" && <YouTag />}
        </span>
        <span
          className="shrink-0"
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {s.aTotal} – {s.bTotal}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-right"
          style={{
            fontSize: TYPE_SCALE.bodyDense,
            fontWeight: !aLead && s.margin !== 0 ? 700 : 500,
            color: !aLead && s.margin !== 0 ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          }}
        >
          {bName}
          {youSide === "b" && <YouTag />}
        </span>
      </span>

      <MarginBar margin={s.margin} live={live} />

      <span className="flex min-w-0 items-center gap-2">
        <Pill kind={pill} />
        <span
          className="min-w-0 flex-1 truncate"
          data-testid="pickem-match-note"
          style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
        >
          {matchNote(s, resolvedCount, leaderName, picked, { a: aName, b: bName })}
          {note ? ` · ${note}` : ""}
        </span>
      </span>
    </button>
  );
}

/** The viewer's own match, findable at a glance in a list of eight. */
function YouTag() {
  return (
    <span
      className="ml-1 rounded px-1"
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-bt-accent)",
        background: "var(--color-bt-accent-faint)",
      }}
    >
      You
    </span>
  );
}
