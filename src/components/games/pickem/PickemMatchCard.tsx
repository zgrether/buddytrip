"use client";

import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE } from "@/lib/typeScale";
import type { MatchStanding } from "@/lib/pickemBoard";

/** Identity for one side, in the shape `avatarFor` already returns. */
export interface SideAvatar {
  avatarIcon: string | null;
  teamColor: string | null;
}

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

export type MatchPill = "not-started" | "live" | "clinched" | "final" | "no-sheet";

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
 * ── A missing sheet is not a clinch, and calling it one was wrong ──────────
 *
 * Someone with no sheet has zero upside, so `matchStanding` correctly reports
 * the opponent's lead as beyond reach from the first result. The maths is
 * right; CLINCHED was the wrong WORD for it. A clinch is a contest won, and
 * beating an empty sheet is not a contest.
 *
 * ── ...and NO PICKS was the wrong word for it too ──────────────────────────
 *
 * Read on the board, "No picks" invites the reading that this person's picks
 * are missing from a sheet that exists. What is missing is the SHEET — they
 * never submitted one, and a sheet that was never written scores nothing.
 *
 * The distinction matters because of what people assume fills the gap. The
 * picking screen opens on every home team, so "I didn't pick" feels like it
 * should mean "I took the chalk". It does not: nothing is stored until Save is
 * pressed, and `sheetPoints` over an absent sheet is 0, not the chalk's score.
 * Verified against the live game rather than reasoned — three people show 0
 * rows in `pickem_picks` and 0 points, while every submitted sheet has 16.
 *
 * So the pill names the absent thing. If a missing sheet should one day BE the
 * chalk, that is a scoring change (a migration that materialises defaults at
 * the lock) and this state stops existing — it is not a relabelling.
 *
 * Ranked above clinch and below final: once nothing is left it stops mattering
 * how the margin was built and the match is simply the result.
 */
export function matchPill(
  s: MatchStanding,
  resolvedCount: number,
  picked: SidesPicked
): MatchPill {
  if (s.remaining === 0) return "final";
  if (!picked.a || !picked.b) return "no-sheet";
  if (resolvedCount === 0) return "not-started";
  return s.clinched ? "clinched" : "live";
}

const PILL_LABEL: Record<MatchPill, string> = {
  "not-started": "Not started",
  live: "Live",
  clinched: "Clinched",
  final: "Final",
  "no-sheet": "Nothing submitted",
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

  /**
   * Said BEFORE anything about margins, because a missing sheet explains the
   * numbers rather than being explained by them.
   *
   * ── It no longer says "unless that changes" ──────────────────────────────
   *
   * It cannot change. This surface renders on a LOCKED game and nowhere else,
   * and `pickem_picks_write` gates on `pickem_picks_open` — so neither the
   * person nor a captain proxying for them can add a sheet from here. The
   * sentence offered a way out that the policy refuses, which is the refusal
   * rule pointing the other way: an INVITATION nobody can accept.
   *
   * What it says instead is the consequence, because that is the part a reader
   * cannot work out. An empty sheet scoring nothing is not obvious on a screen
   * whose picking half defaults every game to the home team.
   */
  if (!picked.a || !picked.b) {
    /**
     * ── SHORTENED, because the PILL beside it already says the fact ────────
     *
     * This read "X didn't submit a sheet — it scores nothing, so Y takes the
     * match", which repeated the pill ("Nothing submitted") and then overran
     * the line it shares with it. Both surfaces that render this note render
     * that pill — the card's `Pill kind="no-sheet"` and the head-to-head's
     * `h2hPill` — so the fact is not lost by dropping it here, which is the
     * thing to check before shortening a sentence into a label.
     *
     * WHAT IS GENUINELY GONE is the explicit consequence, "it scores
     * nothing". The longer version existed to state it because an empty sheet
     * scoring zero is not obvious on a screen whose picking half defaults
     * every game to the home team. The pair now has to carry it by
     * implication — "Nothing submitted" beside "Grether takes it" — which is
     * a real if small loss and the reason this is written down rather than
     * just done.
     */
    if (!picked.a && !picked.b) return "Nothing scores";
    const other = picked.a ? names.a : names.b;
    return `${other} takes it`;
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
  // A missing sheet is not good news for anyone, so it does not take the accent
  // that Live and Clinched use to mean "something is happening here".
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
  aAvatar,
  bAvatar,
  standing,
  resolvedCount,
  picked,
  mine,
  note,
  selected,
  onOpen,
}: {
  aName: string;
  bName: string;
  /**
   * Whose faces these are — the SAME `avatarFor` accessor the head-to-head
   * takes, so a person wears one identity on both screens.
   *
   * Optional, and absent renders exactly as this card did before. `Avatar`
   * already handles every case behind that: an icon or initials, a team colour
   * or the neutral surface, and `teamTextColor` picking the foreground. None of
   * that is re-decided here — the point of passing the raw pair is that the
   * card holds no identity logic at all.
   */
  aAvatar?: SideAvatar;
  bAvatar?: SideAvatar;
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
      className="flex flex-col gap-1.5 px-3 py-2.5 text-left active:scale-[0.98]"
      style={{
        borderRadius: 13,
        /* ── YOUR OWN MATCH TAKES THE CARD TEAL, NOT A BADGE ──────────────
           `mine` used to change the BORDER only, which is a 1px difference
           that has to be hunted for in a list of eight — so the card also
           carried a "YOU" tag to make itself findable. The tag exists nowhere
           else in the app, and a filled card says the same thing from much
           further away, so the fill replaces it rather than joining it. */
        background:
          selected || mine ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        border:
          selected || mine
            ? "1px solid var(--color-bt-accent-border)"
            : "1px solid var(--color-bt-border)",
      }}
    >
      {/* Line 1 — faces and names either side of the score. The LEADER is white
          and bold, the trailer dim: the weight says who is ahead before the
          numbers do.

          Each side is its own `@container`, which is what arms `Avatar`'s
          `collapse`: as the name column narrows the disk becomes a team-colour
          dot and then drops, so the NAME is never the thing that truncates
          first. The card does not choose between disk and dot — the avatar
          does, from the width it is actually given. */}
      <span className="flex items-center gap-2">
        <span
          className="@container flex min-w-0 flex-1 items-center gap-1.5"
          style={{
            fontSize: TYPE_SCALE.name,
            fontWeight: aLead ? 700 : 500,
            color: aLead ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          }}
        >
          {aAvatar && (
            <Avatar
              name={aName}
              avatarIcon={aAvatar.avatarIcon}
              teamColor={aAvatar.teamColor}
              sizePx={26}
              collapse
              collapseAt="chip"
            />
          )}
          <span className="min-w-0 truncate">
            {aName}
          </span>
        </span>
        <span
          className="shrink-0"
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {s.aTotal} – {s.bTotal}
        </span>
        {/* Mirrored: name then face, so the two avatars sit at the card's
            outer edges and the names meet the score in the middle. */}
        <span
          className="@container flex min-w-0 flex-1 items-center justify-end gap-1.5"
          style={{
            fontSize: TYPE_SCALE.name,
            fontWeight: !aLead && s.margin !== 0 ? 700 : 500,
            color: !aLead && s.margin !== 0 ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          }}
        >
          <span className="min-w-0 truncate text-right">
            {bName}
          </span>
          {bAvatar && (
            <Avatar
              name={bName}
              avatarIcon={bAvatar.avatarIcon}
              teamColor={bAvatar.teamColor}
              sizePx={26}
              collapse
              collapseAt="chip"
            />
          )}
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

