"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Flag, Plus, Pencil, Star, Trash2, X, Trophy, RotateCcw,
  Spade, Target, Beer, Dices, Swords, Radio, ChevronRight, ChevronUp, ChevronDown, Check, Users, Info, SlidersHorizontal,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { ModifierCards } from "@/components/games/ModifierCards";
import { Stepper } from "@/components/games/Stepper";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import {
  validatePlacement, matchReadout, placementFit, matchFit, type MatchFormat,
} from "@/lib/gameConfig";
// Format definitions live in code (W-PERF-01) — the catalog + its type come from
// here, read synchronously, never fetched. Re-exported below so existing
// consumers (CompetitionFace, GameSetupRows) keep their `from "./CompetitionGamesPanel"`
// import path.
import { GAME_TYPES, gameTypesForScoringModel, type GameType, type ScoringModel } from "@/lib/gameTypes";

export type { GameType };

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
  /** Trip Owner — gates the RUN actions (post / correct) in this view. The
   *  server also admits a game-delegate, but their entry point is the per-game
   *  tap-through, not this owner/organizer panel. */
  isOwner?: boolean;
}

type RunState = "upcoming" | "open" | "posted" | "correcting";

function runState(g: GameRow): RunState {
  if (g.status === "complete") return g.corrections_open ? "correcting" : "posted";
  if (g.status === "active") return "open";
  return "upcoming";
}

export interface LBTeamLite { id: string; name: string; short_name: string; color: string }

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
  modifiers: Record<string, Record<string, unknown>> | null;
  scorecard_schema: unknown | null;
  course_id: string | null;
  /** The BACK nine of a retained two-nines 18 (W-9HOLE-01); null otherwise. */
  back_course_id: string | null;
  schedule_item_id: string | null;
  corrections_open: boolean;
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

export function formatLabel(key: string | null): string | null {
  return COMP_FORMATS.find((f) => f.key === key)?.label ?? null;
}

