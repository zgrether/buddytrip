"use client";

import { useState } from "react";
import { ChevronLeft, Plus, Swords, Trophy, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { cancelBootstrapSeed } from "@/lib/bootstrapSeed";
import type { ScoringModel } from "@/lib/gameTypes";
import { COMPETITION_CHOICE_WORD, COMPETITION_NAME_EXAMPLE, COMPETITION_UMBRELLA, competitionNoun, competitionWord, COMPETITION_KIND_LINE } from "@/lib/vocabulary";
import { Stepper } from "@/components/games/Stepper";
import { MAX_SEED_TEAMS } from "@/lib/teamColors";
import { STARTING_POINTS, startingPointFits, type StartingPointId } from "@/lib/startingPoints";
import { StartingPointPicker } from "./StartingPointPicker";
import { StartingPointReview } from "./StartingPointReview";

// ── Types ───────────────────────────────────────────────────────────────────

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status?: string | null;
  scoring_model?: ScoringModel | null;
}

interface Props {
  tripId: string;
  /** Null/undefined → create mode. Populated → edit mode. */
  competition?: Competition | null;
  onSuccess?: () => void;
  /** Edit mode only — shown next to Save Changes. */
  onCancel?: () => void;
  /** Create mode: the picker's Just keep score, which makes a side game
   *  rather than a competition, so the caller opens the add-game sheet. */
  onJustKeepScore?: () => void;
}

// ── Shape chooser ────────────────────────────────────────────────────────────
// THE creation decision (W-TYPE-01): the competition's scoring model, written at
// creation and frozen thereafter. It's the one axis team count can't supply (a
// 2-team competition can be points-based).
//   head-to-head → scoring_model='match_play', locked at 2 teams.
//   teams        → scoring_model='points', 2–N teams.

interface ShapeOption {
  model: ScoringModel;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}

const SHAPE_OPTIONS: ShapeOption[] = [
  {
    model: "match_play",
    icon: <Swords size={18} />,
    title: COMPETITION_CHOICE_WORD.match_play,
    blurb: COMPETITION_KIND_LINE.match_play,
  },
  {
    model: "points",
    icon: <Users size={18} />,
    title: COMPETITION_CHOICE_WORD.points,
    blurb: COMPETITION_KIND_LINE.points,
  },
];

// ── CompetitionSetupPanel ───────────────────────────────────────────────────

/**
 * Create or edit a competition. Create mode opens with the SHAPE chooser (the
 * one meaningful decision — head-to-head vs teams), then (for the Teams shape) a
 * team-count picker, then name + tagline. The shape writes `scoring_model` and is
 * frozen after creation; the picker seeds N default-named teams (Team A…N),
 * renameable later in the team editor. Head-to-head is locked at 2 teams (no picker).
 * Edit mode is name + tagline only (shape + team count are frozen — post-creation
 * team management lives in the team editor).
 */
