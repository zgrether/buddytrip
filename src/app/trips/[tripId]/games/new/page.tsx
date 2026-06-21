"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { FinalStandings } from "@/components/games/FinalStandings";
import { EnableScoringGate } from "@/components/games/EnableScoringGate";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import { HandicapRoster, type HandicapPlayer } from "@/components/games/HandicapRoster";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { useTripRole } from "@/hooks/useTripRole";
import type { StrokeStanding } from "@/lib/strokePlay";
import { PLAYER_COLORS, unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import { strokeHoles } from "@/lib/matchPlay";
import type { Participant, ScoreValues } from "@/components/games/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STROKE_PLAY = "gtt_stroke_play";

/**
 * Minimal "new stroke-play game" flow (Slice A, Task 6 create step). TEMPORARY —
 * the real Games tab is Slice E. Pick 2–4 crew → create game + participants →
 * land in the hole-by-hole entry view. Finish/Final + review grid are Task 7.
 */
export default function NewGamePage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  // Resume an existing game when the leaderboard (or a refresh) lands here with
  // ?game=<id>. Without reading this, the page always fell back to pick-players
  // and created a NEW game every time — the picked roster + scores never came
  // back, because they live on the original game id this page never loaded.
  const urlGameId = search.get("game");

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: param },
    { enabled: !isId, retry: false }
  );
  const tripId = isId ? param : resolved.data?.id;
  const utils = trpc.useUtils();
  const { canEdit } = useTripRole(tripId);

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });

  // The game-to-resume (its roster) + its saved scores. Enabled only when we
  // arrived with ?game — the standalone "new game" flow leaves these idle.
  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { enabled: !!tripId && !!urlGameId }
  );
  const scoresQ = trpc.scores.listByGame.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { enabled: !!tripId && !!urlGameId }
  );

  const [selected, setSelected] = useState<string[]>([]);
  // A game created or joined in THIS session (the standalone new flow, or after
  // adding players to a competition game we opened with ?game).
  const [createdGame, setCreatedGame] = useState<{ id: string; participants: Participant[] } | null>(null);
  const [view, setView] = useState<"entry" | "grid" | "final">("entry");
  const [currentHole, setCurrentHole] = useState(1);
  const [standings, setStandings] = useState<StrokeStanding[]>([]);
  const [showConfig, setShowConfig] = useState(false); // §B 2B.3 Configuration page
  const [showHandicaps, setShowHandicaps] = useState(false); // §3 stroke handicaps step

  const createGame = trpc.games.create.useMutation();
  const addParticipants = trpc.games.addParticipants.useMutation();
  // §3: per-player handicap strokes (the same general mutation rack uses — it
  // sets game_participants.handicap_strokes by user_id; for stroke it no-ops the
  // re-derive since stroke persists results only at Finish).
  const setStrokes = trpc.playGroups.setParticipantStrokes.useMutation();
  // Phase 2B.1: scoring must be enabled before entries land (universal gate).
  const enableScoring = trpc.games.enableScoring.useMutation();
  const disableScoring = trpc.games.disableScoring.useMutation();

  const memberById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const c of crew.data ?? []) m.set(c.user_id, { id: c.user_id, name: c.displayName ?? c.user?.name ?? "Player" });
    return m;
  }, [crew.data]);

  const toParticipants = (userIds: string[]): Participant[] =>
    userIds.map((uid, i) => {
      const name = memberById.get(uid)?.name ?? "Player";
      return { id: uid, name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] };
    });

  // The roster already saved on the resumed game (empty until players are added).
  const resumeRoster = useMemo(
    () => ((gameQ.data?.participants ?? []) as { user_id: string }[]).map((p) => p.user_id),
    [gameQ.data]
  );

  // The game we're actually scoring: one created/joined this session, or the
  // ?game we opened once it has a roster. Null → show the pick-players screen.
  const game = useMemo<{ id: string; participants: Participant[] } | null>(() => {
    if (createdGame) return createdGame;
    if (urlGameId && resumeRoster.length > 0) {
      const participants = resumeRoster.map((uid, i) => {
        const name = memberById.get(uid)?.name ?? "Player";
        return { id: uid, name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] };
      });
      return { id: urlGameId, participants };
    }
    return null;
  }, [createdGame, urlGameId, resumeRoster, memberById]);

  // §3: the COURSE-aware scorecard — par + stroke index from the applied course
  // snapshot (falls back to the 18-hole template default when no course). The
  // live strip MUST use this same index the server final (computeStrokePlayResults)
  // nets against, so net can't diverge (CLAUDE.md #8).
  const scUnits = useMemo(
    () => unitsFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0]),
    [gameQ.data]
  );
  const scIndex = useMemo(() => strokeIndexOf(scUnits), [scUnits]);
  // Per-player handicap strokes (read from game_participants), and the stroked
  // holes each one allocates against the course index — drives the pips + net.
  const strokesOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of (gameQ.data?.participants ?? []) as { user_id: string; handicap_strokes: number | null }[]) {
      m.set(p.user_id, effectiveStrokes(p));
    }
    return m;
  }, [gameQ.data]);
  const entryPips = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const [uid, n] of strokesOf) m[uid] = new Set([...strokeHoles(n, scIndex)].map(String));
    return m;
  }, [strokesOf, scIndex]);
  const handicapPlayers: HandicapPlayer[] = useMemo(
    () =>
      (game?.participants ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        avatarIcon: null,
        teamColor: null,
        strokes: strokesOf.get(p.id) ?? 0,
      })),
    [game, strokesOf]
  );

  // The id the saver writes to: the resumed game, else the one created here.
  const activeGameId = urlGameId ?? createdGame?.id;
  // Phase 2B.1: a configured game must be Enabled before its score screen opens.
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  const gameCompetitionId = (gameQ.data as { competition_id?: string | null } | undefined)?.competition_id ?? null;
  async function refreshGame() {
    await gameQ.refetch();
    if (gameCompetitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId: gameCompetitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  async function handleEnable() {
    if (!tripId || !activeGameId) return;
    try {
      await enableScoring.mutateAsync({ tripId, gameId: activeGameId });
      await refreshGame();
      setShowConfig(false); // re-Enable from Configuration → back to score entry
    } catch {
      // surfaced via the global error toast
    }
  }
  // §B 2B.3: Disable from Configuration — keep scores, STAY in Configuration.
  async function handleDisable() {
    if (!tripId || !activeGameId) return;
    try {
      await disableScoring.mutateAsync({ tripId, gameId: activeGameId });
      await refreshGame();
    } catch {
      // surfaced via the global error toast
    }
  }
  // §3: persist one player's handicap strokes, then refetch so the pips + the
  // handicap roster reflect it (the live strip nets off the same scIndex).
  const onSetStrokes = (userId: string, strokes: number) =>
    setStrokes
      .mutateAsync({ tripId: tripId!, gameId: activeGameId!, userId, strokes })
      .then((r) => { void gameQ.refetch(); return r; });
  // Score writes go through the connectivity-resilient saver: optimistic value,
  // retry-with-backoff, per-cell save status, kept-and-flagged (never rolled
  // back) on failure. Owns `values` + `saveStatus` for this game.
  const { values, setValues, saveStatus, onChange, onClear, retryCell } =
    useScoreSaver(tripId, activeGameId);
  // Finishing also retries (idempotent — recomputes from the same scores); a
  // failure stays on the entry view and surfaces via the global error toast,
  // so it's loud + retryable instead of a silent stall.
  const finishGame = trpc.games.finish.useMutation({
    retry: 4,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 8000),
  });

  // Seed the saved scores into the entry view ONCE on resume — never clobber an
  // edit already made in this session (mirrors the match page).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !urlGameId || !scoresQ.data) return;
    const loaded: ScoreValues = {};
    for (const e of scoresQ.data as { participant_id: string; unit_label: string; value: number | null }[]) {
      if (e.value == null) continue;
      (loaded[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    setValues((v) => (Object.keys(v).length ? v : loaded));
    seededRef.current = true;
  }, [urlGameId, scoresQ.data, setValues]);

  function toggle(userId: string) {
    setSelected((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length >= 4
          ? prev
          : [...prev, userId]
    );
  }

  async function start() {
    if (!tripId || selected.length < 2) return;
    // Resume target: add players to the game we opened (?game). Only create a
    // brand-new standalone game when we arrived WITHOUT one.
    const gameId =
      urlGameId ?? (await createGame.mutateAsync({ tripId, gameTypeId: STROKE_PLAY })).id;
    await addParticipants.mutateAsync({ tripId, gameId, userIds: selected });
    setCreatedGame({ id: gameId, participants: toParticipants(selected) });
    if (urlGameId) {
      void utils.games.getById.invalidate({ tripId, gameId });
    } else {
      // Stamp the new id into the URL so a refresh / re-entry resumes it.
      router.replace(`/trips/${param}/games/new?game=${gameId}`);
    }
  }

  if (!tripId) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // Resuming from ?game — wait for the roster before choosing pick-vs-score, so
  // we never flash the "pick players" screen over a game that already has them.
  if (urlGameId && !createdGame && gameQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  async function handleFinish() {
    if (!tripId || !game) return;
    try {
      const res = await finishGame.mutateAsync({ tripId, gameId: game.id });
      setStandings(res.standings);
      setView("final");
    } catch {
      // Stay on the entry view (no silent advance). The global error toast
      // surfaces the failure; the Finish CTA stays tappable to retry (the
      // recompute is idempotent).
    }
  }

  function playAgain() {
    setCreatedGame(null);
    setValues({});
    setStandings([]);
    setSelected([]);
    setCurrentHole(1);
    setView("entry");
    seededRef.current = false;
    // Drop ?game so "Play again" starts a fresh game instead of resuming this one.
    if (urlGameId) router.replace(`/trips/${param}/games/new`);
  }

  // ── §3 Handicaps step — per-player ABSOLUTE strokes (stroke is per-player, not
  // per-matchup). Reached from the setup hull's Handicaps row AND Configuration.
  // Drives `netStrokeEntries`/`strokeHoles`: the input Phase 1 deferred. ──
  if (game && showHandicaps && canEdit) {
    return (
      <div className="flex flex-col" style={{ height: "100vh" }}>
        <HandicapRoster
          players={handicapPlayers}
          holeCount={scUnits.length}
          strokeIndex={scIndex}
          onSetStrokes={onSetStrokes}
          onDone={() => setShowHandicaps(false)}
          onBack={() => setShowHandicaps(false)}
        />
      </div>
    );
  }

  // ── Enable gate (Phase 2B.1) → §B setup hull (2B.2). A configured game must be
  // enabled before its score screen opens; the gate also hosts the standardized
  // course + Name·Format·Points drill-down rows + (§3) the Handicaps step. ──
  if (game && !scoringEnabled && !showConfig) {
    return (
      <EnableScoringGate
        title="Stroke Play"
        subtitle={`${game.participants.length} player${game.participants.length === 1 ? "" : "s"}`}
        onEnable={handleEnable}
        onBack={() => router.back()}
        pending={enableScoring.isPending}
        setupRows={
          gameQ.data ? (
            <>
              <GameSetupRows
                tripId={tripId}
                competitionId={gameCompetitionId}
                game={gameQ.data as unknown as GameRow}
                canEdit={canEdit}
                onChanged={() => {
                  void gameQ.refetch();
                  if (gameCompetitionId) {
                    utils.competitions.leaderboard.invalidate({ tripId, competitionId: gameCompetitionId });
                    utils.competitions.faceBootstrap.invalidate({ tripId });
                    utils.games.listByTrip.invalidate({ tripId });
                  }
                }}
              />
              <HandicapsRow strokesOf={strokesOf} onClick={() => setShowHandicaps(true)} disabled={!canEdit} />
            </>
          ) : null
        }
      />
    );
  }

  // ── Configuration page (§B 2B.3) — the post-Enable editing home, reached from
  // the score-entry hub's top-right gear. ──
  if (game && showConfig && gameQ.data && canEdit) {
    return (
      <div className="fixed inset-0 z-50">
        <GameConfigurationView
          subtitle="Stroke Play"
          onBack={() => setShowConfig(false)}
          tripId={tripId}
          competitionId={gameCompetitionId}
          game={gameQ.data as unknown as GameRow}
          canEdit={canEdit}
          onChanged={() => void refreshGame()}
          whosPlayingLabel={`${game.participants.length} player${game.participants.length === 1 ? "" : "s"} · per-player strokes`}
          onEditWhosPlaying={() => { setShowConfig(false); setShowHandicaps(true); }}
          scoringEnabled={scoringEnabled}
          onEnable={handleEnable}
          onDisable={handleDisable}
          busy={enableScoring.isPending || disableScoring.isPending}
        />
      </div>
    );
  }

  // ── Play ──
  if (game) {
    return (
      <div className="fixed inset-0 z-50">
        {view === "final" ? (
          <FinalStandings
            participants={game.participants}
            standings={standings}
            unitCount={scUnits.length}
            dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
          />
        ) : view === "grid" ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              <button onClick={() => setView("entry")} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>Scorecard</span>
            </div>
            <div className="min-h-0 flex-1">
              <StandardGrid
                units={scUnits}
                tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
                participants={game.participants}
                values={values}
                direction="low_wins"
                pips={entryPips}
                saveStatus={saveStatus}
                onCellTap={(label) => {
                  setCurrentHole(Number(label) || 1);
                  setView("entry");
                }}
              />
            </div>
          </div>
        ) : (
          <ScoreEntryView
            gameName="Stroke Play"
            units={scUnits}
            participants={game.participants}
            values={values}
            direction="low_wins"
            currentHole={currentHole}
            onHoleChange={setCurrentHole}
            onChange={onChange}
            onClear={onClear}
            saveStatus={saveStatus}
            onRetryCell={retryCell}
            pips={entryPips}
            onBack={() => router.back()}
            onOpenGrid={() => setView("grid")}
            onConfig={canEdit ? () => setShowConfig(true) : undefined}
            onFinish={handleFinish}
          />
        )}
      </div>
    );
  }

  // ── Pick players ──
  const members = (crew.data ?? []).filter((c) => memberById.has(c.user_id));
  return (
    <div className="mx-auto max-w-md px-4 py-6" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>New stroke-play game</h1>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>Pick 2–4 players.</p>

      <div className="mt-4 flex flex-col gap-2">
        {members.map((c) => {
          const on = selected.includes(c.user_id);
          const name = memberById.get(c.user_id)?.name ?? "Player";
          return (
            <button
              key={c.user_id}
              onClick={() => toggle(c.user_id)}
              className="flex items-center justify-between text-left"
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                color: "var(--color-bt-text)",
                fontSize: 15,
              }}
            >
              {name}
              {on && <span style={{ color: "var(--color-bt-accent)", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}
      </div>

      <button
        onClick={start}
        disabled={selected.length < 2 || createGame.isPending || addParticipants.isPending}
        className="mt-5 w-full disabled:opacity-40"
        style={{
          height: 50,
          borderRadius: 12,
          background: "var(--color-bt-accent)",
          color: "#0d1f1a",
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Start game
      </button>
    </div>
  );
}

/** §3 Handicaps drill-down row in the stroke setup hull — opens the per-player
 *  HandicapRoster. Mirrors the GameSetupRows row style; the summary reads how
 *  many players have strokes set (none yet = a neutral "Add strokes" cue). */
function HandicapsRow({ strokesOf, onClick, disabled }: { strokesOf: Map<string, number>; onClick: () => void; disabled?: boolean }) {
  const withStrokes = [...strokesOf.values()].filter((n) => n > 0).length;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Handicaps <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· optional</span>
        </span>
        <span className="truncate text-sm" style={{ color: withStrokes ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", marginTop: 2 }}>
          {withStrokes > 0 ? `${withStrokes} player${withStrokes === 1 ? "" : "s"} get strokes` : "Add per-player strokes"}
        </span>
      </div>
      <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
    </button>
  );
}
