"use client";

import { useMemo, type ReactNode } from "react";
import { Trophy, Users, SlidersHorizontal, Flag } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { StepCard } from "@/app/trips/[tripId]/components/setup-guide/StepCard";

/**
 * CompetitionSetupGuide — the pre-live main view of the Competition Face
 * (Stage 1). The trip face's "Add what you've got" setup guide, mirrored for the
 * competition: a header + the movement cards (Plan the games · Build the teams ·
 * Configure each game · Go live), any-order/nothing-blocked stance, calm voice.
 *
 * STANDARD PALETTE ONLY — no competition accent / tonal shift. Distinction from
 * the trip face is structure + content + the trophy glyph + the bottom-nav
 * switch, not color (the cards use the existing accent tint via the `home`
 * domain). The cards ROUTE to the existing surfaces — "Manage games" and
 * "Configure each game" open the SAME Games surface; "Build the teams" opens the
 * team builder; "View leaderboard →" peeks the board. The guide adds/manages; the
 * board is where you tap into a game.
 */

interface Props {
  tripId: string;
  competition: { id: string; name: string; tagline: string | null; status: "upcoming" | "active" | "completed" };
  onManageGames: () => void;
  onBuildTeams: () => void;
  onViewBoard: () => void;
  onGoLive: () => void;
}

export function CompetitionSetupGuide({
  tripId, competition, onManageGames, onBuildTeams, onViewBoard, onGoLive,
}: Props) {
  const { data: allGames = [] } = trpc.games.listByTrip.useQuery({ tripId });
  const { data: teams = [] } = trpc.teams.list.useQuery({ tripId, competitionId: competition.id });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery({ tripId, competitionId: competition.id });

  const games = useMemo(
    () => (allGames as { id: string; competition_id: string | null; status: string; points_distribution: unknown; points_total: number | null }[])
      .filter((g) => g.competition_id === competition.id && g.status !== "dropped"),
    [allGames, competition.id]
  );
  const gamesCount = games.length;
  // A game "needs setup" until it has its points (a distribution or an owner
  // total). Mirrors the games-panel "needs split" framing.
  const needsSetup = games.filter((g) => !g.points_distribution && g.points_total == null).length;
  const teamsCount = (teams as unknown[]).length;
  const assignedCount = (assignments as unknown[]).length;
  const isLive = competition.status === "active";

  const gamesDone = gamesCount > 0;
  const teamsDone = teamsCount >= 2 && assignedCount > 0;
  const configDone = gamesCount > 0 && needsSetup === 0;

  return (
    <section data-testid="competition-setup-guide">
      <header className="relative flex items-start gap-4 pr-10 sm:gap-5">
        <GuideGlyph />
        <div className="min-w-0 flex-1">
          <p className="mb-3 text-[11px] font-semibold uppercase" style={{ color: "var(--color-bt-accent)", letterSpacing: "0.1em" }}>
            Get set up
          </p>
          <h2 className="mb-3 font-semibold" style={{ color: "var(--color-bt-text)", fontSize: "clamp(20px, 2.8vw, 26px)", lineHeight: 1.15, letterSpacing: "-0.015em" }}>
            Let&rsquo;s build it out
          </h2>
          <p className="max-w-prose" style={{ color: "var(--color-bt-text-dim)", fontSize: 15, lineHeight: 1.65 }}>
            Add games, build the teams, set the points — in any order, nothing&rsquo;s blocked. When it&rsquo;s ready, go live and the crew gets the leaderboard.
          </p>
        </div>
        <button
          type="button"
          onClick={onViewBoard}
          className="absolute right-0 top-0 inline-flex items-center gap-1 text-[12px] font-semibold transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-accent)" }}
          data-testid="guide-view-leaderboard"
        >
          View leaderboard →
        </button>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StepCard
          number={1}
          domain="home"
          title="Plan the games"
          body="The rounds and contests you'll compete in. Points and order show on the board before anything's played."
          thumbnail={<IconThumb Icon={Trophy} />}
          cta="Manage games"
          ctaIcon={<Trophy size={14} strokeWidth={2} />}
          onCta={onManageGames}
          done={gamesDone}
          doneSummary={`${gamesCount} game${gamesCount === 1 ? "" : "s"}${needsSetup > 0 ? ` · ${needsSetup} need${needsSetup === 1 ? "s" : ""} setup` : ""}.`}
          doneCta={gamesDone ? `${gamesCount} game${gamesCount === 1 ? "" : "s"}` : undefined}
          testId="guide-step-games"
        />
        <StepCard
          number={2}
          domain="home"
          title="Build the teams"
          body="Two teams from the crew. Name them, assign players, pick captains if you like."
          thumbnail={<IconThumb Icon={Users} />}
          cta="Build teams"
          ctaIcon={<Users size={14} strokeWidth={2} />}
          onCta={onBuildTeams}
          done={teamsDone}
          doneSummary={`${teamsCount} teams · ${assignedCount} assigned.`}
          doneCta={teamsDone ? `${assignedCount} assigned` : undefined}
          testId="guide-step-teams"
        />
        <StepCard
          number={3}
          domain="home"
          title="Configure each game"
          body={needsSetup > 0 ? `${needsSetup} game${needsSetup === 1 ? "" : "s"} still need points before they'll score.` : "Set points, pairings and rules. Tap a game on the board to configure it."}
          thumbnail={<IconThumb Icon={SlidersHorizontal} />}
          cta="Review setup"
          ctaIcon={<SlidersHorizontal size={14} strokeWidth={2} />}
          onCta={onManageGames}
          done={configDone}
          doneSummary="Every game has its points."
          doneCta={configDone ? "All set" : undefined}
          testId="guide-step-config"
        />
        <StepCard
          number={4}
          domain="home"
          title="Go live when you're ready"
          body="Hand the crew the leaderboard. You stay in the driver's seat — nothing locks."
          thumbnail={<IconThumb Icon={Flag} />}
          cta={isLive ? "It's live" : "Go live"}
          ctaIcon={<Flag size={14} strokeWidth={2} />}
          onCta={onGoLive}
          done={isLive}
          doneSummary="Live — the crew has the board."
          doneCta={isLive ? "Live" : undefined}
          testId="guide-step-golive"
        />
      </div>
    </section>
  );
}

/** Trophy glyph for the header — the competition face's identity mark (the
 *  distinction is the glyph + structure, not color). */
function GuideGlyph() {
  return (
    <div
      className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl"
      style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
      aria-hidden
    >
      <Trophy size={26} />
    </div>
  );
}

/** Simple centered-icon thumbnail for a step card's preview area. */
function IconThumb({ Icon }: { Icon: typeof Trophy }) {
  return (
    <div className="flex h-full w-full items-center justify-center" aria-hidden>
      <Icon size={34} style={{ color: "var(--color-bt-accent)", opacity: 0.55 }} />
    </div>
  );
}

export type { ReactNode };
