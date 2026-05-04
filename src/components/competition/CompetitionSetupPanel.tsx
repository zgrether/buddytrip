"use client";

import { useState } from "react";
import { Plus, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ───────────────────────────────────────────────────────────────────

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  motto: string | null;
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

// ── Default team palette ────────────────────────────────────────────────────
// Exempt from token migration per STYLE_GUIDE.md Section 7. These eight
// hex values are intentional team identity colors; the (color, color_dim)
// pairs match the team color picker in TeamsPanel.
const DEFAULT_TEAM_PALETTE: Array<{
  name: string;
  shortName: string;
  color: string;
  colorDim: string;
}> = [
  { name: "Team Blue",   shortName: "BLU", color: "#3b82f6", colorDim: "#0a1a2a" },
  { name: "Team Orange", shortName: "ORG", color: "#f97316", colorDim: "#2a1200" },
  { name: "Team Green",  shortName: "GRN", color: "#22c55e", colorDim: "#0a2a0f" },
  { name: "Team Red",    shortName: "RED", color: "#ef4444", colorDim: "#2a0a0a" },
  { name: "Team Purple", shortName: "PUR", color: "#a855f7", colorDim: "#1a0a2a" },
  { name: "Team Cyan",   shortName: "CYN", color: "#06b6d4", colorDim: "#0a1f2a" },
  { name: "Team Amber",  shortName: "AMB", color: "#f59e0b", colorDim: "#2a1f00" },
  { name: "Team Pink",   shortName: "PNK", color: "#ec4899", colorDim: "#2a0a1a" },
];

// ── CompetitionSetupPanel ───────────────────────────────────────────────────

export function CompetitionSetupPanel({ tripId, competition, onSuccess, onCancel }: Props) {
  const isEdit = !!competition;
  const utils = trpc.useUtils();

  const [name, setName] = useState(competition?.name ?? "");
  const [tagline, setTagline] = useState(competition?.tagline ?? "");
  const [motto, setMotto] = useState(competition?.motto ?? "");
  const [teamCount, setTeamCount] = useState<number>(2);
  const [customTeamCount, setCustomTeamCount] = useState<string>("5");
  const [error, setError] = useState<string | null>(null);

  const createComp = trpc.competitions.create.useMutation({
    // Optimistic insert per CLAUDE.md so the panel collapses fast.
    onMutate: async () => {
      await utils.competitions.getByTrip.cancel({ tripId });
    },
    onError: (e) => setError(e.message ?? "Failed to create competition"),
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
    },
  });

  const createTeam = trpc.teams.create.useMutation();

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          name: vars.name ?? previous.name,
          tagline: vars.tagline ?? previous.tagline,
          motto: vars.motto ?? previous.motto,
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
    },
  });

  const isSubmitting = createComp.isPending || updateComp.isPending;
  const desiredTeamCount = teamCount === -1
    ? Math.max(2, Math.min(12, parseInt(customTeamCount, 10) || 2))
    : teamCount;
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
        motto: motto.trim() || null,
      });
      onSuccess?.();
      return;
    }

    // Create flow — competition first, then pre-create N empty team rows so
    // TeamsPanel opens onto a populated grid the user can rename in place.
    const comp = await createComp.mutateAsync({
      tripId,
      name: trimmedName,
      tagline: tagline.trim() || undefined,
      motto: motto.trim() || undefined,
    });

    const teamSlots = Math.max(2, Math.min(12, desiredTeamCount));
    const palette = Array.from({ length: teamSlots }, (_, i) => DEFAULT_TEAM_PALETTE[i % DEFAULT_TEAM_PALETTE.length]);
    await Promise.all(
      palette.map((team) =>
        createTeam.mutateAsync({
          tripId,
          competitionId: comp.id,
          name: team.name,
          shortName: team.shortName,
          color: team.color,
          colorDim: team.colorDim,
        })
      )
    );

    utils.teams.list.invalidate({ tripId, competitionId: comp.id });
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
              Name it, pick a team count, and you&rsquo;re ready to roll.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
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

        <FieldShell
          label="Motto"
          optional
          helper="Appears on the leaderboard header"
        >
          <input
            value={motto}
            onChange={(e) => setMotto(e.target.value)}
            placeholder="e.g. No guts, no glory"
            maxLength={500}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
          />
        </FieldShell>

        {!isEdit && (
          <FieldShell
            label="Number of Teams"
            required
            helper={
              desiredTeamCount === 2
                ? "Two-team format uses head-to-head points scoring"
                : "Multi-team format uses standings-based scoring"
            }
          >
            <div className="flex gap-1.5">
              {[2, 3, 4].map((n) => (
                <SegmentChip
                  key={n}
                  active={teamCount === n}
                  onClick={() => setTeamCount(n)}
                >
                  {n}
                </SegmentChip>
              ))}
              <SegmentChip
                active={teamCount === -1}
                onClick={() => setTeamCount(-1)}
              >
                Custom
              </SegmentChip>
            </div>
            {teamCount === -1 && (
              <input
                type="number"
                min={2}
                max={12}
                value={customTeamCount}
                onChange={(e) => setCustomTeamCount(e.target.value)}
                className="mt-2 w-24 rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }}
              />
            )}
          </FieldShell>
        )}

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

function FieldShell({
  label,
  required,
  optional,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  helper?: string;
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
      {helper && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {helper}
        </p>
      )}
    </div>
  );
}

function SegmentChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg py-2 text-sm font-semibold transition-colors"
      style={
        active
          ? { background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {children}
    </button>
  );
}
