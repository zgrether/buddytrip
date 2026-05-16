import type { ComponentType } from "react";
import { BarsStyle } from "./BarsStyle";
import { CardsStyle } from "./CardsStyle";
import { GridStyle } from "./GridStyle";
import { HeatmapStyle } from "./HeatmapStyle";
import { LeaderboardStyle } from "./LeaderboardStyle";
import { MinimalStyle } from "./MinimalStyle";
import { PodiumStyle } from "./PodiumStyle";
import { StadiumStyle } from "./StadiumStyle";
import type { ScoreboardStyleId, StyleProps } from "./types";

export const STYLE_COMPONENTS: Record<
  ScoreboardStyleId,
  ComponentType<StyleProps>
> = {
  grid: GridStyle,
  leaderboard: LeaderboardStyle,
  heatmap: HeatmapStyle,
  cards: CardsStyle,
  bars: BarsStyle,
  podium: PodiumStyle,
  stadium: StadiumStyle,
  minimal: MinimalStyle,
};

export * from "./types";
export * from "./mock-score";
