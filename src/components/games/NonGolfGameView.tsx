"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Settings } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { NonGolfConfigurationView } from "@/components/games/NonGolfConfigurationView";
import { NonGolfScoreboard } from "@/components/games/NonGolfScoreboard";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { GamePageHeader } from "@/components/competition/GamePageHeader";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import { useInGamePanel, usePublishGameChrome } from "@/components/games/GameChrome";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { GAME_TYPES, isManualGameType, type ScoringModel } from "@/lib/gameTypes";
import {
  configToNonGolfDraft,
  nonGolfDraftToPayload,
  nonGolfDraftsEqual,
  type NonGolfConfigDraft,
  type CompetitionFormat,
} from "@/lib/configDraft";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import type { GameRow, LBTeamLite } from "@/components/competition/CompetitionGamesPanel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
      <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
    </div>
  );
}

/**
 * The non-golf (manual) game scoreboard page (W-NONGOLF lifecycle surface) — the
 * non-golf twin of golf's per-format game pages. A game tap on the leaderboard
 * lands here (the old post-results modal is promoted to this page). Same
 * mode-driven structure as golf:
 *  - **Setup mode** (pending): member → `SetupPlaceholder`; owner/delegate →
 *    pass-through (placeholder + "Set up this game" + corner gear → settings).
 *  - **Scoring mode** (active/complete): the scoreboard (`NonGolfScoreboard`).
 *
 * The interim header is deliberately simple/functional — the consistent
 * projected-points header (a logged follow-on) replaces it across all game types.
 *
 * Spec 2 Phase 2: a persistence-BOUND composed view, re-HOSTED by both its route
 * wrapper AND the leaderboard's game PANEL (CompetitionFace) — same recipe as
 * MatchGameView. Reads its OWN tripId + gameId (?game=); the back arrow closes
 * the panel for free.
 */
