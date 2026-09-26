import { getGameTypeDefinition, type ResultKind } from "@/lib/gameTypes";
import { isBracketGame } from "@/lib/resultStrategy";

/**
 * Ruling 2 (PR 4), in PR 1's terms: **a head-to-head cup accepts games whose
 * result is head to head.**
 *
 * Written against the format's declared `resultKinds` rather than as a list of
 * refused configurations, so the next format is judged by what it PRODUCES, not
 * by whether someone remembered to add it to an exclusion list. With two teams it
 * reduces, in practice, to refusing a bracket — the one configuration of a
 * two-kind format that pays by placement.
 *
 * ── The container is an input, not only the configuration ─────────────────
 *
 * A format that declares both kinds is pinned by its configuration AND by its
 * container. Simple (`head_to_head` / null) is win / halve / lose here only
 * because a head-to-head cup has exactly two teams: the same Simple setup in a
 * three-team points race pays by placement. This function answers for the
 * head-to-head container only, and says so in its name, rather than claiming a
 * general answer it would get wrong elsewhere.
 *
 * Client-safe: the format picker hides what this refuses, and the server
 * refuses it, from the one predicate — so the UI never offers what the backend
 * will turn down, and the two cannot drift.
 */
export function resultKindInHeadToHead(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined,
): ResultKind | undefined {
  const def = getGameTypeDefinition(gameTypeId);
  if (!def) return undefined;
  if (def.resultKinds.length === 1) return def.resultKinds[0];
  // Two declared, so the configuration pins it. A bracket runs a field of
  // entrants down to a champion and pays by placement. Every other configuration
  // of a two-kind format — Simple, Matches, best-of-N, pick'em in either roll-up
  // — meets the two teams and one wins or they halve.
  return isBracketGame(gameTypeId, competitionFormat) ? "ranked" : "head_to_head";
}

/**
 * Why a head-to-head cup cannot hold this configuration, or null when it can.
 * Names what to do instead, because the only reader who reaches the server's
 * copy is one whose picker disagreed with it.
 */
export function headToHeadResultRefusal(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined,
): string | null {
  if (resultKindInHeadToHead(gameTypeId, competitionFormat) !== "ranked") return null;
  if (isBracketGame(gameTypeId, competitionFormat)) {
    return "A Match Play cup is head to head, and a bracket pays by placement. Choose Simple or Matches for this game, or run the bracket in a points cup.";
  }
  const name = getGameTypeDefinition(gameTypeId)?.name ?? "This format";
  return `A Match Play cup is head to head, and ${name} pays by placement. Choose a format that decides a winner between the two teams.`;
}
