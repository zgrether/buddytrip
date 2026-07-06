"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Swords, Trash2, RotateCcw, Eraser, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

interface Competition {
  id: string;
  name: string;
  /** Short label for the bottom-nav tab; falls back to `name` when unset. */
  short_name?: string | null;
  tagline: string | null;
  /** Frozen at creation (the shape chooser). Shown read-only here. */
  scoring_model?: "match_play" | "points";
}

interface Props {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onDeleted?: () => void;
}

/**
 * CompetitionSettings — competition META + danger zone, modeled on the
 * game-settings page (the sibling pattern):
 *   1. Scoring model — the frozen shape, a read-only row (never editable; the
 *      shape is chosen at creation, delete-and-restart to change it).
 *   2. Details       — name + tagline, AUTO-SAVED on blur (no Save button), the
 *      always-editable "Rules"-tier exception even once scoring has started.
 *   3. Danger        — reset / delete (owner). Always reachable: it's the
 *      recovery hatch, so unlike the per-GAME danger zone (which unlocks by
 *      toggling back to Setup) it is NEVER disabled — a scored competition with
 *      no escape would strand the owner.
 *
 * Competition-level lock: once any game is scored (`competitionHasScore` via
 * teamAssignments.rosterLocked) the STRUCTURAL settings freeze — the shape is
 * already frozen, team structure locks in the Rosters surface — and a quiet
 * explainer says so. Name/tagline (and the danger hatch) stay open.
 *
 * Team management is NOT here — it lives in the member-visible Rosters overlay
 * opened from the board (W-TEAMSURFACE-01), where roster editing is live + drag.
 *
 * STANDARD PALETTE ONLY — no competition accent / tonal shift.
 */
export function CompetitionSettings({
  competition,
  tripId,
  canEdit,
  isOwner,
  onDeleted,
}: Props) {
  // Score-based lock — the SAME signal the Rosters surface uses, so the two
  // can't disagree about whether the competition is "underway".
  const { data: scored = false } = trpc.teamAssignments.rosterLocked.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );

  return (
    <div className="space-y-6">
      {scored && <ScoringStartedNote />}

      <ScoringModelSection model={competition.scoring_model ?? "match_play"} scored={scored} />

      <DetailsSection competition={competition} tripId={tripId} canEdit={canEdit} />

      {/* Danger zone is the owner's reset/delete hatch — reachable at all times
          (Task 1). Delete-and-restart is the supported recovery path. */}
      {isOwner && (
        <DangerSection competition={competition} tripId={tripId} onDeleted={onDeleted} />
      )}
    </div>
  );
}

// ── Scoring-started explainer (top-of-page, mirrors the game lock banner) ─────

function ScoringStartedNote() {
  return (
    <p
      className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-[12px] leading-snug"
      style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
      data-testid="comp-scoring-started-note"
    >
      <Lock size={14} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
      <span>
        Scoring has started — the competition shape and teams are locked. You can
        still rename it, and the reset / delete hatches stay available below.
      </span>
    </p>
  );
}

// ── Scoring model (frozen, read-only) ────────────────────────────────────────

const MODEL_DISPLAY: Record<"match_play" | "points", { label: string; shape: string; icon: React.ReactNode }> = {
  match_play: { label: "Match Play", shape: "Head-to-head", icon: <Swords size={16} /> },
  points: { label: "Points", shape: "Teams", icon: <Users size={16} /> },
};

