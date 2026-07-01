"use client";

import { createElement } from "react";
import { Lock } from "lucide-react";
import { formatIcon } from "@/components/competition/GameRow";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { GameFormatExplainer } from "./GameFormatExplainer";
import { GameRulesNote } from "./GameRulesNote";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * MemberSetupView — the redesigned member-facing setup-mode surface. It's the
 * shared body dropped into BOTH member entry components (`SetupPlaceholder` for
 * stroke/rack/manual + `MemberNotReady` for the golf match page) so they render
 * identically; the two entry components are NOT consolidated here (logged as debt).
 *
 * Emotional arc — identity → calm status → explainer → rules — replacing the old
 * giant-faint-watermark dead-end. The member stays walled from the roster
 * (unchanged, server-side); this adds only the STATIC explainer + read-only Rules,
 * both already present in the member's `getById` payload.
 *
 * Tokens throughout except the accent glow behind the icon (mockup art). Inherits
 * `--font-sans`. `game` may be absent (a not-yet-created match) — degrades to the
 * generic icon + a neutral name with no explainer.
 */
export function MemberSetupView({
  tripId,
  game,
}: {
  tripId: string;
  game: GameRow | null | undefined;
}) {
  const typeId = game?.game_type_id ?? null;
  const def = getGameTypeDefinition(typeId);
  const Icon = formatIcon(typeId);
  const gameName = game?.name?.trim() || "This game";
  const rules = game?.rules_for_today?.trim();

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col items-center px-5"
      style={{ paddingTop: 56, paddingBottom: 40 }}
      data-testid="member-setup-view"
    >
      {/* Identity — the format icon in a tinted rounded square with a soft accent
          glow behind (echoes the hero's trophy glow; the glow is mockup art). */}
      <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
        <div
          aria-hidden
          className="absolute"
          style={{ inset: -10, borderRadius: 26, background: "radial-gradient(circle, rgba(45,212,191,0.22), transparent 70%)" }}
        />
        <div
          className="relative flex items-center justify-center"
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          {createElement(Icon, { size: 30 })}
        </div>
      </div>

      {/* Game name + format label. */}
      <h1 className="mt-5 text-center" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: "var(--color-bt-text)" }}>
        {gameName}
      </h1>
      {def && (
        <p className="mt-1 text-center" style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
          {def.name}
        </p>
      )}

      {/* Calm status pill — reassuring, member-facing; no internal mechanics
          (no "scoring" / Setup toggle language). */}
      <div
        className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1"
        style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
      >
        <Lock size={12} style={{ color: "var(--color-bt-text-dim)" }} />
        <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>Being set up — check back soon</span>
      </div>

      {/* Explainer (the star) + read-only Rules of the Day — only when rules exist. */}
      <div className="mt-8 w-full space-y-5">
        <GameFormatExplainer gameTypeId={typeId} variant="member" />
        {rules && game && <GameRulesNote tripId={tripId} game={game} canEdit={false} />}
      </div>
    </div>
  );
}
