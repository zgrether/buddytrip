import type { OutcomeOverwrite } from "@/lib/outcomeReconcile";

/**
 * The words for #1437's notice — a hole this device entered now holds a
 * different result because another device wrote it later.
 *
 * Zach's ruling: not an error and not a dialog, a heads-up. The WHAT matters
 * (which hole, what it is now); who changed it is optional and omitted — the
 * player can see the match and knows who else is scoring it. The overwrite
 * usually lands after both players have moved on, so the player on the next hole
 * sees the status jump with no visible cause: this line is that cause.
 *
 * The match is named only when the game has more than one, because "Hole 3"
 * alone is ambiguous exactly when a scorer is entering several matches.
 *
 * Pure: the sides' names come in, a sentence goes out.
 */
export function outcomeOverwriteNotice(
  o: OutcomeOverwrite,
  match: { label: string; aName: string; bName: string } | undefined,
  matchCount: number,
): string {
  const where = `${match && matchCount > 1 ? `${match.label}, hole` : "Hole"} ${o.hole}`;
  if (o.to === null) return `${where} was cleared`;
  if (o.to === "halved") return `${where} changed to Halved`;
  const winner = o.to === "side_a" ? match?.aName : match?.bName;
  return winner ? `${where} changed — ${winner} won it` : `${where} changed`;
}
