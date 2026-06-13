"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Flag, Plus, Minus, Pencil, Star, Trash2, X, Trophy, RotateCcw,
  Spade, Target, Beer, Dices, Swords, Radio, ChevronRight, Check, Users, Info, SlidersHorizontal,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import {
  validatePlacement, matchReadout, placementFit, matchFit, type MatchFormat,
} from "@/lib/gameConfig";

/**
 * CompetitionGamesPanel — the Slice D contest list + the two-tab add/edit page
 * (Game · Configuration), on `games`.
 *
 * Game tab (owner-controlled): Type → format → name → course (golf) → the
 * owner-set point value (a placement TOTAL, or a match per-match value), set with
 * an integrated stepper. Non-golf types offer a single "Generic <Type> Game".
 *
 * Configuration tab (the hub returned to via the dashboard tap-through):
 * a single role-aware delegate at the top; a MODEL-AWARE point editor (placement
 * → place splits that must SUM to the owner total; match → a derived readout);
 * the rules-of-the-day explainer; and the "How's it played?" format chooser. A
 * single save persists both tabs (and reconciles the delegate grant).
 */

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

/** Drag payload key for a game id — read by the agenda drop targets. */
export const DND_GAME_KEY = "application/x-buddytrip-game-id";

export interface GameRow {
  id: string;
  competition_id: string | null;
  game_type_id: string | null;
  name: string | null;
  status: "pending" | "active" | "complete" | "dropped";
  points_distribution: PointsDistribution | null;
  points_total: number | null;
  competition_format: string | null;
  rules_for_today: string | null;
  scorecard_schema: unknown | null;
  course_id: string | null;
  schedule_item_id: string | null;
}

interface GameType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isEngine: boolean;
  isGolf: boolean;
  resultStrategy: string | null;
  category: string;
}

interface Member { memberId: string; displayName: string }

// ── Static option tables ──────────────────────────────────────────────────────

const CATEGORY_ORDER = ["golf", "card", "yard", "bar", "other"] as const;
const CATEGORY_META: Record<string, { label: string; Icon: typeof Flag }> = {
  golf: { label: "Golf", Icon: Flag },
  card: { label: "Card", Icon: Spade },
  yard: { label: "Yard", Icon: Target },
  bar: { label: "Bar", Icon: Beer },
  other: { label: "Other", Icon: Dices },
};

const COMP_FORMATS = [
  { key: "head_to_head", label: "Head-to-Head / Match", desc: "One-off matchup, winner takes the points.", Icon: Swords },
  { key: "bracket_se", label: "Bracket — Single Elimination", desc: "Lose once, you're out.", Icon: Trophy },
  { key: "bracket_de", label: "Bracket — Double Elimination", desc: "Two lives — a losers' bracket.", Icon: Trophy },
  { key: "best_of_n", label: "Best of N", desc: "First to win the majority of games.", Icon: Target },
  { key: "live_results", label: "Live Results", desc: "A running tally that updates as it plays (e.g. Pick'em).", Icon: Radio },
] as const;

function formatLabel(key: string | null): string | null {
  return COMP_FORMATS.find((f) => f.key === key)?.label ?? null;
}

