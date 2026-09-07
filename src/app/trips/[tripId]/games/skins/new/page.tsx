"use client";

import { SkinsGameView } from "@/components/games/skins/SkinsGameView";

/**
 * Skins game route — a thin wrapper over {@link SkinsGameView} (CLAUDE.md #12:
 * the route is a thin wrapper, the leaderboard opens the identical component as
 * a panel, and `opensAsPanel`'s allowlist decides which host is used).
 *
 * Unlike scramble's route next door, this one does NOT reuse another format's
 * view, and the difference is worth naming because the default is reuse.
 * Scramble is stroke play with a different scorer — an input to that view.
 * Skins is not a variant of anything on the surface: its entry is a choice list
 * over N players plus Tied rather than a keypad or a two-sided outcome, its
 * board carries a carryover pot per grouping that nothing else in the app has,
 * and it computes no handicaps at all, so stroke's handicap roster and scoring
 * type would be settings rows about nothing.
 *
 * The view learns everything it needs from `games.game_type_id` on the row it
 * already fetches, never from a prop — a prop would be a second source of that
 * fact that has to agree with the row.
 */
export default function SkinsGamePage() {
  return <SkinsGameView />;
}
