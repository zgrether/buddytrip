"use client";

import { Flag, Spade, Target, Beer, Dices } from "lucide-react";

/**
 * SetupPlaceholder (A2-ux) — the setup-mode scoreboard surface. A game-tap always
 * lands on the scoreboard page; while the game is in SETUP mode it renders this
 * instead of a live board:
 *  - **Member:** just the themed "still being set up" message (no game data — the
 *    A2-core gate already withheld it; conceal-the-machinery voice).
 *  - **Owner/delegate:** the same surface + `children` (the Game Management toggle +
 *    "keep setting it up" button).
 *
 * The motif is **watermark-recessive** ("flashy but fades"): the game-type lucide
 * icon enlarged to fill the space, faint via the state-silhouette token family
 * (`--color-bt-state-*`, the LocationHero pattern) so it's atmosphere, not
 * information — the foreground (message + controls) never competes. Richer per-type
 * motifs are a follow-on that drops into this same slot; this ships the default.
 */

const CATEGORY_ICON: Record<string, typeof Flag> = {
  golf: Flag,
  card: Spade,
  yard: Target,
  bar: Beer,
  other: Dices,
};

export function SetupPlaceholder({
  gameName,
  category,
  message,
  children,
}: {
  gameName?: string | null;
  /** golf | card | yard | bar | other — keys the watermark icon. */
  category?: string | null;
  /** Override the default sub-message (e.g. the owner's tailored line). */
  message?: string;
  /** Owner/delegate controls (the Game Management panel + "keep setting it up"). */
  children?: React.ReactNode;
}) {
  const Icon = CATEGORY_ICON[category ?? "other"] ?? Dices;
  const name = gameName?.trim() || "This game";
  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center px-5" style={{ paddingTop: 72, paddingBottom: 40, minHeight: "60vh" }}>
      {/* Watermark motif — large, faint, fills-but-recedes (aria-hidden, no hit area). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-start justify-center"
        style={{ color: "var(--color-bt-state-stroke)", paddingTop: 40, overflow: "hidden" }}
      >
        <Icon size={240} strokeWidth={1.25} />
      </div>

      {/* Foreground */}
      <div className="relative flex flex-col items-center text-center">
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {name} is still being set up
        </div>
        <p className="mt-1.5" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text-dim)", maxWidth: 320 }}>
          {message ?? "Hang tight — the crew can't see it yet. It opens once it's switched to scoring."}
        </p>
        {children && <div className="mt-5 w-full">{children}</div>}
      </div>
    </div>
  );
}