/** Singles vs doubles for the match readout. Only singles exists today. */
function matchFormatFor(gameTypeId: string | null): MatchFormat {
  return gameTypeId === "gtt_match_play_doubles" ? "doubles" : "singles";
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CompetitionGamesPanel({ competitionId, tripId, canEdit }: Props) {
  const [editing, setEditing] = useState<GameRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: allGames = [] } = trpc.games.listByTrip.useQuery({ tripId }, { enabled: !!tripId });
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
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>Games</p>
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{statusText}</p>
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="add-game"
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
            <GameCard
              key={g.id}
              game={g}
              typeName={typeName(g.game_type_id)}
              canEdit={canEdit}
              onEdit={() => setEditing(g)}
            />
          ))}
        </div>

        {(creating || editing) && (
          <GameSheet
            tripId={tripId}
            competitionId={competitionId}
            game={editing}
            types={typesTyped}
            canEdit={canEdit}
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

// ── Game card (model-aware metadata) ──────────────────────────────────────────

function GameCard({
  game, typeName, canEdit, onEdit,
}: {
  game: GameRow; typeName: string; canEdit: boolean; onEdit: () => void;
}) {
  const dropped = game.status === "dropped";
  const dist = game.points_distribution;

  let pointsLine: string | null = null;
  if (dist?.type === "placement") {
    const total = game.points_total ?? dist.values.reduce((a, b) => a + b, 0);
    pointsLine = dist.values.length > 0 ? `${fmtValue(total)} · ${dist.values.map(fmtValue).join("│")}` : `${fmtValue(total)} · needs split`;
  } else if (dist?.type === "per_match") {
    pointsLine = `${fmtValue(dist.value)}/match`;
  } else if (game.points_total != null) {
    pointsLine = `${fmtValue(game.points_total)} · needs split`;
  }
  const fmtLabel = formatLabel(game.competition_format);

  return (
    <button
      type="button"
      onClick={canEdit ? onEdit : undefined}
      disabled={!canEdit}
      className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left disabled:cursor-default"
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
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {fmtLabel && <span>{fmtLabel}</span>}
          {fmtLabel && pointsLine && <span aria-hidden>·</span>}
          {pointsLine && <span className="tabular-nums">{pointsLine}</span>}
        </div>
      </div>

      {canEdit && <Pencil size={13} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />}
    </button>
  );
}

// ── Two-tab Game sheet ────────────────────────────────────────────────────────

type Tab = "game" | "config";

function GameSheet({
  tripId, competitionId, game, types, canEdit, onClose,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow | null;
  types: GameType[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const isEdit = !!game;
  const utils = trpc.useUtils();

  const initialType = types.find((t) => t.id === game?.game_type_id);
  const [category, setCategory] = useState<string>(initialType?.category ?? "golf");
  const [gameTypeId, setGameTypeId] = useState<string>(
    game?.game_type_id ?? types.find((t) => t.category === "golf")?.id ?? types[0]?.id ?? ""
  );
  const [title, setTitle] = useState(game?.name ?? "");
  const [tab, setTab] = useState<Tab>("game");

  // Owner total (placement) / per-match value (match) — integer steppers, so
  // there's always a concrete value (defaults: 8 placement, 1 per match).
  const [total, setTotal] = useState<number>(game?.points_total ?? 8);
  const [perMatchValue, setPerMatchValue] = useState<number>(() => {
    const d = game?.points_distribution;
    return d?.type === "per_match" ? d.value : 1;
  });
  // Placement split. 1st place initializes EMPTY (never 0) so "untouched" stays
  // distinct from "entered 0".
  const [placeInputs, setPlaceInputs] = useState<string[]>(() => {
    const d = game?.points_distribution;
    if (d?.type === "placement" && d.values.length > 0) return d.values.map(String);
    return [""];
  });
  const [compFormat, setCompFormat] = useState<string | null>(game?.competition_format ?? null);
  const [rules, setRules] = useState<string>(game?.rules_for_today ?? "");
  // Single delegate. undefined = not-yet-initialized from the existing grant.
  const [delegateId, setDelegateId] = useState<string | null | undefined>(game ? undefined : null);
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesPresent = CATEGORY_ORDER.filter((c) => types.some((t) => t.category === c));
  const categoryTypes = types.filter((t) => t.category === category);
  const effectiveTypeId = categoryTypes.some((t) => t.id === gameTypeId) ? gameTypeId : categoryTypes[0]?.id ?? "";
  const selectedType = types.find((t) => t.id === effectiveTypeId);
  const isMatchPlay = selectedType?.resultStrategy === "match_play";
  const isGolf = category === "golf";

  // Members (for the delegate picker + name resolution) and the existing grant.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, { enabled: canEdit });
  const orgQuery = trpc.games.listOrganizers.useQuery(
    { tripId, gameId: game?.id ?? "" },
    { enabled: !!game?.id }
  );
  const originalOrgId = ((orgQuery.data as { user_id: string }[] | undefined)?.[0]?.user_id) ?? null;
  useEffect(() => {
    if (game && delegateId === undefined && orgQuery.isSuccess) setDelegateId(originalOrgId);
  }, [game, delegateId, orgQuery.isSuccess, originalOrgId]);
  const desiredDelegate = delegateId === undefined ? originalOrgId : delegateId;

  const { data: teamCounts } = trpc.competitions.teamAssignmentCounts.useQuery({ tripId, competitionId });
  const teamSizes = useMemo(() => Object.values((teamCounts as Record<string, number>) ?? {}), [teamCounts]);
  const numTeams = teamSizes.length;

  const create = trpc.games.create.useMutation();
  const update = trpc.games.update.useMutation();
  const setDist = trpc.games.setPointsDistribution.useMutation();
  const setTotalM = trpc.games.setPointsTotal.useMutation();
  const setStatus = trpc.games.setStatus.useMutation();
  const addOrg = trpc.games.addOrganizer.useMutation();
  const removeOrg = trpc.games.removeOrganizer.useMutation();

  // Derived validation (the same pure fn the server uses).
  const started = !isMatchPlay && (placeInputs[0]?.trim() ?? "") !== "";
  const enteredValues = started ? placeInputs.map((s) => Number(s.trim() || "0")) : [];
  const placement = validatePlacement(total, enteredValues);
  const pFit = placementFit(enteredValues, numTeams);
  const mFit = matchFit(teamSizes, matchFormatFor(effectiveTypeId));
  const readout = matchReadout(perMatchValue, teamSizes, matchFormatFor(effectiveTypeId));
  const blockedPartial = started && !placement.saveable;

  // Clear a submit error as soon as the user changes anything relevant.
  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, total, perMatchValue, placeInputs, compFormat, effectiveTypeId, rules]);

  function buildDistribution(): PointsDistribution | null {
    if (isMatchPlay) return { type: "per_match", value: perMatchValue > 0 ? perMatchValue : 1 };
    return started ? { type: "placement", values: enteredValues } : null;
  }

  async function reconcileDelegate(gameId: string) {
    const original = isEdit ? originalOrgId : null;
    if (desiredDelegate === original) return;
    if (original) await removeOrg.mutateAsync({ tripId, gameId, userId: original });
    if (desiredDelegate) await addOrg.mutateAsync({ tripId, gameId, userId: desiredDelegate });
  }

  async function persist(): Promise<boolean> {
    setError(null);
    if (canEdit && !title.trim()) { setError("Add a title to save this game"); setTab("game"); return false; }
    if (!effectiveTypeId) { setError("Pick a format"); setTab("game"); return false; }
    if (blockedPartial) { setTab("config"); return false; } // button is disabled too
    const distribution = buildDistribution();
    try {
      let gameId: string;
      if (isEdit && game) {
        gameId = game.id;
        if (canEdit) {
          await update.mutateAsync({ tripId, gameId, name: title.trim(), competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null });
          await setTotalM.mutateAsync({ tripId, gameId, total: isMatchPlay ? null : total });
        } else {
          await update.mutateAsync({ tripId, gameId, competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null });
        }
        await setDist.mutateAsync({ tripId, gameId, distribution });
      } else {
        const created = (await create.mutateAsync({
          tripId, gameTypeId: effectiveTypeId, name: title.trim(), competitionId,
          pointsDistribution: distribution, pointsTotal: isMatchPlay ? null : total,
        })) as { id: string };
        gameId = created.id;
        if (compFormat || rules.trim()) {
          await update.mutateAsync({ tripId, gameId, competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null });
        }
      }
      if (canEdit) await reconcileDelegate(gameId);
      utils.games.listByTrip.invalidate({ tripId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save game");
      return false;
    }
  }

  async function handleSave() {
    if (await persist()) onClose();
  }

  async function handleDrop() {
    if (!game) return;
    await setStatus.mutateAsync({ tripId, gameId: game.id, status: game.status === "dropped" ? "pending" : "dropped" });
    utils.games.listByTrip.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    onClose();
  }

  const busy = create.isPending || update.isPending || setDist.isPending || setTotalM.isPending;
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
          <div style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
                {isEdit ? "Edit Game" : "Add Game"}
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
                <X size={16} />
              </button>
            </div>
            <div className="flex px-4">
              <TabButton active={tab === "game"} onClick={() => setTab("game")}>Game</TabButton>
              <TabButton active={tab === "config"} onClick={() => setTab("config")}>Configuration</TabButton>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {tab === "game" ? (
              <GameTab
                isEdit={isEdit}
                canEdit={canEdit}
                categoriesPresent={categoriesPresent}
                category={category}
                setCategory={(c) => { setCategory(c); const first = types.find((t) => t.category === c); if (first) setGameTypeId(first.id); }}
                categoryTypes={categoryTypes}
                effectiveTypeId={effectiveTypeId}
                setGameTypeId={setGameTypeId}
                selectedType={selectedType}
                title={title}
                setTitle={setTitle}
                isGolf={isGolf}
                courseId={game?.course_id ?? null}
                isMatchPlay={isMatchPlay}
                total={total}
                setTotal={setTotal}
                perMatchValue={perMatchValue}
                setPerMatchValue={setPerMatchValue}
                readout={readout}
              />
            ) : (
              <ConfigTab
                canEdit={canEdit}
                members={members as Member[]}
                delegateId={desiredDelegate}
                setDelegateId={setDelegateId}
                isMatchPlay={isMatchPlay}
                isGolf={isGolf}
                courseId={game?.course_id ?? null}
                total={total}
                placeInputs={placeInputs}
                setPlaceInputs={setPlaceInputs}
                placement={placement}
                pFit={pFit}
                mFit={mFit}
                readout={readout}
                perMatchValue={perMatchValue}
                rules={rules}
                setRules={setRules}
                compFormat={compFormat}
                openFormatSheet={() => setFormatSheetOpen(true)}
              />
            )}

            {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
          </div>

          <div className="flex items-center gap-2 border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
            {isEdit && game && canEdit && (
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
            {tab === "game" && (
              <button
                type="button"
                onClick={() => setTab("config")}
                className="flex-1 rounded-xl py-3 text-sm font-semibold"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
              >
                Configuration ›
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || blockedPartial}
              data-testid="save-game"
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              {isEdit ? "Save game" : "Add game"}
            </button>
          </div>
        </div>
      </div>

      {formatSheetOpen && (
        <FormatSheet
          current={compFormat}
          onPick={(k) => { setCompFormat(k); setFormatSheetOpen(false); }}
          onClose={() => setFormatSheetOpen(false)}
        />
      )}
    </ScrollLock>
  );
}

// ── Game tab ──────────────────────────────────────────────────────────────────

function GameTab({
  isEdit, canEdit, categoriesPresent, category, setCategory, categoryTypes, effectiveTypeId,
  setGameTypeId, selectedType, title, setTitle, isGolf, courseId, isMatchPlay,
  total, setTotal, perMatchValue, setPerMatchValue, readout,
}: {
  isEdit: boolean; canEdit: boolean; categoriesPresent: readonly string[]; category: string;
  setCategory: (c: string) => void; categoryTypes: GameType[]; effectiveTypeId: string;
  setGameTypeId: (id: string) => void; selectedType: GameType | undefined; title: string;
  setTitle: (s: string) => void; isGolf: boolean; courseId: string | null; isMatchPlay: boolean;
  total: number; setTotal: (n: number) => void; perMatchValue: number; setPerMatchValue: (n: number) => void;
  readout: ReturnType<typeof matchReadout>;
}) {
  const readOnly = !canEdit;
  return (
    <>
      {!isEdit && (
        <Field label="Type" required>
          <div className="grid grid-cols-5 gap-2">
            {categoriesPresent.map((c) => {
              const m = CATEGORY_META[c];
              return <TypeChip key={c} active={category === c} onClick={() => setCategory(c)} icon={<m.Icon size={18} />} label={m.label} />;
            })}
          </div>
        </Field>
      )}

      {!isEdit && (
        <Field label="Format" required>
          <div className="flex flex-wrap gap-1.5">
            {categoryTypes.map((t) => (
              <Chip key={t.id} active={effectiveTypeId === t.id} onClick={() => setGameTypeId(t.id)}>{t.name}</Chip>
            ))}
          </div>
          {selectedType && !selectedType.isEngine && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              No built-in scoring engine for this type yet — name it below and enter the result by hand.
            </p>
          )}
        </Field>
      )}

      <Field label="Title" required>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          readOnly={readOnly}
          placeholder={isGolf ? "e.g. Day 1 Scramble" : "e.g. Poker Night, Cornhole"}
          maxLength={200}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: readOnly ? 0.7 : 1 }}
        />
      </Field>

      {isGolf && (
        <Field label="Course">
          <div
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            style={{ background: "var(--color-bt-card-raised)", color: courseId ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
          >
            <span>{courseId ? "Course applied" : "No course yet"}</span>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            The golf course is optional, but required if you want to keep score.
          </p>
        </Field>
      )}

      {isMatchPlay ? (
        <PointStepper
          label="Points per match"
          caption="POINTS PER MATCH"
          value={perMatchValue}
          onChange={readOnly ? () => {} : setPerMatchValue}
          footer={<MatchReadoutLine readout={readout} />}
        />
      ) : (
        <PointStepper
          label="Point value"
          caption="POINTS FOR THIS GAME"
          value={total}
          onChange={readOnly ? () => {} : setTotal}
          footer={
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal size={12} style={{ color: "var(--color-bt-text-dim)" }} />
              <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Split across finishing places on the Configuration tab ›
              </span>
            </div>
          }
        />
      )}
    </>
  );
}

/** The integrated −/value/+ point control (matches the mock). */
function PointStepper({
  label, caption, value, onChange, footer,
}: {
  label: string; caption: string; value: number; onChange: (n: number) => void; footer?: React.ReactNode;
}) {
  return (
    <Field label={label} required>
      <div className="rounded-xl" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
        <div className="flex items-center gap-3 px-3 py-3">
          <StepBtn dir="dec" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} />
          <div className="flex-1 text-center">
            <div className="text-3xl font-black leading-none tabular-nums" style={{ color: "var(--color-bt-text)" }}>{fmtValue(value)}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{caption}</div>
          </div>
          <StepBtn dir="inc" onClick={() => onChange(value + 1)} />
        </div>
        {footer && (
          <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            {footer}
          </div>
        )}
      </div>
    </Field>
  );
}

function StepBtn({ dir, onClick, disabled }: { dir: "inc" | "dec"; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "inc" ? "Increase" : "Decrease"}
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg disabled:opacity-40"
      style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
    >
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

function MatchReadoutLine({ readout }: { readout: ReturnType<typeof matchReadout> }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Points available
      </span>
      <span className="text-sm font-bold tabular-nums" style={{ color: readout.available != null ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
        {readout.available != null ? `${fmtValue(readout.available)} · ${readout.label}` : readout.label}
      </span>
    </div>
  );
}

// ── Configuration tab ─────────────────────────────────────────────────────────

function ConfigTab({
  canEdit, members, delegateId, setDelegateId, isMatchPlay, isGolf, courseId, total, placeInputs, setPlaceInputs,
  placement, pFit, mFit, readout, perMatchValue, rules, setRules, compFormat, openFormatSheet,
}: {
  canEdit: boolean; members: Member[]; delegateId: string | null; setDelegateId: (id: string | null) => void;
  isMatchPlay: boolean; isGolf: boolean; courseId: string | null; total: number; placeInputs: string[]; setPlaceInputs: (v: string[]) => void;
  placement: ReturnType<typeof validatePlacement>; pFit: ReturnType<typeof placementFit>;
  mFit: ReturnType<typeof matchFit>; readout: ReturnType<typeof matchReadout>;
  perMatchValue: number; rules: string; setRules: (s: string) => void;
  compFormat: string | null; openFormatSheet: () => void;
}) {
  return (
    <>
      <DelegationBlock canEdit={canEdit} members={members} delegateId={delegateId} setDelegateId={setDelegateId} />

      {isMatchPlay ? (
        <Field label="Point value">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black tabular-nums" style={{ color: "var(--color-bt-text)" }}>{fmtValue(perMatchValue)}</span>
            <span className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>/ match · set on Game tab</span>
          </div>
          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            <MatchReadoutLine readout={readout} />
          </div>
        </Field>
      ) : (
        <PlacementEditor total={total} placeInputs={placeInputs} setPlaceInputs={setPlaceInputs} placement={placement} />
      )}

      {!isMatchPlay && pFit.state === "warn" && <FitWarning message={pFit.message!} />}
      {isMatchPlay && mFit.state === "warn" && <FitWarning message={mFit.message!} />}

      <Field label="Rules explainer">
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Tap out the rules of the day — formats, gimmes, mulligans, tiebreakers…"
          className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
        />
      </Field>

      <Field label="Competition format">
        <button
          type="button"
          onClick={openFormatSheet}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: compFormat ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
        >
          <span>{formatLabel(compFormat) ?? "How's it played?"}</span>
          <ChevronRight size={15} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Sets the label on the leaderboard. Running it up in-app comes later — until then you enter results by hand.
        </p>
      </Field>

      <MakeItReady canEdit={canEdit} isGolf={isGolf} isMatchPlay={isMatchPlay} courseId={courseId} />
    </>
  );
}

/**
 * MAKE IT READY — the day-of setup checklist (owner only). Stubbed: the rows show
 * the correct ready/not-set state but the deep setup (course picker, pairings,
 * handicaps) is wired in a follow-up — for now results are entered by hand. Rows
 * are model-aware: every game can group/pair; only golf/match carry a course and
 * handicaps.
 */
function MakeItReady({
  canEdit, isGolf, isMatchPlay, courseId,
}: {
  canEdit: boolean; isGolf: boolean; isMatchPlay: boolean; courseId: string | null;
}) {
  if (!canEdit) return null;
  const rows: { Icon: typeof Flag; label: string; state: string; ready: boolean }[] = [];
  if (isGolf) rows.push({ Icon: Flag, label: "Course", state: courseId ? "Applied" : "Not set", ready: !!courseId });
  rows.push({ Icon: Users, label: "Groups & pairings", state: "Not set", ready: false });
  if (isGolf || isMatchPlay) rows.push({ Icon: Target, label: "Handicaps", state: "Not set", ready: false });

  return (
    <Field label="Make it ready">
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
          >
            <span className="flex items-center gap-2" style={{ color: "var(--color-bt-text)" }}>
              <r.Icon size={14} style={{ color: "var(--color-bt-accent)" }} />
              {r.label}
            </span>
            <span className="text-[11px] font-semibold" style={{ color: r.ready ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
              {r.state}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Course, pairings and handicap setup lands in a follow-up — for now, enter results by hand.
      </p>
    </Field>
  );
}

function DelegationBlock({
  canEdit, members, delegateId, setDelegateId,
}: {
  canEdit: boolean; members: Member[]; delegateId: string | null; setDelegateId: (id: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);

  if (!canEdit) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl px-3 py-3" style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}>
        <Users size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-accent)" }}>You&rsquo;ve been asked to help set this up</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Configure away. The owner keeps the basics (name, course, value) on the Game tab.
          </p>
        </div>
      </div>
    );
  }

  const assigned = members.find((m) => m.memberId === delegateId);
  return (
    <Field label="Delegate">
      {assigned ? (
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
        >
          <span className="flex items-center gap-2"><Users size={14} style={{ color: "var(--color-bt-accent)" }} />{assigned.displayName}</span>
          <button type="button" onClick={() => { setDelegateId(null); setPicking(false); }} aria-label="Remove delegate" className="flex h-6 w-6 items-center justify-center rounded-md" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={13} />
          </button>
        </div>
      ) : !picking ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
        >
          <Users size={15} style={{ color: "var(--color-bt-accent)" }} />
          Assign a game organizer
        </button>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <button
              key={m.memberId}
              type="button"
              onClick={() => { setDelegateId(m.memberId); setPicking(false); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            >
              <span>{m.displayName}</span>
              <Plus size={13} style={{ color: "var(--color-bt-accent)" }} />
            </button>
          ))}
          {members.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>No crew to assign yet.</p>
          )}
        </div>
      )}
      <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Hand this game&rsquo;s setup and running to one person — they get their own Configuration tab.
      </p>
    </Field>
  );
}

function FitWarning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning)" }}>
      <span className="text-[11px] leading-relaxed" style={{ color: "var(--color-bt-warning)" }}>{message}</span>
    </div>
  );
}

// ── Placement editor (distributes the owner total) ────────────────────────────

function PlacementEditor({
  total, placeInputs, setPlaceInputs, placement,
}: {
  total: number; placeInputs: string[]; setPlaceInputs: (v: string[]) => void;
  placement: ReturnType<typeof validatePlacement>;
}) {
  const started = (placeInputs[0]?.trim() ?? "") !== "";
  return (
    <Field label="Point distribution">
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
        The owner set this game at <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>{fmtValue(total)} points</span>. Spread them across team places — the split must total {fmtValue(total)} exactly.
      </p>
      <div className="space-y-2">
        {placeInputs.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-16 flex-shrink-0 text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {ordinalShort(i + 1)} place
            </span>
            <input
              type="number" min={0} value={p}
              onChange={(e) => { const next = [...placeInputs]; next[i] = e.target.value; setPlaceInputs(next); }}
              className="w-20 rounded-lg px-2 py-1.5 text-sm outline-none"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            />
            <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>pts</span>
            {placeInputs.length > 1 && (
              <button
                type="button"
                onClick={() => setPlaceInputs(placeInputs.filter((_, j) => j !== i))}
                aria-label={`Remove ${ordinalShort(i + 1)} place`}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {started && (
          <button
            type="button"
            onClick={() => setPlaceInputs([...placeInputs, ""])}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
          >
            <Plus size={12} style={{ color: "var(--color-bt-accent)" }} />
            Add {ordinalShort(placeInputs.length + 1)} place
          </button>
        )}
        <div className="mt-1 flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Allocated
          </span>
          <span
            className="flex items-center gap-1 text-sm font-bold tabular-nums"
            style={{ color: !started ? "var(--color-bt-text-dim)" : placement.saveable ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}
          >
            {started && placement.saveable && <Check size={13} />}
            {fmtValue(placement.allocated)} of {fmtValue(total)} pts
          </span>
        </div>
        {!started && (
          <div className="flex items-start gap-1.5">
            <Info size={12} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              Points haven&rsquo;t been distributed yet — it can wait until later.
            </span>
          </div>
        )}
        {started && !placement.saveable && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-danger)" }}>
            {placement.remaining > 0
              ? `${fmtValue(placement.remaining)} point${placement.remaining === 1 ? "" : "s"} left to allocate`
              : `${fmtValue(-placement.remaining)} point${-placement.remaining === 1 ? "" : "s"} over — must total ${fmtValue(total)}`}
          </p>
        )}
      </div>
    </Field>
  );
}

// ── "How's it played?" format sheet ───────────────────────────────────────────

function FormatSheet({
  current, onPick, onClose,
}: {
  current: string | null; onPick: (k: string) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" style={{ background: "var(--color-bt-overlay)" }} onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>How&rsquo;s it played?</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {COMP_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onPick(f.key)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left"
              style={{
                background: current === f.key ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${current === f.key ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              <f.Icon size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{f.label}</span>
                  <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}>Manual</span>
                  {current === f.key && <Check size={13} style={{ color: "var(--color-bt-accent)", marginLeft: "auto" }} />}
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{f.desc}</p>
              </div>
            </button>
          ))}
          <p className="px-1 pt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            However it runs, you can always enter the result by hand — picking a format never leaves you stuck on &ldquo;coming soon.&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative px-3 py-2.5 text-sm font-semibold"
      style={{ color: active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: "var(--color-bt-accent)" }} />}
    </button>
  );
}

function TypeChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-semibold"
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
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{label}</label>
        {required && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bt-danger)" }} />}
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

/** Whole numbers as-is, halves as ½ (0.5 → "½", 1.5 → "1½"). */
function fmtValue(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
