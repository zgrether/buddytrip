"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  X,
  ArrowLeft,
  Lock,
  Swords,
  Users,
  Trophy,
  RotateCcw,
  Eraser,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";

// ── Competition settings (drill-in / master→detail) ────────────────────────
//
// A floating card overlay modeled 1:1 on TripSettingsModal: a fixed-width card
// on the light `--color-bt-card-float` background, whose master menu lists the
// setting rows and slides to a focused detail screen when one is tapped (forward
// from the right, back from the left — the shared .ts-slide-* classes, skipped
// under prefers-reduced-motion). Replaces the old inline full-page sub-surface
// (the navy `--color-bt-base` swap with a separate "Board" back button + a
// still-visible header gear).
//
// Content mirrors the old CompetitionSettings page, re-presented as drill-ins:
//   Competition details — name / short name / tagline, AUTO-SAVED on blur (the
//     always-editable "Rules"-tier exception; no Save button, a "Saved" flash).
//   Scoring model       — the frozen shape, read-only (chosen at creation).
//   Danger zone (owner) — reset scoring → reset skeleton → delete, each a
//     focused confirm screen (the recovery hatch — NEVER locked).
//
// STANDARD PALETTE ONLY — no competition accent / tonal shift.

type View =
  | "menu"
  | "details"
  | "scoring"
  | "reset-scoring"
  | "reset-skeleton"
  | "delete";

const TITLES: Record<View, string> = {
  menu: "Competition settings",
  details: "Competition details",
  scoring: "Scoring model",
  "reset-scoring": "Reset all scoring",
  "reset-skeleton": "Reset all games",
  delete: "Delete competition",
};

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
  onClose: () => void;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onDeleted?: () => void;
}

const MODEL_DISPLAY: Record<
  "match_play" | "points",
  { label: string; shape: string; icon: ReactNode }
> = {
  match_play: { label: "Match Play", shape: "Head-to-head", icon: <Swords size={16} /> },
  points: { label: "Points", shape: "Teams", icon: <Users size={16} /> },
};