/** Singles vs doubles for the match readout. Only singles exists today. */
function matchFormatFor(gameTypeId: string | null): MatchFormat {
  return gameTypeId === "gtt_match_play_doubles" ? "doubles" : "singles";
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CompetitionGamesPanel({ competitionId, tripId, canEdit, isOwner = false }: Props) {
  const [editing, setEditing] = useState<GameRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<GameRow | null>(null); // game being posted/corrected

  const { data: allGames = [] } = trpc.games.listByTrip.useQuery({ tripId }, { enabled: !!tripId });
  const types = GAME_TYPES; // format definitions in code (W-PERF-01) — no fetch
  const { data: lb } = trpc.competitions.leaderboard.useQuery({ tripId, competitionId }, { enabled: !!competitionId });

  const games = useMemo(
    () => (allGames as GameRow[]).filter((g) => g.competition_id === competitionId),
    [allGames, competitionId]
  );
  const typesTyped = types as GameType[];
  const typeName = (id: string | null) => typesTyped.find((t) => t.id === id)?.name ?? "Game";

  const live = games.filter((g) => g.status !== "dropped");
  const postedCount = live.filter((g) => g.status === "complete").length;
  const teams = (lb?.teams ?? []) as LBTeamLite[];
  const pointsAvailable = lb?.pointsAvailable ?? 0;
  const onBoard = Object.values((lb?.teamTotals ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);

  // Seed the placement order for the run sheet: the posted finishing order (from
  // the leaderboard cells) when correcting, else the roster order.
  const runningOrder = useMemo(() => {
    if (!running) return [];
    const cells = ((lb?.cells ?? []) as { gameId: string; teamId: string; place: number }[])
      .filter((c) => c.gameId === running.id)
      .sort((a, b) => a.place - b.place);
    return cells.length ? cells.map((c) => c.teamId) : teams.map((t) => t.id);
  }, [running, lb, teams]);

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
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {postedCount} of {live.length} posted · {fmtValue(onBoard)} of {fmtValue(pointsAvailable)} pts on the board
            </p>
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
              isOwner={isOwner}
              onEdit={() => setEditing(g)}
              onRun={() => setRunning(g)}
            />
          ))}
        </div>

        {live.length > 0 && postedCount < live.length && (
          <p className="mt-3 text-center text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            When every game is posted, the cup has its winner.
          </p>
        )}

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

        {running && (
          <RunSheet
            tripId={tripId}
            competitionId={competitionId}
            game={running}
            teams={teams}
            initialOrder={runningOrder}
            isEngine={!!typesTyped.find((t) => t.id === running.game_type_id)?.isEngine}
            onClose={() => setRunning(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Game card (model-aware metadata) ──────────────────────────────────────────

function GameCard({
  game, typeName, canEdit, isOwner, onEdit, onRun,
}: {
  game: GameRow; typeName: string; canEdit: boolean; isOwner: boolean; onEdit: () => void; onRun: () => void;
}) {
  const dropped = game.status === "dropped";
  const state = runState(game);
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
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", opacity: dropped ? 0.55 : 1 }}
      data-testid={`game-card-${game.id}`}
    >
      <button
        type="button"
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="flex w-full items-start gap-3 px-3 py-3 text-left disabled:cursor-default"
      >
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
        >
          {game.scorecard_schema ? <Flag size={15} /> : <Star size={15} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {game.name || "Untitled game"}
            </p>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            >
              {typeName}
            </span>
            {dropped ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}>
                Abandoned
              </span>
            ) : (
              <RunStateBadge state={state} />
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

      {canEdit && !dropped && (
        // Posting/correcting is operational (owner-minus-destructive) — owner &
        // co-admins both run it. canEdit = owner OR co-admin.
        <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
          <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {state === "posted" ? "Points are on the board" : state === "correcting" ? "Correcting — re-post to update" : "Not posted yet"}
          </span>
          <RunButton state={state} onClick={onRun} />
        </div>
      )}
    </div>
  );
}

function RunStateBadge({ state }: { state: RunState }) {
  const map: Record<RunState, { label: string; bg: string; fg: string }> = {
    upcoming: { label: "Upcoming", bg: "var(--color-bt-card)", fg: "var(--color-bt-text-dim)" },
    open: { label: "Open", bg: "var(--color-bt-accent-faint)", fg: "var(--color-bt-accent)" },
    posted: { label: "Posted", bg: "var(--color-bt-accent-faint)", fg: "var(--color-bt-accent)" },
    correcting: { label: "Correcting", bg: "var(--color-bt-warning-faint)", fg: "var(--color-bt-warning)" },
  };
  const m = map[state];
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

function RunButton({ state, onClick }: { state: RunState; onClick: () => void }) {
  if (state === "posted") {
    return (
      <button type="button" onClick={onClick} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}>
        Correct
      </button>
    );
  }
  if (state === "correcting") {
    return (
      <button type="button" onClick={onClick} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--color-bt-warning)", color: "var(--color-bt-base)" }}>
        Re-post
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} data-testid={`post-${state}`} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}>
      Post
    </button>
  );
}

// ── Two-tab Game sheet ────────────────────────────────────────────────────────

type Tab = "game" | "config";

export function GameSheet({
  tripId, competitionId, game, types, canEdit, scoringModel, onClose,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow | null;
  types: GameType[];
  canEdit: boolean;
  /** The competition's scoring-model (W-TYPE-01) — the create picker offers only
   *  formats compatible with it. Omit/null → offer everything. */
  scoringModel?: ScoringModel | null;
  onClose: () => void;
}) {
  const isEdit = !!game;
  const utils = trpc.useUtils();

  // W-TYPE-01: the CREATE picker offers only formats whose scoring-model matches
  // the competition's (match_play → 1v1/2v2/rack + manual; points → Stroke +
  // manual). Lookups for an EXISTING game's type read the full catalog (`types`)
  // so editing never breaks even if a type weren't offerable.
  const offerable = gameTypesForScoringModel(scoringModel, types);
  const initialType = types.find((t) => t.id === game?.game_type_id);
  const [category, setCategory] = useState<string>(initialType?.category ?? "golf");
  const [gameTypeId, setGameTypeId] = useState<string>(
    game?.game_type_id ?? offerable.find((t) => t.category === "golf")?.id ?? offerable[0]?.id ?? ""
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
  // Enabled special rules (golf) — keyed by modifier, value = per-rule config.
  const [modifiers, setModifiers] = useState<Record<string, Record<string, unknown>>>(game?.modifiers ?? {});
  // Single delegate. undefined = not-yet-initialized from the existing grant.
  const [delegateId, setDelegateId] = useState<string | null | undefined>(game ? undefined : null);
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Course (Phase 1.0): the panel previously SHOWED course state but had no way
  // to set it — competition games had no course-selection entry point, so the
  // stroke index never reached the (conformant) handicap path. Wire the existing
  // CoursePicker here. Local state tracks the pick; on an existing game we
  // persist immediately via applyCourse, on a new game we apply after create.
  const [courseId, setCourseId] = useState<string | null>(game?.course_id ?? null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);

  const categoriesPresent = CATEGORY_ORDER.filter((c) => offerable.some((t) => t.category === c));
  const categoryTypes = offerable.filter((t) => t.category === category);
  const effectiveTypeId = categoryTypes.some((t) => t.id === gameTypeId) ? gameTypeId : categoryTypes[0]?.id ?? "";
  const selectedType = types.find((t) => t.id === effectiveTypeId);
  // Per-match formats: 1v1 match play AND rack-n-stack (a set of rank-paired
  // mini-matches) — both accumulate per-match points, not a placement total.
  const isMatchPlay =
    selectedType?.resultStrategy === "match_play" || selectedType?.resultStrategy === "rack_n_stack";
  // Paired match play (1v1 / 2v2) — the ONLY formats that get a page-one match
  // count. Rack (rack_n_stack) auto-groups by team size, stroke has no matches.
  const isPairedMatch = selectedType?.resultStrategy === "match_play";
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

  // On edit, "how many matches" is DERIVED from the live rows (display only —
  // the count is changed in the builder, not re-typed here).
  const existingMatchesQ = trpc.matches.listByGame.useQuery(
    { tripId, gameId: game?.id ?? "" },
    { enabled: isEdit && isPairedMatch && !!game?.id }
  );
  const existingMatchCount = (existingMatchesQ.data?.matches?.length as number | undefined) ?? null;

  const create = trpc.games.create.useMutation();
  const update = trpc.games.update.useMutation();
  const setDist = trpc.games.setPointsDistribution.useMutation();
  const setTotalM = trpc.games.setPointsTotal.useMutation();
  const setStatus = trpc.games.setStatus.useMutation();
  const deleteGame = trpc.games.delete.useMutation();
  const addOrg = trpc.games.addOrganizer.useMutation();
  const removeOrg = trpc.games.removeOrganizer.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const clearCourse = trpc.games.clearCourse.useMutation();

  // Resolve the applied course's NAME for the field label (a pre-set course
  // has an id but no just-picked name). Skipped when nothing's applied.
  const courseQ = trpc.courses.getById.useQuery(
    { courseId: courseId ?? "" },
    { enabled: !!courseId },
  );
  const resolvedCourseName = courseName ?? ((courseQ.data?.name as string | undefined) ?? null);

  // Pick a course: snapshot it onto an existing game now; for a new game stash
  // the id and apply it right after create (persist()).
  async function handlePickCourse(id: string, name: string) {
    setCourseId(id);
    setCourseName(name);
    setCoursePickerOpen(false);
    if (isEdit && game) {
      try {
        await applyCourse.mutateAsync({ tripId, gameId: game.id, courseId: id });
        utils.games.listByTrip.invalidate({ tripId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to apply course");
      }
    }
  }

  // Clear the applied course (× on the field). On an existing game, persist the
  // clear (reverts the snapshot to the template default); on a new game just
  // drop the stashed pick.
  async function handleClearCourse() {
    setCourseId(null);
    setCourseName(null);
    if (isEdit && game) {
      try {
        await clearCourse.mutateAsync({ tripId, gameId: game.id });
        utils.games.listByTrip.invalidate({ tripId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to clear course");
      }
    }
  }

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
          await update.mutateAsync({ tripId, gameId, name: title.trim(), competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null, modifiers });
          await setTotalM.mutateAsync({ tripId, gameId, total: isMatchPlay ? null : total });
        } else {
          await update.mutateAsync({ tripId, gameId, competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null, modifiers });
        }
        await setDist.mutateAsync({ tripId, gameId, distribution });
      } else {
        // C1 default-0: a NEW match game is created at 0 points-per-match — its
        // value is set on the setup page's inline Points row (C2), and 0 keeps the
        // Enable gate shut (C3) until it's set. Placement games keep the Add
        // stepper, so their distribution comes from `buildDistribution()`.
        const createDistribution: PointsDistribution | null = isMatchPlay
          ? { type: "per_match", value: 0 }
          : distribution;
        const created = (await create.mutateAsync({
          tripId, gameTypeId: effectiveTypeId, name: title.trim(), competitionId,
          pointsDistribution: createDistribution, pointsTotal: isMatchPlay ? null : total,
        })) as { id: string };
        gameId = created.id;
        if (compFormat || rules.trim() || Object.keys(modifiers).length > 0) {
          await update.mutateAsync({ tripId, gameId, competitionFormat: (compFormat as never) ?? null, rulesForToday: rules.trim() || null, modifiers });
        }
        // Apply a course chosen during create (snapshots par + stroke index).
        if (courseId) {
          try {
            await applyCourse.mutateAsync({ tripId, gameId, courseId });
          } catch {
            // Non-fatal: the game still saves on the template default par/index.
          }
        }
        // C1: Add no longer seeds match rows. Matches are build-as-you-go in the
        // configurer — the setup page seeds ONE empty match when it lands with zero
        // rows (match/new/page.tsx) and "+ Add match" grows it. (The old count
        // stepper + its seeding here were redundant with that.)
      }
      if (canEdit) {
        await reconcileDelegate(gameId);
        // Write the new grant straight into the listOrganizers cache. The
        // mutations above already succeeded, so this is server truth — and
        // unlike invalidate() (which only schedules a refetch) it's synchronous,
        // so an IMMEDIATE reopen of the modal seeds from the correct value
        // instead of racing the refetch against the dialog close.
        utils.games.listOrganizers.setData(
          { tripId, gameId },
          desiredDelegate
            ? ([{ user_id: desiredDelegate, granted_by: null, created_at: null }] as never)
            : []
        );
      }
      utils.games.listByTrip.invalidate({ tripId });
      // Background reconcile (eventual consistency) — the setData above is what
      // makes the immediate reopen correct.
      utils.games.listOrganizers.invalidate({ tripId, gameId });
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

  async function handleDelete() {
    if (!game) return;
    if (!window.confirm("Delete this game permanently? It and all its scores are removed — this can't be undone. (To keep it but hide it from the board, use Abandon instead.)")) return;
    await deleteGame.mutateAsync({ tripId, gameId: game.id });
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
                courseId={courseId}
                courseName={resolvedCourseName}
                onPickCourse={() => setCoursePickerOpen(true)}
                onClearCourse={handleClearCourse}
                isMatchPlay={isMatchPlay}
                isPairedMatch={isPairedMatch}
                existingMatchCount={existingMatchCount}
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
                courseId={courseId}
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
                availableModifiers={selectedType?.compatibleModifiers ?? []}
                modifiers={modifiers}
                setModifiers={setModifiers}
                compFormat={compFormat}
                openFormatSheet={() => setFormatSheetOpen(true)}
              />
            )}

            {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

            {isEdit && game && canEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteGame.isPending}
                data-testid="delete-game"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: "transparent", color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-border)" }}
              >
                <Trash2 size={12} />
                Delete game permanently
              </button>
            )}
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

      {coursePickerOpen && (
        <CoursePicker
          onApply={({ id, name }) => void handlePickCourse(id, name)}
          onClose={() => setCoursePickerOpen(false)}
        />
      )}
    </ScrollLock>
  );
}

// ── Game tab ──────────────────────────────────────────────────────────────────

function GameTab({
  isEdit, canEdit, categoriesPresent, category, setCategory, categoryTypes, effectiveTypeId,
  setGameTypeId, selectedType, title, setTitle, isGolf, courseId, courseName, onPickCourse, onClearCourse, isMatchPlay,
  isPairedMatch, existingMatchCount,
  total, setTotal, perMatchValue, setPerMatchValue, readout,
}: {
  isEdit: boolean; canEdit: boolean; categoriesPresent: readonly string[]; category: string;
  setCategory: (c: string) => void; categoryTypes: GameType[]; effectiveTypeId: string;
  setGameTypeId: (id: string) => void; selectedType: GameType | undefined; title: string;
  setTitle: (s: string) => void; isGolf: boolean; courseId: string | null; courseName: string | null;
  onPickCourse: () => void; onClearCourse: () => void; isMatchPlay: boolean;
  isPairedMatch: boolean; existingMatchCount: number | null;
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
          {courseId ? (
            // Applied: show the course name (tap to change) + an × to clear.
            <div
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            >
              <button
                type="button"
                onClick={readOnly ? undefined : onPickCourse}
                disabled={readOnly}
                className="min-w-0 flex-1 truncate text-left disabled:opacity-70"
              >
                {courseName ?? "Course applied"}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onClearCourse}
                  aria-label="Clear course"
                  title="Clear course"
                  className="ml-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={readOnly ? undefined : onPickCourse}
              disabled={readOnly}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm disabled:opacity-70"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            >
              <span>Select a course</span>
              <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          )}
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            The golf course is optional, but required if you want to keep score.
          </p>
        </Field>
      )}

      {/* W-GAMEPAGE Phase-C teardown: Add Game no longer sets match-play points.
          A new match game is created at 0 points (build-as-you-go) and its
          points-per-match is set on the setup page's inline Points row (C2). So
          the match-play stepper shows on EDIT only; placement (stroke/non-golf)
          keeps its Add stepper — placement games have no inline setup-page Points
          row, so the modal stays their points home. */}
      {isMatchPlay ? (
        isEdit ? (
          <PointStepper
            label="Points per match"
            caption="POINTS PER MATCH"
            value={perMatchValue}
            onChange={readOnly ? () => {} : setPerMatchValue}
            footer={<MatchReadoutLine readout={readout} />}
          />
        ) : null
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

      {/* Matches (1v1/2v2 only): EDIT shows the derived live count (changed in the
          builder). Add no longer seeds a count — build-as-you-go owns it: the setup
          page seeds one empty match on landing and "+ Add match" grows it (C1). */}
      {isPairedMatch && isEdit && (
        <Field label="Matches">
          <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}>
            <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
              {existingMatchCount ?? "—"} {existingMatchCount === 1 ? "match" : "matches"}
            </span>{" "}
            · add or remove in Set Pairings
          </div>
        </Field>
      )}
    </>
  );
}