function ScoringModelSection({ model, scored }: { model: "match_play" | "points"; scored: boolean }) {
  const cfg = MODEL_DISPLAY[model];
  return (
    <section className="space-y-3">
      <SectionLabel>Scoring model</SectionLabel>
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        data-testid="comp-scoring-model-row"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          >
            {cfg.icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {cfg.label}
            </p>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {cfg.shape}
            </p>
          </div>
          {/* Frozen at creation — read-only. The lock icon makes that explicit
              (and reads doubly-locked once scoring has started). */}
          <Lock
            size={14}
            style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
            aria-label={scored ? "Locked — scoring started" : "Set at creation"}
          />
        </div>
        {/* Reserved for a future scoring-model explainer blurb (W-TYPE-01) — do
            NOT fill this in yet; the space is held so the row can grow a one-line
            description without a relayout, mirroring the game-type explainer
            reservation on the game page. */}
      </div>
    </section>
  );
}

// ── Details (name + tagline, auto-saved on blur) ─────────────────────────────

function DetailsSection({
  competition,
  tripId,
  canEdit,
}: {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(competition.name);
  const [shortName, setShortName] = useState(competition.short_name ?? "");
  const [tagline, setTagline] = useState(competition.tagline ?? "");
  const [error, setError] = useState<string | null>(null);
  // Transient "Saved" flash after a successful auto-save.
  const [savedAt, setSavedAt] = useState(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          name: vars.name ?? previous.name,
          short_name: vars.shortName !== undefined ? vars.shortName : previous.short_name,
          tagline: vars.tagline ?? previous.tagline,
        });
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      setError(e.message ?? "Failed to save");
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(0), 1600);
    },
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face header reads name/tagline from the faceBootstrap snapshot —
      // re-resolve it so the rename shows without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  // Auto-save on blur (the game-settings pattern — no Save button). Name needs
  // ≥2 chars; an invalid/empty name reverts to the last saved value rather than
  // persisting junk.
  const commitName = () => {
    if (!canEdit) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setName(competition.name);
      setError(null);
      return;
    }
    if (trimmed === competition.name) return;
    setError(null);
    updateComp.mutate({ tripId, competitionId: competition.id, name: trimmed });
  };
  const commitShortName = () => {
    if (!canEdit) return;
    const trimmed = shortName.trim();
    if (trimmed === (competition.short_name ?? "")) return;
    setError(null);
    // Empty clears it (→ null) so the nav falls back to the full name.
    updateComp.mutate({ tripId, competitionId: competition.id, shortName: trimmed || null });
  };
  const commitTagline = () => {
    if (!canEdit) return;
    const trimmed = tagline.trim();
    if (trimmed === (competition.tagline ?? "")) return;
    setError(null);
    updateComp.mutate({ tripId, competitionId: competition.id, tagline: trimmed || null });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <SectionLabel>Competition details</SectionLabel>
        <SaveStatus pending={updateComp.isPending} savedAt={savedAt} />
      </div>
      <div
        className="space-y-4 rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Competition Name <span className="normal-case font-normal">required</span>
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
            onBlur={commitName}
            readOnly={!canEdit}
            placeholder="e.g. BBMI 2026, The Yert Open"
            maxLength={200}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
            data-testid="comp-settings-name"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Short name <span className="normal-case font-normal">shown in the bottom navigation bar</span>
          </label>
          <input
            value={shortName}
            onChange={(e) => { setShortName(e.target.value); if (error) setError(null); }}
            onBlur={commitShortName}
            readOnly={!canEdit}
            placeholder="e.g. BBMI — keep it short to fit the nav tab"
            maxLength={40}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
            data-testid="comp-settings-short-name"
          />
          <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            The full name won&apos;t fit the &ldquo;Live&rdquo; tab — set a short label here. Leave blank to fall back to the full name.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Tagline <span className="normal-case font-normal">optional</span>
          </label>
          <input
            value={tagline}
            onChange={(e) => { setTagline(e.target.value); if (error) setError(null); }}
            onBlur={commitTagline}
            readOnly={!canEdit}
            placeholder="e.g. May the best team win"
            maxLength={500}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
            data-testid="comp-settings-tagline"
          />
        </div>

        {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
      </div>
    </section>
  );
}

function SaveStatus({ pending, savedAt }: { pending: boolean; savedAt: number }) {
  if (pending) {
    return <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="comp-save-status">Saving…</span>;
  }
  if (savedAt > 0) {
    return <span className="text-[11px]" style={{ color: "var(--color-bt-accent)" }} data-testid="comp-save-status">Saved</span>;
  }
  return null;
}

// ── Danger zone (reset / delete) ─────────────────────────────────────────────

/** Which danger-zone confirm is open. The escalating ladder, mildest → severest:
 *  reset scoring → reset to skeleton → delete. */
type DangerConfirm = null | "scoring" | "skeleton" | "delete";