export function CompetitionSettingsModal({
  competition,
  tripId,
  canEdit,
  isOwner,
  onClose,
  onDeleted,
}: Props) {
  const utils = trpc.useUtils();
  useModalBackButton(onClose);

  // ── Navigation ──────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("menu");
  const [dir, setDir] = useState<"right" | "left">("right");
  const go = (v: View) => {
    setDir("right");
    setView(v);
  };
  const back = () => {
    setDir("left");
    setView("menu");
  };

  // Score-based lock — the SAME signal the Rosters surface uses, so the two
  // can't disagree about whether the competition is "underway".
  const { data: scored = false } = trpc.teamAssignments.rosterLocked.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id },
  );

  const model = competition.scoring_model ?? "match_play";
  const modelCfg = MODEL_DISPLAY[model];

  // ── Details drafts (auto-saved on blur — the game-settings pattern) ───────
  const [name, setName] = useState(competition.name);
  const [shortName, setShortName] = useState(competition.short_name ?? "");
  const [tagline, setTagline] = useState(competition.tagline ?? "");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous) {
        utils.competitions.getByTrip.setData(
          { tripId },
          {
            ...previous,
            name: vars.name ?? previous.name,
            short_name:
              vars.shortName !== undefined ? vars.shortName : previous.short_name,
            tagline: vars.tagline ?? previous.tagline,
          },
        );
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      setDetailsError(e.message ?? "Failed to save");
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

  // Auto-save on blur. Name needs ≥2 chars; an invalid/empty name reverts to the
  // last saved value rather than persisting junk.
  const commitName = () => {
    if (!canEdit) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setName(competition.name);
      setDetailsError(null);
      return;
    }
    if (trimmed === competition.name) return;
    setDetailsError(null);
    updateComp.mutate({ tripId, competitionId: competition.id, name: trimmed });
  };
  const commitShortName = () => {
    if (!canEdit) return;
    const trimmed = shortName.trim();
    if (trimmed === (competition.short_name ?? "")) return;
    setDetailsError(null);
    // Empty clears it (→ null) so the nav falls back to the full name.
    updateComp.mutate({
      tripId,
      competitionId: competition.id,
      shortName: trimmed || null,
    });
  };
  const commitTagline = () => {
    if (!canEdit) return;
    const trimmed = tagline.trim();
    if (trimmed === (competition.tagline ?? "")) return;
    setDetailsError(null);
    updateComp.mutate({
      tripId,
      competitionId: competition.id,
      tagline: trimmed || null,
    });
  };

  // ── Danger zone (reset / delete) ──────────────────────────────────────────
  const [dangerError, setDangerError] = useState<string | null>(null);

  // Cascade-tally inputs for the delete confirm copy (assignments + games).
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id && isOwner },
  );
  const { data: allGames = [] } = trpc.games.listByTrip.useQuery(
    { tripId },
    { enabled: !!competition.id && isOwner },
  );
  const teamsCount = (assignments as Array<unknown>).length;
  const gamesCount = (allGames as Array<{ competition_id: string | null }>).filter(
    (g) => g.competition_id === competition.id,
  ).length;

  // A reset changes results + (for skeleton) config across every game. Clear
  // both the board's faceBootstrap snapshot (#10) and every per-game cache the
  // board prefetches, so an opened game reflects the reset immediately.
  function invalidateAfterReset() {
    utils.competitions.faceBootstrap.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId: competition.id });
    utils.games.listByTrip.invalidate({ tripId });
    utils.games.getById.invalidate();
    utils.scores.listByGame.invalidate();
    utils.matches.listByGame.invalidate();
    utils.playGroups.listByGame.invalidate();
    utils.teamAssignments.rosterLocked.invalidate({
      tripId,
      competitionId: competition.id,
    });
  }

  const resetScoring = trpc.competitions.resetScoring.useMutation({
    onSuccess: () => {
      invalidateAfterReset();
      back();
    },
    onError: (e) => setDangerError(e.message ?? "Failed to reset scoring"),
  });
  const resetToSkeleton = trpc.competitions.resetToSkeleton.useMutation({
    onSuccess: () => {
      invalidateAfterReset();
      back();
    },
    onError: (e) => setDangerError(e.message ?? "Failed to reset to skeleton"),
  });
  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face renders from the faceBootstrap snapshot — re-resolve so it
      // returns to the empty/create state without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
    onSuccess: () => {
      onDeleted?.();
      onClose();
    },
    onError: (e) => setDangerError(e.message ?? "Failed to delete competition"),
  });

  const openDanger = (v: View) => {
    setDangerError(null);
    go(v);
  };

  const isMenu = view === "menu";
  const slideClass = dir === "right" ? "ts-slide-right" : "ts-slide-left";

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex w-full max-w-[400px] flex-col rounded-2xl"
          style={{
            background: "var(--color-bt-card-float)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-floating, 0 24px 60px rgba(0,0,0,0.45))",
            minHeight: 320,
            maxHeight: "85vh",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ───────────────────────────────────────────────── */}
          <div
            className="flex items-center gap-2.5 px-4 pb-3 pt-4"
            style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
          >
            {!isMenu && (
              <button
                onClick={back}
                aria-label="Back"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                }}
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span
              className="min-w-0 flex-1 truncate text-base font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {TITLES[view]}
            </span>
            {view === "details" && (
              <SaveStatus pending={updateComp.isPending} savedAt={savedAt} />
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              data-testid="comp-settings-close-btn"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <X size={15} />
            </button>
          </div>

          {/* ── Sliding viewport ─────────────────────────────────────── */}
          <div className="relative flex-1 overflow-x-hidden overflow-y-auto">
            <div key={view} className={`p-4 ${slideClass}`}>
              {/* ── Menu ──────────────────────────────────────────── */}
              {view === "menu" && (
                <>
                  {scored && <ScoringStartedNote />}

                  <Section label="Competition">
                    <Row
                      testId="comp-settings-details-row"
                      icon={<Trophy size={17} />}
                      title="Competition details"
                      subtitle={[competition.name, competition.tagline]
                        .filter(Boolean)
                        .join(" · ")}
                      onClick={() => go("details")}
                    />
                    <Row
                      testId="comp-settings-scoring-row"
                      icon={modelCfg.icon}
                      title="Scoring model"
                      subtitle={`${modelCfg.label} · ${modelCfg.shape}`}
                      onClick={() => go("scoring")}
                    />
                  </Section>

                  {/* Danger zone is the owner's reset/delete hatch — reachable at
                      all times (the recovery path is never locked). */}
                  {isOwner && (
                    <Section label="Danger zone" danger>
                      <Row
                        tone="warning"
                        testId="comp-reset-scoring-btn"
                        icon={<RotateCcw size={16} />}
                        title="Reset all scoring"
                        subtitle="Clears every game's scores — teams and setup stay"
                        onClick={() => openDanger("reset-scoring")}
                      />
                      <Row
                        tone="warning"
                        testId="comp-reset-skeleton-btn"
                        icon={<Eraser size={16} />}
                        title="Reset all games to skeleton"
                        subtitle="Clears pairings, courses, handicaps, and scores"
                        onClick={() => openDanger("reset-skeleton")}
                      />
                      <Row
                        tone="danger"
                        testId="competition-delete-btn"
                        icon={<Trash2 size={16} />}
                        title="Delete competition"
                        subtitle="Removes teams, games, scores — for everyone"
                        onClick={() => openDanger("delete")}
                      />
                    </Section>
                  )}
                </>
              )}

              {/* ── Competition details ───────────────────────────── */}
              {view === "details" && (
                <>
                  <FieldLabel>
                    Competition name{" "}
                    <span className="font-normal normal-case">required</span>
                  </FieldLabel>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (detailsError) setDetailsError(null);
                    }}
                    onBlur={commitName}
                    readOnly={!canEdit}
                    placeholder="e.g. BBMI 2026, The Yert Open"
                    maxLength={200}
                    style={{ ...fieldStyle, opacity: canEdit ? 1 : 0.7 }}
                    data-testid="comp-settings-name"
                  />
                  <div className="h-3.5" />

                  <FieldLabel>
                    Short name{" "}
                    <span className="font-normal normal-case">
                      shown in the bottom navigation bar
                    </span>
                  </FieldLabel>
                  <input
                    value={shortName}
                    onChange={(e) => {
                      setShortName(e.target.value);
                      if (detailsError) setDetailsError(null);
                    }}
                    onBlur={commitShortName}
                    readOnly={!canEdit}
                    placeholder="e.g. BBMI — keep it short to fit the nav tab"
                    maxLength={40}
                    style={{ ...fieldStyle, opacity: canEdit ? 1 : 0.7 }}
                    data-testid="comp-settings-short-name"
                  />
                  <p
                    className="mt-1.5 text-xs leading-snug"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    The full name won&apos;t fit the &ldquo;Live&rdquo; tab — set a
                    short label here. Leave blank to fall back to the full name.
                  </p>
                  <div className="h-3.5" />

                  <FieldLabel>
                    Tagline <span className="font-normal normal-case">optional</span>
                  </FieldLabel>
                  <input
                    value={tagline}
                    onChange={(e) => {
                      setTagline(e.target.value);
                      if (detailsError) setDetailsError(null);
                    }}
                    onBlur={commitTagline}
                    readOnly={!canEdit}
                    placeholder="e.g. May the best team win"
                    maxLength={500}
                    style={{ ...fieldStyle, opacity: canEdit ? 1 : 0.7 }}
                    data-testid="comp-settings-tagline"
                  />

                  {detailsError && (
                    <p
                      className="mt-3 text-xs"
                      style={{ color: "var(--color-bt-danger)" }}
                    >
                      {detailsError}
                    </p>
                  )}
                </>
              )}

              {/* ── Scoring model (frozen, read-only) ─────────────── */}
              {view === "scoring" && (
                <>
                  <div
                    className="rounded-xl p-4"
                    style={{
                      background: "var(--color-bt-card)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                    data-testid="comp-scoring-model-row"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: "var(--color-bt-accent-faint)",
                          color: "var(--color-bt-accent)",
                        }}
                      >
                        {modelCfg.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: "var(--color-bt-text)" }}
                        >
                          {modelCfg.label}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          {modelCfg.shape}
                        </p>
                      </div>
                      <Lock
                        size={14}
                        style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                        aria-label={
                          scored ? "Locked — scoring started" : "Set at creation"
                        }
                      />
                    </div>
                  </div>
                  <p
                    className="mt-3 px-1 text-xs leading-snug"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    The scoring model is chosen when the competition is created and
                    can&apos;t be changed. To use a different shape, delete and
                    restart the competition.
                  </p>
                </>
              )}

              {/* ── Danger confirm screens ────────────────────────── */}
              {view === "reset-scoring" && (
                <ConfirmScreen
                  tone="warning"
                  icon={<RotateCcw size={22} />}
                  title="Reset all scoring?"
                  body="Clears all scores. Teams, games, and setup stay — every game is ready to re-score."
                  confirmLabel="Reset scoring"
                  pendingLabel="Resetting…"
                  pending={resetScoring.isPending}
                  error={dangerError}
                  testId="comp-reset-scoring-confirm"
                  onConfirm={() =>
                    resetScoring.mutate({ tripId, competitionId: competition.id })
                  }
                  onCancel={back}
                />
              )}
              {view === "reset-skeleton" && (
                <ConfirmScreen
                  tone="warning"
                  icon={<Eraser size={22} />}
                  title="Reset all games to skeleton?"
                  body="Resets every game to unconfigured. Teams stay; all pairings, courses, handicaps, and scores are cleared — each game needs setting up again."
                  confirmLabel="Reset to skeleton"
                  pendingLabel="Resetting…"
                  pending={resetToSkeleton.isPending}
                  error={dangerError}
                  testId="comp-reset-skeleton-confirm"
                  onConfirm={() =>
                    resetToSkeleton.mutate({ tripId, competitionId: competition.id })
                  }
                  onCancel={back}
                />
              )}
              {view === "delete" && (
                <ConfirmScreen
                  tone="danger"
                  icon={<Trash2 size={22} />}
                  title={`Delete “${competition.name}”?`}
                  body={`This removes the competition, its teams, and rosters${describeRemoved(
                    teamsCount,
                  )}.${describeDeleteGames(gamesCount)} This cannot be undone.`}
                  confirmLabel="Delete competition"
                  pendingLabel="Deleting…"
                  pending={deleteComp.isPending}
                  error={dangerError}
                  testId="competition-delete-confirm"
                  onConfirm={() =>
                    deleteComp.mutate({ tripId, competitionId: competition.id })
                  }
                  onCancel={back}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

// ── Scoring-started explainer (top-of-menu, mirrors the game lock banner) ─────

function ScoringStartedNote() {
  return (
    <p
      className="mb-4 flex items-start gap-2 rounded-xl px-3.5 py-3 text-[12px] leading-snug"
      style={{
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text-dim)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="comp-scoring-started-note"
    >
      <Lock
        size={14}
        style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }}
      />
      <span>
        Scoring has started — the competition shape and teams are locked. You can
        still rename it, and the reset / delete hatches stay available below.
      </span>
    </p>
  );
}

function SaveStatus({ pending, savedAt }: { pending: boolean; savedAt: number }) {
  if (pending) {
    return (
      <span
        className="flex-shrink-0 text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
        data-testid="comp-save-status"
      >
        Saving…
      </span>
    );
  }
  if (savedAt > 0) {
    return (
      <span
        className="flex-shrink-0 text-[11px]"
        style={{ color: "var(--color-bt-accent)" }}
        data-testid="comp-save-status"
      >
        Saved
      </span>
    );
  }
  return null;
}

// ── Confirm screen (reset scoring / reset skeleton / delete) ──────────────────

function ConfirmScreen({
  tone,
  icon,
  title,
  body,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  testId,
  onConfirm,
  onCancel,
}: {
  tone: "warning" | "danger";
  icon: ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  testId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const accent =
    tone === "danger" ? "var(--color-bt-danger)" : "var(--color-bt-warning)";
  const accentFaint =
    tone === "danger"
      ? "var(--color-bt-danger-faint)"
      : "var(--color-bt-warning-faint)";

  return (
    <>
      <div
        className="mx-auto mb-3.5 mt-1 flex h-12 w-12 items-center justify-center rounded-[13px]"
        style={{ background: accentFaint, color: accent }}
      >
        {icon}
      </div>
      <p
        className="text-center text-base font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {title}
      </p>
      <p
        className="mb-[18px] mt-[7px] text-center text-[13px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {body}
      </p>
      {error && (
        <p
          className="mb-2 text-center text-xs"
          style={{ color: "var(--color-bt-danger)" }}
        >
          {error}
        </p>
      )}
      <button
        data-testid={testId}
        disabled={pending}
        onClick={onConfirm}
        className="mb-2 w-full rounded-[10px] py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
        style={{ background: accent }}
      >
        {pending ? pendingLabel : confirmLabel}
      </button>
      <GhostButton onClick={onCancel}>Cancel</GhostButton>
    </>
  );
}

// ── Small presentational helpers (mirror TripSettingsModal) ───────────────────

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-bt-card-raised)",
  border: "1px solid var(--color-bt-border)",
  borderRadius: 10,
  padding: "11px 13px",
  fontSize: 14,
  color: "var(--color-bt-text)",
  outline: "none",
};

