import { LandPlot, Spade, Target, Beer, Dices, Gamepad2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getGameTypeDefinition, type GameCategory } from "@/lib/gameTypes";

/**
 * One shared game-type icon source (add-game picker + competition leaderboard).
 * Keyed by CATEGORY (golf/card/yard/bar/other), not scoring format — all golf
 * formats (stroke/singles/doubles/rack) share the land-plot (course) glyph.
 * Format-specific icons
 * (swords for match play, layers for rack) read as "combat/stack" on a board
 * that's half non-golf; category is what actually orients a viewer.
 */
export const CATEGORY_ICONS: Record<GameCategory, LucideIcon> = {
  golf: LandPlot,
  card: Spade,
  yard: Target,
  bar: Beer,
  other: Dices,
};

/** Resolve a game's icon from its type id via the category it belongs to.
 *  Unregistered/null ids fall back to a generic glyph rather than going blank. */
export function categoryIcon(gameTypeId: string | null | undefined): LucideIcon {
  const category = getGameTypeDefinition(gameTypeId)?.category;
  return (category && CATEGORY_ICONS[category]) || Gamepad2;
}