/** The integrated −/value/+ point control (matches the mock). */
export function PointStepper({
  label, caption, value, onChange, footer, max,
}: {
  label: string; caption: string; value: number; onChange: (n: number) => void; footer?: React.ReactNode; max?: number;
}) {
  // A Field + footer composition over the canonical <Stepper> (P-B). The bespoke
  // step-buttons are gone; min stays 1 and fmtValue keeps the ½-point display.
  return (
    <Field label={label} required>
      <div className="rounded-xl" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
        <div className="px-3 py-3">
          <Stepper size="full" value={value} min={1} max={max} onChange={onChange} label={caption} formatValue={fmtValue} />
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

export function MatchReadoutLine({ readout }: { readout: ReturnType<typeof matchReadout> }) {
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
  placement, pFit, mFit, readout, perMatchValue, rules, setRules, availableModifiers, modifiers, setModifiers,
  compFormat, openFormatSheet,
}: {
  canEdit: boolean; members: Member[]; delegateId: string | null; setDelegateId: (id: string | null) => void;
  isMatchPlay: boolean; isGolf: boolean; courseId: string | null; total: number; placeInputs: string[]; setPlaceInputs: (v: string[]) => void;
  placement: ReturnType<typeof validatePlacement>; pFit: ReturnType<typeof placementFit>;
  mFit: ReturnType<typeof matchFit>; readout: ReturnType<typeof matchReadout>;
  perMatchValue: number; rules: string; setRules: (s: string) => void;
  availableModifiers: string[]; modifiers: Record<string, Record<string, unknown>>;
  setModifiers: (m: Record<string, Record<string, unknown>>) => void;
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

      {isGolf && availableModifiers.length > 0 && (
        <Field label="Special rules">
          <ModifierCards available={availableModifiers} modifiers={modifiers} onChange={setModifiers} readOnly={!canEdit} />
        </Field>
      )}

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

export function PlacementEditor({
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

export function FormatSheet({
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

// ── Run sheet: post / score-correction (manual placement + engine post) ───────

interface SchemaUnits { units?: { count?: number } }

export function RunSheet({
  tripId, competitionId, game, teams, initialOrder, isEngine, matchPlay, onClose, onEditConfig,
}: {
  tripId: string; competitionId: string; game: GameRow; teams: LBTeamLite[];
  initialOrder: string[]; isEngine: boolean;
  /** Match-play competition (W-NONGOLF-02): a non-golf game scores win/lose/tie
   *  instead of a finishing order. Ignored for engine games + non-2-team comps. */
  matchPlay?: boolean;
  onClose: () => void;
  /** When present, a pencil in the header reopens the game's config (GameSheet).
   *  The non-golf board path uses it so config is reachable from the run sheet
   *  (the board row itself has no route — the config-vs-live split is WS4). */
  onEditConfig?: () => void;
}) {
  const utils = trpc.useUtils();
  const state = runState(game);
  const correcting = state === "posted" || state === "correcting";
  const dist = game.points_distribution?.type === "placement" ? game.points_distribution.values : [];

  // Win/lose/tie scoring: a manual (non-engine) game in a match-play competition
  // with exactly two sides. The winner takes the game's points; a tie splits them
  // (the leaderboard derives [total,0] and averages a tie → P/2). Anything else
  // (engine games, points comps, >2 teams) keeps #430's finishing-order editor.
  const winLoseTie = !isEngine && !!matchPlay && teams.length === 2;
  const [order, setOrder] = useState<string[]>(initialOrder.length ? initialOrder : teams.map((t) => t.id));
  // Selected outcome for the win/lose/tie editor: a team id (that side won) or
  // "tie". Defaults to the leading side from the seeded order — adjust or pick Tie.
  const [result, setResult] = useState<string>(() => initialOrder[0] ?? teams[0]?.id ?? "");
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Engine incomplete-post guard (§4): name the gap, never block.
  const { data: detail } = trpc.games.getById.useQuery({ tripId, gameId: game.id }, { enabled: isEngine });
  const { data: scoreRows } = trpc.scores.listByGame.useQuery({ tripId, gameId: game.id }, { enabled: isEngine });
  const participants = ((detail as { participants?: unknown[] } | undefined)?.participants ?? []) as unknown[];
  const unitCount = ((game.scorecard_schema as SchemaUnits | null)?.units?.count) ?? 18;
  const expected = participants.length * unitCount;
  const entered = (scoreRows ?? []).filter((r) => (r as { value: number | null }).value != null).length;
  const missing = Math.max(0, expected - entered);
  const incomplete = isEngine && expected > 0 && missing > 0;

  const post = trpc.games.post.useMutation();
  const openCorrection = trpc.games.openCorrection.useMutation();
  const busy = post.isPending || openCorrection.isPending;

  function teamById(id: string) { return teams.find((t) => t.id === id); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  async function commit() {
    setError(null);
    if (isEngine && incomplete && !confirmIncomplete) { setConfirmIncomplete(true); return; }
    try {
      if (isEngine) {
        await post.mutateAsync({ tripId, gameId: game.id });
      } else if (winLoseTie) {
        // Winner → position 1, loser → position 2; a tie puts BOTH at position 1
        // (placementPoints averages → P/2 each). The leaderboard awards [total,0].
        const placements =
          result === "tie"
            ? teams.map((t) => ({ entityId: t.id, position: 1 }))
            : teams.map((t) => ({ entityId: t.id, position: t.id === result ? 1 : 2 }));
        await post.mutateAsync({ tripId, gameId: game.id, placements });
      } else {
        await post.mutateAsync({ tripId, gameId: game.id, placements: order.map((id, i) => ({ entityId: id, position: i + 1 })) });
      }
      utils.games.listByTrip.invalidate({ tripId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    }
  }

  async function unlockForCorrection() {
    setError(null);
    try {
      await openCorrection.mutateAsync({ tripId, gameId: game.id });
      utils.games.listByTrip.invalidate({ tripId });
      // Reopening flips the game complete → active, which changes its leaderboard
      // row state (Final → Live) — invalidate the board's cache too, matching the
      // post/commit path above, so the leaderboard isn't stale until a refresh.
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open correction");
    }
  }

  const postLabel = correcting ? "Re-post" : "Post";
  const postBg = correcting ? "var(--color-bt-warning)" : "var(--color-bt-accent)";

  return (
    <ScrollLock>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: "var(--color-bt-overlay)" }} onClick={onClose}>
        <div
          className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
            <div>
              <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>{correcting ? "Score correction" : "Post results"}</h3>
              <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{game.name || "Game"}</p>
            </div>
            <div className="flex items-center gap-1">
              {onEditConfig && (
                <button type="button" onClick={onEditConfig} aria-label="Edit game settings" data-testid="run-edit-config" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
                  <Pencil size={15} />
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {correcting && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning)" }}>
                <Info size={14} style={{ color: "var(--color-bt-warning)", flexShrink: 0, marginTop: 1 }} />
                <span className="text-[11px] leading-relaxed" style={{ color: "var(--color-bt-warning)" }}>
                  Correcting a posted round — re-posting recomputes the whole leaderboard.
                </span>
              </div>
            )}

            {isEngine ? (
              <EngineReview
                incomplete={incomplete}
                missing={missing}
                correcting={correcting}
                onUnlock={unlockForCorrection}
                unlocking={openCorrection.isPending}
                scoresOpen={game.corrections_open}
              />
            ) : winLoseTie ? (
              <WinLoseTieEditor teams={teams} result={result} onPick={setResult} />
            ) : (
              <ManualPlacementEditor order={order} teams={teams} dist={dist} teamById={teamById} move={move} />
            )}

            {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
          </div>

          <div className="border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
            {confirmIncomplete ? (
              <div className="space-y-2.5">
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
                  {missing} score{missing === 1 ? "" : "s"} are still blank. Rained out? Post the current standing now and correct it later — totally fine. Otherwise keep entering.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmIncomplete(false)} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}>
                    Keep entering
                  </button>
                  <button type="button" onClick={commit} disabled={busy} className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: postBg, color: "var(--color-bt-base)" }}>
                    Post anyway
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={commit}
                disabled={busy}
                data-testid="run-post"
                className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
                style={{ background: postBg, color: "var(--color-bt-base)" }}
              >
                {postLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

/** Manual placement entry — order the teams 1st→last; PAYS shows the configured
 *  distribution (the poster sets ORDER, never points). */
function ManualPlacementEditor({
  order, teams, dist, teamById, move,
}: {
  order: string[]; teams: LBTeamLite[]; dist: number[];
  teamById: (id: string) => LBTeamLite | undefined; move: (i: number, dir: -1 | 1) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Finishing order</span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Pays</span>
      </div>
      <div className="space-y-1.5">
        {order.map((teamId, i) => {
          const team = teamById(teamId);
          const pays = dist[i] ?? 0;
          return (
            <div key={teamId} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
              <span className="w-5 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>{i + 1}</span>
              <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: team?.color ?? "var(--color-bt-text-dim)" }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{team?.name ?? "Team"}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: pays > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>{fmtValue(pays)}</span>
              <div className="ml-1 flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="flex h-4 w-6 items-center justify-center rounded disabled:opacity-30" style={{ color: "var(--color-bt-text-dim)" }}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down" className="flex h-4 w-6 items-center justify-center rounded disabled:opacity-30" style={{ color: "var(--color-bt-text-dim)" }}>
                  <ChevronDown size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Order the teams by finish — points come from the game&rsquo;s configured distribution, so you set the order, not the points.
      </p>
    </div>
  );
}

/** Win/lose/tie result for a match-play (head-to-head) non-golf game: ONE
 *  question, three mutually-exclusive PEERS (each side + Tie). Selection-state
 *  alone carries the meaning — no per-row "wins" label, no two rows both saying
 *  win. Posts winner→pos 1, loser→pos 2, tie→both pos 1; the leaderboard awards
 *  [total,0] (averaged for a tie). */
function WinLoseTieEditor({
  teams, result, onPick,
}: {
  teams: LBTeamLite[]; result: string; onPick: (r: string) => void;
}) {
  // Three peers in one uniform row shape so none reads as primary: each side
  // (its color disc) and Tie (a split disc of BOTH colors — "shared").
  const options: { id: string; mark: React.ReactNode; label: string; testid: string }[] = [
    ...teams.map((t) => ({
      id: t.id,
      mark: <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: t.color }} />,
      label: t.name,
      testid: `wlt-win-${t.id}`,
    })),
    {
      id: "tie",
      mark: (
        <span className="flex h-3 w-3 flex-shrink-0 overflow-hidden rounded-full">
          <span className="h-full w-1/2" style={{ background: teams[0]?.color ?? "var(--color-bt-text-dim)" }} />
          <span className="h-full w-1/2" style={{ background: teams[1]?.color ?? "var(--color-bt-text-dim)" }} />
        </span>
      ),
      label: "Tie",
      testid: "wlt-tie",
    },
  ];
  return (
    <div>
      <div className="mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Who won?</span>
      </div>
      <div role="radiogroup" aria-label="Who won?" className="space-y-1.5">
        {options.map((o) => {
          const sel = result === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onPick(o.id)}
              data-testid={o.testid}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-left"
              style={{ background: sel ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)", border: `1px solid ${sel ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}` }}
            >
              {o.mark}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: sel ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}>{o.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Head-to-head: the winner takes the game&rsquo;s points; a tie splits them evenly.
      </p>
    </div>
  );
}

function EngineReview({
  incomplete, missing, correcting, onUnlock, unlocking, scoresOpen,
}: {
  incomplete: boolean; missing: number; correcting: boolean; onUnlock: () => void; unlocking: boolean; scoresOpen: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
        {correcting
          ? "This round is posted. Open score correction to edit the scorecard, then re-post to recompute the leaderboard."
          : "Posting commits the computed result and publishes the current standing to the leaderboard."}
      </p>
      {correcting && !scoresOpen && (
        <button type="button" onClick={onUnlock} disabled={unlocking} className="w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}>
          {unlocking ? "Opening…" : "Open score correction"}
        </button>
      )}
      {correcting && scoresOpen && (
        <p className="text-[11px]" style={{ color: "var(--color-bt-accent)" }}>Scores are open — edit on the scorecard, then re-post here.</p>
      )}
      {incomplete && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
          <Info size={13} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
          <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{missing} score{missing === 1 ? "" : "s"} still blank — you can post anyway.</span>
        </div>
      )}
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

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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

export function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Whole numbers as-is, halves as ½ (0.5 → "½", 1.5 → "1½"). */
export function fmtValue(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