export function NonGolfGameView() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const urlGameId = search.get("game");

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: param },
    { ...STRUCTURE_QUERY, enabled: !isId, retry: false }
  );
  const tripId = isId ? param : resolved.data?.id;
  const utils = trpc.useUtils();
  // #501 Part 1: delegate-aware — a game-delegate (even a plain Member) edits this
  // game, mirroring the server's `canEditGame`. `isOwner` stays trip-Owner-only.
  const { canEdit, isOwner } = useGameEditAccess(tripId, urlGameId);

  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId }
  );
  const compQ = trpc.competitions.getByTrip.useQuery(
    { tripId: tripId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId }
  );

  const game = gameQ.data as unknown as GameRow | undefined;
  const competitionId = game?.competition_id ?? (compQ.data?.id as string | undefined) ?? null;
  const scoringModel = ((compQ.data?.scoring_model as ScoringModel | undefined) ?? "match_play") as ScoringModel;

  const lbQ = trpc.competitions.leaderboard.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { enabled: !!tripId && !!competitionId }
  );

  // Config sync: on a config change from another device (modifiers/rules, run
  // config, name, go-live, finish) silently refetch this game's config so members
  // converge. Non-golf "scores" are posted RESULTS (score-derived, not in the
  // config hash) — those already reflect via the board's shared leaderboard poll,
  // so here we invalidate the config (getById) + the leaderboard read.
  const onConfigChanged = useCallback(() => {
    if (tripId && urlGameId) void utils.games.getById.invalidate({ tripId, gameId: urlGameId });
    if (tripId && competitionId) void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
  }, [utils, tripId, urlGameId, competitionId]);
  useConfigSync(tripId, urlGameId, !!urlGameId, onConfigChanged);
  const teams = useMemo(() => ((lbQ.data?.teams ?? []) as LBTeamLite[]), [lbQ.data]);
  const gameCells = useMemo(
    () => ((lbQ.data?.cells ?? []) as { gameId: string; teamId: string; place: number; points: number }[])
      .filter((c) => c.gameId === urlGameId)
      .sort((a, b) => a.place - b.place),
    [lbQ.data, urlGameId]
  );
  // #533 projection (non-golf) — a presentation rollup of the results already on
  // the page: the posted per-team points for THIS game (the leaderboard cells).
  // Nothing declared → an empty map → the row shows 0s. No engine call.
  const projectionPerTeam = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of gameCells) out[c.teamId] = (out[c.teamId] ?? 0) + c.points;
    return out;
  }, [gameCells]);
  const initialOrder = useMemo(
    () => (gameCells.length ? gameCells.map((c) => c.teamId) : teams.map((t) => t.id)),
    [gameCells, teams]
  );
  // Seed the match control's declared outcome from the posted cells — a draw is
  // both sides at place 1 (the win/lose/tie post writes both → position 1).
  const initialResult = useMemo(() => {
    if (gameCells.length === 2 && gameCells.every((c) => c.place === 1)) return "tie";
    return gameCells[0]?.teamId;
  }, [gameCells]);

  // SERVER scoring state — drives which PAGE renders (setup placeholder vs scoreboard):
  // the game's actual visibility follows the server, not a staged toggle. The settings
  // toggle reads the DRAFT (configDraft.scoringEnabled) + `staged` instead (below).
  const scoringEnabled = (game as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  const typeDef = GAME_TYPES.find((t) => t.id === game?.game_type_id);
  const typeName = typeDef?.name ?? "Game";

  // ── Draft-then-save (P2 non-golf flip) ──────────────────────────────────────
  // The WHOLE settings page is ONE composite draft (name / delegate / rules / format /
  // points / the scoring flag), committed atomically via save_game_config on Save —
  // NOTHING self-persists. A LEAN variant (NonGolfConfigDraft: no matches / course /
  // groupings), mirroring the match page's model. There are NO locks: non-golf has no
  // destroys-tier setting (the thesis), so the page is fully editable even while live —
  // an edit stages, Save commits it.
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { enabled: !!tripId && !!urlGameId },
  );
  const serverDelegates = useMemo(
    () => ((orgQ.data as { user_id: string }[] | undefined) ?? []).map((d) => d.user_id),
    [orgQ.data],
  );

  // Draft slices — a scalar sentinel means "untouched, read the server mirror". name/
  // rules/scoring/delegates use null; format/points can BE null, so they use undefined.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [formatDraft, setFormatDraft] = useState<CompetitionFormat | null | undefined>(undefined);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [pointsDistDraft, setPointsDistDraft] = useState<PointsDistribution | null | undefined>(undefined);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);

  const serverConfigDraft = useMemo<NonGolfConfigDraft>(
    () => configToNonGolfDraft((game ?? {}) as Parameters<typeof configToNonGolfDraft>[0], serverDelegates),
    [game, serverDelegates],
  );
  const anyTouched =
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null ||
    formatDraft !== undefined || pointsTotalDraft !== undefined || pointsDistDraft !== undefined ||
    delegatesDraft !== null;

  const configDraft = useMemo<NonGolfConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: scoringDraft ?? serverConfigDraft.scoringEnabled,
      competitionFormat: formatDraft !== undefined ? formatDraft : serverConfigDraft.competitionFormat,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      pointsDistribution: pointsDistDraft !== undefined ? pointsDistDraft : serverConfigDraft.pointsDistribution,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft],
  );

  // The server config hash — ONE value fed to BOTH the outbox base and Save's baseHash
  // (P1: recover-vs-discard and conflict-vs-allow must agree on the base).
  const hashQ = trpc.games.configHash.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { enabled: !!tripId && !!urlGameId, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );
  const serverHash = hashQ.data?.hash;

  // Frozen baseline (+hash): the dirty reference AND the concurrency base, frozen the
  // moment the draft is touched so the ~20s poll can't move it mid-edit.
  const [baseline, setBaseline] = useState<{ draft: NonGolfConfigDraft; hash: string } | null>(null);
  useEffect(() => {
    if (anyTouched) return;
    if (!game || !serverHash) return;
    setBaseline((prev) =>
      prev && prev.hash === serverHash && nonGolfDraftsEqual(prev.draft, serverConfigDraft)
        ? prev
        : { draft: serverConfigDraft, hash: serverHash },
    );
  }, [anyTouched, serverConfigDraft, serverHash, game]);

  // Dirty gated on anyTouched (P1: kills the post-save transient where a refetched
  // server draft briefly ≠ the stale baseline before it re-seeds).
  const dirty = anyTouched && !!baseline && !nonGolfDraftsEqual(configDraft, baseline.draft);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { if (dirty) setJustSaved(false); }, [dirty]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveConfigM = trpc.games.saveConfig.useMutation();

  // Hard-teardown durability (localStorage), the shape-agnostic outbox. Base = the SAME
  // serverHash the baseline freezes on, so restore-vs-discard and Save's conflict check
  // can't disagree.
  const draftBundle = useMemo(
    () => ({ name: nameDraft, rules: rulesDraft, scoring: scoringDraft, format: formatDraft, pointsTotal: pointsTotalDraft, pointsDist: pointsDistDraft, delegates: delegatesDraft }),
    [nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft],
  );
  const { recover: recoverDraft, clear: clearDraftOutbox } = useDraftOutbox<typeof draftBundle>({
    view: "nongolf",
    gameId: urlGameId,
    draft: draftBundle,
    touched: anyTouched,
    serverFingerprint: serverHash ?? "",
    enabled: !!urlGameId && canEdit && !!serverHash,
  });

  function resetSlices() {
    setNameDraft(null); setRulesDraft(null); setScoringDraft(null);
    setFormatDraft(undefined); setPointsTotalDraft(undefined); setPointsDistDraft(undefined);
    setDelegatesDraft(null);
  }
  const applyBundle = useCallback((b: typeof draftBundle) => {
    if (b.name !== null) setNameDraft(b.name);
    if (b.rules !== null) setRulesDraft(b.rules);
    if (b.scoring !== null) setScoringDraft(b.scoring);
    if (b.format !== undefined) setFormatDraft(b.format);
    if (b.pointsTotal !== undefined) setPointsTotalDraft(b.pointsTotal);
    if (b.pointsDist !== undefined) setPointsDistDraft(b.pointsDist);
    if (b.delegates !== null) setDelegatesDraft(b.delegates);
  }, []);
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current || !serverHash) return;
    recoveredRef.current = true;
    const r = recoverDraft() as typeof draftBundle | null;
    if (r) applyBundle(r);
  }, [serverHash, recoverDraft, applyBundle]);

  async function handleSaveConfig() {
    if (!tripId || !urlGameId || !baseline || !dirty || saveConfigM.isPending) return;
    setSaveError(null);
    try {
      await saveConfigM.mutateAsync({ tripId, gameId: urlGameId, baseHash: baseline.hash, payload: nonGolfDraftToPayload(configDraft) });
    } catch (e) {
      setSaveError((e as { message?: string })?.message || "Couldn’t save your changes.");
      return;
    }
    clearDraftOutbox();
    resetSlices();
    setJustSaved(true);
    await refreshGame();
    void hashQ.refetch();
    utils.games.listOrganizers.invalidate({ tripId, gameId: urlGameId });
  }
  function handleCancelConfig() {
    resetSlices();
    setSaveError(null);
    setJustSaved(false);
    clearDraftOutbox();
  }

  // The ONE settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1 → land here directly for an owner/delegate of a setup-mode game).
  // Confirm-on-leave: the whole page is ONE draft (commits only on Save), so a
  // back-press with unsaved edits is a silent data-loss path. `guardDirty` /
  // `handleCancelConfig` are wired through latest-refs (synced in the effect below)
  // because `guardDirty` reads `showConfig`, which this hook returns — a direct pass
  // would be circular.
  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const {
    open: showConfig,
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
  // Gate the guard on the overlay being OPEN + editable — the scoreboard underneath
  // (and a member's read-only view) must never trap a back-press.
  const guardDirty = showConfig && canEdit && dirty;
  useEffect(() => {
    dirtyRef.current = guardDirty;
    discardRef.current = handleCancelConfig;
  });

  async function refreshGame() {
    await gameQ.refetch();
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  // The Setup/Scoring toggle is now a DRAFT edit — staging scoring_enabled; Save commits
  // it WITH the config in one atomic RPC (go-live readiness is re-asserted server-side
  // inside the tx, so the client gate can't be bypassed).
  function handleEnable() { setScoringDraft(true); }
  function handleDisable() { setScoringDraft(false); }

  // #550: as a PANEL, publish chrome to the app bar (back/title + owner gear)
  // instead of a second header. Non-golf has no focused entry surface (posted
  // results), so the bottom nav stays. Standalone route keeps its own header.
  const inPanel = useInGamePanel();
  usePublishGameChrome(
    inPanel
      ? {
          title: (game?.name as string | undefined)?.trim() || typeName,
          onSettings: game && !showConfig && canEdit ? openConfig : undefined,
        }
      : null,
  );

  if (!tripId || !urlGameId) return <Spinner />;
  if (gameQ.isLoading || !game) return <Spinner />;

  // As a panel the app bar carries back/title/gear (published above) → no own
  // header. Standalone route (no bar) keeps it.
  const header = (title: string) => inPanel ? null : (
    <header className="flex shrink-0 items-center justify-between" style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
      <button onClick={() => router.back()} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>
      <div className="min-w-0 text-center">
        <div className="truncate" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{typeName}</div>
      </div>
      {canEdit ? (
        <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
          <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      ) : <div className="h-9 w-9" />}
    </header>
  );

  // ── The ONE settings page — reached via the corner gear in BOTH modes. ──
  // Returned DIRECTLY (not in a `fixed inset-0` wrapper): it's a full-page view,
  // and its own `min-h-screen` root document-scrolls. Wrapping it in `fixed`
  // pinned it to the viewport, so tall content (e.g. the points panel + danger
  // zone) overflowed past the bottom with no way to scroll — the reported bug.
  // This matches the rack page, which already renders the config view directly.
  if (showConfig && canEdit && competitionId) {
    return (
      <>
      <NonGolfConfigurationView
        hideHeader={inPanel}
        subtitle={typeName}
        onBack={closeConfig}
        tripId={tripId}
        competitionId={competitionId}
        game={game}
        scoringModel={scoringModel}
        canEdit={canEdit}
        isOwner={isOwner}
        onChanged={() => void refreshGame()}
        onDeleted={() => router.push(`/trips/${tripId}/leaderboard`)}
        // Draft-then-save: the whole page is controlled off configDraft; Save commits.
        draft={configDraft}
        onNameChange={setNameDraft}
        onRulesChange={setRulesDraft}
        onDelegatesChange={setDelegatesDraft}
        onFormatChange={setFormatDraft}
        onPointsTotalChange={setPointsTotalDraft}
        onPointsDistChange={setPointsDistDraft}
        // The toggle reads the DRAFT; `staged` = draft ≠ the live server flag.
        serverScoringEnabled={scoringEnabled}
        ready={configDraft.pointsTotal != null || configDraft.pointsDistribution != null}
        onEnable={handleEnable}
        onDisable={handleDisable}
        saving={saveConfigM.isPending}
        saveBar={
          <SettingsSaveBar
            dirty={dirty}
            saving={saveConfigM.isPending}
            justSaved={justSaved}
            error={saveError}
            onSave={() => void handleSaveConfig()}
            onCancel={handleCancelConfig}
          />
        }
      />
      {confirmingClose && (
        <DiscardChangesPrompt
          onDiscard={confirmDiscard}
          onKeepEditing={cancelClose}
          onSave={() => { cancelClose(); void handleSaveConfig(); }}
          saving={saveConfigM.isPending}
        />
      )}
      </>
    );
  }

  const gameName = game.name?.trim() || typeName;

  // ── Setup mode (pending) — member placeholder / owner pass-through. ──
  if (!scoringEnabled) {
    return (
      <div className="flex flex-col" style={{ minHeight: inPanel ? "100%" : "100vh", background: "var(--color-bt-base)" }}>
        {header(gameName)}
        <div className="flex-1">
          <SetupPlaceholder
            tripId={tripId}
            game={game}
            message={canEdit
              ? "Set the format, points, and rules on the settings page — the crew can’t see the game until you switch it to scoring."
              : undefined}
          >
            {canEdit && (
              <button
                type="button"
                onClick={openConfig}
                data-testid="setup-go-to-settings"
                className="mx-auto flex items-center justify-center gap-2"
                style={{ height: 48, padding: "0 22px", borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}
              >
                <Settings size={17} /> Set up this game
              </button>
            )}
          </SetupPlaceholder>
        </div>
      </div>
    );
  }

  // ── Scoring mode (active/complete) — the scoreboard. ──
  return (
    <div className="flex flex-col" style={{ minHeight: inPanel ? "100%" : "100vh", background: "var(--color-bt-base)" }}>
      {header(gameName)}
      {/* Standard game header — row 1 (the collapsed cup hero) + optional row 2
          (this game's projected/final per-team contribution), sticky over the
          scoreboard. Competition games only.

          Row 2 is OMITTED for manual (direct-submit) formats: the result is
          entered and posted in one action, so there's nothing to "project" —
          the row would only ever mirror what was just submitted. A future
          non-golf format with incremental/engine scoring (resultStrategy set)
          keeps the projection. */}
      <GamePageHeader
        tripId={tripId}
        competitionId={competitionId}
        projection={
          isManualGameType(game.game_type_id)
            ? undefined
            : {
                perTeam: projectionPerTeam,
                gameName,
                final: game.status === "complete",
              }
        }
      />
      {competitionId && (
        <NonGolfScoreboard
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          teams={teams}
          scoringModel={scoringModel}
          initialOrder={initialOrder}
          initialResult={initialResult}
          canEdit={canEdit}
          onPosted={() => router.back()}
        />
      )}
    </div>
  );
}
