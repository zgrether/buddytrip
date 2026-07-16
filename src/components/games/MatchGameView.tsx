"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X, Swords, SlidersHorizontal, Sparkles, Users, Settings, ListChecks } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { useOutcomeSaver } from "@/hooks/useOutcomeSaver";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useInGamePanel, usePublishGameChrome } from "@/components/games/GameChrome";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MatchEntryView, type MatchGroupData } from "@/components/games/MatchEntryView";
import { MatchOutcomeEntryView } from "@/components/games/MatchOutcomeEntryView";
import { OutcomeScorecard } from "@/components/games/OutcomeScorecard";
import { MemberNotReady } from "@/components/games/MemberNotReady";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { ChecklistRow, type ChecklistRowState } from "@/components/games/ChecklistRow";
import { MatchCard } from "@/components/games/MatchCard";
import { StandardGrid } from "@/components/games/StandardGrid";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { RelHandicapControl } from "@/components/games/RelHandicapControl";
import type { SidePlayer } from "@/components/games/MatchSides";
import { DragHandle } from "@/components/games/DragHandle";
import { RowNumber } from "@/components/games/RowNumber";
import { PlayerChip } from "@/components/games/PlayerChip";
import { Avatar } from "@/components/Avatar";
import { TimePicker } from "@/components/TimePicker";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { MatchPointsRow, type PointsMatch } from "@/components/games/MatchPointsRow";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GamePageHeader } from "@/components/competition/GamePageHeader";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import { ScoringLockBanner } from "@/components/games/ScoringLockBanner";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { parseTime, toTime24 } from "@/lib/time";
import { buildDecided, buildDecidedFromOutcomes, matchState, strokeHoles, type DecidedHole, type HoleOutcomeRow } from "@/lib/matchPlay";
import { gloriousConfig, type GloriousConfig } from "@/lib/gloriousHoles";
import { rollupMatchPlay, type ProjMatch } from "@/lib/gameProjection";
import { PLAYER_COLORS, unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import { filledMatches, allMatchesFilled, hasValidMatch, pointsReady, removeMatchRow, sideMemberIds } from "@/lib/matchDraft";
import {
  configToDraft,
  configDraftToPayload,
  configDraftsEqual,
  isDraftMatchFilled,
  type ConfigDraft,
  type DraftMatchConfig,
  type DraftMatchInput,
} from "@/lib/configDraft";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import type { ScorecardSchema } from "@/lib/courseIndex";
import { matchRosterValid } from "@/lib/teamRoster";
import { GAME_TYPES, getGameTypeDefinition } from "@/lib/gameTypes";
import { ModifierCards } from "@/components/games/ModifierCards";
import { enabledCount, type ModifiersMap } from "@/lib/modifiers";
import { unconfirmedCount, type Participant, type ScoreValues, type OutcomeValues } from "@/components/games/types";
import { showToast } from "@/lib/toast";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One unified match-play type (Refactor A1). 1v1-vs-2v2 is per-match, derived from
// each match's side type — not the game type. `MATCH_PLAY_DOUBLES` is retired.
const MATCH_PLAY = "gtt_match_play";
// Mirrors the server cap (matches router). Dynamic match count grows up to here.
const MAX_MATCHES = 24;

// A server match side: a user (1v1) or a play_group (2v2). The editable draft
// holds each side as a list of member user ids — length ≤1 for singles, ≤2 for
// doubles — so one code path serves both (singles is the 1-per-side case).
type SideRef = { type: "user" | "play_group"; id: string } | null;
/**
 * The editable match row. This IS the composite draft's match shape
 * (`DraftMatchConfig`) — not a parallel type. Draft-then-save folded the per-match
 * points override (`pointValue`) onto the match itself, so Points derives from the
 * DRAFT rather than `serverMatches`: a not-yet-saved match has no server id to key
 * an override map by, and co-locating it keeps the override correct across
 * reorder / add / remove.
 */
type DraftMatch = DraftMatchConfig;
type Screen = "new" | "member-wait" | "setup" | "overview" | "score" | "config";

/** Which settings rows are expanded. Multi-open (draft-then-save): a row's panel is
 *  pure UI state now — collapsing no longer commits anything, so there's no reason
 *  to force one open at a time. */
type RowId = "matches" | "handicaps" | "players" | "course" | "config" | "modifiers";

/**
 * The whole settings draft as one serializable bundle — what the hard-teardown
 * outbox stores (P1.7). `null` = that slice is untouched, mirroring the live state
 * exactly, so a recovered bundle restores only what the user actually edited.
 *
 * The outbox used to hold ONLY the matches draft, which under the composite model
 * meant a refresh recovered your pairings and silently dropped your name / points /
 * course / rules edits — partial durability that reads as data loss.
 */
interface SettingsDraftBundle {
  matches: DraftMatch[] | null;
  name: string | null;
  rules: string | null;
  scoring: boolean | null;
  entryMode: string | null;
  modifiers: ModifiersMap | null;
  pointsTotal: number | null;
  course: ConfigDraft["course"] | null;
  delegates: string[] | null;
}

/**
 * MatchGameView — the singles/doubles match-play game surface (Slice B). Walks the
 * full lifecycle (create → pairings → handicap → enableScoring → score → finish),
 * role-gated, persisting each step via the `matches` router. Resume an existing
 * game with `?game=<id>`.
 *
 * Spec 2 Phase 1: this is a persistence-BOUND composed VIEW (it owns tRPC/state —
 * NOT one of the pure scorecard primitives that also live in this folder). It is
 * re-HOSTED in two places that both live under `/trips/[tripId]/` and both carry
 * `?game=<id>`, so it reads its OWN tripId (`useParams`) + gameId (`?game=`) in
 * both contexts with no prop threading:
 *   1. the route page (`games/match/new/page.tsx`) — a thin wrapper, and
 *   2. the persistent leaderboard's game PANEL (`CompetitionFace`) — a slide-in
 *      layer over the still-mounted board (the ~70-80% nav speed win).
 * The exit affordance (`goBack` → `router.back()`) closes the panel for free:
 * the panel is opened by a `?game=` history entry, so a back pops it.
 */
export function MatchGameView() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { ...STRUCTURE_QUERY, enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const me = useCurrentUser();
  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });

  // Competition roster (Slice D): a competition game pairs from the players
  // assigned to its teams, not the whole trip crew. Names still resolve from
  // crew (the roster is a subset of trip members). All STRUCTURE — kept.
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const utils = trpc.useUtils();
  const assignQ = trpc.teamAssignments.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  // Teams (Slice D, ordered by created_at). A Ryder-cup match binds a side to a
  // team: side A → team[0], side B → team[1]. That makes the pair picker
  // constrainable to one team (no cross-team pair) and the strip team-colored.
  const teamsQ = trpc.teams.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );

  const [gameId, setGameId] = useState<string | null>(search.get("game"));
  // #501 Part 1: delegate-aware canEdit (owner/org OR this game's delegate),
  // centralized in useGameEditAccess. isOwner stays trip-Owner-only.
  const { canEdit, isOwner, loading: roleLoading } = useGameEditAccess(tripId, gameId);
  const [manualScreen, setManualScreen] = useState<Screen | null>(null);
  // The settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1 → land here directly for an owner/delegate of a setup-mode game,
  // back → leaderboard). The gear path pushes a history entry so the arrow and the
  // OS/mouse back are the SAME action; the deep-link path routes back through the
  // router to the leaderboard. (Aliased to `cfgOpen` — the rest of the page is
  // unchanged.)
  // Draft-then-save: leaving with unsaved edits would silently bin the whole page's
  // draft (the old model persisted per-row, so this path couldn't lose anything).
  // `dirty` + `handleCancel` are defined far below — this hook has to be declared up
  // here with the other screen state — so hand them over by latest-ref, which the
  // hook reads at close time rather than at mount.
  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const {
    open: cfgOpen,
    openConfig,
    closeConfig,
    confirmingClose,
    confirmDiscard,
    cancelClose,
  } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
    isDirty: () => dirtyRef.current,
    onDiscard: () => discardRef.current(),
  });

  const [teeTime, setTeeTime] = useState(""); // "HH:MM" 24h
  // ── The composite draft's SLICES (Draft-Then-Save P1, spec §2.1) ────────────
  // The whole settings page is ONE client draft; nothing reaches the server until
  // Save. Each slice is `null` when UNTOUCHED, and `configDraft` (below) assembles
  // them OVER the server mirror — so an untouched field tracks the server (incl.
  // another device's change) while a touched one holds the user's edit.
  //
  // Why slices instead of one restructured object: `draft` (the matches slice) is
  // declared here, ABOVE the mirror memo it would have to read, and the editors
  // (MatchSetup/HandicapsSection) already write it. Promoting it in place would
  // force a reorder that cascades through the file; assembling siblings over the
  // mirror gets the same ONE-object read seam with a local change.
  const [draft, setDraft] = useState<DraftMatch[]>([]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // "" is a legal drafted value (rules cleared) — only null means untouched, which
  // is why every slice tests `?? mirror` rather than truthiness.
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [entryModeDraft, setEntryModeDraft] = useState<string | null>(null);
  const [modifiersDraft, setModifiersDraft] = useState<ModifiersMap | null>(null);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null>(null);
  const [courseDraft, setCourseDraft] = useState<ConfigDraft["course"] | null>(null);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  // Surfaced when Save fails — the draft is KEPT (edits are never discarded) and
  // the panel stays open so the reason is readable and the action retryable.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Once the user TOUCHES the draft in a setup session, the server must never
  // re-derive over it. The seed effect's `draft.length` guard alone is not enough:
  // under concurrent renders its closure can read a stale length and re-seed,
  // wiping in-progress edits when serverMatches lands mid-setup (the create-refetch
  // race the accordion's instant-open exposed). A ref is always current, so it's
  // the reliable lock. Reset on every fresh seed entry (create / Edit).
  const draftTouched = useRef(false);
  // One-shot latch for the hard-teardown outbox restore (see the seed effect).
  const didRecoverRef = useRef(false);
  // The user-edit setter: marks the draft touched, then updates it. Use this for
  // EVERY user edit (picks, reorder, remove, add, handicap); use raw setDraft only
  // for SEEDING (create / resume / Edit), which must NOT set the touched lock.
  const editDraft = (fn: (prev: DraftMatch[]) => DraftMatch[]) => {
    draftTouched.current = true;
    setDraft(fn);
  };
  const [selector, setSelector] = useState<{ matchIdx: number; slot: "a" | "b"; memberIdx: number } | null>(null);
  // Which rows are expanded. MULTI-OPEN (draft-then-save): the single-open accordion
  // existed to force a commit between rows — collapsing a draft editor is what used
  // to persist it, so two rows open at once meant a cross-row derivation could read a
  // half-committed store. Nothing commits on collapse now (the page's one Save does),
  // so open/close is pure UI state and any number of rows can be open. That also
  // retires the incidental one-open gating of Handicaps behind Matches — Handicaps
  // keeps its OWN explicit prerequisite gate (`handicapsReady`), which is the honest
  // rule anyway.
  const [openRows, setOpenRows] = useState<Set<RowId>>(() => new Set());
  const toggleRow = (row: RowId) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  const closeRow = (row: RowId) =>
    setOpenRows((prev) => {
      if (!prev.has(row)) return prev;
      const next = new Set(prev);
      next.delete(row);
      return next;
    });
  // Back-stack: forward transitions push the screen they left; Back pops to it.
  // Empty stack means we arrived directly (derived screen) → leave to trip home.
  const [navStack, setNavStack] = useState<Screen[]>([]);
  // The scorecard is an OVERLAY over the match entry view (not a third screen), so
  // the entry stays mounted underneath and dismiss returns with score state intact.
  const [gridOpen, setGridOpen] = useState(false);
  const [currentHole, setCurrentHole] = useState(1);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  // Collapse-on-advance: when teeing off with some slots still unfilled, confirm
  // the consequence (the game drops to the filled count; cup clinch shifts).
  // Course (Slice C): picked on the new-game screen, applied to the game once
  // it's created. id null until chosen.
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);

  // game config + pairings are STRUCTURE (kept); scores are STATE (the match
  // RESULTS within matches.listByGame change on finish/recompute, which invalidate
  // it — not on the fast score cadence — so it caches as structure too). Only the
  // raw scores stay short, so a reopen refreshes them while the rest is instant.
  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gameId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameId });
  // Multi-tee scorecard yardage rows (Spec 5b) — reads the persisted course record(s).
  const { rows: teeRows, courseName: scorecardCourseName } = useScorecardTeeRows(tripId, gameQ.data);
  const matchesQ = trpc.matches.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameId });
  // Scores are STATE — poll (~20s, paused when tab hidden) so remote entries
  // reflect on this open board (game-state sync). `loadedValues` is a memo of
  // this query merged UNDER the local `values` (mergedFor), so the poll refreshes
  // others' scores while the active enterer's local edits still win.
  const scoresQ = trpc.scores.listByGame.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );
  // Refactor B: the outcome counterpart to scoresQ — polled the same way so a
  // remote device's recorded outcomes converge here too. Only relevant for an
  // outcome-mode game; harmless (empty) to poll for a score-mode one, and the
  // hook name isn't yet determined by entry_mode gating to keep both queries
  // unconditional (React Hooks can't be called conditionally).
  const outcomesQ = trpc.matchOutcomes.listByGame.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );

  // Config sync: on a config change from another device (matchups reassigned,
  // side handicaps, modifiers/rules, course, go-live, finish), silently refetch
  // this game's config so members converge. Match config spans the game row +
  // the matches table → invalidate both.
  const onConfigChanged = useCallback(() => {
    if (!tripId || !gameId) return;
    void utils.games.getById.invalidate({ tripId, gameId });
    void utils.matches.listByGame.invalidate({ tripId, gameId });
  }, [utils, tripId, gameId]);
  useConfigSync(tripId, gameId, !!gameId, onConfigChanged);

  // Shape (Refactor A1): 1v1-vs-2v2 is a per-match property, so the AUTHORITATIVE
  // signal is the game's own matches — a doubles game's `game_matches` carry
  // `{type:"play_group"}` sides. Derive `sided` from those (not `game_type_id`,
  // which is now the uniform `gtt_match_play` for every match game). A brand-new
  // game with no matches yet reads the `?format=doubles` hint (the standalone
  // create route), else defaults singles. This ALSO retires the old
  // "matches-land-before-the-game-row" seed race: shape and matches now arrive
  // from the SAME query (`matchesQ`), so there's no window where the game type is
  // ahead of the matches. (A2 unfolds this game-level `sided` into a true
  // per-match shape so a single game can mix 1v1 + 2v2.)
  const loadedMatchesForShape = matchesQ.data?.matches ?? [];
  const sided =
    loadedMatchesForShape.length > 0
      ? loadedMatchesForShape.some(
          (m) =>
            (m.side_a as { type?: string } | null)?.type === "play_group" ||
            (m.side_b as { type?: string } | null)?.type === "play_group"
        )
      : search.get("format") === "doubles";

  // The matches that are actually playable — both sides fully assigned to their
  // OWN shape. An unfilled slot is not a match (it never scores), so teeing off
  // COLLAPSES the game to these: the unfilled slots are discarded and points-in-
  // play / the cup clinch recompute from this count.
  const filledDraft = useMemo(() => filledMatches(draft), [draft]);

  // Per-match score-entry type (A2a): a 1v1 match writes per-user entries, a 2v2
  // match writes per-side (play_group) entries — in the SAME mixed game. So the
  // saver's participant_type is resolved PER participant id: any id that is one of
  // this game's play_groups is 'play_group', otherwise 'user'. (The play_group id
  // space is disjoint from user ids.)
  const playGroupIdSet = useMemo(
    () => new Set((matchesQ.data?.playGroups ?? []).map((pg) => (pg as { id: string }).id)),
    [matchesQ.data]
  );
  const participantTypeOf = useCallback(
    (pid: string): "user" | "play_group" => (playGroupIdSet.has(pid) ? "play_group" : "user"),
    [playGroupIdSet]
  );
  // Scoring — the connectivity-resilient saver owns `values` + `saveStatus`:
  // optimistic value, retry-with-backoff, per-cell status, kept-and-flagged
  // (never rolled back) on failure.
  // onCleared: a Reset Hole/cell has no local value left to shadow the
  // poll-loaded loadedValues/loadedOutcomeValues snapshot (mergedFor's
  // server layer), so the match-list header and scorecard grid would
  // otherwise show the pre-reset result until the next scheduled poll —
  // refetch right away instead of waiting out GAME_SYNC_INTERVAL_MS.
  const { values, setValues, saveStatus, onChange, onClear, retryCell } =
    useScoreSaver(tripId, gameId, participantTypeOf, () => void scoresQ.refetch());
  // Refactor B: the outcome write path — same durability contract, unconditional
  // (hooks can't be conditional); inert for a score-mode game (nothing calls its
  // onChange/onClear there).
  const {
    values: outcomeValues,
    setValues: setOutcomeValues,
    saveStatus: outcomeSaveStatus,
    onChange: onOutcomeChange,
    onClear: onOutcomeClear,
    retryCell: retryOutcomeCell,
  } = useOutcomeSaver(tripId, gameId, () => void outcomesQ.refetch());

  const createGame = trpc.games.create.useMutation();
  // Still the NEW-GAME path's course apply (handleCreate snapshots the picked course
  // onto the just-created game). The SETTINGS page no longer calls it — course is a
  // draft slice there, committed by save_game_config.
  const applyCourse = trpc.games.applyCourse.useMutation();
  // (setPairings / setHandicap / matches.enableScoring / games.disableScoring /
  // games.update-for-modifiers are GONE from this page. Every one of them was a
  // piecemeal settings write; `save_game_config` replaces the lot with one atomic
  // commit, and `scoring_enabled` rides the same payload rather than a second
  // round-trip. The routers themselves stay — other surfaces still use them, and
  // matches.setHandicap / matches.setPointValue remain the deliberate CORRECTIONS
  // late-edit path, which this refactor does not touch.)
  // Finishing retries (idempotent recompute); a failure stays on the overview
  // and surfaces via the global error toast — loud + retryable, not a silent
  // stall. Score writes go through useScoreSaver (above).
  const finishGame = trpc.games.finish.useMutation({
    retry: 4,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 8000),
  });
  // #7 correction path: reopen score entry on a posted game (owner/co-admin/
  // delegate — server-gated by requireGameRunAction). "Re-lock" is handleFinish.
  const openCorrection = trpc.games.openCorrection.useMutation();

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.displayName ?? c.user?.name ?? "Player");
    return m;
  }, [crew.data]);

  const avatarIconOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.user?.avatar_icon ?? null);
    return m;
  }, [crew.data]);

  // Loaded scores (for live match status on the matchup page + scoring resume).
  const loadedValues = useMemo(() => {
    const v: ScoreValues = {};
    for (const e of scoresQ.data ?? []) {
      if (e.value == null) continue;
      (v[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    return v;
  }, [scoresQ.data]);

  // Refactor B: this game's entry mode + the loaded outcome-mode counterpart to
  // loadedValues (keyed by match_id, not participant).
  const outcomeMode = (gameQ.data as { entry_mode?: string } | undefined)?.entry_mode === "outcome";
  const loadedOutcomeValues = useMemo(() => {
    const v: OutcomeValues = {};
    for (const e of outcomesQ.data ?? []) {
      (v[e.match_id as string] ??= {})[String(e.hole_number)] = e.result as HoleOutcomeRow["result"];
    }
    return v;
  }, [outcomesQ.data]);
  const mergedOutcomeFor = (matchId: string) => ({ ...(loadedOutcomeValues[matchId] ?? {}), ...(outcomeValues[matchId] ?? {}) });

  // Max singles matches = floor(players ÷ 2): the standalone pool is
  // undifferentiated, so any two of the crew pair up (Slice B). In a 2-team
  // competition the cap becomes min(teamA, teamB) since matches cross the team
  // line — generally min team size across teams — which is Slice D's concern.
  // Build-as-you-go (W-GAMEPAGE-01 §6.1): matches start at one and grow via
  // "+ Add match" — no pre-seeded count, so the old crew/roster match caps that
  // sized the initial draft are gone.
  const gameCompId = (gameQ.data?.competition_id as string | null) ?? null;
  const rosterIds = useMemo(
    () => [...new Set((assignQ.data ?? []).map((a) => a.user_id as string))],
    [assignQ.data]
  );

  const status = gameQ.data?.status as string | undefined;
  // Phase 2B.1: scoring enabled is the real "open for scoring" flag (publish no
  // longer goes Live — first score does, #396). The owner lands on the overview
  // once enabled (or active/complete); members see it once enabled (= published).
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  // The DRAFT's live flag — `configDraft.scoringEnabled` by construction, computed
  // here because the settings lock is derived ~240 lines above the composite memo.
  // configDraft reads THIS, so there is exactly one definition.
  const draftScoringEnabled = scoringDraft ?? scoringEnabled;
  // #501: game-altering config (matches/course/points/handicaps/modifiers) freezes
  // in scoring mode. MatchSetup/HandicapsSection have no read-only mode, so their
  // rows go non-expandable; GameSetupRows/ModifierCards take settingsEditable directly.
  //
  // Follows the DRAFT (migration 082): staging Setup unlocks the rows immediately, so
  // one atomic Save disables AND re-configures. This was only safe once 082 landed —
  // 081's true→false branch disabled and RETURNed early WITHOUT writing config, so
  // unlocking on a staged Setup would have silently dropped every edit riding that
  // same payload. 082 lets the branch fall through, under the existing course/matches
  // freeze guards. Don't repoint this back at the server flag without re-reading them.
  const settingsEditable = canEdit && !draftScoringEnabled;
  // Lifecycle #7: Final = locked. `locked` (posted, no correction) → read-only;
  // `correcting` (owner re-opened) → editable again until re-locked.
  const correctionsOpen = !!(gameQ.data as { corrections_open?: boolean } | undefined)?.corrections_open;
  const locked = status === "complete" && !correctionsOpen;
  const correcting = status === "complete" && correctionsOpen;
  const published = matchesQ.data?.published ?? false;
  const serverMatches = useMemo(() => matchesQ.data?.matches ?? [], [matchesQ.data]);
  const serverParticipants = useMemo(() => matchesQ.data?.participants ?? [], [matchesQ.data]);
  // 2v2 only: the sides (play_groups) carry their own handicap; their members
  // come from participants.play_group_id. Empty for singles.
  const serverPlayGroups = useMemo(
    () => (matchesQ.data?.playGroups ?? []) as { id: string; handicap_strokes: number | null }[],
    [matchesQ.data]
  );
  const membersOfSide = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of serverParticipants) {
      const pg = (p as { play_group_id?: string | null }).play_group_id;
      if (!pg) continue;
      if (!m.has(pg)) m.set(pg, []);
      m.get(pg)!.push(p.user_id as string);
    }
    return m;
  }, [serverParticipants]);

  // Stable color per user across the game.
  const colorOf = useMemo(() => {
    const ids = new Set<string>();
    for (const mm of serverMatches) {
      const a = mm.side_a as SideRef;
      const b = mm.side_b as SideRef;
      if (a?.id) ids.add(a.id);
      if (b?.id) ids.add(b.id);
    }
    const map = new Map<string, string>();
    [...ids].forEach((id, i) => map.set(id, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    return map;
  }, [serverMatches]);

  // ── Team identity (Slice D) ────────────────────────────────────────────────
  // A Ryder-cup match crosses the team line: side A is team[0]'s, side B is
  // team[1]'s. We never store team on a side — it's DERIVED from the players'
  // roster (team_assignments), so moving a player's team re-attributes their
  // match automatically. The two teams are ordered (created_at); the binding is
  // by index so it's consistent across every match.
  const teams = useMemo(
    () => (teamsQ.data ?? []) as { id: string; name: string; short_name: string | null; color: string }[],
    [teamsQ.data]
  );
  // Team binding applies only to a game that's actually IN the competition (a
  // 2-team Ryder cup) — a standalone match stays the neutral per-player flow.
  const twoTeams = !!gameCompId && teams.length === 2;
  // user → team_id (the roster, from team_assignments).
  const teamOfUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignQ.data ?? []) m.set(a.user_id as string, a.team_id as string);
    return m;
  }, [assignQ.data]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  // The team a setup slot is bound to (side A → team[0], side B → team[1]).
  const teamForSlot = (slot: "a" | "b") => (twoTeams ? teams[slot === "a" ? 0 : 1] : undefined);
  // A side's team, DERIVED from its player(s): a user side → that user's team; a
  // pair side → its members' team (both members share one, enforced at setup).
  const teamOfSide = (sideId: string): { id: string; name: string; short_name: string | null; color: string } | undefined => {
    // Per-match (A2a): resolve the side's type from the data, not a game flag — a
    // 2v2 side is a play_group (in `membersOfSide`) → its first member's team; a
    // 1v1 side IS the user. So one game can mix both.
    const memberId = membersOfSide.has(sideId) ? (membersOfSide.get(sideId) ?? [])[0] : sideId;
    if (!memberId) return undefined;
    const teamId = teamOfUser.get(memberId);
    return teamId ? teamById.get(teamId) : undefined;
  };
  // A side's display color: its TEAM color in a 2-team competition, else the
  // per-player palette (standalone / non-team game) — unchanged for those.
  const sideColor = (sideId: string) => (twoTeams ? teamOfSide(sideId)?.color : undefined) ?? colorOf.get(sideId);
  // THE canonical roster-based team-color resolver (team identity = the person's
  // roster, never the slot). A user's team color in a 2-team competition; undefined
  // when teamless or standalone → the consumer falls back to the neutral palette.
  // Shared by the Matches panel (MatchSetup) and the handicap selector.
  const teamColorOf = (userId: string) => (twoTeams ? teamById.get(teamOfUser.get(userId) ?? "")?.color : undefined);
  // The roster of one team — the constrained pool for that side's picker, so a
  // cross-team pair is impossible to assemble (Step 3: invalid unrepresentable).
  const rosterOfTeam = (teamId: string) =>
    [...new Set((assignQ.data ?? []).filter((a) => a.team_id === teamId).map((a) => a.user_id as string))];

  // Handicap keyed by SIDE id: a user (1v1, from game_participants) or a
  // play_group (2v2, from play_groups). Same map shape, the entry/board read it
  // identically.
  const handicapOf = useMemo(() => {
    // Per-match (A2a): populate from BOTH tables unconditionally — user ids and
    // play_group ids never collide, so a mixed game's sides each resolve against
    // whichever holds their id (the server compute does exactly this).
    const m = new Map<string, number>();
    for (const p of serverParticipants) m.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
    for (const pg of serverPlayGroups) m.set(pg.id, effectiveStrokes(pg));
    return m;
  }, [serverParticipants, serverPlayGroups]);

  // Has the user touched ANY slice? Drives the outbox mirror below AND freezes the
  // baseline/baseHash further down — one definition, so "dirty enough to protect"
  // and "dirty enough to freeze the base" can't drift apart.
  const anyTouched =
    draftTouched.current ||
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null ||
    entryModeDraft !== null || modifiersDraft !== null || pointsTotalDraft !== null ||
    courseDraft !== null || delegatesDraft !== null;

  // Draft durability (Layer 2 — hard-teardown outbox). The in-app net (now the
  // confirm-on-leave gate) covers every IN-APP exit; this mirrors the in-progress
  // draft to localStorage so a refresh / tab-close / OS-kill / background can't lose
  // it (incomplete drafts too — those never reach the server at all).
  //
  // It stores the WHOLE composite now, not just the matches slice: under
  // draft-then-save a matches-only outbox recovered your pairings and silently
  // dropped the name / points / course / rules edits made in the same sitting.
  const draftBundle = useMemo<SettingsDraftBundle>(
    () => ({
      matches: draftTouched.current ? draft : null,
      name: nameDraft,
      rules: rulesDraft,
      scoring: scoringDraft,
      entryMode: entryModeDraft,
      modifiers: modifiersDraft,
      pointsTotal: pointsTotalDraft,
      course: courseDraft,
      delegates: delegatesDraft,
    }),
    [draft, nameDraft, rulesDraft, scoringDraft, entryModeDraft, modifiersDraft, pointsTotalDraft, courseDraft, delegatesDraft]
  );
  // The SERVER-produced config hash. Declared here, above the outbox, because the
  // outbox's `base` and Save's `baseHash` MUST BE ONE VALUE — captured once and fed
  // to both. Same query + key `useConfigSync` polls, so it shares that cache and
  // costs no extra round-trip.
  //
  // Why one value: they answer two halves of the same question. The outbox's base
  // decides recover-vs-discard ("did the server move since this draft diverged?");
  // baseHash decides conflict-vs-allow ("is the state I opened with still current?").
  // Key them off DIFFERENT fingerprints and they disagree about what the base was —
  // e.g. a matches-only fingerprint ignores a remote COURSE change, so the outbox
  // happily restores, the baseline re-seeds to the newer server at mount, Save's
  // check passes, and the recovered draft silently overwrites the other device.
  const hashQ = trpc.games.configHash.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );
  const serverHash = hashQ.data?.hash;
  const { recover: recoverDraft, clear: clearDraftOutbox } = useDraftOutbox<SettingsDraftBundle | DraftMatch[]>({
    view: "match",
    gameId,
    draft: draftBundle,
    touched: anyTouched,
    // The hook tracks this while untouched and freezes it at the first edit —
    // exactly when `baseline` freezes, off the same query. So the stored base IS the
    // baseHash the eventual Save is judged against.
    serverFingerprint: serverHash ?? "",
    // Never mirror before the hash lands: an entry stored with base "" could never
    // be recovered (it would compare unequal to every real hash and delete itself).
    //
    // Gated on the DRAFT's flag, not the server's: now that staging Setup unlocks the
    // rows (082), edits made against a still-live game are real drafted work and a
    // refresh must not lose them. The old server gate existed because the outbox fed
    // setPairings writes — nothing auto-writes from it any more, it only restores a
    // draft, so mirroring a staged-Setup game is safe. An untouched live game still
    // mirrors nothing: its rows are locked, so there's nothing to protect.
    enabled: !!gameId && !draftScoringEnabled && !!serverHash,
  });

  // matchId → override, for the game-page projection (per-match award value).
  // DELIBERATELY still keyed off `serverMatches`, not the draft: this feeds the
  // OVERVIEW's header projection, which only renders in scoring mode — where the
  // settings draft is frozen and the server IS the truth — and it keys by SERVER
  // match id (`groups[].matchId`), which a drafted match doesn't have. Repointing it
  // at the draft would break it on the one screen it's used. (The §1 two-store
  // hazard is about SETTINGS rows deriving from two stores; this isn't one.)
  const pointValueByMatch = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const mm of serverMatches) m.set((mm as { id: string }).id, ((mm as { point_value: number | null }).point_value) ?? null);
    return m;
  }, [serverMatches]);

  // This game's delegates (per-game organizers) — a REAL slice of the composite
  // draft, not a placeholder. `save_game_config` replaces the delegate list from
  // the payload for an Owner/Organizer, so the mirror MUST carry the persisted
  // list: seeding it `[]` would make every Organizer's Save silently revoke the
  // game's delegate. Same query key GameIdentityHeader reads → shared cache.
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameId }
  );
  const serverDelegates = useMemo(
    () => ((orgQ.data as { user_id: string }[] | undefined) ?? []).map((o) => o.user_id),
    [orgQ.data]
  );

  // Default total = players per team (total competition players ÷ teams) — the
  // first-setup default the Total Points row persists (behavior only, §3).
  const defaultTotal = useMemo(() => {
    const totalPlayers = (assignQ.data ?? []).length;
    const teamCount = teams.length;
    if (teamCount === 0 || totalPlayers === 0) return 0;
    return Math.round(totalPlayers / teamCount);
  }, [assignQ.data, teams.length]);

  // ── The SERVER MIRROR (Draft-Then-Save P1, spec §1/§2.1) ────────────────────
  // The persisted config as one ConfigDraft. Every untouched slice reads through
  // THIS, so an unedited field still tracks the server (incl. a remote change the
  // #16 hash-poll pulls in) instead of freezing at mount.
  const serverConfigDraft = useMemo<ConfigDraft>(() => {
    const matchInputs: DraftMatchInput[] = (serverMatches as {
      match_number: number | null; side_a: SideRef; side_b: SideRef; point_value: number | null;
    }[]).map((mm, i) => {
      const playersPerSide: 1 | 2 =
        mm.side_a?.type === "play_group" || mm.side_b?.type === "play_group" ? 2 : 1;
      const hcA = mm.side_a?.id ? (handicapOf.get(mm.side_a.id) ?? 0) : 0;
      const hcB = mm.side_b?.id ? (handicapOf.get(mm.side_b.id) ?? 0) : 0;
      return {
        matchNumber: mm.match_number ?? i + 1,
        playersPerSide,
        a: sideMemberIds(mm.side_a, membersOfSide),
        b: sideMemberIds(mm.side_b, membersOfSide),
        handicap: hcA > 0 ? -hcA : hcB > 0 ? hcB : 0,
        pointValue: mm.point_value ?? null,
      };
    });
    const base = configToDraft(
      (gameQ.data ?? {}) as Parameters<typeof configToDraft>[0],
      matchInputs,
      serverDelegates
    );
    // First-setup points default, folded into the MIRROR (not a draft edit) so it
    // lands in the baseline too — opening settings on a fresh game must not read as
    // dirty. This REPLACES the deleted reconcile effect's default-seed: the total is
    // now established by the first Save that happens for another reason (going live
    // is always one), not auto-persisted the moment the row renders. Competition
    // games only — a standalone match has no points at all.
    if (gameCompId && base.pointsTotal == null && defaultTotal > 0) base.pointsTotal = defaultTotal;
    return base;
  }, [serverMatches, membersOfSide, handicapOf, gameQ.data, serverDelegates, gameCompId, defaultTotal]);

  // ── The COMPOSITE draft — the ONE object every derivation and Save reads ─────
  // Slices OVER the mirror. This is the read seam §1 is about: no settings row may
  // derive from `serverMatches` (the two-store hazard that only worked because the
  // single-open accordion force-committed between rows).
  const configDraft = useMemo<ConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: draftScoringEnabled, // === scoringDraft ?? serverConfigDraft.scoringEnabled
      entryMode: entryModeDraft ?? serverConfigDraft.entryMode,
      modifiers: modifiersDraft ?? serverConfigDraft.modifiers,
      // The matches slice is guarded by the SAME `draftTouched` lock the seed effect
      // uses: until the user edits, `draft` is either unseeded ([] off the settings
      // page) or a copy of the server, so the mirror is the honest read. The ref is
      // safe in a memo here because it only ever flips in the same commit as a
      // `setDraft` (editDraft does both), which is already a dep.
      matches: draftTouched.current ? draft : serverConfigDraft.matches,
      pointsTotal: pointsTotalDraft ?? serverConfigDraft.pointsTotal,
      course: courseDraft ?? serverConfigDraft.course,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, draftScoringEnabled, entryModeDraft, modifiersDraft, draft, pointsTotalDraft, courseDraft, delegatesDraft]
  );

  // ── The frozen baseline + baseHash (spec: capture TOGETHER, freeze TOGETHER) ─
  // The dirty check's reference point AND the optimistic-concurrency base, captured
  // in ONE shot from the same render's mirror + the SERVER-produced hash.
  //
  // Both must freeze the moment the draft is touched. If the ~20s poll refreshed the
  // baseHash mid-edit, the conflict check would defeat itself: A saves → my poll
  // lands → my base becomes A's POST-save hash → my Save passes its check → I
  // silently clobber A. Freezing means my Save is judged against the state I
  // actually opened with.
  //
  // The hash is the server's own (`games.configHash`, declared up with the outbox
  // because BOTH must key off the same value) — never recomputed client-side,
  // because `saveConfig` re-derives it via the shared readGameConfigHash and the two
  // must be byte-identical.
  const [baseline, setBaseline] = useState<{ draft: ConfigDraft; hash: string } | null>(null);
  useEffect(() => {
    if (anyTouched) return; // frozen while dirty — see above
    if (!gameQ.data || !serverHash) return;
    setBaseline((prev) =>
      prev && prev.hash === serverHash && configDraftsEqual(prev.draft, serverConfigDraft)
        ? prev // no churn — keep the identity stable so `dirty` doesn't thrash
        : { draft: serverConfigDraft, hash: serverHash },
    );
    // `serverHash` (not hashQ.data) — the SAME binding the outbox's base reads, so
    // the two can't drift apart. Both freeze on this `anyTouched` transition.
  }, [anyTouched, serverConfigDraft, serverHash, gameQ.data]);

  // Save is enabled iff something really changed (pure whole-page equality).
  const dirty = !!baseline && !configDraftsEqual(configDraft, baseline.draft);
  // Did a Save actually land in THIS session? The clean state has two very different
  // causes — "your changes were written" and "your changes were thrown away" (Cancel)
  // or simply "you haven't touched anything yet" — and only the first one may claim a
  // save happened. Cleared the moment the draft goes dirty again.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  // ── Course, drafted (spec §2.2 Design A: the CLIENT pre-computes the snapshot) ─
  // Each handler runs the SAME shared pure derivation the server's applyCourse /
  // setBackNine / clearCourse run, then stages the result — so a drafted course and
  // an immediately-applied one can't drift (CLAUDE.md #8). The `courses` row is
  // fetched imperatively (shared tRPC cache — the row is already warm from the
  // picker in the common case).
  const [courseBusy, setCourseBusy] = useState(false);
  const gameTypeId = (gameQ.data?.game_type_id as string | undefined) ?? "";

  const applyFrontToDraft = (courseId: string, teeName?: string) => {
    if (!gameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const course = await utils.courses.getById.fetch({ courseId });
        const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, gameTypeId, teeName);
        if (!snap.ok) {
          setSaveError(
            snap.reason === "bad_index"
              ? "That course's stroke index isn't a valid permutation — fix it before use."
              : "That game type has no scorecard to snapshot onto."
          );
          return;
        }
        // A fresh front RESETS any prior two-nines back ref (mirrors applyCourse's
        // `back_course_id: null`) — a 9-hole course lands as a lone front that
        // "needs a back nine" until one is composed.
        setSaveError(null);
        setCourseDraft({ id: courseId, backId: null, scorecardSchema: snap.schema });
      } catch {
        setSaveError("Couldn’t load that course — try again.");
      } finally {
        setCourseBusy(false);
      }
    })();
  };

  const applyBackToDraft = (backCourseId: string, backTeeName?: string) => {
    if (!gameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const back = await utils.courses.getById.fetch({ courseId: backCourseId });
        const res = buildComposedCourseSnapshot(
          {
            // Compose onto the DRAFT's front, not the server's — the front may itself
            // be an unsaved pick from this same session.
            frontSchema: configDraft.course.scorecardSchema as ScorecardSchema | null,
            hasBackRef: !!configDraft.course.backId,
            backCourse: back as unknown as CourseSnapshotInput,
          },
          gameTypeId,
          backTeeName
        );
        if (!res.ok) {
          setSaveError(
            res.reason === "back_not_nine"
              ? "The back nine must be a 9-hole course."
              : res.reason === "bad_back_index"
                ? "That course's stroke index isn't a valid permutation — fix it before use."
                : "This isn’t a 9-hole front — it doesn’t take a back nine."
          );
          return;
        }
        setSaveError(null);
        setCourseDraft({ id: configDraft.course.id, backId: backCourseId, scorecardSchema: res.schema });
      } catch {
        setSaveError("Couldn’t load that course — try again.");
      } finally {
        setCourseBusy(false);
      }
    })();
  };

  // Drop just the back nine = re-snapshot the FRONT alone (exactly what the server
  // path does — it re-runs applyCourse with the front), which shrinks the schema
  // back to 9 and clears the back ref → the "needs a back nine" state.
  const removeBackNineFromDraft = () => {
    const frontId = configDraft.course.id;
    if (!frontId) return;
    const teeName = ((configDraft.course.scorecardSchema as { units?: { metadata?: { tee?: { name?: string } } } } | null)
      ?.units?.metadata?.tee?.name ?? "").trim();
    applyFrontToDraft(frontId, teeName || undefined);
  };

  // Clearing reverts the schema to the format's CODE-defined base template — NOT
  // null. `clearCourse` does exactly this; drafting null instead would strip the
  // game of its scorecard entirely.
  const clearCourseInDraft = () => {
    setSaveError(null);
    setCourseDraft({
      id: null,
      backId: null,
      scorecardSchema: getGameTypeDefinition(gameTypeId)?.scorecardSchema ?? null,
    });
  };

  // The game row as the DRAFT sees it — the course rows render pending state from
  // this, so an unsaved pick shows exactly as it will persist.
  const draftGameRow = useMemo(
    () =>
      ({
        ...(gameQ.data as unknown as GameRow),
        name: configDraft.name,
        course_id: configDraft.course.id,
        back_course_id: configDraft.course.backId,
        scorecard_schema: configDraft.course.scorecardSchema,
      }) as GameRow,
    [gameQ.data, configDraft.name, configDraft.course]
  );

  // ── Total Points, off the DRAFT (A2b + Draft-Then-Save) ─────────────────────
  // Both staging adapters are GONE. The points write adapter (mutations +
  // persistEvenShare + bumpPointsBoard + the lifted reconcile + localTotalRef) and
  // the rules blur adapter (commitRules + updateGameM) were scaffolding that
  // reproduced the old per-click writes while the components went controlled; the
  // handlers below are plain draft edits and the page's ONE Save persists them.
  //
  // That deletion is what kills the reconcile's auto-persist: the even share is no
  // longer written from a render at all — `configDraftToPayload` derives it ONCE,
  // at write time, from the FINAL draft, so it can't be computed off a stale match
  // count (P1.4 falls out of this).
  //
  // The paired DRAFT matches resolved to display players + each match's override.
  // Paired-only, so it's the same denominator the award/leaderboard use. Keyed by
  // DRAFT INDEX, never a server match id — an unsaved match has none, and the
  // override travels ON its match (`pointValue`), so add/remove/reorder can't
  // mis-attribute it.
  const pointsMatches = useMemo<PointsMatch[]>(() => {
    const toPlayers = (ids: string[]): SidePlayer[] =>
      ids.map((u) => ({ id: u, name: nameOf.get(u) ?? "Player", teamColor: teamColorOf(u) ?? colorOf.get(u) ?? PLAYER_COLORS[0] }));
    return configDraft.matches
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => isDraftMatchFilled(m))
      .map(({ m, i }) => ({
        id: String(i), // the DRAFT index — the row's key + what onOverrideChange routes back
        number: i + 1,
        aPlayers: toPlayers(m.a),
        bPlayers: toPlayers(m.b),
        pointValue: m.pointValue,
      }));
    // teamColorOf/colorOf/nameOf are per-render closures over memoized maps; react to
    // the underlying data instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configDraft.matches, nameOf, colorOf, teamById, teamOfUser, twoTeams]);

  const onPointsTotalChange = (next: number) => setPointsTotalDraft(next);
  const onPointsOverrideChange = (draftIdx: string, value: number | null) => {
    const idx = Number(draftIdx);
    editDraft((prev) => prev.map((m, i) => (i === idx ? { ...m, pointValue: value } : m)));
  };

  function participant(id: string, fallbackColor?: string): Participant {
    const name = nameOf.get(id) ?? "Player";
    return {
      id,
      name,
      color: sideColor(id) ?? fallbackColor ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(id) ?? null,
    };
  }

  // A scoring side as one Participant, resolved PER SIDE (A2a): a 1v1 side is a user
  // (unchanged); a 2v2 side is a play_group (id = play_group id = the score key).
  // The score key + one-input-per-side shape is what lets entry/board/overview
  // handle 2v2 with no change. (The overview strip's name is still the joined pair;
  // the BUILDER surfaces render players via the shared SideChips instead.)
  function sideParticipant(sideId: string): Participant {
    if (!membersOfSide.has(sideId)) return participant(sideId); // 1v1 user side
    const members = membersOfSide.get(sideId) ?? [];
    const name = members.map((u) => nameOf.get(u) ?? "Player").join(" & ") || "TBD";
    return {
      id: sideId,
      name,
      color: sideColor(sideId) ?? PLAYER_COLORS[0],
      avatarIcon: members[0] ? (avatarIconOf.get(members[0]) ?? null) : null,
    };
  }

  // Persisted scores overlaid with this session's local edits (local wins), so
  // the overview strips reflect scores entered before this load AND just now,
  // without waiting on a refetch.
  const mergedFor = (pid: string) => ({ ...(loadedValues[pid] ?? {}), ...(values[pid] ?? {}) });

  // Effective scorecard: the game's course snapshot (Slice C) or the template
  // default. Drives par + stroke index for the grid, pips, and decided holes —
  // the SAME index the server scores on (no sequential fallback once set).
  const scUnits = useMemo(
    () => unitsFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0]),
    [gameQ.data]
  );
  const scIndex = useMemo(() => strokeIndexOf(scUnits), [scUnits]);

  // Glorious Finishing Holes weight — the LIVE 2×-last-N config off this game
  // (derived at compute time; format-guarded to match singles/doubles). Feeds every
  // matchState on this page + the entry view, the SAME weight the server scores on,
  // so the live strips and the finished record can't diverge.
  const glorious = useMemo<GloriousConfig>(
    () => gloriousConfig(gameQ.data?.game_type_id as string | null, gameQ.data?.modifiers as ModifiersMap | null),
    [gameQ.data]
  );

  // Decided holes (A's perspective) for an overview strip — the shared builder.
  // Refactor B: sourced from recorded outcomes for an outcome-mode game (no
  // scores exist to derive from); byte-identical shared engine either way.
  const decidedFor = (g: MatchGroupData) =>
    outcomeMode
      ? buildDecidedFromOutcomes(
          Object.entries(mergedOutcomeFor(g.matchId)).map(([h, result]) => ({ hole: Number(h), result }))
        )
      : buildDecided(mergedFor(g.a.id), mergedFor(g.b.id), g.strokesA, g.strokesB, scIndex, scUnits.length);

  // A match's current hole = the first hole either player hasn't scored yet, so
  // opening a match drops you where it's at (not the hole you left from).
  const currentHoleFor = (g: MatchGroupData) => {
    // Outcome mode records per-hole OUTCOMES (keyed by hole label), not gross per
    // side — reading the gross merge (mergedFor) there is always empty and lands
    // on hole 1 (item 3). Read the right source per mode; first hole without a
    // value = the current hole (mirrors stroke's currentHoleSeededRef).
    if (outcomeMode) {
      const rec = mergedOutcomeFor(g.matchId);
      for (let h = 1; h <= scUnits.length; h++) {
        if (rec[scUnits[h - 1]?.label ?? String(h)] == null) return h;
      }
      return scUnits.length;
    }
    const va = mergedFor(g.a.id);
    const vb = mergedFor(g.b.id);
    for (let h = 1; h <= scUnits.length; h++) {
      if (va[String(h)] == null || vb[String(h)] == null) return h;
    }
    return scUnits.length;
  };

  // Derive the screen from server state; manual transitions take precedence.
  // Active/complete → the flat overview; pending → setup (owner) or wait (member).
  const derived: Screen = !gameId
    ? "new"
    : status === "complete" || status === "active" || scoringEnabled
      ? "overview"
      : !canEdit
        ? "member-wait"
        : "setup";
  const screen = manualScreen ?? derived;

  // Forward step: remember the screen we're leaving so Back can return to it.
  const go = (next: Screen) => {
    setNavStack((s) => [...s, screen]);
    setManualScreen(next);
  };
  // Back step: pop to the previous workflow screen, or leave the page when
  // there's nothing to pop — router.back() returns to wherever we came from
  // (the leaderboard, when launched from it), so breadcrumb and browser-back
  // agree instead of disagreeing (one to trip home, one to the leaderboard).
  const goBack = () => {
    if (navStack.length === 0) {
      router.back();
      return;
    }
    setManualScreen(navStack[navStack.length - 1]);
    setNavStack((s) => s.slice(0, -1));
  };

  // Browser/OS back steps through the score-entry sub-screens instead of jumping to
  // the leaderboard. Depth: 0 on the hub/overview, 1 in a match's score screen, 2 in
  // its grid (only when not locked — a locked match opens the grid directly, one
  // level). `matchBack()` is the one path the score-entry breadcrumbs use.
  const inGrid = screen === "score" && !locked && gridOpen;
  const matchEntryDepth = (screen === "score" ? 1 : 0) + (inGrid ? 1 : 0);
  const matchBack = useScreenHistory(matchEntryDepth, () => {
    if (inGrid) setGridOpen(false);
    else if (screen === "score") goBack();
  });

  // Seed the editable draft from the server when we land on setup for an
  // existing game (e.g. owner opens a pending game, or taps Edit) and the local
  // draft is empty. Create + Edit also seed via their handlers; this covers a
  // direct/derived landing. Once the user has TOUCHED the draft, never re-derive
  // (the ref guard, immune to the stale-closure race the length guard alone hits).
  useEffect(() => {
    if (draftTouched.current) return;
    // The checklist lives on the settings overlay; seed the draft when it opens
    // with an empty local draft.
    if (!cfgOpen || draft.length > 0) return;
    // Wait for the game row before seeding (course/modifiers/name come from it).
    // NB (Refactor A1): the old "matches-land-before-the-game-row → doubles seeded
    // as singles" race is GONE — `sided` now derives from `matchesQ` (the same
    // query as the matches being seeded), not `gameQ.data.game_type_id`, so shape
    // and matches are always consistent. This gate remains only so the seed reads
    // a loaded game row for its other fields.
    //
    // Wait for the config HASH too: it's the outbox's base, so recovering before it
    // lands would compare a stored base against "" — discarding (and deleting) a
    // perfectly good draft. It batches with the queries above, so this costs nothing
    // in practice. Gating the WHOLE effect (not just the recover) matters: the server
    // seed below fills `draft`, and the `draft.length > 0` guard would then stop the
    // effect ever re-entering to recover.
    if (gameId && (!gameQ.data || !serverHash)) return;
    // Hard-teardown recovery (Layer 2): if an outbox draft survived a refresh/kill
    // AND the server is unchanged since it diverged, restore it. A stale outbox
    // (server moved on) returns null + clears itself. One-shot — restoring a
    // NON-matches slice (a name edit, say) leaves `draft` empty, so without this the
    // effect would re-enter and re-apply the bundle on every server tick.
    if (!didRecoverRef.current) {
      didRecoverRef.current = true;
      const recovered = recoverDraft();
      if (recovered) {
        // A bundle written BEFORE the composite outbox stored the bare matches
        // array — restore it as a matches-only bundle rather than dropping it.
        const bundle: SettingsDraftBundle = Array.isArray(recovered)
          ? { matches: recovered, name: null, rules: null, scoring: null, entryMode: null, modifiers: null, pointsTotal: null, course: null, delegates: null }
          : recovered;
        if (bundle.name !== null) setNameDraft(bundle.name);
        if (bundle.rules !== null) setRulesDraft(bundle.rules);
        if (bundle.scoring !== null) setScoringDraft(bundle.scoring);
        if (bundle.entryMode !== null) setEntryModeDraft(bundle.entryMode);
        if (bundle.modifiers !== null) setModifiersDraft(bundle.modifiers);
        if (bundle.pointsTotal !== null) setPointsTotalDraft(bundle.pointsTotal);
        if (bundle.course !== null) setCourseDraft(bundle.course);
        if (bundle.delegates !== null) setDelegatesDraft(bundle.delegates);
        if (bundle.matches && bundle.matches.length > 0) {
          // Mark touched so the server seed below never clobbers the restore.
          draftTouched.current = true;
          // Normalize `pointValue`: a draft written to localStorage BEFORE the flip
          // predates that field and recovers as `undefined` — which the Save
          // payload's `pointValue: number | null` rejects at the zod boundary
          // (undefined is dropped by JSON, not coerced to null). Default it.
          setDraft(bundle.matches.map((m) => ({ ...m, pointValue: m.pointValue ?? null })));
          return;
        }
      }
    }
    if (serverMatches.length > 0) {
      setDraft(serverDraftFrom(serverMatches, handicapOf, membersOfSide));
      return;
    }
    // Resume-into-empty: a game with no game_matches starts at ZERO matches — a
    // valid empty state (the table hides; only "Add match" shows). "+ Add match"
    // grows it from there (build-as-you-go — W-GAMEPAGE-01 §6.1).
    setDraft([]);
  }, [cfgOpen, draft.length, serverMatches, handicapOf, membersOfSide, sided, gameId, gameQ.data, serverHash, recoverDraft]);

  // (The modifiers seed effect is GONE. It existed because `modifiersDraft` was a
  // server MIRROR that had to be re-synced whenever the row was closed and skipped
  // mid-edit. As a null-when-untouched slice it needs no seed at all: untouched
  // reads the mirror through `configDraft` — which also picks up a remote change
  // for free — and touched holds the edit until Save. This is what retires
  // CLAUDE.md #17's persist-on-COLLAPSE hazard for this page: an edit can no longer
  // be silently discarded by leaving the row open, because collapsing was never
  // what saved it.)

  // ── Actions ──────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!tripId) return;
    const g = await createGame.mutateAsync({
      tripId,
      // One unified type (A1) — the shape lives on the matches the builder writes,
      // not the game type. The name still reflects the current game-level shape.
      gameTypeId: MATCH_PLAY,
      name: sided ? "2v2 Match Play" : "Singles Match Play",
      teeTime: teeTime || null,
    });
    setGameId(g.id);
    // Snapshot the chosen course's par+index onto the new game (the §0 contract).
    if (courseId) {
      try {
        await applyCourse.mutateAsync({ tripId, gameId: g.id, courseId });
      } catch {
        // Non-fatal: the game still works on the template default par/index.
      }
    }
    // A new game starts at ZERO matches (the valid empty state) — no seed row is
    // persisted. "+ Add match" builds the first one (build-as-you-go), persisting
    // on collapse.
    await refreshAfterMatchCountChange();
    // The checklist is interactive the instant setGameId ran (above); leave the
    // draft empty unless the user already started adding (never clobber a touched draft).
    if (!draftTouched.current) {
      setDraft([]);
    }
    // Land straight on the settings page (the checklist's home) — the owner just
    // created the game and wants to configure it (A2-ux correction).
    openConfig();
  }

  // ── THE SAVE (Draft-Then-Save P1, spec §2.7) ────────────────────────────────
  // The ONE commit path for the whole settings page. Everything that used to write
  // piecemeal — persist-on-collapse (matches/handicaps), persist-on-collapse
  // (modifiers), rules-on-blur, points-per-click, course-on-pick, entry-mode-on-tap,
  // name-on-blur, delegate-on-pick, and the saveSetup()+enableScoring two-step — is
  // now one atomic `save_game_config` RPC.
  //
  // `scoring_enabled` is a DRAFT FIELD, not a separate transaction: Save commits the
  // config AND goes live / disables in the same all-or-nothing write. The RPC asserts
  // readiness POST-write inside its tx, so a not-ready go-live rolls the whole thing
  // back — no half-configured live game.
  const saveConfigM = trpc.games.saveConfig.useMutation();

  // The board cascade, run ONLY when Save flips `scoring_enabled`. A config-only
  // save can't change the leaderboard (the game isn't live, so it contributes
  // nothing), so it takes the LEAN path instead — see handleSave.
  async function refreshAfterMatchCountChange() {
    await Promise.all([gameQ.refetch(), matchesQ.refetch(), scoresQ.refetch()]);
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId: tripId!, competitionId });
      utils.games.listByTrip.invalidate({ tripId: tripId! });
      utils.competitions.faceBootstrap.invalidate({ tripId: tripId! });
    }
  }

  /** Drop every slice back to "untouched" so the composite re-mirrors the just-saved
   *  server state and the baseline/baseHash re-seed from the next read.
   *
   *  `matches` seeds the matches slice with what we just SAVED rather than `[]`: the
   *  seed effect only fires into an EMPTY draft, so blanking it would leave the
   *  Matches panel showing "no matches" until the refetch landed. Passing the saved
   *  set keeps the panel showing exactly what's now on the server, with no flash. It
   *  also preserves any UNFILLED rows the user is still building — `configDraftToPayload`
   *  never persists those, and blowing them away as a side effect of an unrelated Save
   *  would silently discard an in-progress add. */
  function resetSlices(matches: DraftMatch[]) {
    draftTouched.current = false;
    setDraft(matches.map((m) => ({ ...m, a: [...m.a], b: [...m.b] })));
    setNameDraft(null);
    setRulesDraft(null);
    setScoringDraft(null);
    setEntryModeDraft(null);
    setModifiersDraft(null);
    setPointsTotalDraft(null);
    setCourseDraft(null);
    setDelegatesDraft(null);
  }

  async function handleSave() {
    if (!tripId || !gameId || !baseline || !dirty || saveConfigM.isPending) return;
    setSaveError(null);
    // `baseline.draft` is what makes matchesDirty honest (an untouched match set
    // must NOT trigger the RPC's clean-replace — that's what lets a game which kept
    // its scores through a disable still be edited and re-enabled).
    const payload = configDraftToPayload(configDraft, baseline.draft);
    // ONE captured value feeds both the conflict check and the outbox base — if
    // these could disagree, conflict-vs-allow and recover-vs-discard would too.
    const baseHash = baseline.hash;
    // Did THIS save flip the live flag? Decides the cascade below.
    const scoringFlipped = payload.scoringEnabled !== baseline.draft.scoringEnabled;

    try {
      await saveConfigM.mutateAsync({ tripId, gameId, baseHash, payload });
    } catch (e) {
      // Keep the draft AND the panel open — edits are never discarded on a failed
      // save. The banner renders the reason (readiness / conflict / course-frozen)
      // legibly rather than a bare toast.
      setSaveError((e as { message?: string })?.message || "Couldn’t save your changes.");
      return;
    }

    clearDraftOutbox(); // durably persisted → drop the teardown copy
    resetSlices(configDraft.matches);
    setOpenRows(new Set());
    setJustSaved(true); // the one path that earns "Saved"

    if (scoringFlipped) {
      // Going live / disabling DOES move the board — run the full cascade. Flip the
      // cache optimistically first so the banner + locks land without a round-trip.
      const cur = utils.games.getById.getData({ tripId, gameId });
      if (cur) {
        utils.games.getById.setData({ tripId, gameId }, { ...cur, scoring_enabled: payload.scoringEnabled } as typeof cur);
      }
      await refreshAfterMatchCountChange();
    } else {
      // LEAN: a config-only save. `saveConfig` returns { ok: true } (the RPC is
      // RETURNS void), so there are no rows to merge — invalidate the two queries
      // this page actually reads (both active → they refetch) and mark the board
      // stale. No scores/leaderboard refetch: the game isn't live, so the board's
      // numbers can't have moved. faceBootstrap is the one that actually refreshes
      // the Live face (CLAUDE.md #10) — invalidating only the child is silently
      // undone by the face's re-seed.
      await Promise.all([
        utils.games.getById.invalidate({ tripId, gameId }),
        utils.matches.listByGame.invalidate({ tripId, gameId }),
      ]);
      utils.games.listByTrip.invalidate({ tripId });
      if (competitionId) utils.competitions.faceBootstrap.invalidate({ tripId });
    }
    // The hash moved (we just changed the config) — refetch it so the baseline
    // re-seeds against the POST-save server state rather than waiting out the poll.
    void hashQ.refetch();
    // No closeConfig(): Save stays put. Flipping to scoring re-renders this page in
    // its locked mode (the user reads the now-live banner); the back arrow leaves.
  }

  /** Cancel = discard every edit and re-mirror the server. The matches slice seeds
   *  straight from the mirror (the persisted set) — that IS the discard. */
  function handleCancel() {
    resetSlices(serverConfigDraft.matches);
    setSaveError(null);
    setJustSaved(false); // discarded, NOT saved — never claim otherwise
    clearDraftOutbox();
  }

  // Feed the settings overlay's confirm-on-leave guard (declared above `dirty`).
  // Only gate while the overlay is actually OPEN and the user can edit — a member's
  // read-only view, or the game screens underneath, must never trap a back-press.
  const guardDirty = cfgOpen && canEdit && dirty;
  useEffect(() => {
    dirtyRef.current = guardDirty;
    discardRef.current = handleCancel;
  });

  // The Setup/Scoring toggle is now a DRAFT edit (spec §2.7-2) — flipping it stages
  // `scoring_enabled` and Save commits it together with the config. `enableReady`
  // still gates the Enable direction client-side; the RPC re-asserts readiness
  // server-side inside the tx, so the gate can't be bypassed.
  function attemptReady() {
    if (draft.length === 0 || filledDraft.length !== draft.length) return;
    setScoringDraft(true);
  }
  function handleDisable() {
    setScoringDraft(false);
  }

  // Dynamic match count — mid-life +1 / −1 (the explicit "arm with 1, add a 2nd
  // mid-life" path). Each persists incrementally (NOT a bulk re-save, so
  // in-progress matches are untouched) and refreshes the board reactively.

  async function handleFinish() {
    if (!tripId || !gameId) return;
    // Spec 1a: never finalize over unconfirmed scores — finish computes from
    // server rows, so an unsaved cell would be silently omitted from standings.
    const gate = unconfirmedCount(saveStatus);
    if (gate.total > 0) {
      showToast(
        gate.errored > 0
          ? `${gate.errored} score${gate.errored > 1 ? "s" : ""} didn’t save — retry before finishing`
          : "Still saving scores — try again in a moment",
      );
      return;
    }
    try {
      await finishGame.mutateAsync({ tripId, gameId });
      await Promise.all([gameQ.refetch(), matchesQ.refetch(), scoresQ.refetch()]);
      // #6: finalize changes the leaderboard — invalidate it so the board
      // reflects the result IMMEDIATELY. The board has no realtime sub (only a
      // 30s poll), so without this it updates only on leave-and-return.
      if (competitionId) {
        utils.competitions.leaderboard.invalidate({ tripId, competitionId });
        utils.games.listByTrip.invalidate({ tripId });
        // The Live face re-seeds competitions.leaderboard FROM faceBootstrap on
        // mount (setData), which marks it fresh and clobbers the invalidate
        // above with the bootstrap's cached value — so invalidate the bootstrap
        // too, or a re-locked correction reads stale until the 30s poll.
        utils.competitions.faceBootstrap.invalidate({ tripId });
      }
      // #550 Task 4: Finish is tapped ON the overview (the "Finish round" /
      // "Re-lock" CTAs). The old `go("overview")` PUSHED another overview onto the
      // nav stack — the two-backs-to-leave bug the unified app-bar back would
      // inherit. We're already on the overview; the refetch above re-renders it as
      // Final · locked. No navigation — stay put (pop-not-push).
    } catch {
      // Stay put (no silent advance). The global error toast surfaces the
      // failure; Finish stays tappable to retry (the recompute is idempotent).
    }
  }

  // (Phase 2B.3's standalone `handleDisable` — a direct games.disableScoring call —
  // is GONE. Disable is a DRAFT edit now (`setScoringDraft(false)`, above): Save
  // commits it through the same atomic RPC, whose true→false branch flips scoring
  // off, returns the game to setup and reverts the active match rows WITHOUT
  // rewriting config — and, as before, never touches scores.)

  // #7: reopen a posted game for correction, then land on the overview so the
  // editor can tap the match to fix (entry is editable again while correcting).
  async function handleCorrect() {
    if (!tripId || !gameId) return;
    try {
      await openCorrection.mutateAsync({ tripId, gameId });
      await gameQ.refetch();
      go("overview");
    } catch {
      // surfaced via the global error toast
    }
  }

  // Scoreable groups (fully-paired matches) for the entry view + grid.
  const groups: MatchGroupData[] = useMemo(
    () =>
      serverMatches
        .filter((mm) => (mm.side_a as SideRef)?.id && (mm.side_b as SideRef)?.id)
        .map((mm, i) => {
          const a = mm.side_a as { id: string };
          const b = mm.side_b as { id: string };
          // Per-side player lists for the shared stacked renderer (item 3): a
          // side id resolves to its play-group members (2v2) or, for a 1v1,
          // the side id IS the user id. Same SidePlayer shape the formation
          // panel / Total Points row already build.
          const sidePlayersOf = (sideId: string): SidePlayer[] =>
            (membersOfSide.get(sideId) ?? [sideId]).map((u) => ({
              id: u,
              name: nameOf.get(u) ?? "Player",
              teamColor: teamColorOf(u) ?? colorOf.get(u) ?? PLAYER_COLORS[0],
            }));
          return {
            matchId: mm.id as string,
            label: `Match ${(mm.match_number as number) ?? i + 1}`,
            a: sideParticipant(a.id),
            b: sideParticipant(b.id),
            aPlayers: sidePlayersOf(a.id),
            bPlayers: sidePlayersOf(b.id),
            strokesA: handicapOf.get(a.id) ?? 0,
            strokesB: handicapOf.get(b.id) ?? 0,
            // Team colors (Slice D) for the strip/entry, when in a 2-team comp.
            leftColor: twoTeams ? teamOfSide(a.id)?.color : undefined,
            rightColor: twoTeams ? teamOfSide(b.id)?.color : undefined,
          };
        }),
    // Team colors come from teamOfSide / sideParticipant, which are plain
    // per-render closures — so we depend on the DATA they read, including the
    // team inputs (twoTeams, teamOfUser, teamById, membersOfSide). Without these,
    // a `groups` computed BEFORE the teams/assignments queries resolved kept
    // stale neutral colors and never recovered when team data landed — the 2v2
    // "teams disappeared on re-entry" bug. Listing them recolors the moment team
    // data arrives. (eslint-disable: we list the data, not the closures.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverMatches, handicapOf, colorOf, nameOf, twoTeams, teamOfUser, teamById, membersOfSide, avatarIconOf, sided]
  );
  // One match at a time: the strip tapped on the overview (falls back to the
  // first). Single-match entry — no shared keypad across matches.
  const selectedGroup = useMemo(
    () => groups.find((g) => g.matchId === selectedMatchId) ?? groups[0] ?? null,
    [groups, selectedMatchId]
  );
  const entryParticipants = selectedGroup ? [selectedGroup.a, selectedGroup.b] : [];

  // #550: as a PANEL, publish this screen's chrome to the app bar (back/title +
  // owner gear + scorecard) instead of rendering our own header. On a standalone
  // route (no provider) `inPanel` is false → we keep our own headers below.
  const inPanel = useInGamePanel();
  const chromeTitle =
    screen === "score" && selectedGroup
      // Item 5: the app-bar title is "Match N" — the player names truncate on a
      // 2v2 and are redundant (they're in the state band + choice rows). label is
      // already "Match N" from the groups builder.
      ? selectedGroup.label
      // The DRAFT's name, not the server's. GameIdentityHeader renders
      // `configDraft.name`, so reading `gameQ.data.name` here put two different names
      // for the same game on screen at once — a stale app bar directly above the live
      // field editing it. Untouched, the draft IS the mirror, so this is identical to
      // the old behaviour everywhere except mid-edit, which is the case that was wrong.
      : configDraft.name.trim() || (sided ? "2v2 Match Play" : "1v1 Match Play");
  usePublishGameChrome(
    inPanel
      ? {
          title: chromeTitle,
          onSettings:
            !cfgOpen && (screen === "overview" || screen === "setup") && canEdit && status !== "complete"
              ? openConfig
              : undefined,
          // Scorecard affordance now lives ON the match card's header row (Zach's
          // QA), not the app bar — so no onScorecard published here.
          // Focused score-entry surface → hide the trip bottom nav (Task 5).
          hideBottomNav: screen === "score",
        }
      : null,
  );

  // #533 header projection (row 2) — a presentation rollup of the match strips
  // ALREADY on this page: "if the game ended now, what does each team get?" Each
  // match's CURRENT standing (up → its team wins the match's points; all-square
  // but started → halved; not started → nothing) summed per team. No engine call,
  // no fetch — the same matchState the strips render, keyed by team via teamOfSide.
  const pointsPerMatch = gameQ.data?.points_distribution?.type === "per_match" ? gameQ.data.points_distribution.value : 0;
  const projectionPerTeam = useMemo(() => {
    const projMatches: ProjMatch[] = groups.map((g) => {
      const st = matchState(decidedFor(g), scUnits.length, glorious);
      return {
        aTeamId: teamOfSide(g.a.id)?.id ?? null,
        bTeamId: teamOfSide(g.b.id)?.id ?? null,
        leader: st.leader,
        started: st.thru > 0,
        // A2b: this match's own override (else the even-share pointsPerMatch fallback)
        // so the game-page projection double-counts an overridden match too.
        points: pointValueByMatch.get(g.matchId) ?? null,
      };
    });
    return rollupMatchPlay(projMatches, pointsPerMatch);
    // decidedFor/teamOfSide are per-render closures; we depend on the DATA they
    // read. GROSS mode reads scores (loadedValues/values); OUTCOME mode reads the
    // per-hole outcomes (loadedOutcomeValues/outcomeValues) — BOTH must be deps or
    // the projection goes stale as outcomes are entered (it only recomputed on
    // remount, i.e. after exiting to the leaderboard). Plus handicaps, roster→team,
    // scorecard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, loadedValues, values, loadedOutcomeValues, outcomeValues, outcomeMode, handicapOf, scIndex, scUnits, twoTeams, teamOfUser, teamById, membersOfSide, pointsPerMatch, pointValueByMatch, glorious]);

  const entryPips = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    if (selectedGroup) {
      m[selectedGroup.a.id] = new Set([...strokeHoles(selectedGroup.strokesA, scIndex)].map(String));
      m[selectedGroup.b.id] = new Set([...strokeHoles(selectedGroup.strokesB, scIndex)].map(String));
    }
    return m;
  }, [selectedGroup, scIndex]);

  // ── Loading ──
  if (!tripId || roleLoading || (gameId && (gameQ.isLoading || matchesQ.isLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // ── Single-match scoring (one match at a time) ──
  if (screen === "score" && selectedGroup) {
    // Score-entry access (Task 2 — reflect the server rule): owner/delegate score
    // any match; a member scores only THEIR OWN match (both players/sides).
    // Tapping a match you can't score lands on the read-only scorecard (like a
    // locked/posted match), never a dead entry screen. SERVER is the real gate.
    const meId = me?.id;
    const inThisMatch = !!meId && (sided
      ? (membersOfSide.get(selectedGroup.a.id) ?? []).includes(meId) ||
        (membersOfSide.get(selectedGroup.b.id) ?? []).includes(meId)
      : selectedGroup.a.id === meId || selectedGroup.b.id === meId);
    const canScoreMatch = canEdit || inThisMatch;
    const readOnly = locked || !canScoreMatch;
    // The read-only scorecard — shared by a read-only/locked viewer's landing
    // surface and the scorer's overlay. Refactor B: an outcome-mode game has no
    // scores to grid, so it swaps in OutcomeScorecard (two lead rows) instead of
    // StandardGrid — same ScorecardChrome (tees/yardage/par/index), only the
    // rows differ (CC follow-up: "look just like the normal scorecard"), so it
    // gets the SAME tee/teeRows StandardGrid does. onCellTap (jump to a hole's
    // entry) is editable-only, score-mode only for now (OutcomeScorecard has no
    // cell-tap yet — hole nav covers navigation); back returns to the matches hub (#7).
    const scorecardGrid = outcomeMode ? (
      <OutcomeScorecard
        units={scUnits}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={gameId}
        a={selectedGroup.a}
        b={selectedGroup.b}
        aPlayers={selectedGroup.aPlayers}
        bPlayers={selectedGroup.bPlayers}
        outcomes={Object.entries(mergedOutcomeFor(selectedGroup.matchId)).map(([h, result]) => ({ hole: Number(h), result }))}
        glorious={glorious}
        leftColor={selectedGroup.leftColor}
        rightColor={selectedGroup.rightColor}
      />
    ) : (
      <StandardGrid
        units={scUnits}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={gameId}
        participants={entryParticipants}
        values={values}
        direction="low_wins"
        pips={entryPips}
        saveStatus={saveStatus}
        glorious={glorious}
        onCellTap={readOnly ? undefined : (label) => {
          setCurrentHole(Number(label) || 1);
          matchBack();
        }}
      />
    );
    return (
      // As a panel: fill BELOW the app bar (absolute inset-0 of the top-14 panel),
      // not fixed inset-0 (which would cover the bar). Standalone: full-screen.
      <div className={inPanel ? "absolute inset-0" : "fixed inset-0 z-50"}>
        {readOnly ? (
          // Read-only when locked OR the viewer can't score this match — the
          // scorecard IS the surface, now an overlay; dismiss returns to the hub.
          <ScorecardSheet title={locked ? "Scorecard · Final" : "Scorecard"} subtitle={scorecardCourseName ?? undefined} onClose={matchBack}>
            {scorecardGrid}
          </ScorecardSheet>
        ) : outcomeMode ? (
          <>
            <MatchOutcomeEntryView
              hideHeader={inPanel}
              gameName={selectedGroup.label}
              subtitle={sided ? "Doubles match · 2v2" : "Singles match · 1v1"}
              units={scUnits}
              match={selectedGroup}
              values={outcomeValues}
              currentHole={currentHole}
              onHoleChange={setCurrentHole}
              onChange={onOutcomeChange}
              onClear={onOutcomeClear}
              saveStatus={outcomeSaveStatus}
              onRetryCell={retryOutcomeCell}
              onBack={matchBack}
              onOpenGrid={() => setGridOpen(true)}
              onFinish={matchBack}
              finishLabel="Back to matches"
              finishSubtext="Outcomes save as you enter"
              meId={me?.id}
              glorious={glorious}
            />
            {gridOpen && (
              <ScorecardSheet title="Scorecard" subtitle={scorecardCourseName ?? undefined} onClose={matchBack}>{scorecardGrid}</ScorecardSheet>
            )}
          </>
        ) : (
          <>
            <MatchEntryView
              hideHeader={inPanel}
              gameName={selectedGroup.label}
              subtitle={sided ? "Doubles match · 2v2" : "Singles match · 1v1"}
              units={scUnits}
              matches={[selectedGroup]}
              values={values}
              currentHole={currentHole}
              onHoleChange={setCurrentHole}
              onChange={onChange}
              onClear={onClear}
              saveStatus={saveStatus}
              onRetryCell={retryCell}
              onBack={matchBack}
              onOpenGrid={() => setGridOpen(true)}
              onFinish={matchBack}
              finishLabel="Back to matches"
              finishSubtext="Scores save as you enter"
              meId={me?.id}
              glorious={glorious}
            />
            {/* Scorecard OVERLAY over entry — entry stays mounted (#543 intact). */}
            {gridOpen && (
              <ScorecardSheet title="Scorecard" subtitle={scorecardCourseName ?? undefined} onClose={matchBack}>{scorecardGrid}</ScorecardSheet>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Shell for the setup screens ──
  // A2-ux correction: the scoreboard page in setup mode is a PASS-THROUGH (the
  // placeholder + a way into settings) — the full checklist lives on the settings
  // overlay (cfgOpen), the ONE home for setup.
  const headerTitle =
    cfgOpen ? "Configuration" : screen === "new" ? "New game" : screen === "setup" ? "Game Setup" : "Matches";
  return (
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: inPanel ? "100%" : "100vh" }}>
      {/* #550: as a panel the app bar carries back/title/gear (published above), so
          the view's own header is suppressed. Standalone route (no bar) keeps it. */}
      {!inPanel && (
        <SetupHeader
          title={headerTitle}
          subtitle={sided ? "Doubles · 2v2 Match Play" : "Singles · 1v1 Match Play"}
          // Settings back routes through history.back() so it's the SAME action as the
          // browser/OS back — both return to the game page.
          onBack={cfgOpen ? closeConfig : goBack}
          right={
            !cfgOpen && (screen === "overview" || screen === "setup") && canEdit && status !== "complete" ? (
              <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
                <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            ) : null
          }
        />
      )}

      {/* Standard game header — row 1 (the collapsed cup hero) + row 2 (this
          game's projected/final per-team contribution), sticky while the match
          list scrolls under it. Competition games only (null otherwise). */}
      {!cfgOpen && screen === "overview" && (
        <GamePageHeader
          tripId={tripId}
          competitionId={competitionId}
          projection={{
            perTeam: projectionPerTeam,
            gameName: (gameQ.data?.name as string | undefined)?.trim() || (sided ? "2v2 Match Play" : "Singles Match Play"),
            final: status === "complete",
          }}
        />
      )}

      <div className="w-full px-4 py-5">
      {!cfgOpen && screen === "new" && (
        <NewGame
          tripId={tripId}
          game={gameQ.data as unknown as GameRow | undefined}
          teeTime={teeTime}
          setTeeTime={setTeeTime}
          courseName={courseName}
          onPickCourse={() => setCoursePickerOpen(true)}
          onCreate={handleCreate}
          pending={createGame.isPending || applyCourse.isPending}
          canEdit={canEdit}
        />
      )}

      {coursePickerOpen && (
        <CoursePicker
          onClose={() => setCoursePickerOpen(false)}
          onApply={({ id, name }) => {
            setCourseId(id);
            setCourseName(name);
            setCoursePickerOpen(false);
          }}
        />
      )}

      {!cfgOpen && screen === "member-wait" && (
        <SetupPlaceholder tripId={tripId} game={gameQ.data as unknown as GameRow | undefined} />
      )}

      {/* A2-ux correction: the setup-mode scoreboard is a PASS-THROUGH for the
          owner/delegate — the placeholder + a way into the ONE settings page (the
          front "set it up" button here; the corner gear in the header). NO checklist
          and NO toggle on this page (the toggle would self-destruct here). */}
      {!cfgOpen && screen === "setup" && (
        <SetupPlaceholder
          tripId={tripId}
          game={gameQ.data as unknown as GameRow | undefined}
          message="Set the matchups, course, and points on the settings page — the crew can’t see the game until you switch it to scoring."
        >
          <button
            type="button"
            onClick={openConfig}
            data-testid="setup-go-to-settings"
            className="mx-auto flex items-center justify-center gap-2"
            style={{ height: 48, padding: "0 22px", borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}
          >
            <Settings size={17} /> Set up this game
          </button>
        </SetupPlaceholder>
      )}

      {cfgOpen && (() => {
        // The config CHECKLIST — UNIFORM canonical rows; each EXPANDS its editor IN
        // PLACE (the row is the frame; the panel drops down beneath it, sheds all
        // modal chrome). MULTI-OPEN (page-owned `openRows`): collapsing is no longer
        // a commit, so any number of rows can be open at once and every row reads the
        // ONE composite draft. The page's single Save (the bar at the top) is the
        // only thing that writes.
        const allFilled = allMatchesFilled(draft);
        // Roster integrity (team-identity PR 1, the D-gap catch): a paired side whose
        // player has LOST their team is invalid even though its SLOTS are full
        // (dropped-after-paired). The keystone predicate (teamRoster.ts) — distinct
        // from the slot-filled `allFilled` above. Only meaningful in a 2-team
        // competition (standalone match play has no teams → always roster-valid).
        const teamedUserIds = new Set(teamOfUser.keys());
        const allRosterValid = !twoTeams || draft.every((d) => matchRosterValid(d.a, d.b, d.playersPerSide, teamedUserIds));
        // C3: points > 0 joins the Enable gate (Phase C) — but ONLY for a
        // COMPETITION game. Points-per-match is a cup concept: the inline Points row
        // exists only when `gameCompId` is set (GameSetupRows gates it on
        // competitionId), and a STANDALONE match game has no points at all (created
        // with points_distribution null). So the points term is conditional —
        // otherwise a standalone game (no Points UI, always 0) could NEVER enable.
        // A2b: readiness keys on the owner-set TOTAL (effectiveTotal = points_total ??
        // players-per-team default), NOT the even share — an all-overridden game has a
        // 0 even share but a real total, and must still be enable-able. This is the
        // SAME resolved truth the Total Points row shows (total > 0), so the row's
        // state and the gate agree; pointsReady is the family's client-gate extension.
        const effectiveTotal = (configDraft.pointsTotal ?? null) ?? defaultTotal;
        const enableReady = allFilled && allRosterValid && (!gameCompId || pointsReady(effectiveTotal));
        const anyHandicap = draft.some((d) => d.handicap !== 0);
        // ≥1 valid (paired) match — the downstream gate (readiness rework P3). Points
        // and Handicaps stay LOCKED until a match exists (they attach to a matchup).
        // Modifiers are NO LONGER gated on this (Task 3b — they're an early format
        // decision, decidable before matchups are set). One named predicate, shared.
        const matchesExist = hasValidMatch(draft);
        // Standalone-only readout now (T4 hides this row for competitions), so the
        // count is just the trip crew — no roster branch.
        const availableCount = crew.data?.length ?? 0;
        // Task 3a: cap the "add match" affordance for 1v1 ONLY, at the number of
        // players per team (each player gets one match). In a 2-team cup that's
        // min(team sizes) — each 1v1 match pairs one player from each team;
        // standalone pairs any two of the crew (floor(crew/2)). Cap only when the
        // roster has actually loaded (>0) so a not-yet-loaded roster never hides
        // "add match".
        //
        // DELIBERATELY NOT capping 2v2: a rigid doubles cap assumes perfectly even,
        // perfectly paired teams — but injury/illness can force a 1v2 or an odd
        // pairing, and a hard cap would BLOCK a legitimate real-world lineup. Cap
        // only where the maximum is genuinely fixed (1v1); leave 2v2 open (the 24
        // ceiling only) so it flexes to reality.
        // Per-match shape (A2a) means a game can mix 1v1 + 2v2, so the old
        // singles-only team-size cap no longer applies at the game level — a mixed
        // lineup can legitimately exceed it. Fall back to the generous MAX ceiling;
        // per-shape caps can be reintroduced on the add-match choice if wanted.
        const maxMatchesForAdd = MAX_MATCHES;
        // §5 row copy. Per-match shape (A2a): the title is just "Matches" (a game
        // can mix 1v1 + 2v2, so a single format name would lie); the subtitle is a
        // COMPOSITION line — "6 singles · 1 doubles · X of Y assigned". Matches uses
        // the INVALID state while any slot is empty (§4/§6.1 hard-block).
        const matchesTitle = "Matches";
        const singlesCount = draft.filter((d) => d.playersPerSide === 1).length;
        const doublesCount = draft.filter((d) => d.playersPerSide === 2).length;
        const compParts: string[] = [];
        if (singlesCount) compParts.push(`${singlesCount} single${singlesCount > 1 ? "s" : ""}`);
        if (doublesCount) compParts.push(`${doublesCount} double${doublesCount > 1 ? "s" : ""}`);
        const matchesSubtitle = draft.length === 0
          ? "No matches yet — add one to start"
          : [...compParts, `${filledDraft.length} of ${draft.length} assigned`].join(" · ");
        // Three-way: 0 matches is a VALID EMPTY state (neutral, not red — a brand-new
        // game shouldn't open in error); a draft with any unfilled/under-rostered slot
        // is invalid (red); all filled + rostered is resolved. (P2/P2b collapse-boundary
        // timing unchanged — this only adds the empty state ahead of the invalid one.)
        const matchesState: ChecklistRowState =
          draft.length === 0 ? "empty" : allFilled && allRosterValid ? "resolved" : "invalid";
        // Handicaps is hard-gated on Matches AND Course (W-9HOLE-01): the per-hole
        // stroke allocation needs the course's stroke-index table, so a complete
        // 18 must resolve first. "Course resolved" = a course applied AND an 18-hole
        // schema (a lone 9-hole front still "needs a back nine" → not resolved).
        const courseResolved =
          !!configDraft.course.id &&
          (((configDraft.course.scorecardSchema as { units?: { count?: number } } | null)?.units?.count) ?? 0) === 18;
        const handicapsReady = matchesExist && courseResolved;
        const handicapsState: ChecklistRowState = anyHandicap ? "resolved" : "empty";
        // When the row is disabled (course/matches not yet resolved) the subtitle
        // NAMES the missing prerequisite, so the dimmed row reads "not available
        // yet" (Task 2c) rather than an unexplained inert control.
        const handicapsSubtitle = !matchesExist
          ? "Set the matchups first"
          : !courseResolved
            ? "Choose a course first"
            : anyHandicap
              ? "Handicaps assigned"
              : "No handicaps assigned";
        // Modifiers (W-GAMEPAGE-01 §6.5) — applicability is data-driven from the
        // format's gameTypes.ts compatibleModifiers (NOT the deprecated DB column).
        // Empty → the row is hidden entirely.
        const availableModifiers = GAME_TYPES.find((t) => t.id === gameQ.data?.game_type_id)?.compatibleModifiers ?? [];
        const modifiersOn = enabledCount(configDraft.modifiers, availableModifiers);
        const modifiersState: ChecklistRowState = modifiersOn > 0 ? "resolved" : "empty";
        const modifiersSubtitle = modifiersOn > 0 ? "Modifiers have been added" : "No modifiers added to your round yet";
        const onSetupChanged = () => {
          void gameQ.refetch();
          if (competitionId) {
            utils.competitions.leaderboard.invalidate({ tripId, competitionId });
            utils.competitions.faceBootstrap.invalidate({ tripId });
            utils.games.listByTrip.invalidate({ tripId });
          }
        };
        return (
          <SettingsColumn className="pb-4">
            {/* SAVE BAR — the page's ONE commit, at the TOP (spec §2.7). Every row
                below is a draft edit; nothing reaches the server until this. Save is
                Primary (STYLE_GUIDE §5, inline — there's no shared <Button>), Cancel
                is Ghost, and Save enables only when the draft actually differs from
                the frozen baseline. */}
            {canEdit && (
              <SaveBar
                dirty={dirty}
                saving={saveConfigM.isPending}
                justSaved={justSaved}
                error={saveError}
                onSave={() => void handleSave()}
                onCancel={handleCancel}
              />
            )}

            {/* Zone 1 — IDENTITY header (W-EDITMODAL-01): name (tap-to-edit) +
                "Assigned to" frame. Display-first, above the checklist. Competition
                games only — it re-homes the modal's name/delegate, which were
                competition-scoped (a standalone game has no delegate/config row).
                CONTROLLED: name + delegate are draft slices — a live write here would
                move the config hash out from under our frozen baseHash. */}
            {gameCompId && gameQ.data && (
              <GameIdentityHeader
                tripId={tripId}
                game={gameQ.data as unknown as GameRow}
                canEdit={canEdit}
                isOwner={isOwner}
                nameValue={configDraft.name}
                onNameChange={setNameDraft}
                delegateValue={configDraft.delegates[0] ?? null}
                onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
              />
            )}

            {/* Format explainer — the compact "how you compete" block that pairs
                directly ABOVE Rules (this is the slot reserved for it). */}
            {gameCompId && gameQ.data && (
              <div className="mt-6">
                <GameFormatExplainer
                  gameTypeId={(gameQ.data as unknown as GameRow).game_type_id}
                  variant="settings"
                />
              </div>
            )}

            {/* RULES OF THE DAY — at the TOP (out of the awkward middle zone that
                disables in scoring mode). Always editable (incl. scoring mode) per
                the carved-out exception (plain canEdit). A draft slice now — the
                page's Save persists it, so there's no on-blur commit. */}
            {gameCompId && gameQ.data && (
              <GameRulesNote
                tripId={tripId}
                game={gameQ.data as unknown as GameRow}
                canEdit={canEdit}
                controlled
                value={configDraft.rulesForToday ?? ""}
                onChange={setRulesDraft}
              />
            )}

            {/* A2-ux: the single Setup/Scoring toggle — the keystone game-mode control,
                now on the ONE settings page (this checklist's home) in BOTH directions.
                Setup mode → the Scoring segment enables (attemptReady → status:'active'),
                gated by enableReady; scoring mode → the Setup segment disables (back to
                setup, scores kept). Rendered for any canEdit game (NOT competition-gated,
                so a standalone match game still toggles — it has no GameIdentityHeader). */}
            {canEdit && (
              <>
                {/* #512 §4: GAME MANAGEMENT is a peer section — a labeled divider above
                    the toggle matching SETTINGS / OPTIONS (the panel's own caption is
                    suppressed via hideLabel so it isn't double-labeled). */}
                <ZoneHeader>Game Management</ZoneHeader>
                {/* The toggle reads the DRAFT (`configDraft.scoringEnabled`), not the
                    server — flipping it stages the change and Save commits it with the
                    rest of the config, so the mode you see is the mode you'd save. */}
                <GameManagementPanel
                  mode={configDraft.scoringEnabled ? "scoring" : "setup"}
                  ready={enableReady}
                  onEnable={attemptReady}
                  onDisable={handleDisable}
                  pending={saveConfigM.isPending}
                  // The toggle answers the tap from the DRAFT, but until Save lands the
                  // server disagrees — say so rather than claim a live game that isn't.
                  staged={configDraft.scoringEnabled !== scoringEnabled}
                  hideLabel
                />
              </>
            )}

            {/* #501: live-game lock — the settings below freeze until the owner/
                delegate flips the toggle above back to Setup. Follows the DRAFT, in
                lockstep with `settingsEditable`: the banner explains why the rows are
                frozen, so it has to clear exactly when they unlock or it contradicts
                them. (082 is what makes staging Setup a real unlock — see
                `settingsEditable`.) */}
            {draftScoringEnabled && canEdit && <ScoringLockBanner staged={draftScoringEnabled !== scoringEnabled} />}

            {/* Available players (W-GAMEPAGE-01 §8) — STANDALONE games only. In a
                competition the rosters live on the competition face (the leaderboard
                + RostersOverlay own team membership), so this read-only echo is
                redundant noise here; the row is hidden entirely. */}
            {!gameCompId && (
              <ChecklistRow
                icon={Users}
                title="Players"
                subtitle={`${availableCount} player${availableCount === 1 ? "" : "s"}`}
                state="resolved"
                expanded={openRows.has("players")}
                onToggle={() => toggleRow("players")}
                testId="row-players"
              >
                <div data-testid="players-rosters">
                  <div className="flex flex-col gap-1">
                    {(crew.data ?? []).map((c) => (
                      <span key={c.user_id} className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                        {nameOf.get(c.user_id) ?? "Player"}
                      </span>
                    ))}
                  </div>
                </div>
              </ChecklistRow>
            )}

            {/* ── Zone 3 — SETTINGS (the required spine that gates Enable scoring):
                Matches · Course · Format·Points (W-GAMEPAGE-01 §5). ── */}
            <ZoneHeader>Settings</ZoneHeader>

            {/* Matches — the pairing builder (the score-entry unit), in place. */}
            <ChecklistRow
              icon={Swords}
              title={matchesTitle}
              subtitle={matchesSubtitle}
              state={matchesState}
              // #501: non-expandable AND force-collapsed in scoring mode (MatchSetup
              // has no read-only mode, so it must not render interactively when live).
              // #512: locked → dim + lock icon (it reads as frozen, not just chevron-less).
              locked={draftScoringEnabled}
              expanded={openRows.has("matches") && settingsEditable}
              onToggle={settingsEditable ? () => toggleRow("matches") : undefined}
              testId="row-matches"
            >
              <MatchSetup
                tripId={tripId}
                draft={draft}
                setDraft={editDraft}
                nameOf={nameOf}
                colorOf={colorOf}
                teamColorOf={teamColorOf}
                avatarIconOf={avatarIconOf}
                teamForSlot={teamForSlot}
                maxMatches={maxMatchesForAdd}
                openSelector={(matchIdx, slot, memberIdx) => setSelector({ matchIdx, slot, memberIdx })}
              />
            </ChecklistRow>

            {/* Entry Mode (Refactor B3) — score entry (today, default) vs
                hole-outcome entry (tap who won each hole directly). A "how you'll
                score this match" decision, independent of Course/Handicaps/Points
                (which stay visible either way — unused-but-harmless in outcome
                mode, a deliberate B3 scope boundary). Frozen once scoring starts,
                same as every other setup-spine row — switching mid-round would
                orphan whichever rows (score_entries / match_hole_outcomes) are
                already entered. */}
            {gameQ.data && (
              <EntryModeRow
                entryMode={configDraft.entryMode === "outcome" ? "outcome" : "score"}
                canEdit={settingsEditable}
                locked={draftScoringEnabled}
                onChange={setEntryModeDraft}
              />
            )}

            {/* Course — Handicaps' per-hole stroke allocation needs the course's
                stroke-index table, so Course resolves before Handicaps (W-9HOLE-01).
                CONTROLLED: the course is a DRAFT slice. It cannot be deferred to a
                later pass — a course applied straight to the server while the rest of
                the page drafts would be reverted by Save writing the draft's older
                course back, and it would move the config hash out from under our
                frozen baseHash (the user's own Save would then conflict).
                `draftGameRow` feeds the row the DRAFT's course state, so it renders
                the pending front/back/needs-a-back-nine exactly as it will persist. */}
            {gameQ.data && (
              <GameSetupRows
                slot="course"
                tripId={tripId}
                competitionId={gameCompId}
                game={draftGameRow}
                canEdit={settingsEditable}
                locked={draftScoringEnabled}
                courseOpen={openRows.has("course")}
                onOpenCourse={() => toggleRow("course")}
                onCloseEditor={() => closeRow("course")}
                onChanged={onSetupChanged}
                onApplyFront={applyFrontToDraft}
                onApplyBack={applyBackToDraft}
                onRemoveBackNine={removeBackNineFromDraft}
                onClearCourse={clearCourseInDraft}
                courseBusy={courseBusy}
              />
            )}

            {/* Total Points — the A2b spine (Refactor A2b): the owner sets a TOTAL,
                the per-match value DERIVES (total ÷ matches), and individual matches
                can be OVERRIDDEN with the remainder redistributing to keep the total
                locked. Replaces the old inline "Points Per Match" stepper for match
                play; rack keeps its "Points per Slot" inline control (GameSetupRows).
                Competition games only (a standalone match has no points). */}
            {gameQ.data && gameCompId && (
              <MatchPointsRow
                matches={pointsMatches}
                pointsTotal={configDraft.pointsTotal}
                defaultTotal={defaultTotal}
                canEdit={settingsEditable}
                locked={draftScoringEnabled}
                expanded={openRows.has("config")}
                onToggle={() => toggleRow("config")}
                onTotalChange={onPointsTotalChange}
                onOverrideChange={onPointsOverrideChange}
              />
            )}

            {/* ── Zone 4 — OPTIONS (never gate Enable): Handicaps · Modifiers ·
                Rules of the Day (W-GAMEPAGE-01 §5). ── */}
            <ZoneHeader>Options</ZoneHeader>

            {/* Handicaps — hard-gated on Matches AND Course (W-9HOLE-01): both must
                resolve (a complete 18) before per-hole strokes can be allocated. */}
            <ChecklistRow
              icon={SlidersHorizontal}
              title="Handicaps"
              subtitle={handicapsSubtitle}
              state={handicapsState}
              // #501: non-expandable AND force-collapsed in scoring mode (HandicapsSection
              // has no read-only mode). #512: locked → dim + lock icon.
              locked={draftScoringEnabled}
              // Task 2c: when the prerequisites aren't met (no course / no matches)
              // the row is VISIBLY disabled (dimmed), not silently unclickable — pass
              // the real toggle but mark it disabled so it reads "not available yet".
              disabled={!handicapsReady}
              expanded={openRows.has("handicaps") && settingsEditable}
              onToggle={settingsEditable ? () => toggleRow("handicaps") : undefined}
              testId="row-handicaps"
            >
              <HandicapsSection
                draft={draft}
                setDraft={editDraft}
                nameOf={nameOf}
                colorOf={colorOf}
                // Roster team color (the shared canonical resolver) — assigned
                // players read their team color; an unassigned player gets undefined →
                // the neutral palette (honest). Same source the Matches panel + overview use.
                teamColorOf={teamColorOf}
              />
            </ChecklistRow>

            {/* Modifiers (W-GAMEPAGE-01 §6.5) — config-only "special rules" driven
                by the format's compatibleModifiers (gameTypes.ts). Hidden entirely
                when the format offers none; otherwise an accordion of toggle cards
                (+ a hole-count stepper for glorious_holes), persist-on-collapse. */}
            {availableModifiers.length > 0 && (
              <ChecklistRow
                icon={Sparkles}
                title="Game Modifiers"
                subtitle={modifiersSubtitle}
                state={modifiersState}
                locked={draftScoringEnabled}
                expanded={openRows.has("modifiers")}
                // Task 3b: modifiers are an EARLY format decision (carry-over, moving
                // tees); matches (who plays whom) is often decided the day before.
                // Don't gate early-decidable config on late-decided data — no
                // matchesExist dependency here (settingsEditable only).
                onToggle={settingsEditable ? () => toggleRow("modifiers") : undefined}
                testId="row-modifiers"
              >
                <ModifierCards
                  available={availableModifiers}
                  modifiers={configDraft.modifiers}
                  onChange={setModifiersDraft}
                  readOnly={!settingsEditable}
                />
              </ChecklistRow>
            )}

            {/* (The persist-on-collapse retry button is GONE with the mechanism it
                retried. Save is the ONE commit and it reports its own failure in the
                SaveBar above, next to the action that failed.) */}

            {/* Danger zone — owner-only (A2-ux correction: the settings page is now the
                ONE home, so the per-game danger ladder lives here too: reset scores /
                reset settings / delete).

                The ONE control here that deliberately keeps reading the SERVER's flag
                while everything above it follows the draft. These aren't drafted edits
                — they're immediate, irreversible server surgery. A game that is LIVE
                and being scored on right now must not have its scores wiped because
                someone staged a Setup toggle they haven't saved; the gate has to
                reflect what's actually live, not what's merely intended. Consequence
                worth knowing: the HAS_SCORES refusal points here, so on a live scored
                game the user Saves the disable first, THEN resets. */}
            {isOwner && gameQ.data && (
              <GameDangerZone
                tripId={tripId}
                gameId={gameQ.data.id as string}
                competitionId={gameCompId}
                onChanged={onSetupChanged}
                onDeleted={() => router.push(competitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`)}
                disabled={scoringEnabled}
              />
            )}
          </SettingsColumn>
        );
      })()}

      {!cfgOpen && screen === "overview" && (
        <Overview
          tripId={tripId}
          game={gameQ.data as unknown as GameRow | undefined}
          groups={groups}
          myId={me?.id}
          published={published}
          complete={status === "complete"}
          canEdit={canEdit}
          decidedFor={decidedFor}
          glorious={glorious}
          holeCount={scUnits.length}
          onFinish={handleFinish}
          finishing={finishGame.isPending}
          correcting={correcting}
          canCorrect={canEdit && locked}
          onCorrect={handleCorrect}
          correctingPending={openCorrection.isPending}
          onOpenMatch={(matchId) => {
            const g = groups.find((x) => x.matchId === matchId);
            if (g) setCurrentHole(currentHoleFor(g));
            setSelectedMatchId(matchId);
            setValues((v) => (Object.keys(v).length ? v : loadedValues));
            setOutcomeValues((v) => (Object.keys(v).length ? v : loadedOutcomeValues));
            // Locked → land on the read-only scorecard overlay; otherwise editable
            // entry (a non-scorer still resolves to read-only in the score screen).
            setGridOpen(locked);
            go("score");
          }}
        />
      )}
      </div>

      {/* Confirm-on-leave (P1.7) — the whole page is one draft, so a back-press with
          unsaved edits would bin it silently. Both exits (the arrow and the OS/browser
          back) route through the overlay's guard, which raises this instead. */}
      {confirmingClose && (
        <DiscardChangesPrompt
          onDiscard={confirmDiscard}
          onKeepEditing={cancelClose}
          onSave={() => {
            cancelClose();
            void handleSave();
          }}
          saving={saveConfigM.isPending}
        />
      )}

      {/* Player selector sheet — constrained to the side's team in a 2-team
          competition (no cross-team pair), else the whole roster/crew. */}
      {selector && (() => {
        const slotTeam = teamForSlot(selector.slot);
        const selectorCrew = slotTeam
          ? rosterOfTeam(slotTeam.id)
          : gameCompId && rosterIds.length > 0
            ? rosterIds
            : (crew.data ?? []).map((c) => c.user_id);
        return (
          <PlayerSelector
            matchIdx={selector.matchIdx}
            slot={selector.slot}
            memberIdx={selector.memberIdx}
            sided={sided}
            teamLabel={slotTeam?.name}
            teamColor={slotTeam?.color}
            draft={draft}
            crew={selectorCrew}
            nameOf={nameOf}
            onPick={(userId) => {
              editDraft((prev) => assignInDraft(prev, selector.matchIdx, selector.slot, selector.memberIdx, userId));
              setSelector(null);
            }}
            onClose={() => setSelector(null)}
          />
        );
      })()}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function serverDraftFrom(
  serverMatches: unknown[],
  handicapOf: Map<string, number>,
  membersOfSide: Map<string, string[]>
): DraftMatch[] {
  // A server side → its member user ids, resolved from the side's OWN type
  // (sideMemberIds) so the reconstruction can't be corrupted by a not-yet-loaded
  // `sided` flag — the 2v2-matches-vanish-on-reopen race.
  return (serverMatches as { match_number: number; side_a: SideRef; side_b: SideRef; point_value: number | null }[]).map((mm, i) => {
    const hcA = mm.side_a?.id ? (handicapOf.get(mm.side_a.id) ?? 0) : 0;
    const hcB = mm.side_b?.id ? (handicapOf.get(mm.side_b.id) ?? 0) : 0;
    // Per-match shape (A2a) read from the side's own type: a play_group side ⇒ 2v2.
    const playersPerSide: 1 | 2 =
      mm.side_a?.type === "play_group" || mm.side_b?.type === "play_group" ? 2 : 1;
    return {
      matchNumber: mm.match_number ?? i + 1,
      playersPerSide,
      a: sideMemberIds(mm.side_a, membersOfSide),
      b: sideMemberIds(mm.side_b, membersOfSide),
      handicap: hcA > 0 ? -hcA : hcB > 0 ? hcB : 0,
      // The per-match points override rides the draft match now (A2b + P1) — seed it
      // from the server or the Points row would reset every override on re-entry.
      pointValue: mm.point_value ?? null,
    };
  });
}

// Assign userId to (matchIdx, slot, memberIdx); if already on another side, MOVE
// them and clear the vacated match's handicap (the relationship it described is
// gone). Singles keeps its exact one-per-slot behavior; doubles fills a member
// position within a 2-player side.
function assignInDraft(
  prev: DraftMatch[],
  matchIdx: number,
  slot: "a" | "b",
  memberIdx: number,
  userId: string
): DraftMatch[] {
  const next = prev.map((d) => ({ ...d, a: [...d.a], b: [...d.b] }));
  // Per-match shape (A2a): the target match's own shape drives the assignment.
  const playersPerSide = next[matchIdx]?.playersPerSide ?? 1;
  if (playersPerSide === 1) {
    // Singles — identical to the original: clear from OTHER matches, set here.
    next.forEach((d, i) => {
      if (i === matchIdx) return;
      if (d.a[0] === userId) { d.a = []; d.handicap = 0; }
      if (d.b[0] === userId) { d.b = []; d.handicap = 0; }
    });
    next[matchIdx][slot] = [userId];
    return next;
  }
  // Doubles — remove the player from every side (move); only OTHER matches lose
  // their handicap. Then place at the requested member position in the target.
  next.forEach((d, i) => {
    (["a", "b"] as const).forEach((s) => {
      if (d[s].includes(userId)) {
        d[s] = d[s].filter((u) => u !== userId);
        if (i !== matchIdx) d.handicap = 0;
      }
    });
  });
  const target = next[matchIdx];
  const arr = target[slot].slice();
  if (memberIdx < arr.length) arr[memberIdx] = userId;
  else arr.push(userId);
  target[slot] = arr;
  return next;
}

/**
 * Setup-flow title bar — matches the entry app bar (Quick Game / score views):
 * back arrow only (top-left), centered title (white) + subtitle, optional
 * top-right slot (the overview's Edit link).
 */
/**
 * SaveBar — the settings page's ONE commit affordance (Draft-Then-Save P1 §2.7).
 *
 * At the TOP of the page: every row below is a draft edit, so the commit belongs
 * where the user can see it the whole time rather than at the end of a long scroll.
 * Save is **Primary** and Cancel is **Ghost** (STYLE_GUIDE §5, inline-styled — the
 * repo has no shared <Button>). Save is disabled until the draft actually differs
 * from the frozen baseline, so it can't fire a no-op write.
 *
 * On failure the panel STAYS open, the draft is kept, and the reason renders here
 * legibly — the RPC's readiness assert (PRECONDITION_FAILED "finish setting up this
 * game…"), the optimistic-concurrency CONFLICT, and the course/matches freeze all
 * arrive as real sentences, so the banner names what to fix instead of a bare
 * "save failed".
 */
function SaveBar({
  dirty,
  saving,
  justSaved,
  error,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  /** A Save actually landed this session — the ONLY state that may claim one did. */
  justSaved: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  // "Clean" is not the same claim as "saved". Cancel DISCARDS the draft and lands
  // clean, and an untouched page is clean too — neither wrote anything, so neither
  // may say so. Only a landed Save earns "Saved"; otherwise the label says nothing
  // rather than something false.
  const hint = saving ? "Saving…" : dirty ? "Unsaved changes" : justSaved ? "Saved" : "";
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-1 px-4 pb-2 pt-2" style={{ background: "var(--color-bt-base)" }} data-testid="settings-save-bar">
      <div className="flex items-center gap-2.5">
        <span className="flex-1 truncate text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="settings-dirty-hint">
          {hint}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={!dirty || saving}
          className="disabled:opacity-40"
          style={{
            height: 38,
            padding: "0 14px",
            borderRadius: 12,
            background: "transparent",
            color: "var(--color-bt-text-dim)",
            border: "0.5px solid var(--color-bt-border)",
            fontSize: 14,
            fontWeight: 600,
          }}
          data-testid="settings-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="disabled:opacity-40"
          style={{
            height: 38,
            padding: "0 18px",
            borderRadius: 12,
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            border: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
          data-testid="settings-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <p
          className="mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--color-bt-danger-faint)", border: "1px solid var(--color-bt-danger-border)", color: "var(--color-bt-danger)" }}
          data-testid="settings-save-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * DiscardChangesPrompt (P1.7) — the confirm-on-leave gate.
 *
 * Draft-then-save moved the whole settings page onto ONE draft, which turned a
 * back-press into a silent data-loss path (the old per-row persistence meant leaving
 * could never lose anything). This offers the way OUT of that: Save what you did,
 * keep editing, or explicitly throw it away.
 *
 * Discard is the DANGER action and it is never the default — the safe options come
 * first, and the destructive one is styled as destructive (STYLE_GUIDE §5), because
 * the thing it destroys is the user's unsaved work.
 */
function DiscardChangesPrompt({
  onDiscard,
  onKeepEditing,
  onSave,
  saving,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onKeepEditing}
      data-testid="discard-changes-prompt"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ maxWidth: 340, background: "var(--color-bt-card-float)", borderRadius: 18, padding: 18 }}
      >
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--color-bt-text)" }}>Unsaved changes</div>
        <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Your changes to this game haven’t been saved yet. Leaving now discards them.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full disabled:opacity-40"
            style={{ height: 44, borderRadius: 12, background: "var(--color-bt-accent)", color: "var(--color-bt-base)", border: "none", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onKeepEditing}
            className="w-full"
            style={{ height: 44, borderRadius: 12, background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "0.5px solid var(--color-bt-border)", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-keep"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full"
            style={{ height: 44, borderRadius: 12, background: "transparent", color: "var(--color-bt-danger)", border: "0.5px solid var(--color-bt-danger-border)", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-discard"
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}

/** A labeled zone divider on the setup face (W-GAMEPAGE-01 §5) — the groups are
 *  labels, not panes (one scrolling column). Token-styled, quiet caption. */
function ZoneHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        {children}
      </span>
      <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
    </div>
  );
}

function SetupHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header
      className="flex shrink-0 items-center justify-between"
      style={{
        height: 52,
        padding: "0 8px",
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>
      <div className="min-w-0 text-center">
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
      </div>
      <div className="flex h-9 min-w-9 items-center justify-end pr-1">{right}</div>
    </header>
  );
}

function NewGame({
  tripId,
  game,
  teeTime,
  setTeeTime,
  courseName,
  onPickCourse,
  onCreate,
  pending,
  canEdit,
}: {
  tripId: string;
  game: GameRow | null | undefined;
  teeTime: string;
  setTeeTime: (t: string) => void;
  courseName: string | null;
  onPickCourse: () => void;
  onCreate: () => void;
  pending: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return <MemberNotReady tripId={tripId} game={game} />;
  // Build-as-you-go (W-GAMEPAGE-01 §6.1): creating the game seeds exactly ONE
  // empty match — no up-front count. Matches are added one at a time on the setup
  // face, so there's no stepper here.
  return (
    <div>
      <div className="flex flex-col gap-3.5">
        {/* Course — opens the Course Selector (Slice C); same field style as the tee time. */}
        <div>
          <FieldLabel>Course</FieldLabel>
          <button type="button" onClick={onPickCourse} className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm" style={pillStyle}>
            <span style={{ color: courseName ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}>
              {courseName ?? "Select a course"}
            </span>
            <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </div>

        <TimePicker
          label="First tee time"
          presets="tee"
          value={parseTime(teeTime)}
          onChange={(v) => setTeeTime(toTime24(v))}
        />
      </div>

      <PrimaryButton label="Create game" onClick={onCreate} disabled={pending} />
    </div>
  );
}

// The Matches setup grid — ONE template shared by the branded header and every
// match row, so the six columns line up: grab │ # │ Team A │ vs │ Team B │ ×.
// The two team columns flex (minmax(0,1fr)); the four structural columns are fixed.
const MATCH_GRID = "24px 22px minmax(0,1fr) auto minmax(0,1fr) 24px";

function MatchSetup({
  draft,
  setDraft,
  nameOf,
  colorOf,
  teamColorOf,
  avatarIconOf,
  teamForSlot,
  maxMatches,
  openSelector,
}: {
  tripId: string;
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  /** A player's TEAM color from their ROSTER assignment (`teamOfUser`) — team
   *  identity is the person, never the slot. A player dropped from their team
   *  resolves to undefined → the neutral per-player palette (the honest "no team"
   *  state), exactly like the handicap selector. Undefined for standalone games. */
  teamColorOf: (userId: string) => string | undefined;
  avatarIconOf: Map<string, string | null>;
  /** The team bound to a setup slot (side A → team[0], side B → team[1]) — drives
   *  the shared branded column header. Undefined in a standalone (non-2-team) game,
   *  where the header falls back to a neutral "Side A / Side B". */
  teamForSlot: (slot: "a" | "b") => { name: string; color: string } | undefined;
  /** Ceiling on the number of matches — "add match" hides once reached. For 1v1
   *  this is the players-per-team cap (Task 3a); for 2v2 it's the generous 24
   *  ceiling (no team cap — see the call site's reasoning). */
  maxMatches: number;
  openSelector: (matchIdx: number, slot: "a" | "b", memberIdx: number) => void;
}) {
  // Drag-to-reorder (mirrors the news composer): `ins` is the insertion slot in
  // the original array (0..length). The accent line shows only once the cursor
  // crosses a neighbour's midpoint, and never on the dragged card's own two
  // adjacent slots (a no-op). Drag is armed only while the grip is held so the
  // slots/stepper inside the card stay tappable.
  const [dragState, setDragState] = useState<{ from: number; ins: number | null } | null>(null);
  const [armedIdx, setArmedIdx] = useState<number | null>(null);
  // "＋ Add match" reveals the "Add singles / Add doubles" choice (A2a) so each
  // match's shape is picked when it's added — a game can mix both.
  const [addOpen, setAddOpen] = useState(false);
  const addMatch = (pps: 1 | 2) => {
    setDraft((prev) => [...prev, { matchNumber: prev.length + 1, playersPerSide: pps, a: [], b: [], handicap: 0, pointValue: null }]);
    setAddOpen(false);
  };

  const reorderTo = (from: number, ins: number) =>
    setDraft((prev) => {
      if (from < 0 || from >= prev.length) return prev;
      if (ins === from || ins === from + 1) return prev; // own slot — no-op
      const copy = prev.slice();
      const [moved] = copy.splice(from, 1);
      const target = Math.max(0, Math.min(copy.length, ins > from ? ins - 1 : ins));
      copy.splice(target, 0, moved);
      return copy;
    });

  const onCardDragOver = (i: number, clientY: number, rect: DOMRect) =>
    setDragState((s) => {
      if (!s) return s;
      const isTop = clientY < rect.top + rect.height / 2;
      let ins: number | null = isTop ? i : i + 1;
      if (ins === s.from || ins === s.from + 1) ins = null; // adjacent = no-op, hide line
      return s.ins === ins ? s : { ...s, ins };
    });

  // One member (a single user) as a Participant — for an individual setup slot.
  function memberPart(userId: string | undefined): Participant | null {
    if (!userId) return null;
    const name = nameOf.get(userId) ?? "Player";
    return {
      id: userId,
      name,
      // Roster team color (neutral if the player is teamless) — NOT the slot's.
      color: teamColorOf(userId) ?? colorOf.get(userId) ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(userId) ?? null,
    };
  }
  // One TEAM COLUMN of the match grid — it holds the same column in both formats,
  // just 1 chip tall (1v1) or 2 chips tall (2v2). NOT a separate team-row, NOT a
  // per-row team label: a 2v2 match is the SAME six columns as 1v1, only two chips
  // stacked per side. The within-side gap (6px) is deliberately tighter than the
  // between-match separator (P2c) so the two chips read as ONE side; the grid's
  // items-center then centers the structural cells (grab/#/vs/×) against the stack
  // (the "span both rows, centered" effect). Each sub-slot picks a single player.
  // Team identity rides on the player avatar's ROSTER color (memberPart →
  // teamColorOf), never the slot — a dropped-from-team player reads neutral, honestly.
  const sideSlots = (members: string[], matchIdx: number, slot: "a" | "b", pps: 1 | 2) => {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: pps }).map((_, k) => (
          <Slot key={k} player={memberPart(members[k])} onTap={() => openSelector(matchIdx, slot, k)} />
        ))}
      </div>
    );
  };

  // The shared branded header team for a slot: the bound team's name + color in a
  // 2-team competition, else a neutral "Side A/B" (a standalone game has no teams).
  const headerTeam = (slot: "a" | "b") => {
    const t = teamForSlot(slot);
    return t ?? { name: slot === "a" ? "Side A" : "Side B", color: "var(--color-bt-text-dim)" };
  };
  const a = headerTeam("a");
  const b = headerTeam("b");

  return (
    <div data-testid="match-pairings">
      {/* The table (team-name header + match rows) appears only once there's at
          least one match — a brand-new game shows just "Add match". 0 matches is a
          valid empty state, not an error. */}
      {draft.length > 0 && (
        <>
      {/* Shared branded column header (BOTH formats): team names centered +
          team-colored in their columns, "vs" centered in its; grab/#/× columns
          empty. Same MATCH_GRID template as the rows below → the columns line up. */}
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: MATCH_GRID, gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <span />
        <span />
        <span className="truncate text-center" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", color: a.color }}>{a.name}</span>
        <span className="text-center" style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
        <span className="truncate text-center" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", color: b.color }}>{b.name}</span>
        <span />
      </div>

      <div className="flex flex-col">
        {draft.map((d, i) => {
          const dragging = dragState?.from === i;
          const dropIndicator: "top" | "bottom" | null =
            dragState?.ins === i
              ? "top"
              : i === draft.length - 1 && dragState?.ins === draft.length
                ? "bottom"
                : null;
          return (
            <div
              key={i}
              draggable={armedIdx === i}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragState({ from: i, ins: null });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                onCardDragOver(i, e.clientY, e.currentTarget.getBoundingClientRect());
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragState && dragState.ins != null) reorderTo(dragState.from, dragState.ins);
                setDragState(null);
                setArmedIdx(null);
              }}
              onDragEnd={() => {
                setDragState(null);
                setArmedIdx(null);
              }}
              // The match is one flat grid ROW (no frame, no "MATCH N" band). The
              // four structural columns (grab │ # │ vs │ ×) center against the team
              // columns, which hold one chip (1v1) or two stacked chips (2v2). A
              // hairline separator above every match but the first delimits them —
              // quiet in 1v1, load-bearing in 2v2 (it makes the 2-row match read as
              // one unit).
              className="grid items-center"
              style={{ position: "relative", gridTemplateColumns: MATCH_GRID, gap: 8, padding: "10px 0", opacity: dragging ? 0.4 : 1, borderTop: i > 0 ? "1px solid var(--color-bt-border)" : undefined }}
            >
              {dropIndicator && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    [dropIndicator === "top" ? "top" : "bottom"]: -1,
                    height: 2,
                    borderRadius: 2,
                    background: "var(--color-bt-accent)",
                    boxShadow: "0 0 0 2px var(--color-bt-accent-faint)",
                    pointerEvents: "none",
                  }}
                />
              )}
              {/* grab — far left, away from the × (reorder isn't next to remove). */}
              <DragHandle onMouseDown={() => setArmedIdx(i)} onMouseUp={() => setArmedIdx(null)} />
              {/* # — the table index column (separate from grab). A small shape tag
                  sits under it so a mixed game's 1v1 vs 2v2 cards read at a glance. */}
              <div className="flex flex-col items-center gap-1">
                <RowNumber number={i + 1} />
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: "0.03em",
                    padding: "1px 4px",
                    borderRadius: 4,
                    color: d.playersPerSide === 2 ? "#c4b5fd" : "#93c5fd",
                    background: d.playersPerSide === 2 ? "rgba(167,139,250,0.14)" : "rgba(96,165,250,0.14)",
                  }}
                >
                  {d.playersPerSide === 2 ? "2V2" : "1V1"}
                </span>
              </div>
              {sideSlots(d.a, i, "a", d.playersPerSide)}
              <span className="text-center" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
              {sideSlots(d.b, i, "b", d.playersPerSide)}
              {/* Remove = the itinerary-builder "×" dismiss (NOT a trash can), DIM not
                  red — draft removal is free (no persisted scores) and the open panel
                  must never read as an error. Far right. Always REMOVES the row —
                  0 matches is now a valid empty state (the table hides, leaving just
                  "Add match"), so the last match is deletable, not floor-clamped. */}
              <button
                type="button"
                onClick={() => setDraft((prev) => removeMatchRow(prev, i))}
                title="Remove match"
                aria-label={`Remove match ${i + 1}`}
                className="flex items-center justify-center"
                style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)" }}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
        </>
      )}

      {/* Add another match (A2a) — "＋ Add match" reveals a singles/doubles choice
          so a game can mix shapes; each new card carries the chosen playersPerSide.
          Hidden at the generous MAX ceiling. */}
      {draft.length < maxMatches && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            className="flex w-full items-center justify-center gap-1.5"
            style={{ height: 46, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
          >
            <Plus size={16} />
            Add match
          </button>
          {addOpen && (
            <div className="mt-2.5 flex gap-2.5" data-testid="add-match-choice">
              <AddShapeButton kind="1V1" label="Add singles" onClick={() => addMatch(1)} />
              <AddShapeButton kind="2V2" label="Add doubles" onClick={() => addMatch(2)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One choice in the Add-match disclosure: a shape tag (1V1 blue / 2V2 purple) over
 *  a plain label, matching the mockup's two-button "Add singles / Add doubles". */
function AddShapeButton({ kind, label, onClick }: { kind: "1V1" | "2V2"; label: string; onClick: () => void }) {
  const doubles = kind === "2V2";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-0.5"
      style={{ padding: 11, borderRadius: 11, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: doubles ? "#c4b5fd" : "#93c5fd" }}>{kind}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>{label}</span>
    </button>
  );
}

/**
 * EntryModeRow — the score-entry-vs-hole-outcome toggle (Refactor B3). A native
 * SETTINGS row (icon + title + subtitle + an inline control, no accordion body —
 * same idiom as GameSetupRows' "Total Points"/"Points per Slot" inline stepper),
 * NOT a bespoke widget. The control itself reuses GameManagementPanel's
 * segmented-track styling (the Setup/Scoring toggle) — a rounded card-raised
 * track with a neutral-filled active segment. Unlike Setup/Scoring, neither
 * option here is a "live" action, so BOTH segments use the neutral (not teal)
 * active treatment — teal stays reserved for the live/scoring signal elsewhere.
 *
 * CONTROLLED (Draft-Then-Save P1): this row owns no persistence — it renders the
 * mode it's given and reports a tap via `onChange`. The page stages it in the
 * composite draft and its single Save commits it. (It used to `games.update` on
 * tap; under draft-then-save that would move the game's config hash out from under
 * the page's frozen baseHash and make the user's OWN Save conflict.)
 */
function EntryModeRow({
  entryMode,
  canEdit,
  locked,
  onChange,
}: {
  entryMode: "score" | "outcome";
  canEdit: boolean;
  locked: boolean;
  onChange: (mode: "score" | "outcome") => void;
}) {
  const disabled = locked || !canEdit;

  const setMode = (mode: "score" | "outcome") => {
    if (mode === entryMode || disabled) return;
    onChange(mode);
  };

  return (
    <ChecklistRow
      icon={ListChecks}
      title="Entry Mode"
      subtitle={entryMode === "outcome" ? "Hole outcome — tap who won each hole" : "Score entry — enter gross strokes"}
      state="resolved"
      disabled={!canEdit}
      locked={locked}
      testId="row-entry-mode"
      control={
        <div className="flex" style={{ gap: 4, padding: 4, borderRadius: 10, background: "var(--color-bt-card-raised)" }}>
          <EntryModeSegment label="Score" active={entryMode === "score"} onClick={() => setMode("score")} disabled={disabled} testId="entry-mode-score" />
          <EntryModeSegment label="Outcome" active={entryMode === "outcome"} onClick={() => setMode("outcome")} disabled={disabled} testId="entry-mode-outcome" />
        </div>
      }
    />
  );
}

function EntryModeSegment({
  label,
  active,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
      style={{
        background: active ? "var(--color-bt-base)" : "transparent",
        color: active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
        border: active ? "1px solid var(--color-bt-border)" : "1px solid transparent",
        opacity: disabled && !active ? 0.6 : 1,
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

/**
 * HandicapsSection — the relocated per-match handicap controls (config-checklist
 * Phase 1). Lifted out of MatchSetup so handicaps are their own checklist row,
 * gated by Matches: it renders one RelHandicapControl per FULLY-PAIRED match
 * (nothing to allocate strokes between until both sides are set). Edits the same
 * draft.handicap the inline control did; the parent's Save persists it.
 */
function HandicapsSection({
  draft,
  setDraft,
  nameOf,
  colorOf,
  teamColorOf,
}: {
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  /** A player's TEAM color from their roster assignment (`teamOfUser`), the same
   *  source the overview uses (`sideColor`/`teamOfSide`) — so the handicap avatars
   *  match every other team-avatar surface (Rhinos red / Phoenix purple). A player
   *  with NO team assignment correctly returns undefined → the per-player palette
   *  fallback (NOT a bug — an unassigned player has no team color). Undefined for a
   *  standalone (non-2-team) game too. (P-D defect 1: colorOf alone was the neutral
   *  palette and lost team identity for the assigned players.) */
  teamColorOf: (userId: string) => string | undefined;
}) {
  // Each side as its players (stacked chips via the shared SideChips) + a display
  // name for the stroke caption. Replaces the old compound "R&"-avatar / "Name & …"
  // treatment (A2a) — one chip per player, team-colored, avatar-left.
  const sidePlayers = (members: string[]): SidePlayer[] =>
    members.map((u) => ({ id: u, name: nameOf.get(u) ?? "Player", teamColor: teamColorOf(u) ?? colorOf.get(u) ?? PLAYER_COLORS[0] }));
  const sideName = (members: string[]) => members.map((u) => nameOf.get(u) ?? "Player").join(" & ");
  // Per-match filled (A2a): both sides at the match's OWN players-per-side.
  const filled = draft
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.a.length === d.playersPerSide && d.b.length === d.playersPerSide);

  if (filled.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="handicaps-need-matches">
        Set the matchups first — strokes are assigned per matchup.
      </p>
    );
  }
  return (
    // Separator hairline between matches (row pattern Phase 3) — the same delimiter
    // Matches uses, replacing the old gap-3 spacing so the two surfaces read alike.
    <div className="flex flex-col" data-testid="handicaps-section">
      {filled.map(({ d, i }, idx) => (
        // §8: the per-row "Match N" header is gone — the number rides the control's
        // left gutter instead (passed below), shown only when there's >1 match.
        <div
          key={i}
          style={{
            borderTop: idx > 0 ? "1px solid var(--color-bt-border)" : undefined,
            paddingTop: idx > 0 ? 14 : 0,
            paddingBottom: 14,
          }}
        >
          <RelHandicapControl
            a={{ players: sidePlayers(d.a), name: sideName(d.a) }}
            b={{ players: sidePlayers(d.b), name: sideName(d.b) }}
            value={d.handicap}
            matchNumber={draft.length > 1 ? i + 1 : undefined}
            onChange={(v) => setDraft((prev) => prev.map((x, j) => (j === i ? { ...x, handicap: v } : x)))}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Overview — the flat list of tappable match strips (the post-setup home for a
 * match-play game). Banner + Edit (owner) + N strips, one per 1v1. Tapping a
 * strip opens single-match entry. When every match is decided, the owner can
 * finish the round.
 */
function Overview({
  tripId,
  game,
  groups,
  myId,
  published,
  complete,
  canEdit,
  decidedFor,
  glorious,
  holeCount,
  onFinish,
  finishing,
  correcting,
  canCorrect,
  onCorrect,
  correctingPending,
  onOpenMatch,
}: {
  tripId: string;
  game: GameRow | null | undefined;
  groups: MatchGroupData[];
  myId: string | undefined;
  published: boolean;
  complete: boolean;
  canEdit: boolean;
  decidedFor: (g: MatchGroupData) => DecidedHole[];
  /** Glorious Finishing Holes weight (2× the last N) for the match state. */
  glorious: GloriousConfig;
  /** The round's hole count (from the scorecard schema) — feeds matchState so
   *  close-out/over derive against 9 vs 18, not a hardcoded 18. */
  holeCount: number;
  onFinish: () => void;
  finishing: boolean;
  /** #7: posted game re-opened for a correction (editable until re-locked). */
  correcting: boolean;
  /** #7: locked + editor → may open a correction. */
  canCorrect: boolean;
  onCorrect: () => void;
  correctingPending: boolean;
  onOpenMatch: (matchId: string) => void;
}) {
  if (!published) return <MemberNotReady tripId={tripId} game={game} />;
  const decideds = groups.map(decidedFor);
  const allOver = groups.length > 0 && decideds.every((d) => matchState(d, holeCount, glorious).over);
  const matchWord = groups.length === 1 ? "Match" : "Matches";
  return (
    <div>
      {/* Section header — mirrors Rack's "GROUPS · TAP TO ENTER SCORES" above-list
          label (one shared header pattern across formats). The banner is gone; the
          suffix carries state — scorable states nudge "tap to enter scores", a
          posted round reads "· final", and a re-opened one "· correcting". */}
      <div className="mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          {complete
            ? correcting
              ? `${matchWord} · correcting`
              : `${matchWord} · final`
            : `${matchWord} · tap to enter scores`}
        </span>
      </div>

      {/* #501 Part 3: the scoring board is read-and-score only — match count is
          config, so the live +1/−1 affordances are gone. Add/remove matches in Setup
          mode (toggle back → Matches row), where mid-game config is deliberate. */}
      <div className="flex flex-col gap-2.5">
        {groups.map((g, i) => (
          <MatchCard
            key={g.matchId}
            a={g.a}
            b={g.b}
            aPlayers={g.aPlayers}
            bPlayers={g.bPlayers}
            results={decideds[i]}
            glorious={glorious}
            label={`Match ${i + 1}`}
            youId={myId}
            leftColor={g.leftColor}
            rightColor={g.rightColor}
            hideFormat
            onClick={() => onOpenMatch(g.matchId)}
          />
        ))}
      </div>

      {canEdit && !complete && allOver && (
        <button onClick={onFinish} disabled={finishing} className="mt-5 w-full disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
          Finish round
        </button>
      )}

      {/* #7: the deliberate, auditable correction path (owner/co-admin/delegate). */}
      {canCorrect && (
        <button onClick={onCorrect} disabled={correctingPending} className="mt-5 w-full disabled:opacity-40" style={{ height: 48, borderRadius: 12, background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", fontSize: 15, fontWeight: 600 }}>
          {correctingPending ? "Opening…" : "Correct a score"}
        </button>
      )}
      {canEdit && correcting && (
        <button onClick={onFinish} disabled={finishing} className="mt-5 w-full disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-warning)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
          {finishing ? "Re-locking…" : "Re-lock result"}
        </button>
      )}
    </div>
  );
}

function PlayerSelector({
  matchIdx,
  slot,
  memberIdx,
  sided,
  teamLabel,
  teamColor,
  draft,
  crew,
  nameOf,
  onPick,
  onClose,
}: {
  matchIdx: number;
  slot: "a" | "b";
  memberIdx: number;
  sided: boolean;
  /** The team this side is bound to (2-team competition) — the pool is just this
   *  team, so a cross-team pair can't be built. Undefined for standalone. */
  teamLabel?: string;
  teamColor?: string;
  draft: DraftMatch[];
  crew: string[];
  nameOf: Map<string, string>;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  // Map user → the match they currently occupy (if any) — across all members of
  // both sides, so a player already placed shows as "taken" / moves when chosen.
  const inMatch = new Map<string, number>();
  draft.forEach((d, i) => {
    for (const u of d.a) inMatch.set(u, i);
    for (const u of d.b) inMatch.set(u, i);
  });
  const available = crew.filter((id) => !inMatch.has(id));
  const taken = crew.filter((id) => inMatch.has(id));
  // Title: when the side is team-bound, name the team (the constraint is visible
  // — you're picking a Blue player into Blue's side). Else fall back to A/B.
  const title = teamLabel
    ? sided
      ? `${teamLabel} · Player ${memberIdx + 1}`
      : `Match ${matchIdx + 1} · ${teamLabel}`
    : sided
      ? `Match ${matchIdx + 1} · Side ${slot === "a" ? "A" : "B"} · Player ${memberIdx + 1}`
      : `Match ${matchIdx + 1} · Player ${slot === "a" ? 1 : 2}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} data-testid="player-selector">
      <div onClick={(e) => e.stopPropagation()} className="w-full" style={{ background: "var(--color-bt-card-float)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px 28px", maxHeight: "75vh", overflowY: "auto" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {teamColor && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: teamColor }} />}
          {title}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 14 }}>Available</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {available.length === 0 && <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Everyone&apos;s assigned.</span>}
          {available.map((id) => (
            <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} teamColor={teamColor} onClick={() => onPick(id)} />
          ))}
        </div>
        {taken.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 16 }}>Already in a match</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {taken.map((id) => (
                <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} teamColor={teamColor} sub={`Match ${(inMatch.get(id) ?? 0) + 1}`} dim onClick={() => onPick(id)} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
              Choosing someone already in a match moves them here and clears that match&apos;s handicap.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small shared bits ──

// Card-raised pill — matches the TimePicker trigger (Course / Matches fields).
const pillStyle: React.CSSProperties = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
};

// Field label above a control — same style as the TimePicker's label.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </label>
  );
}

function Slot({ player, onTap }: { player: Participant | null; onTap: () => void }) {
  if (!player) {
    // The plus + label live together inside one dashed pill (card-raised so it
    // reads as a fillable block). Always "+ Add player".
    return (
      <button
        onClick={onTap}
        className="flex items-center justify-center gap-1.5"
        style={{ width: "100%", minWidth: 0, height: 44, borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
      >
        <Plus size={15} />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Add player</span>
      </button>
    );
  }
  // Filled — the shared PlayerChip (avatar 30, left-aligned, §11 team initial, no
  // avatarIcon; player.color is roster-resolved upstream). The button is just the
  // tap target (reset surface); the chip owns the visual, so the Matches slot and
  // the handicap segment render an identical chip.
  return (
    <button onClick={onTap} className="block w-full text-left" style={{ minWidth: 0, padding: 0, border: "none", background: "none" }}>
      <PlayerChip name={player.name} teamColor={player.color} />
    </button>
  );
}

function SelectorRow({ name, teamColor, sub, dim, onClick }: { name: string; teamColor?: string | null; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 text-left" style={{ padding: "9px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: dim ? 0.55 : 1 }}>
      <span className="flex min-w-0 items-center gap-2.5">
        {/* §11 team initial, no avatarIcon (closes #477). teamColor is the slot's
            team — correct here: the picker list is constrained to that team. */}
        <Avatar name={name} teamColor={teamColor} sizePx={30} />
        <span style={{ fontSize: 15, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </span>
      {sub && <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>{sub}</span>}
    </button>
  );
}

function PrimaryButton({ label, onClick, disabled, outlined }: { label: string; onClick: () => void; disabled?: boolean; outlined?: boolean }) {
  // Outlined = the "more to fill" signal (neutral, not an error): same accent,
  // hollow. Filled accent once every slot is assigned.
  const style: React.CSSProperties = outlined
    ? { height: 52, borderRadius: 12, background: "transparent", color: "var(--color-bt-accent)", border: "1.5px solid var(--color-bt-accent-border)", fontSize: 16, fontWeight: 600 }
    : { height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 };
  return (
    <button onClick={onClick} disabled={disabled} className="mt-6 w-full disabled:opacity-40" style={style}>
      {label}
    </button>
  );
}
