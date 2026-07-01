"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { ScoringLockBanner } from "@/components/games/ScoringLockBanner";
import {
  PointStepper,
  FormatSheet,
  formatLabel,
  fmtValue,
  type GameRow,
} from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";

/**
 * NonGolfConfigurationView (W-NONGOLF lifecycle surface) — the non-golf twin of
 * golf's `GameConfigurationView`: the ONE settings home, reached by the corner
 * gear, carrying the mode toggle + Danger Zone. It mirrors golf's STRUCTURE
 * (identity → settings → rules → toggle → danger zone) but ships a **LEAN
 * payload** — only what non-golf needs, no golf cruft (no Matches / Course /
 * Handicaps / Modifiers):
 *
 *  - **competition_format** (its real home now — drives future matchup/bracket dev),
 *  - by the competition's `scoring_model`:
 *      - **match_play** → a single game-value stepper (the points for the one
 *        Team-A-vs-B match; win = N, draw = split). It feeds the EXISTING
 *        win/lose/tie path via `games.points_total` — no second mechanism.
 *      - **points** → the two points sections (value + placement split), reusing
 *        `FormatPointsPanel` (its manual branch is exactly the placement editor),
 *  - **Rules of the Day**, the **Setup/Scoring** toggle, the **Danger Zone**.
 */
export function NonGolfConfigurationView({
  subtitle,
  onBack,
  tripId,
  competitionId,
  game,
  scoringModel,
  canEdit,
  isOwner,
  onChanged,
  onDeleted,
  scoringEnabled,
  ready = true,
  onEnable,
  onDisable,
  busy,
}: {
  subtitle: string;
  onBack: () => void;
  tripId: string;
  competitionId: string;
  game: GameRow;
  scoringModel: ScoringModel;
  canEdit: boolean;
  isOwner: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  scoringEnabled: boolean;
  /** Minimum requirements met — gates the toggle's Scoring segment (non-golf is
   *  ready once points are configured; matches the server `assertGameReady`). */
  ready?: boolean;
  onEnable: () => void;
  onDisable: () => void;
  busy: boolean;
}) {
  // #501: in scoring mode game-altering settings freeze (competition_format +
  // points). Rules keeps plain canEdit (the exception), the toggle stays active
  // (the path back to Setup), and the Danger Zone disables wholesale.
  const settingsEditable = canEdit && !scoringEnabled;
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bt-base)" }}>
      <header
        className="flex shrink-0 items-center"
        style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}
      >
        <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        <div className="min-w-0 flex-1 text-center" style={{ marginRight: 36 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Configuration</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {/* Identity — name (tap-to-edit) + assigned-to (same as golf). */}
        <GameIdentityHeader tripId={tripId} game={game} canEdit={canEdit} isOwner={isOwner} />

        {/* #501: live-game lock banner — settings below are frozen until toggled
            back to Setup. */}
        {scoringEnabled && canEdit && <ScoringLockBanner />}

        {/* Competition format — relocated here as its real home, near the top
            (it drives future matchup/bracket dev). Locked in scoring mode. */}
        <CompetitionFormatRow tripId={tripId} game={game} canEdit={settingsEditable} locked={scoringEnabled} onChanged={onChanged} />

        {/* The points payload, by the competition's scoring model. Locked in scoring —
            #512 Option B: dim the read-only panel so it reads as frozen. */}
        {scoringModel === "match_play" ? (
          <div className="mt-2" style={{ opacity: scoringEnabled ? 0.55 : undefined }}>
            <MatchValueStepper tripId={tripId} game={game} canEdit={settingsEditable} onChanged={onChanged} />
          </div>
        ) : (
          <div className="mt-2" style={{ opacity: scoringEnabled ? 0.55 : undefined }}>
            <FormatPointsPanel tripId={tripId} game={game} canEdit={settingsEditable} />
          </div>
        )}

        {/* Format explainer — compact "how you compete" block, pairs directly
            above Rules (orients the owner on the format they're configuring). */}
        <div className="mt-6">
          <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
        </div>

        {/* Rules of the Day — saves on blur (same as golf). The carved-out exception:
            stays editable in scoring mode (notes, not game-altering). */}
        <GameRulesNote tripId={tripId} game={game} canEdit={canEdit} />

        {/* The single Setup / Scoring toggle — owner/delegate only. */}
        {canEdit && (
          <div className="mt-6">
            <GameManagementPanel
              mode={scoringEnabled ? "scoring" : "setup"}
              ready={ready}
              onEnable={onEnable}
              onDisable={onDisable}
              pending={busy}
            />
          </div>
        )}

        {/* Per-game danger zone — owner-only (reset scores / reset settings / delete).
            Disabled wholesale in scoring mode (#501) — switch to Setup to manage it. */}
        {isOwner && (
          <GameDangerZone
            tripId={tripId}
            gameId={game.id}
            competitionId={competitionId}
            onChanged={onChanged}
            onDeleted={onDeleted}
            disabled={scoringEnabled}
          />
        )}
      </div>
    </div>
  );
}