function DangerSection({
  competition,
  tripId,
  onDeleted,
}: {
  competition: Competition;
  tripId: string;
  onDeleted?: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<DangerConfirm>(null);
  const [error, setError] = useState<string | null>(null);

  // Cascade-tally inputs for the delete confirm copy (assignments + games).
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const { data: allGames = [] } = trpc.games.listByTrip.useQuery(
    { tripId },
    { enabled: !!competition.id }
  );
  const teamsCount = (assignments as Array<unknown>).length;
  const gamesCount = (allGames as Array<{ competition_id: string | null }>).filter(
    (g) => g.competition_id === competition.id
  ).length;

  // A reset changes results + (for skeleton) config across every game. Two layers
  // of cache to clear:
  //  1. Board surfaces render from the faceBootstrap snapshot (#10) → re-resolve
  //     it + the child caches other board surfaces read directly.
  //  2. Per-GAME surfaces — the score-entry / scorecard / match pages read
  //     games.getById + scores/matches/playGroups.listByGame, which the board
  //     PREFETCHES on row hover (fresh for the 60s staleTime). Without clearing
  //     these, opening a game after a reset shows its OLD scores + pairings until
  //     the staleTime expires (the 15-30s lag). Invalidate every cached instance
  //     (all gameIds) so an opened game refetches the cleared state on mount.
  function invalidateAfterReset() {
    utils.competitions.faceBootstrap.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId: competition.id });
    utils.games.listByTrip.invalidate({ tripId });
    utils.games.getById.invalidate();
    utils.scores.listByGame.invalidate();
    utils.matches.listByGame.invalidate();
    utils.playGroups.listByGame.invalidate();
    // The reset clears scores → the roster lock releases; refresh that signal so
    // the settings + Rosters surfaces unlock without a hard reload.
    utils.teamAssignments.rosterLocked.invalidate({ tripId, competitionId: competition.id });
  }

  const resetScoring = trpc.competitions.resetScoring.useMutation({
    onSuccess: () => { invalidateAfterReset(); setConfirm(null); },
    onError: (e) => setError(e.message ?? "Failed to reset scoring"),
  });
  const resetToSkeleton = trpc.competitions.resetToSkeleton.useMutation({
    onSuccess: () => { invalidateAfterReset(); setConfirm(null); },
    onError: (e) => setError(e.message ?? "Failed to reset to skeleton"),
  });
  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face renders from the faceBootstrap snapshot — re-resolve so it
      // returns to the empty/create state without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
    onSuccess: () => { setConfirm(null); onDeleted?.(); },
    onError: (e) => setError(e.message ?? "Failed to delete competition"),
  });

  const open = (which: DangerConfirm) => { setError(null); setConfirm(which); };

  return (
    <section className="space-y-3">
      <SectionLabel danger>Danger zone</SectionLabel>
      <div className="space-y-2.5">
        {/* The escalating ladder: clear scores → strip setup → delete. Always
            available — the recovery hatch is never locked (see component note). */}
        <DangerRow
          icon={<RotateCcw size={14} />}
          tone="warning"
          label="Reset all scoring"
          blurb="Clears every game's scores. Teams, games, and setup stay — each game is ready to re-score."
          onClick={() => open("scoring")}
          testId="comp-reset-scoring-btn"
        />
        <DangerRow
          icon={<Eraser size={14} />}
          tone="warning"
          label="Reset all games to skeleton"
          blurb="Resets every game to unconfigured. Teams stay; all pairings, courses, handicaps, and scores are cleared."
          onClick={() => open("skeleton")}
          testId="comp-reset-skeleton-btn"
        />
        <DangerRow
          icon={<Trash2 size={14} />}
          tone="danger"
          label="Delete competition"
          blurb="Removes the competition, its teams, and rosters. Games detach to the trip (their scores are kept). This can't be undone."
          onClick={() => open("delete")}
          testId="competition-delete-btn"
        />
        {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
      </div>

      {confirm === "scoring" && (
        <DangerConfirmModal
          tone="warning"
          icon={<RotateCcw size={18} />}
          title="Reset all scoring?"
          body="Clears all scores. Teams, games, and setup stay — every game is ready to re-score."
          confirmLabel="Reset scoring"
          pendingLabel="Resetting…"
          isPending={resetScoring.isPending}
          testId="comp-reset-scoring-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetScoring.mutate({ tripId, competitionId: competition.id })}
        />
      )}
      {confirm === "skeleton" && (
        <DangerConfirmModal
          tone="warning"
          icon={<Eraser size={18} />}
          title="Reset all games to skeleton?"
          body="Resets every game to unconfigured. Teams stay; all pairings, courses, handicaps, and scores are cleared — each game needs setting up again."
          confirmLabel="Reset to skeleton"
          pendingLabel="Resetting…"
          isPending={resetToSkeleton.isPending}
          testId="comp-reset-skeleton-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetToSkeleton.mutate({ tripId, competitionId: competition.id })}
        />
      )}
      {confirm === "delete" && (
        <DangerConfirmModal
          tone="danger"
          icon={<Trash2 size={18} />}
          title={`Delete “${competition.name}”?`}
          body={`This removes the competition, its teams, and rosters${describeRemoved(teamsCount)}.${describeDetach(gamesCount)} This cannot be undone.`}
          confirmLabel="Delete Competition"
          pendingLabel="Deleting…"
          isPending={deleteComp.isPending}
          testId="competition-delete-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => deleteComp.mutate({ tripId, competitionId: competition.id })}
        />
      )}
    </section>
  );
}

/** The removed cascade: team rosters (assignments). Games are NOT removed — they
 *  detach (ON DELETE SET NULL, migration 056), so they're described separately. */
function describeRemoved(assignments: number): string {
  if (assignments <= 0) return "";
  return ` (${assignments} assignment${assignments === 1 ? "" : "s"})`;
}

/** Games detach to standalone trip games (scores preserved), they are not deleted. */
function describeDetach(games: number): string {
  if (games <= 0) return "";
  return ` Its ${games} game${games === 1 ? "" : "s"} detach to the trip (scores kept).`;
}
