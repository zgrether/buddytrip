"use client";

import { useState } from "react";
import { Plus, Swords, Trophy, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { ScoringModel } from "@/lib/gameTypes";

// ── Types ───────────────────────────────────────────────────────────────────

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status?: string | null;
}

interface Props {
  tripId: string;
  /** Null/undefined → create mode. Populated → edit mode. */
  competition?: Competition | null;
  onSuccess?: () => void;
  /** Edit mode only — shown next to Save Changes. */
  onCancel?: () => void;
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
    title: "Head-to-head",
    blurb: "Two teams, match play — win, halve, or lose each game.",
  },
  {
    model: "points",
    icon: <Users size={18} />,
    title: "Teams",
    blurb: "Two or more teams race for points each game — most points wins.",
  },
];

// ── CompetitionSetupPanel ───────────────────────────────────────────────────

/**
 * Create or edit a competition. Create mode opens with the SHAPE chooser (the
 * one meaningful decision — head-to-head vs teams), then name + tagline. The
 * shape writes `scoring_model` and is frozen after creation. Team count is not
 * set here — both shapes seed two teams; the Teams shape adds more via the
 * Rosters surface afterward. Edit mode is name + tagline only (shape is frozen).
 */
export function CompetitionSetupPanel({ tripId, competition, onSuccess, onCancel }: Props) {
  const isEdit = !!competition;
  const utils = trpc.useUtils();

  const [scoringModel, setScoringModel] = useState<ScoringModel>("match_play");
  const [name, setName] = useState(competition?.name ?? "");
  const [tagline, setTagline] = useState(competition?.tagline ?? "");
  const [error, setError] = useState<string | null>(null);

  const createComp = trpc.competitions.create.useMutation({
    onMutate: async () => {
      await utils.competitions.getByTrip.cancel({ tripId });
    },
    onError: (e) => setError(e.message ?? "Failed to create competition"),
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The Live face renders from the faceBootstrap snapshot (boot.competition),
      // not getByTrip — re-resolve it so the face swaps the create form for the
      // board (and seeds the new competition's child caches) without a hard
      // refresh.
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
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
      setError(e.message ?? "Failed to update competition");
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

  async function handleSubmit() {
    setError(null);
    if (trimmedName.length < 2) {
      setError("Competition name must be at least 2 characters");
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

    await createComp.mutateAsync({
      tripId,
      name: trimmedName,
      tagline: tagline.trim() || undefined,
      scoringModel,
    });
    onSuccess?.();
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="competition-setup-panel"
    >
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
              Set Up Competition
            </h2>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Pick a shape, name it, and you&rsquo;re set.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Shape chooser — create only (the shape is frozen after creation). */}
        {!isEdit && (
          <FieldShell label="Competition Shape" required>
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
          </FieldShell>
        )}

        <FieldShell label="Competition Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BBMI 2026, The Yert Open"
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
            {isEdit ? "Save Changes" : "Create Competition"}
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