function Section({
  label,
  danger,
  children,
}: {
  label: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p
        className="mb-2 px-0.5 text-[10px] font-bold uppercase"
        style={{
          letterSpacing: "0.09em",
          color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)",
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onClick,
  tone,
  testId,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  /** Colors the icon-square + title. Omit for the neutral accent style. */
  tone?: "warning" | "danger";
  testId?: string;
}) {
  const color =
    tone === "danger"
      ? "var(--color-bt-danger)"
      : tone === "warning"
        ? "var(--color-bt-warning)"
        : "var(--color-bt-accent)";
  const faint =
    tone === "danger"
      ? "var(--color-bt-danger-faint)"
      : tone === "warning"
        ? "var(--color-bt-warning-faint)"
        : "var(--color-bt-accent-faint)";
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-3 rounded-[11px] px-3 py-3 text-left transition-colors last:mb-0 hover:bg-[var(--color-bt-hover)]"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <span
        className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
        style={{ background: faint, color }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-sm font-semibold"
          style={{ color: tone ? color : "var(--color-bt-text)" }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            className="mt-0.5 block truncate text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {subtitle}
          </span>
        )}
      </span>
      <ChevronRight
        size={17}
        className="flex-shrink-0"
        style={{ color: "var(--color-bt-text-dim)" }}
      />
    </button>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-1.5 text-[10px] font-bold uppercase"
      style={{ letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </p>
  );
}

function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] py-2.5 text-[13.5px] font-semibold"
      style={{
        background: "transparent",
        border: "1px solid var(--color-bt-border)",
        color: "var(--color-bt-text)",
      }}
    >
      {children}
    </button>
  );
}

// ── Delete-confirm copy helpers ───────────────────────────────────────────────

/** The removed cascade: team rosters (assignments). */
function describeRemoved(assignments: number): string {
  if (assignments <= 0) return "";
  return ` (${assignments} assignment${assignments === 1 ? "" : "s"})`;
}

/** Games are DELETED with the competition (Phase 1 default), not detached — their
 *  scores/results go too. N=0 → skip the clause (no games to name). */
function describeDeleteGames(games: number): string {
  if (games <= 0) return "";
  return ` Its ${games} game${
    games === 1 ? "" : "s"
  } — and all their scores and results — are permanently deleted.`;
}
