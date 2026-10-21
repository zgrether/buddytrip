/**
 * One plain line per format (Zach's rulings on the starting points mockup,
 * 2026-10-21), shown in the add-game sheet and on suggested games. Every screen
 * reads it from here, beside the format catalog (`gameTypes.ts`).
 *
 * NOT the catalog's `description`. That is a paragraph, used as the rules
 * starter text and the member placeholder; this is the one line that tells
 * someone choosing a format what it is. `formatLines.test.ts` requires a line
 * for every format in the catalog and keeps each to one short line.
 *
 * Zach approved the Rack-n-Stack line as written (2026-10-21).
 */
export const FORMAT_LINE: Record<string, string> = {
  gtt_stroke_play: "Count every stroke. Lowest total wins.",
  gtt_scramble: "Everyone hits, the team plays the best shot. One score per team.",
  gtt_skins: "Win a hole outright to win its skin. Ties carry it over.",
  gtt_match_play: "Head-to-head, hole by hole. Win more holes, win the match.",
  gtt_rack_n_stack: "Play your own round. Each team’s scores are ranked and matched best vs best.",
  gtt_pickem: "Pick the winners of a slate of games. The best picks win.",
  gtt_generic_card: "Any card game. You enter the result by hand.",
  gtt_generic_yard: "Any yard game. You enter the result by hand.",
  gtt_generic_bar: "Any bar game. You enter the result by hand.",
  gtt_manual: "Any game at all. You enter the result by hand.",
};

/** A bracket is a format OF a manual game, so its line sits beside the types'. */
export const BRACKET_LINE = "Lose and you’re out.";

/** The line for a format, or for a manual game played as a bracket. */
export function formatLine(gameTypeId: string | null | undefined, competitionFormat?: string | null): string | null {
  if (competitionFormat === "bracket") return BRACKET_LINE;
  return (gameTypeId && FORMAT_LINE[gameTypeId]) || null;
}

/**
 * Match Play's ways to play it: an EXPLAINER, not a setting (Zach). Nothing
 * about players is asked before teams exist; the matches are paired later.
 * Each is played on the course and scored by who wins each hole.
 */
export const MATCH_PLAY_WAYS: { name: string; size: string; line: string }[] = [
  { name: "Singles", size: "1 v 1", line: "One on one, each player’s own ball." },
  { name: "Best Ball", size: "2 v 2", line: "Everyone plays their own ball; the side’s better score counts." },
  { name: "Alternate Shot", size: "2 v 2", line: "Partners share one ball and take turns." },
  { name: "Scramble", size: "2 v 2", line: "Both hit, pick the best shot, play from there." },
];
export const MATCH_PLAY_WAYS_NOTE = "Any of these works. You’ll pair players once teams are set.";
