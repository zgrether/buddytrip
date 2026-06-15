"use client";

import { useState } from "react";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionHeader } from "./CompetitionHeader";
import { CompetitionSetupGuide } from "./CompetitionSetupGuide";
import { CompetitionLeaderboard } from "./CompetitionLeaderboard";
import { TeamsPanel } from "./TeamsPanel";
import { CompetitionGamesPanel } from "./CompetitionGamesPanel";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
}

/**
 * The competition face's two states + their setup sub-surfaces:
 *   guide  — the setup guide (pre-live main view for editors)
 *   board  — the leaderboard (post-live main view for everyone)
 *   games  — the Games surface (reached from the guide)
 *   teams  — the team builder (reached from the guide)
 */
type FaceView = "guide" | "games" | "teams" | "board";

interface Props {
  tripId: string;
  competition: Competition;
  canEdit: boolean;
  isOwner: boolean;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onCompetitionDeleted?: () => void;
}

/**
 * CompetitionFace — the Live face's body: the symmetric two-state experience
 * (setup guide ⇄ leaderboard) hosted on the escaped, clean competition chrome
 * (the host page provides Band 1 title bar + bottom nav; this owns Band 2's
 * competition header + the state body).
 *
 * Stage 3 ties three things together:
 *   1. The symmetric toggle — the guide peeks the board ("View leaderboard →"),
 *      the board returns to the guide ("Setup view"). Default flips at go-live.
 *   2. Go-live — the explicit owner switch. It's a VISIBILITY switch, not a
 *      data lock: the owner keeps the toggle (Back to Setup) and can edit
 *      mid-round. Centralized here so going live also flips the default view.
 *   3. Chrome-shrink — the header collapses to a compact bar once live.
 *
 * STANDARD PALETTE ONLY (supersession #2) — no competition accent / tonal shift.
 */
export function CompetitionFace({
  tripId,
  competition,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: Props) {
  const utils = trpc.useUtils();
  const isLive = competition.status === "active";

  // Default flips at go-live (§3): pre-live the setup guide is the editor's
  // main view; post-live the leaderboard is. Non-editors only ever see the
  // board (the page gates them out of the pre-live face entirely).
  const [view, setView] = useState<FaceView>(
    !canEdit ? "board" : isLive ? "board" : "guide"
  );

  // ── Go live / back to setup (visibility switch, NOT a data lock) ───────────
  // Centralized here (not in the header) so going live can also flip the
  // default view to the board. Optimistic so the chrome-shrink + toggle update
  // instantly.
  const setStatus = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous && vars.status) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          status: vars.status,
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) {
        utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      }
    },
    onSettled: () => utils.competitions.getByTrip.invalidate({ tripId }),
  });

  const toggleLive = () => {
    const next: "upcoming" | "active" = isLive ? "upcoming" : "active";
    // Flip the default view to match the new stage (board when live, guide
    // when returning to setup) immediately — the optimistic status update keeps
    // the chrome in sync.
    setView(next === "active" ? "board" : "guide");
    setStatus.mutate({ tripId, competitionId: competition.id, status: next });
  };

  const header = (
    <CompetitionHeader
      competition={competition}
      tripId={tripId}
      canEdit={canEdit}
      isOwner={isOwner}
      compact={isLive}
      onToggleLive={
        isOwner && competition.status !== "completed" ? toggleLive : undefined
      }
      togglePending={setStatus.isPending}
      onDeleted={onCompetitionDeleted}
    />
  );

  // ── Setup guide (editors, pre-live default) ────────────────────────────────
  if (view === "guide") {
    return (
      <div className="space-y-6">
        {header}
        <CompetitionSetupGuide
          tripId={tripId}
          competition={competition}
          onManageGames={() => setView("games")}
          onBuildTeams={() => setView("teams")}
          onViewBoard={() => setView("board")}
          onGoLive={() => {
            if (!isLive) toggleLive();
          }}
        />
      </div>
    );
  }

  // ── Board + setup sub-surfaces ─────────────────────────────────────────────
  const subTitle =
    view === "games" ? "Games" : view === "teams" ? "Teams" : null;

  return (
    <div className="space-y-4">
      {header}

      {/* Symmetric toggle (§3): the board offers "Setup view"; the setup
          sub-surfaces offer "Setup guide" back. Editors only — the crew sees
          the board with no management affordance. */}
      {canEdit && view === "board" && (
        <button
          type="button"
          onClick={() => setView("guide")}
          className="inline-flex items-center gap-1 text-[13px] font-semibold"
          style={{ color: "var(--color-bt-accent)" }}
          data-testid="comp-setup-view"
        >
          <SlidersHorizontal size={15} /> Setup view
        </button>
      )}
      {canEdit && view !== "board" && (
        <button
          type="button"
          onClick={() => setView("guide")}
          className="inline-flex items-center gap-1 text-[13px] font-semibold"
          style={{ color: "var(--color-bt-accent)" }}
          data-testid="comp-back-to-guide"
        >
          <ChevronLeft size={16} /> Setup guide
        </button>
      )}

      {subTitle && (
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {subTitle}
        </p>
      )}

      {view === "games" && (
        <CompetitionGamesPanel
          competitionId={competition.id}
          tripId={tripId}
          canEdit={canEdit}
          isOwner={isOwner}
        />
      )}
      {view === "teams" && (
        <TeamsPanel
          competitionId={competition.id}
          tripId={tripId}
          canEdit={canEdit}
          isOwner={isOwner}
        />
      )}
      {view === "board" && (
        <CompetitionLeaderboard competitionId={competition.id} tripId={tripId} />
      )}
    </div>
  );
}
