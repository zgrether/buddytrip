"use client";

import { ChevronLeft } from "lucide-react";
import { STARTING_POINTS, suggestedGames, type StartingPointId } from "@/lib/startingPoints";
import { COMPETITION_NAME_EXAMPLE, competitionNoun, competitionWord } from "@/lib/vocabulary";
import { categoryIcon } from "@/lib/gameCategoryIcon";
import { formatLine } from "@/lib/formatLines";
import { EYEBROW, TYPE_SCALE } from "@/lib/typeScale";
import { MAX_SEED_TEAMS, SEED_TEAM_COLORS, seedTeamName } from "@/lib/teamColors";
import { TeamBadge } from "@/components/TeamBadge";
import { Stepper } from "@/components/games/Stepper";
import { StartingPointArt } from "./StartingPointArt";

/**
 * A starting point's review (Zach's rulings, 2026-10-21): it opens on a larger
 * version of the tile's art, then the name, then setup. Golf week's setup is
 * Play as: Individuals (the default) or Teams, with a team-count stepper when
 * Teams is chosen, which covers the multi-team points race; Scramble joins its
 * suggestions only with teams. A Head-to-Head Cup is always two teams, so its
 * setup has nothing to choose; a Bar-night bracket chooses how many teams.
 *
 * The suggested games are listed so the person sees what they are signing up
 * for; they are added from the board afterwards, never here.
 *
 * Persistence-agnostic: the panel owns the state and the create; this renders
 * it and reports changes.
 */
