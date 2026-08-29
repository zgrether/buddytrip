"use client";

import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * People who filled in a sheet that counts for nothing.
 *
 * ── Not a cosmetic gap ─────────────────────────────────────────────────────
 *
 * Someone with a sheet and no side — or no opponent — did the work and it
 * scores nowhere. That is a real state and two people need it visible: the
 * PERSON, who otherwise opens a board they are simply absent from, and the
 * RUNNER, for whom it is usually a setup error they would want to fix.
 *
 * Rendering nothing is the empty-versus-unknown pattern: fifteen rows where
 * there are seventeen people reads as "there are fifteen people", and the
 * reader has no way to tell a short field from a dropped one.
 */
export function PickemUnassignedNote({
  names: list,
  teamCount = 2,
}: {
  names: string[];
  /**
   * "Either side" is TWO-TEAM language, and this is the tenth instance in this
   * feature of copy naming a mechanic that is not in play. With four teams the
   * sentence has to be about the scoring, not about a pair.
   *
   * Defaulted to 2 so the match-play call sites read exactly as they did.
   */
  teamCount?: number;
}) {
  if (list.length === 0) return null;
  return (
    <p
      data-testid="pickem-board-unassigned"
      className="rounded-xl px-3 py-2.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        lineHeight: 1.5,
        color: "var(--color-bt-text-dim)",
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <b style={{ color: "var(--color-bt-text)" }}>{names(list)}</b>{" "}
      {list.length === 1 ? "isn't" : "aren't"} in the scoring —{" "}
      {list.length === 1 ? "their sheet doesn't" : "their sheets don't"} count toward{" "}
      {teamCount > 2 ? "any team" : "either side"}.
    </p>
  );
}

/** "Bill", "Bill and Ty", "Bill, Ty and Frank" — an Oxford-less join, because
 *  this reads as a sentence rather than a list. */
function names(list: string[]): string {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