/** Competition-format picker row — its real home (relocated from the Add/Edit
 *  modal). Opens the shared `FormatSheet`; persists via `games.update`, optimistic
 *  on the `getById` cache, then re-seeds the Live face (faceBootstrap, #10). */
function CompetitionFormatRow({
  tripId, game, canEdit, locked, onChanged,
}: {
  tripId: string; game: GameRow; canEdit: boolean; locked?: boolean; onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const update = trpc.games.update.useMutation();
  const [open, setOpen] = useState(false);
  const label = formatLabel(game.competition_format);

  function pick(key: string) {
    setOpen(false);
    const cur = utils.games.getById.getData({ tripId, gameId: game.id });
    if (cur) utils.games.getById.setData({ tripId, gameId: game.id }, { ...cur, competition_format: key } as typeof cur);
    update
      .mutateAsync({ tripId, gameId: game.id, competitionFormat: key as never })
      .then(() => {
        utils.games.listByTrip.invalidate({ tripId });
        if (game.competition_id) utils.competitions.faceBootstrap.invalidate({ tripId });
        onChanged();
      })
      .catch(() => utils.games.getById.invalidate({ tripId, gameId: game.id }));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => canEdit && setOpen(true)}
        disabled={!canEdit}
        // #512 Option B: live-locked → dim + a lock icon in place of the chevron.
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: locked ? 0.55 : undefined }}
        data-testid="row-competition-format"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Competition format
          </span>
          <span className="truncate text-sm" style={{ color: label ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", marginTop: 2 }}>
            {label ?? "Choose how it’s played"}
          </span>
        </div>
        {locked
          ? <Lock size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
          : <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />}
      </button>
      {open && (
        <FormatSheet current={game.competition_format} onPick={pick} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** The single-match game-value stepper (match_play scoring model) — the points
 *  for the one Team-A-vs-B match. It writes `games.points_total`, the SAME value
 *  the leaderboard derives the win/lose/tie award from ([total, 0], tie averaged);
 *  no second points mechanism. Optimistic on `getById`, then re-seeds the board. */
function MatchValueStepper({
  tripId, game, canEdit, onChanged,
}: {
  tripId: string; game: GameRow; canEdit: boolean; onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const setTotalM = trpc.games.setPointsTotal.useMutation();
  // Controlled straight off the persisted value — the optimistic `setData` below
  // re-renders the parent's getById subscription with the new total, so there's
  // no local copy to drift (and no resync effect).
  const value = game.points_total ?? 1;

  function onChange(v: number) {
    const cur = utils.games.getById.getData({ tripId, gameId: game.id });
    if (cur) utils.games.getById.setData({ tripId, gameId: game.id }, { ...cur, points_total: v } as typeof cur);
    setTotalM
      .mutateAsync({ tripId, gameId: game.id, total: v })
      .then(() => {
        utils.games.listByTrip.invalidate({ tripId });
        if (game.competition_id) utils.competitions.faceBootstrap.invalidate({ tripId });
        onChanged();
      })
      .catch(() => utils.games.getById.invalidate({ tripId, gameId: game.id }));
  }

  return (
    <PointStepper
      label="Game value"
      caption="POINTS FOR THE MATCH"
      value={value}
      onChange={canEdit ? onChange : () => {}}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Win / Draw
          </span>
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-bt-text)" }}>
            Win {fmtValue(value)} · Draw {fmtValue(value / 2)} each
          </span>
        </div>
      }
    />
  );
}
