"use client";

import { SlidersHorizontal } from "lucide-react";
import { STARTING_POINTS, type StartingPointId } from "@/lib/startingPoints";
import { EYEBROW, TYPE_SCALE } from "@/lib/typeScale";
import { StartingPointArt, type ArtKind } from "./StartingPointArt";

/**
 * "What are you playing?" — the create panel's first screen (Zach's rulings on
 * the starting points mockup, 2026-10-21). A 2×2 grid of illustrated tiles:
 * the three starting points, and Just keep score, which makes a side game and
 * goes straight to the add-game sheet. Build your own is a quieter row below
 * and opens today's chooser. Pick'em pool is held until per-person results
 * exist.
 *
 * The title is not the umbrella "Start a Competition": Just keep score makes
 * no competition, and the question is what the group is doing, not which kind
 * of competition to make. The chooser behind Build your own keeps the umbrella.
 */

const JUST_KEEP_SCORE = { name: "Just keep score", blurb: "One round, no standings." };

interface Tile {
  key: ArtKind;
  name: string;
  blurb: string;
  onSelect: () => void;
}

export function StartingPointPicker({
  onPick,
  onJustKeepScore,
  onBuildYourOwn,
}: {
  onPick: (id: StartingPointId) => void;
  onJustKeepScore: () => void;
  onBuildYourOwn: () => void;
}) {
  const sp = (id: StartingPointId): Tile => ({
    key: id,
    name: STARTING_POINTS[id].name,
    blurb: STARTING_POINTS[id].blurb,
    onSelect: () => onPick(id),
  });
  const tiles: Tile[] = [
    sp("team_cup_weekend"),
    sp("golf_week"),
    sp("bar_night_bracket"),
    { key: "just_keep_score", ...JUST_KEEP_SCORE, onSelect: onJustKeepScore },
  ];

  return (
    <div className="flex flex-col gap-3.5" data-testid="starting-point-picker">
      <div className="flex flex-col gap-1.5">
        <div style={{ ...EYEBROW, color: "var(--color-bt-accent)" }}>Start here</div>
        <h2 className="m-0" style={{ fontSize: 24, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.15 }}>
          What are you playing?
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={t.onSelect}
            data-testid={`starting-point-${t.key}`}
            className="flex flex-col gap-2.5 rounded-2xl p-2 pb-3 text-left"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
          >
            {/* The art fills the box at its own aspect ratio, so a phone tile and a
                desktop tile draw the same picture at their own size (Zach). */}
            <div className="flex items-center justify-center rounded-xl px-3 py-2.5" style={{ background: "var(--color-bt-card)" }}>
              <StartingPointArt kind={t.key} maxHeight={132} />
            </div>
            {/* A blurb may wrap; the block keeps room for two lines so the tiles in
                a row stay aligned whichever wraps. */}
            <div className="flex flex-col gap-0.5 px-1" style={{ minHeight: 56 }}>
              <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 600, color: "var(--color-bt-text)" }}>{t.name}</span>
              <span style={{ fontSize: TYPE_SCALE.captionPlus, lineHeight: 1.35, color: "var(--color-bt-text-dim)" }}>{t.blurb}</span>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onBuildYourOwn}
        data-testid="starting-point-build-your-own"
        className="flex items-center justify-center gap-2 rounded-xl"
        style={{
          minHeight: 48,
          background: "transparent",
          border: "1.5px dashed var(--color-bt-border)",
          color: "var(--color-bt-text-dim)",
          fontSize: TYPE_SCALE.emphasis,
          fontWeight: 500,
        }}
      >
        <SlidersHorizontal size={16} />
        Build your own
      </button>
    </div>
  );
}
