"use client";

import { useMemo, useState } from "react";
import { Flag, Plus, Pencil, Star, Trash2, X, Trophy, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * CompetitionGamesPanel — the Slice D1 §7 contest list + creation flow, on
 * `games` (the legacy `events`-table EventsPanel is retired by this slice).
 *
 * A competition contest is a `games` row. Phase 1 (this panel): name, format
 * (game_type), points distribution, status — fully valid with every Phase-2 field
 * (course / scorecard / pairings) null. The two-screen fork (Save & close vs
 * Save & configure ›) persists the shell; the configure deep-link is a follow-on
 * once a per-game config page exists (shell-only for now, by decision).
 */

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

export interface GameRow {
  id: string;
  competition_id: string | null;
  game_type_id: string | null;
  name: string | null;
  status: "pending" | "active" | "complete" | "dropped";
  points_distribution: number[] | null;
  scorecard_schema: unknown | null;
  schedule_item_id: string | null;
}

interface GameType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isEngine: boolean;
  isGolf: boolean;
}

export function CompetitionGamesPanel({ competitionId, tripId, canEdit }: Props) {
  const [editing, setEditing] = useState<GameRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: allGames = [] } = trpc.games.listByTrip.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  const { data: types = [] } = trpc.games.listTypes.useQuery(undefined, { enabled: !!tripId });

  const games = useMemo(
    () => (allGames as GameRow[]).filter((g) => g.competition_id === competitionId),
    [allGames, competitionId]
  );
  const typesTyped = types as GameType[];
  const typeName = (id: string | null) => typesTyped.find((t) => t.id === id)?.name ?? "Game";

  const live = games.filter((g) => g.status !== "dropped");
  const statusText = `${live.length} game${live.length === 1 ? "" : "s"}${
    games.length - live.length > 0 ? ` · ${games.length - live.length} abandoned` : ""
  }`;

  return (
    <div
      data-testid="competition-games-panel"
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span style={{ color: live.length > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }} aria-hidden>
            <Trophy size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Games
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {statusText}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            <Plus size={12} />
            Game
          </button>
        )}
      </div>

      <div className="px-4 pb-4 pt-3" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
        {games.length === 0 && (
          <div className="px-2 py-6 text-center">
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              No games yet.
              {canEdit
                ? " Tap + Game to add the rounds and contests you'll compete in — points and order show on the leaderboard before anything is played."
                : " Check back once the organizer adds rounds and contests."}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {games.map((g) => (
            <GameCard key={g.id} game={g} typeName={typeName(g.game_type_id)} canEdit={canEdit} onEdit={() => setEditing(g)} />
          ))}
        </div>

        {(creating || editing) && (
          <GameSheet
            tripId={tripId}
            competitionId={competitionId}
            game={editing}
            types={typesTyped}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function GameCard({
  game,
  typeName,
  canEdit,
  onEdit,
}: {
  game: GameRow;
  typeName: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const dropped = game.status === "dropped";
  const dist = game.points_distribution ?? [];
  const total = dist.reduce((a, b) => a + b, 0);
  const distSummary = dist.length > 0 ? dist.map((p, i) => `${ordinalShort(i + 1)}: ${p}`).join(" · ") : null;

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3 py-3"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        opacity: dropped ? 0.55 : 1,
      }}
      data-testid={`game-card-${game.id}`}
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
      >
        {game.scorecard_schema ? <Flag size={15} /> : <Star size={15} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {game.name || "Untitled game"}
          </p>
          {!dropped && total > 0 && (
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--color-bt-accent)" }}>
              {total} pt{total === 1 ? "" : "s"}
            </span>
          )}
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
          >
            {typeName}
          </span>
          {dropped && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
            >
              Abandoned
            </span>
          )}
        </div>
        {distSummary && !dropped && (
          <p className="mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
            {distSummary}
          </p>
        )}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${game.name ?? "game"}`}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}

// ── GameSheet (create / edit) ─────────────────────────────────────────────────

function GameSheet({
  tripId,
  competitionId,
  game,
  types,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow | null;
  types: GameType[];
  onClose: () => void;
}) {
  const isEdit = !!game;
  const utils = trpc.useUtils();

  // Golf = engine golf types; Other = the non-engine manual type. Data-driven.
  const golfTypes = types.filter((t) => t.isGolf);
  const otherTypes = types.filter((t) => !t.isGolf);
  const initialType = types.find((t) => t.id === game?.game_type_id);
  const [isGolf, setIsGolf] = useState(initialType ? initialType.isGolf : true);
  const [gameTypeId, setGameTypeId] = useState<string>(
    game?.game_type_id ?? golfTypes[0]?.id ?? otherTypes[0]?.id ?? ""
  );
  const [title, setTitle] = useState(game?.name ?? "");
  const [points, setPoints] = useState<number[]>(() => {
    const d = game?.points_distribution;
    return d && d.length > 0 ? [...d] : [0];
  });
  const [error, setError] = useState<string | null>(null);

  const visibleTypes = isGolf ? golfTypes : otherTypes;
  // Keep a valid selection when toggling Golf/Other.
  const effectiveTypeId = visibleTypes.some((t) => t.id === gameTypeId) ? gameTypeId : visibleTypes[0]?.id ?? "";

  const create = trpc.games.create.useMutation();
  const update = trpc.games.update.useMutation();
  const setDist = trpc.games.setPointsDistribution.useMutation();
  const setStatus = trpc.games.setStatus.useMutation();

  const total = points.reduce((a, b) => a + (b || 0), 0);

  async function persist(): Promise<boolean> {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return false;
    }
    if (!effectiveTypeId) {
      setError("Pick a format");
      return false;
    }
    const distribution = points.filter((p) => p > 0).length > 0 ? points.map((p) => p || 0) : null;
    try {
      if (isEdit && game) {
        await update.mutateAsync({ tripId, gameId: game.id, name: title.trim() });
        await setDist.mutateAsync({ tripId, gameId: game.id, distribution });
      } else {
        const created = (await create.mutateAsync({
          tripId,
          gameTypeId: effectiveTypeId,
          name: title.trim(),
          competitionId,
          pointsDistribution: distribution,
        })) as { id: string };
        // create takes the distribution inline; nothing more to write.
        void created;
      }
      utils.games.listByTrip.invalidate({ tripId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save game");
      return false;
    }
  }

  async function handleSaveClose() {
    if (await persist()) onClose();
  }
  // Shell-only for now: configure deep-link is a follow-on (no per-game config
  // page yet). Persists the shell exactly like Save & close.
  async function handleSaveConfigure() {
    if (await persist()) onClose();
  }

  async function handleDrop() {
    if (!game) return;
    await setStatus.mutateAsync({ tripId, gameId: game.id, status: game.status === "dropped" ? "pending" : "dropped" });
    utils.games.listByTrip.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    onClose();
  }

  const busy = create.isPending || update.isPending || setDist.isPending;
  const isDropped = game?.status === "dropped";

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
            <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              {isEdit ? "Edit Game" : "Add Game"}
            </h3>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {!isEdit && (
              <div className="grid grid-cols-2 gap-2">
                <TypeChip active={isGolf} onClick={() => setIsGolf(true)} icon={<Flag size={18} />} label="Golf" />
                <TypeChip active={!isGolf} onClick={() => setIsGolf(false)} icon={<Star size={18} />} label="Other" />
              </div>
            )}

            {!isEdit && (
              <Field label="Format" required>
                <div className="flex flex-wrap gap-1.5">
                  {visibleTypes.map((t) => (
                    <Chip key={t.id} active={effectiveTypeId === t.id} onClick={() => setGameTypeId(t.id)}>
                      {t.name}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Title" required>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isGolf ? "e.g. Day 1 Scramble" : "e.g. Poker Night, Cornhole"}
                maxLength={200}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
              />
            </Field>

            <Field label="Points Distribution">
              <div className="space-y-2">
                {points.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-16 flex-shrink-0 text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
                      {ordinalShort(i + 1)} place
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={p || ""}
                      onChange={(e) => {
                        const next = [...points];
                        next[i] = parseFloat(e.target.value) || 0;
                        setPoints(next);
                      }}
                      placeholder="0"
                      className="w-20 rounded-lg px-2 py-1.5 text-sm outline-none"
                      style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
                    />
                    <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>pts</span>
                    <button
                      type="button"
                      onClick={() => setPoints(points.filter((_, j) => j !== i))}
                      aria-label={`Remove ${ordinalShort(i + 1)} place`}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded-md"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {(points.length === 0 || (points[points.length - 1] ?? 0) > 0) && (
                  <button
                    type="button"
                    onClick={() => setPoints([...points, 0])}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                    style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
                  >
                    <Plus size={12} style={{ color: "var(--color-bt-accent)" }} />
                    Add {ordinalShort(points.length + 1)} place
                  </button>
                )}
                {points.length > 0 && (
                  <div className="mt-1 flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                      Total available
                    </span>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: total > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                    >
                      {total} pt{total === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
              </div>
            </Field>

            {error && (
              <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
            {isEdit && game && (
              <button
                type="button"
                onClick={handleDrop}
                disabled={setStatus.isPending}
                aria-label={isDropped ? "Restore game" : "Drop game"}
                title={isDropped ? "Restore" : "Drop (abandon)"}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: "transparent", color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-border)" }}
              >
                {isDropped ? <RotateCcw size={15} /> : <Trash2 size={15} />}
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveClose}
              disabled={busy}
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            >
              Save &amp; close
            </button>
            <button
              type="button"
              onClick={handleSaveConfigure}
              disabled={busy}
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Save &amp; configure ›
            </button>
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────────

function TypeChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-semibold"
      style={
        active
          ? { background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1.5px solid var(--color-bt-accent-border)" }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? { background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }
      }
    >
      {children}
    </button>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          {label}
        </label>
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
