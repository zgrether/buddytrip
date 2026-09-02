"use client";

import { ValueUnit } from "@/components/ValueUnit";
import { fmtValue } from "@/components/competition/CompetitionGamesPanel";
import { gameLockState, type GameLifecycleInput } from "@/lib/gameLifecycle";

/**
 * ScoringStateBanner — the one banner that says whether a finished game's result
 * is settled or being looked at again, for every format.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The correcting state was barely signalled anywhere. Inside a game the only
 * tell was an eyebrow label swapping "final" for "correcting" — small-caps text
 * doing alert work, in a label nobody was reading. And it was uneven: rack had a
 * banner but only for the LOCKED state (so it vanished exactly when there was
 * something to say), match had a word in a section label, and stroke and non-golf
 * had nothing at all. Two of four formats said something, and the two that did
 * disagreed about what and where.
 *
 * That is CLAUDE.md #24 again — the tenth instance, and the SECOND shape of it:
 * the STATE was already unified (`gameLockState`, since #809) while the
 * PRESENTATION of it stayed private per view. A "the labels still match" check
 * would not have caught this one, because the labels did not match and two
 * formats had no label to compare.
 *
 * So the banner takes the same `status` + `correctionsOpen` pair every other
 * lifecycle surface reads, and resolves it through the SAME predicate. There is
 * no way for one format to disagree with another about what a re-opened game
 * looks like without changing this file.
 *
 * ── Persistence-agnostic (CLAUDE.md #7) ──────────────────────────────────────
 * No tRPC, no DB, no auth. The parent passes the two lifecycle columns.
 *
 * ── Not role-gated, deliberately ─────────────────────────────────────────────
 * A member can correct their own scores in this mode, so the banner is a state
 * they participate in rather than someone else's private edit. It takes no
 * `canEdit` and must not grow one — the CTA below it is where the role answer
 * lives (`GameLifecycleActions`), and that split is the point: what is TRUE of
 * the game is shown to everyone; what you may DO about it is gated.
 */
export function ScoringStateBanner({
  status,
  correctionsOpen,
  pointsTotal,
}: Pick<GameLifecycleInput, "status" | "correctionsOpen"> & {
  /**
   * What the game is worth — the IN-PROGRESS state's whole content.
   *
   * `games.points_total`, the same single number the leaderboard sums and
   * `PointsAtStake` renders. Passed IN rather than derived here so there is one
   * source: two derivations of one number is how a banner comes to disagree
   * with the board about the same game.
   *
   * A bracket is no different, even though its final settles two places — the
   * GAME's value is one number, and how it splits across places is the board's
   * business, not this banner's.
   *
   * Omitted or 0 → the banner stays absent in progress, exactly as before. A
   * game with nothing at stake has nothing to announce.
   */
  pointsTotal?: number | null;
}) {
  const { isLocked, isCorrecting } = gameLockState({ status, correctionsOpen });
  const worth = Number(pointsTotal ?? 0);
  if (!isLocked && !isCorrecting && worth <= 0) return null;

  /**
   * Warning tone for CORRECTING, accent for LOCKED — STYLE_GUIDE §3's
   * "Warning" and "Yes / Works / Confirmed" rows respectively, taken as whole
   * trios (faint background, solid text, border) rather than mixed.
   *
   * Warning is marked STATUS DISPLAY ONLY in the guide, which is exactly this:
   * the banner states a fact and is not tappable. The same trio carries the
   * board's IN REVIEW badge, so the two surfaces read as one state instead of
   * two things that happen to be amber.
   */
  const tone = isCorrecting
    ? {
        bg: "var(--color-bt-warning-faint)",
        fg: "var(--color-bt-warning)",
        border: "var(--color-bt-warning-border)",
        text: "Scoring changes permitted",
        testid: "banner-correcting",
      }
    : isLocked
      ? {
          bg: "var(--color-bt-accent-faint)",
          fg: "var(--color-bt-accent)",
          border: "var(--color-bt-accent-border)",
          text: "Game results are final",
          testid: "banner-locked",
        }
      : {
          /**
           * IN PROGRESS — neutral, and the home for the value that used to float
           * loose in the bracket's top right with no container.
           *
           * Neutral rather than accent or warning: nothing has happened yet, and
           * that is what keeps accent meaning "settled" and warning meaning
           * "changes permitted" — both stay worth something because this state
           * borrows neither. (This used to add "the card surface + an ordinary
           * border is the no-verdict treatment"; the surface moved, see below.
           * NEUTRAL is the property that mattered, and it still holds — base is
           * no more of a verdict than card was.)
           *
           * DARKER than the match rows, not lighter (#14).
           *
           * The ribbon shared `--color-bt-card` with the rows below it, so it
           * read as another item in the list rather than a statement ABOUT the
           * game. A lighter surface would not have fixed that — it would read
           * as another RAISED card in the same stack, which is the same
           * confusion one level up. Going darker makes it read as cut into the
           * page, which nothing else in that column does.
           *
           * `--color-bt-base` is the page background (STYLE_GUIDE §1 Level 0)
           * and already exists — no new token, no hex, and nothing for §7's
           * hardcoded-colour list to grow by. The border stays: STYLE_GUIDE
           * builds separation from borders rather than shadows.
           *
           * Text goes BRIGHTER in the same breath. Dim-on-dark was legible
           * against `card` and would not be against `base`, and the contrast is
           * half of what makes the strip read as a different KIND of thing.
           */
          bg: "var(--color-bt-base)",
          fg: "var(--color-bt-text)",
          border: "var(--color-bt-border)",
          text: null,
          testid: "banner-in-progress",
        };

  return (
    <div
      data-testid={tone.testid}
      className="mb-2 flex items-center justify-center rounded-lg"
      style={{ height: 30, background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      {tone.text != null ? (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: tone.fg }}>{tone.text}</span>
      ) : (
        /* IN PROGRESS — the value carries, so it is split (STYLE_GUIDE §2c) and
           then matches the point chips directly below it in the match list,
           which have always rendered "2 PTS" with the digits primary. The lead-in
           is a label like the unit is. */
        <span className="flex items-baseline" style={{ gap: 4, fontSize: 12.5, fontWeight: 600 }}>
          <span style={{ color: "var(--color-bt-text-dim)" }}>This game is worth</span>
          <ValueUnit value={fmtValue(worth)} unit="pts" size={12.5} color={tone.fg} />
        </span>
      )}
    </div>
  );
}
