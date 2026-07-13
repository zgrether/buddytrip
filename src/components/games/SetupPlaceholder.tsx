"use client";

import { LandPlot, Spade, Target, Beer, Dices } from "lucide-react";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { MemberSetupView } from "./MemberSetupView";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * SetupPlaceholder (A2-ux) — the setup-mode scoreboard surface. A game-tap always
 * lands on the scoreboard page; while the game is in SETUP mode it renders this
 * instead of a live board:
 *  - **Member** (no `children`): the redesigned `MemberSetupView` — identity +
 *    calm status pill + the per-format explainer + read-only Rules (if written).
 *    The member is still walled from the roster server-side; only the static
 *    explainer + Rules are added (both already in the member's payload).
 *  - **Owner/delegate** (`children` = the Game Management controls): the setup
 *    pass-through — a faint watermark + the tailored `message` + the controls.
 *    Unchanged.
 *
 * Member vs owner is keyed on the presence of `children` (owner controls), which
 * is exactly how the callers already differentiate the two.
 */

const CATEGORY_ICON: Record<string, typeof LandPlot> = {
  golf: LandPlot,
  card: Spade,
  yard: Target,
  bar: Beer,
  other: Dices,
};

export function SetupPlaceholder({
  tripId,
  game,
  message,
  children,
}: {
  tripId: string;
  game: GameRow | null | undefined;
  /** Owner's tailored sub-message (owner path only). */
  message?: string;
  /** Owner/delegate controls (the Game Management panel + "keep setting it up").
   *  When present, this is the owner pass-through; when absent, the member view. */
  children?: React.ReactNode;
}) {
  // Member path — no controls → the redesigned member surface.
  if (!children) {
    return <MemberSetupView tripId={tripId} game={game} />;
  }

  // Owner/delegate pass-through — unchanged watermark-recessive treatment.
  const category = getGameTypeDefinition(game?.game_type_id)?.category ?? "other";
  const Icon = CATEGORY_ICON[category] ?? Dices;
  const name = game?.name?.trim() || "This game";
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
        <div className="mt-5 w-full">{children}</div>
      </div>
    </div>
  );
}