export function CompetitionSetupPanel({ tripId, competition, onSuccess, onCancel, onJustKeepScore }: Props) {
  const isEdit = !!competition;
  // Create opens on the picker (starting points, Zach 2026-10-21). A starting
  // point opens its REVIEW (its art, the name, its setup) and is recorded on
  // the competition; Build your own opens the form below with none.
  const [step, setStep] = useState<"pick" | "review" | "build">("pick");
  const [startingPoint, setStartingPoint] = useState<StartingPointId | null>(null);
  const utils = trpc.useUtils();

  const [scoringModel, setScoringModel] = useState<ScoringModel>("match_play");
  const [teamCount, setTeamCount] = useState(2);
  // A points race is played as INDIVIDUALS by default (PR 7, ruling 21):
  // structure is something you add, not something you are made to build.
  const [playAs, setPlayAs] = useState<"individuals" | "teams">("individuals");
  // Edit mode names the competition that exists; create mode follows the shape
  // being picked, so the name field and button change with it. The title is
  // the umbrella word ("Start a Competition"); the shape options are where the
  // type is CHOSEN, so they use the choosing form (Head-to-Head Cup); the name
  // field and button come after the choice and say plain Cup.
  const kind = isEdit ? competition?.scoring_model ?? null : scoringModel;
  const word = competitionWord(kind);
  const noun = competitionNoun(kind);
  const [name, setName] = useState(competition?.name ?? "");
  const [tagline, setTagline] = useState(competition?.tagline ?? "");
  const [error, setError] = useState<string | null>(null);

  const createComp = trpc.competitions.create.useMutation({
    onMutate: async () => {
      await utils.competitions.getByTrip.cancel({ tripId });
    },
    onError: (e) => setError(e.message ?? `Couldn't create the ${noun}`),
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The Live face renders from the faceBootstrap snapshot (boot.competition),
      // not getByTrip — re-resolve it so the face swaps the create form for the
      // board (and seeds the new competition's child caches) without a hard
      // refresh.
      utils.competitions.faceBootstrap.invalidate({ tripId });
      // `trips.list` carries `hasCompetition`, which the dashboard card renders
      // as the trophy chip — without this the chip is missing on a trip that now
      // has a cup (#813). `trips.list` is NOT one of faceBootstrap's seeded
      // children, so CLAUDE.md #10's re-seed hazard doesn't apply to it.
      //
      // Actor-side only: the flag changed for every member of the trip, and only
      // this client invalidates. The rest needs cross-user propagation.
      utils.trips.list.invalidate();
    },
  });

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      // getByTrip is faceBootstrap-seeded: cancel the bootstrap too, or an
      // in-flight one lands after the rename and puts the old name back
      // (#1405 C, src/lib/bootstrapSeed.ts).
      await Promise.all([
        utils.competitions.getByTrip.cancel({ tripId }),
        cancelBootstrapSeed(utils, tripId),
      ]);
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          name: vars.name ?? previous.name,
          tagline: vars.tagline ?? previous.tagline,
        });
      }
      return { previous };
    },
    onError: (e, _vars, ctxRollback) => {
      if (ctxRollback?.previous) {
        utils.competitions.getByTrip.setData({ tripId }, ctxRollback.previous);
      }
      setError(e.message ?? "Couldn't save the change");
    },
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face header reads name/tagline from the faceBootstrap snapshot —
      // re-resolve it so the rename shows without a hard refresh.
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  const isSubmitting = createComp.isPending || updateComp.isPending;
  const trimmedName = name.trim();
  const submitDisabled = isSubmitting || trimmedName.length < 2;

  function pickStartingPoint(id: StartingPointId) {
    const sp = STARTING_POINTS[id];
    setStartingPoint(id);
    setScoringModel(sp.scoringModel);
    if (sp.players === "individuals_or_teams") setPlayAs("individuals");
    if (sp.players === "teams") {
      setPlayAs("teams");
      setTeamCount(2);
    }
    setStep("review");
  }

  async function handleSubmit() {
    setError(null);
    if (trimmedName.length < 2) {
      setError("The name needs at least 2 characters");
      return;
    }

    if (isEdit && competition) {
      await updateComp.mutateAsync({
        tripId,
        competitionId: competition.id,
        name: trimmedName,
        tagline: tagline.trim() || null,
      });
      onSuccess?.();
      return;
    }

    const createTeamCount = scoringModel === "points" ? (playAs === "individuals" ? 0 : teamCount) : 2;
    await createComp.mutateAsync({
      tripId,
      name: trimmedName,
      tagline: tagline.trim() || undefined,
      scoringModel,
      // Match-play is locked at 2 teams. A points race played as individuals seeds
      // none: it has no roster, and its standings are whoever plays (ruling 22).
      teamCount: createTeamCount,
      // Recorded only while the choices still fit it: changing the shape
      // after picking a starting point makes this Build your own.
      startingPoint:
        startingPoint && startingPointFits(startingPoint, scoringModel, createTeamCount) ? startingPoint : undefined,
    });
    onSuccess?.();
  }

  const panelStyle = { background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" };

  if (!isEdit && step === "review" && startingPoint) {
    return (
      <div className="mx-auto w-full max-w-[600px] rounded-xl p-4" style={panelStyle} data-testid="competition-setup-panel">
        <StartingPointReview
          startingPoint={startingPoint}
          name={name}
          onNameChange={setName}
          playAs={playAs}
          onPlayAsChange={setPlayAs}
          teamCount={teamCount}
          onTeamCountChange={setTeamCount}
          onBack={() => setStep("pick")}
          onCreate={() => void handleSubmit()}
          submitting={isSubmitting}
          error={error}
        />
      </div>
    );
  }

  if (!isEdit && step === "pick") {
    return (
      // Capped at ~600px and centred (Zach): on a desktop the tiles would
      // otherwise stretch, and the 2x2 reads as four banners.
      <div className="mx-auto w-full max-w-[600px] rounded-xl p-4" style={panelStyle} data-testid="competition-setup-panel">
        <StartingPointPicker
          onPick={pickStartingPoint}
          onJustKeepScore={() => onJustKeepScore?.()}
          onBuildYourOwn={() => {
            setStartingPoint(null);
            setStep("build");
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={panelStyle}
      data-testid="competition-setup-panel"
    >
      {!isEdit && (
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="-ml-1 mb-2 flex items-center gap-1 text-sm font-medium"
          style={{ minHeight: 44, color: "var(--color-bt-text-dim)" }}
          data-testid="starting-points-back"
        >
          <ChevronLeft size={18} />
          Starting points
        </button>
      )}
      {!isEdit && (
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
            }}
          >
            <Trophy size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              {isEdit ? `Edit ${noun}` : `Start a ${COMPETITION_UMBRELLA}`}
            </h2>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Shape chooser — create only (the shape is frozen after creation). */}
        {!isEdit && (
          <div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="shape-chooser">
              {SHAPE_OPTIONS.map((opt) => (
                <ShapeCard
                  key={opt.model}
                  option={opt}
                  selected={scoringModel === opt.model}
                  onSelect={() => setScoringModel(opt.model)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Play as — a points race only (ruling 21). Individuals is the default and
            has NO roster step: whoever plays the race's games is in the standings. */}
        {!isEdit && scoringModel === "points" && (
          <FieldShell label="Play as" required>
            <div className="grid grid-cols-2 gap-2" data-testid="play-as">
              {(["individuals", "teams"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPlayAs(v)}
                  aria-pressed={playAs === v}
                  data-testid={`play-as-${v}`}
                  className="rounded-lg px-3 py-2 text-sm font-semibold"
                  style={{
                    background: playAs === v ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    border: `1px solid ${playAs === v ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                    color: playAs === v ? "var(--color-bt-accent)" : "var(--color-bt-text)",
                  }}
                >
                  {v === "individuals" ? "Individuals" : "Teams"}
                </button>
              ))}
            </div>
          </FieldShell>
        )}

        {/* Team count — a points race played as TEAMS only; head-to-head is locked at
            2. The picker seeds N default-named teams (Team A…N), renameable later. */}
        {!isEdit && scoringModel === "points" && playAs === "teams" && (
          <FieldShell label="Teams" required>
            <div
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
            >
              <span className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                Start with {teamCount} teams
              </span>
              <Stepper
                size="inline"
                value={teamCount}
                min={2}
                max={MAX_SEED_TEAMS}
                onChange={setTeamCount}
                testId="team-count-stepper"
              />
            </div>
          </FieldShell>
        )}

        <FieldShell label={`${word} name`} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={COMPETITION_NAME_EXAMPLE[kind ?? "match_play"]}
            maxLength={200}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
            data-testid="competition-setup-name"
          />
        </FieldShell>

        <FieldShell label="Tagline" optional>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. May the best team win"
            maxLength={500}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
          />
        </FieldShell>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            data-testid="competition-setup-submit"
          >
            {!isEdit && <Plus size={15} />}
            {isEdit ? "Save Changes" : `Create ${noun}`}
          </button>
          {isEdit && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="rounded-xl px-4 py-3 text-sm font-medium"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "0.5px solid var(--color-bt-border)",
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function ShapeCard({
  option,
  selected,
  onSelect,
}: {
  option: ShapeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex flex-col gap-1.5 rounded-xl p-3 text-left transition-colors"
      style={{
        background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
        border: `1px solid ${selected ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
      }}
      data-testid={`shape-option-${option.model}`}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          background: selected ? "var(--color-bt-accent)" : "var(--color-bt-card)",
          color: selected ? "var(--color-bt-base)" : "var(--color-bt-accent)",
        }}
      >
        {option.icon}
      </span>
      <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {option.title}
      </span>
      <span className="text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
        {option.blurb}
      </span>
    </button>
  );
}

function FieldShell({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </label>
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
          </span>
        )}
        {optional && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            optional
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