export function StartingPointReview({
  startingPoint,
  name,
  onNameChange,
  playAs,
  onPlayAsChange,
  teamCount,
  onTeamCountChange,
  onBack,
  onCreate,
  submitting,
  error,
}: {
  startingPoint: StartingPointId;
  name: string;
  onNameChange: (next: string) => void;
  playAs: "individuals" | "teams";
  onPlayAsChange: (next: "individuals" | "teams") => void;
  teamCount: number;
  onTeamCountChange: (next: number) => void;
  onBack: () => void;
  onCreate: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const sp = STARTING_POINTS[startingPoint];
  const word = competitionWord(sp.scoringModel);
  /** The teams this setup creates; 0 = individuals. */
  const teams =
    sp.players === "two_teams" ? 2 : sp.players === "individuals_or_teams" && playAs === "individuals" ? 0 : teamCount;
  const suggestions = suggestedGames(startingPoint, teams);
  const canCreate = !submitting && name.trim().length >= 2;

  return (
    <div className="flex flex-col gap-4" data-testid="starting-point-review">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex items-center gap-1 self-start text-sm font-medium"
        style={{ minHeight: 44, color: "var(--color-bt-text-dim)" }}
        data-testid="starting-points-back"
      >
        <ChevronLeft size={18} />
        Starting points
      </button>

      {/* The tile's art, larger, then what it sets up. */}
      <div
        className="-mt-2 flex flex-col items-center gap-3 rounded-2xl px-4 pb-4 pt-5"
        style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="w-full" style={{ maxWidth: 300 }}>
          <StartingPointArt kind={startingPoint} teams={teams} maxHeight={150} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h2 className="m-0" style={{ fontSize: 22, fontWeight: 700, color: "var(--color-bt-text)" }}>
            {sp.name}
          </h2>
          <div style={{ ...EYEBROW, color: "var(--color-bt-accent)" }} data-testid="starting-point-review-chip">
            {word} · {teams === 0 ? "Individuals" : `${teams} teams`}
          </div>
        </div>
      </div>

      <Field label={`${word} name`} htmlFor="starting-point-name">
        <input
          id="starting-point-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={COMPETITION_NAME_EXAMPLE[sp.scoringModel]}
          maxLength={200}
          className="w-full rounded-xl px-3.5 outline-none"
          style={{
            height: 48,
            fontSize: 16,
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
          }}
          data-testid="competition-setup-name"
        />
      </Field>

      {sp.players === "individuals_or_teams" && (
        <Field label="Play as">
          <div
            role="group"
            aria-label="Play as"
            className="grid grid-cols-2 gap-1 rounded-xl p-1"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
            data-testid="play-as"
          >
            {(["individuals", "teams"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onPlayAsChange(v)}
                aria-pressed={playAs === v}
                data-testid={`play-as-${v}`}
                className="rounded-lg"
                style={{
                  minHeight: 44,
                  fontSize: TYPE_SCALE.emphasis,
                  fontWeight: playAs === v ? 700 : 600,
                  background: playAs === v ? "var(--color-bt-accent)" : "transparent",
                  color: playAs === v ? "var(--color-bt-on-accent)" : "var(--color-bt-text)",
                }}
              >
                {v === "individuals" ? "Individuals" : "Teams"}
              </button>
            ))}
          </div>
        </Field>
      )}

      {teams >= 2 && sp.players !== "two_teams" && (
        <div className="flex items-center justify-between gap-3" data-testid="starting-point-teams">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: teams }, (_, i) => (
              <TeamBadge key={i} {...seedTeamName(i)} color={SEED_TEAM_COLORS[i].color} size={28} />
            ))}
          </div>
          <Stepper
            size="inline"
            value={teamCount}
            min={2}
            max={MAX_SEED_TEAMS}
            onChange={onTeamCountChange}
            formatValue={(n) => `${n} teams`}
            testId="team-count-stepper"
          />
        </div>
      )}

      <Field label="Suggested games">
        <div className="overflow-hidden rounded-xl" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
          {suggestions.map((s, i) => {
            const Icon = categoryIcon(s.gameTypeId);
            return (
              <div
                key={s.key}
                className="flex items-start gap-3 px-3.5 py-3"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)" }}
                data-testid={`review-suggestion-${s.key}`}
              >
                <Icon size={18} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 500, color: "var(--color-bt-text)" }}>{s.name}</span>
                  {/* The format's one plain line, from the descriptions module (Zach). */}
                  <span style={{ fontSize: TYPE_SCALE.captionPlus, lineHeight: 1.4, color: "var(--color-bt-text-dim)" }} data-testid={`review-suggestion-line-${s.key}`}>
                    {formatLine(s.gameTypeId, s.competitionFormat)}
                  </span>
                </span>
                <span style={{ fontSize: TYPE_SCALE.emphasis, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>{s.pointsTotal} pts</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2" style={{ fontSize: TYPE_SCALE.body, color: "var(--color-bt-text-dim)" }}>
          Add them from the board when you’re ready.
        </p>
      </Field>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
          {error}
        </p>
      )}

      {/* PINNED to the bottom of the screen (Zach, on the Golf week review's
          look; CLAUDE.md #14: a bottom CTA anchors to the viewport, never the
          end of the content). STICKY in the page's own scroll, not fixed, so
          it keeps the panel's width and centre on a desktop, where the panel
          is centred in the content column rather than the window. The bar
          bleeds over the panel's padding and carries its surface, so the
          content scrolls under it rather than showing through. */}
      <div
        className="sticky z-10 -mx-4 -mb-4 px-4 pb-4 pt-3"
        style={{
          // Above the fixed bottom nav, which the page scrolls under: its MEASURED
          // height, as the game panel uses (`--bt-bottomnav-height`, published by
          // AppTabBar). Where there is no bar the fallback is the safe-area inset.
          // Measured at 390px: `bottom: 0` put the button under the nav.
          bottom: "var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px))",
          background: "var(--color-bt-card)",
          borderTop: "1px solid var(--color-bt-subtle-border)",
        }}
        data-testid="starting-point-review-cta"
      >
      <button
        type="button"
        onClick={onCreate}
        disabled={!canCreate}
        className="flex w-full items-center justify-center rounded-xl disabled:opacity-50"
        style={{ minHeight: 52, background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)", fontSize: 16, fontWeight: 700 }}
        data-testid="competition-setup-submit"
      >
        {submitting ? "Creating…" : `Create ${competitionNoun(sp.scoringModel)}`}
      </button>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} style={{ ...EYEBROW, fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
