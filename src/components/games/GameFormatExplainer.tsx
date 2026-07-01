"use client";

import { createElement } from "react";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { formatIcon } from "@/components/competition/GameRow";

/**
 * GameFormatExplainer — the ONE per-format "how you compete in this format" block,
 * mounted on the member setup placeholder and atop owner/delegate game settings so
 * the explanation can't drift between surfaces.
 *
 * The copy is invariant per format, so it lives in code: this reads it from the
 * catalog `description` field keyed on `game_type_id` (NOT competition_format /
 * scoring_model) — one home, no hardcoded strings here. The four manual types all
 * carry the SAME Non-golf description, so reading each type's description
 * uniformly collapses them to one explainer with no special-casing.
 *
 * Two variants:
 *  - `member`   — the big "HOW YOU COMPETE" + large copy that stars on the setup
 *                 placeholder (the icon + game name are the placeholder's hero).
 *  - `settings` — a compact orienting block that sits directly above Rules of the
 *                 Day on the settings page ("here's the format you're setting up").
 *
 * Renders nothing for an unregistered game type (defensive — no blank label).
 */
export function GameFormatExplainer({
  gameTypeId,
  variant,
}: {
  gameTypeId: string | null;
  variant: "member" | "settings";
}) {
  const def = getGameTypeDefinition(gameTypeId);
  if (!def) return null;

  if (variant === "member") {
    return (
      <div className="w-full" data-testid="game-format-explainer">
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          How you compete
        </p>
        <p className="mt-2" style={{ fontSize: 19, lineHeight: 1.55, color: "var(--color-bt-text)" }}>
          {def.description}
        </p>
      </div>
    );
  }

  // settings — compact, orienting, sits above Rules. Quieter than the editable
  // Rules card below it (dim copy) so it reads as reference, not an input.
  const Icon = formatIcon(gameTypeId);
  return (
    <div
      className="rounded-xl px-3.5 py-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="game-format-explainer"
    >
      <div className="flex items-center gap-2">
        {createElement(Icon, {
          size: 15,
          className: "shrink-0",
          style: { color: "var(--color-bt-accent)" },
        })}
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          How you compete · {def.name}
        </span>
      </div>
      <p className="mt-1.5" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
        {def.description}
      </p>
    </div>
  );
}
