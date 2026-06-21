"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Flag, GripVertical, Plus, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MatchEntryView, type MatchGroupData } from "@/components/games/MatchEntryView";
import { MemberNotReady } from "@/components/games/MemberNotReady";
import { MatchCard } from "@/components/games/MatchCard";
import { StandardGrid } from "@/components/games/StandardGrid";
import { RelHandicapControl } from "@/components/games/RelHandicapControl";
import { Avatar } from "@/components/Avatar";
import { TimePicker } from "@/components/TimePicker";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { parseTime, toTime24 } from "@/lib/time";
import { buildDecided, matchState, strokeHoles, type HoleResult } from "@/lib/matchPlay";
import { PLAYER_COLORS, unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import type { Participant, ScoreValues } from "@/components/games/types";

/** "07:40" → "7:40 AM". Empty/invalid → "". */
function formatTee(t: string | null | undefined): string {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_PLAY = "gtt_match_play_singles";
const MATCH_PLAY_DOUBLES = "gtt_match_play_doubles";
// Mirrors the server cap (matches router). Dynamic match count grows up to here.
const MAX_MATCHES = 24;

// A server match side: a user (1v1) or a play_group (2v2). The editable draft
// holds each side as a list of member user ids — length ≤1 for singles, ≤2 for
// doubles — so one code path serves both (singles is the 1-per-side case).
type SideRef = { type: "user" | "play_group"; id: string } | null;
interface DraftMatch {
  matchNumber: number;
  a: string[]; // member user ids on side A (≤ playersPerSide)
  b: string[]; // member user ids on side B
  handicap: number; // signed: <0 → a gets |n|, >0 → b gets n, 0 → even
}
type Screen = "new" | "member-wait" | "setup" | "overview" | "score" | "config";

/**
 * Singles match-play game flow (Slice B). TEMPORARY route — the real Games tab
 * is Slice E. Walks the full lifecycle (create → pairings → handicap → activate
 * → score → finish), role-gated, persisting each step via the `matches` router.
 * Resume an existing game with `?game=<id>`.
 */
export default function NewMatchGamePage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const { canEdit: tripCanEdit, loading: roleLoading } = useTripRole(tripId);
  const me = useCurrentUser();
  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });

  // Competition roster (Slice D): a competition game pairs from the players
  // assigned to its teams, not the whole trip crew. Names still resolve from
  // crew (the roster is a subset of trip members).
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const utils = trpc.useUtils();
  const assignQ = trpc.teamAssignments.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { enabled: !!tripId && !!competitionId }
  );
  // Teams (Slice D, ordered by created_at). A Ryder-cup match binds a side to a
  // team: side A → team[0], side B → team[1]. That makes the pair picker
  // constrainable to one team (no cross-team pair) and the strip team-colored.
  const teamsQ = trpc.teams.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { enabled: !!tripId && !!competitionId }
  );

  const [gameId, setGameId] = useState<string | null>(search.get("game"));
  const [manualScreen, setManualScreen] = useState<Screen | null>(null);

  // New-game form. Dynamic match count: start at 1 (a single default match) and
  // grow one at a time — never force the full suggested count up front.
  const [matchCount, setMatchCount] = useState(1);
  const [teeTime, setTeeTime] = useState(""); // "HH:MM" 24h
  // Setup editing state
  const [draft, setDraft] = useState<DraftMatch[]>([]);
  const [selector, setSelector] = useState<{ matchIdx: number; slot: "a" | "b"; memberIdx: number } | null>(null);
  // Back-stack: forward transitions push the screen they left; Back pops to it.
  // Empty stack means we arrived directly (derived screen) → leave to trip home.
  const [navStack, setNavStack] = useState<Screen[]>([]);
  const [view, setView] = useState<"entry" | "grid">("entry");
  const [currentHole, setCurrentHole] = useState(1);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  // Collapse-on-advance: when teeing off with some slots still unfilled, confirm
  // the consequence (the game drops to the filled count; cup clinch shifts).
  const [confirmCollapse, setConfirmCollapse] = useState(false);
  // Course (Slice C): picked on the new-game screen, applied to the game once
  // it's created. id null until chosen.
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);

  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  const matchesQ = trpc.matches.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  const scoresQ = trpc.scores.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  // Per-game delegate (§10): a member granted as this game's organizer runs it
  // like an editor — config, pairings, score, finish. The server gate
  // (requireGameEdit) admits them; the UI must light up the same way. Trip
  // Owner/Organizer keep edit on every game; a delegate only on theirs.
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });

  // Format: the resumed game's type is authoritative; a brand-new game (no game
  // yet) reads the `?format=doubles` hint. `sided` switches the whole flow
  // between 1v1 (a side is a user) and 2v2 (a side is a pair = a play_group).
  // Default singles → existing URLs with no param are byte-for-byte unchanged.
  const resumedTypeId = gameQ.data?.game_type_id as string | undefined;
  const sided = resumedTypeId ? resumedTypeId === MATCH_PLAY_DOUBLES : search.get("format") === "doubles";
  const playersPerSide = sided ? 2 : 1;

  // The matches that are actually playable — both sides fully assigned. An
  // unfilled slot is not a match (it never scores), so teeing off COLLAPSES the
  // game to these: the unfilled slots are discarded and points-in-play / the cup
  // clinch recompute from this count. "Defined" was builder-time intent only.
  const filledDraft = useMemo(
    () => draft.filter((d) => d.a.length === playersPerSide && d.b.length === playersPerSide),
    [draft, playersPerSide]
  );

  // Scoring — the connectivity-resilient saver owns `values` + `saveStatus`:
  // optimistic value, retry-with-backoff, per-cell status, kept-and-flagged
  // (never rolled back) on failure. 2v2 records ONE entry per side (the
  // play_group), so the saver tags writes with participant_type='play_group'.
  const { values, setValues, saveStatus, onChange, onClear, retryCell } =
    useScoreSaver(tripId, gameId, sided ? "play_group" : undefined);
  const amDelegate = useMemo(
    () => !!me && (orgQ.data as { user_id: string }[] | undefined ?? []).some((o) => o.user_id === me.id),
    [orgQ.data, me]
  );
  const canEdit = tripCanEdit || amDelegate;

  const createGame = trpc.games.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const setPairings = trpc.matches.setPairings.useMutation();
  const setHandicap = trpc.matches.setHandicap.useMutation();
  const setDoublesPairings = trpc.matches.setDoublesPairings.useMutation();
  const setDoublesHandicap = trpc.matches.setDoublesHandicap.useMutation();
  const activate = trpc.matches.activate.useMutation();
  // Phase 2B.1: Disable scoring — close to the crew, back to setup, scores kept.
  const disableScoring = trpc.games.disableScoring.useMutation();
  // Dynamic match count (+1 / −1). Each changes the game's configured match
  // count → the clinch goalpost (value × count) on the competition board, so
  // both refresh the board after (see refreshAfterMatchCountChange).
  const addMatch = trpc.matches.addMatch.useMutation();
  const removeMatch = trpc.matches.removeMatch.useMutation();
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

  // Max singles matches = floor(players ÷ 2): the standalone pool is
  // undifferentiated, so any two of the crew pair up (Slice B). In a 2-team
  // competition the cap becomes min(teamA, teamB) since matches cross the team
  // line — generally min team size across teams — which is Slice D's concern.
  const crewCount = crew.data?.length ?? 0;
  // 1v1 needs 2 players per match, 2v2 needs 4 (two pairs).
  const maxMatches = Math.max(1, Math.floor(crewCount / (sided ? 4 : 2)));

  // Competition roster + the singles match cap = min(teamA, teamB). Used to seed
  // a resumed competition game's pairings and to scope the player picker.
  const gameCompId = (gameQ.data?.competition_id as string | null) ?? null;
  const rosterIds = useMemo(
    () => [...new Set((assignQ.data ?? []).map((a) => a.user_id as string))],
    [assignQ.data]
  );
  const compMatchCount = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const a of assignQ.data ?? []) sizes.set(a.team_id as string, (sizes.get(a.team_id as string) ?? 0) + 1);
    // A 2v2 match consumes 2 from each team, a 1v1 consumes 1 — so the cap is
    // min over teams of floor(teamSize / playersPerSide).
    const counts = [...sizes.values()].map((n) => Math.floor(n / playersPerSide));
    return counts.length >= 2 ? Math.max(1, Math.min(...counts)) : 0;
  }, [assignQ.data, playersPerSide]);

  const status = gameQ.data?.status as string | undefined;
  // Phase 2B.1: scoring enabled is the real "open for scoring" flag (publish no
  // longer goes Live — first score does, #396). The owner lands on the overview
  // once enabled (or active/complete); members see it once enabled (= published).
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
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
    const memberId = sided ? (membersOfSide.get(sideId) ?? [])[0] : sideId;
    if (!memberId) return undefined;
    const teamId = teamOfUser.get(memberId);
    return teamId ? teamById.get(teamId) : undefined;
  };
  // A side's display color: its TEAM color in a 2-team competition, else the
  // per-player palette (standalone / non-team game) — unchanged for those.
  const sideColor = (sideId: string) => (twoTeams ? teamOfSide(sideId)?.color : undefined) ?? colorOf.get(sideId);
  // The roster of one team — the constrained pool for that side's picker, so a
  // cross-team pair is impossible to assemble (Step 3: invalid unrepresentable).
  const rosterOfTeam = (teamId: string) =>
    [...new Set((assignQ.data ?? []).filter((a) => a.team_id === teamId).map((a) => a.user_id as string))];

  // Handicap keyed by SIDE id: a user (1v1, from game_participants) or a
  // play_group (2v2, from play_groups). Same map shape, the entry/board read it
  // identically.
  const handicapOf = useMemo(() => {
    const m = new Map<string, number>();
    if (sided) {
      for (const pg of serverPlayGroups) m.set(pg.id, effectiveStrokes(pg));
    } else {
      for (const p of serverParticipants) m.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
    }
    return m;
  }, [sided, serverParticipants, serverPlayGroups]);

  function participant(id: string, fallbackColor?: string): Participant {
    const name = nameOf.get(id) ?? "Player";
    return {
      id,
      name,
      color: sideColor(id) ?? fallbackColor ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(id) ?? null,
    };
  }

  // A scoring side as one Participant. Singles → the user (unchanged). Doubles →
  // the play_group: id = play_group id (the score key), name = "Alice & Bob".
  // This is what lets the entry/board/overview render 2v2 with no changes — one
  // input per side, exactly group_holes.
  function sideParticipant(sideId: string): Participant {
    if (!sided) return participant(sideId);
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

  // Decided holes (A's perspective) for an overview strip — the shared builder.
  const decidedFor = (g: MatchGroupData) =>
    buildDecided(mergedFor(g.a.id), mergedFor(g.b.id), g.strokesA, g.strokesB, scIndex, scUnits.length);

  // A match's current hole = the first hole either player hasn't scored yet, so
  // opening a match drops you where it's at (not the hole you left from).
  const currentHoleFor = (g: MatchGroupData) => {
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

  // Seed the editable draft from the server when we land on setup for an
  // existing game (e.g. owner opens a pending game, or taps Edit) and the local
  // draft is empty. Create + Edit also seed via their handlers; this covers a
  // direct/derived landing.
  useEffect(() => {
    if (screen !== "setup" || draft.length > 0) return;
    if (serverMatches.length > 0) {
      setDraft(serverDraftFrom(serverMatches, handicapOf, membersOfSide, sided));
      return;
    }
    // Resume-into-empty: a competition game tapped from the leaderboard arrives
    // with no game_matches, so the derived "setup" landing had an empty draft and
    // a disabled CTA. Seed blank pairing cards from the roster's match cap (or the
    // crew cap for a standalone game) so setup is fillable.
    const n = compMatchCount || maxMatches;
    if (n > 0) setDraft(Array.from({ length: n }, (_, i) => ({ matchNumber: i + 1, a: [], b: [], handicap: 0 })));
  }, [screen, draft.length, serverMatches, handicapOf, membersOfSide, sided, compMatchCount, maxMatches]);

  // After a +1/−1 (or initial create): re-pull the game's matches AND refresh
  // the competition board so "first to XX" / "X of Y" recompute ON SCREEN. The
  // board has no realtime sub (only a 30s poll) and re-seeds competitions.
  // leaderboard FROM faceBootstrap on mount, so invalidate BOTH (CLAUDE.md #10),
  // else the goalpost reads stale until the poll.
  async function refreshAfterMatchCountChange() {
    await Promise.all([gameQ.refetch(), matchesQ.refetch(), scoresQ.refetch()]);
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId: tripId!, competitionId });
      utils.games.listByTrip.invalidate({ tripId: tripId! });
      utils.competitions.faceBootstrap.invalidate({ tripId: tripId! });
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!tripId) return;
    const g = await createGame.mutateAsync({
      tripId,
      gameTypeId: sided ? MATCH_PLAY_DOUBLES : MATCH_PLAY,
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
    const count = Math.min(Math.max(1, matchCount), maxMatches);
    // Persist the configured matches as rows NOW (empty) so the game has ≥1
    // configured match from creation — the board's clinch goalpost (value ×
    // count) is live immediately, not 0 until tee-off.
    const emptyMatches = Array.from({ length: count }, (_, i) => ({ sideA: null, sideB: null, matchNumber: i + 1 }));
    if (sided) await setDoublesPairings.mutateAsync({ tripId, gameId: g.id, matches: emptyMatches });
    else await setPairings.mutateAsync({ tripId, gameId: g.id, matches: emptyMatches });
    await refreshAfterMatchCountChange();
    setDraft(Array.from({ length: count }, (_, i) => ({ matchNumber: i + 1, a: [], b: [], handicap: 0 })));
    go("setup");
  }

  function startSetup() {
    // Seed the draft from server (or blank cards).
    if (serverMatches.length > 0) {
      setDraft(serverDraftFrom(serverMatches, handicapOf, membersOfSide, sided));
    } else if (draft.length === 0) {
      setDraft(Array.from({ length: matchCount }, (_, i) => ({ matchNumber: i + 1, a: [], b: [], handicap: 0 })));
    }
    go("setup");
  }

  // Tee off — the advance affordance. It's a SIGNAL, not a gate: clickable while
  // slots are unfilled. With every slot filled it commits straight through; with
  // some unfilled it confirms the collapse first (the game drops to the filled
  // count and the cup clinch shifts — a surfaced consequence, not a scold). With
  // nothing filled there's no match to play, so it's a no-op.
  function attemptReady() {
    if (filledDraft.length === 0) return;
    if (filledDraft.length < draft.length) {
      setConfirmCollapse(true);
      return;
    }
    void commitReady();
  }

  // Persist the pairings + handicaps, publish (activate), land on the overview.
  // Operates on `filledDraft` ONLY — unfilled slots are discarded here (the
  // collapse: setPairings clean-replaces, so the dropped rows are gone and the
  // board recomputes points-in-play / clinch from the filled count). No separate
  // Save-then-Activate; the two formats differ only in side shape + procedure.
  async function commitReady() {
    if (!tripId || !gameId) return;
    setConfirmCollapse(false);
    const matches = filledDraft;
    if (matches.length === 0) return;
    if (sided) {
      const saved = await setDoublesPairings.mutateAsync({
        tripId,
        gameId,
        matches: matches.map((d, i) => ({
          sideA: { members: d.a },
          sideB: { members: d.b },
          matchNumber: i + 1,
        })),
      });
      const handicapWrites = matches.flatMap((d, i) => {
        const row = saved[i] as { id: string; side_a: SideRef; side_b: SideRef } | undefined;
        if (!row || d.handicap === 0) return [];
        const recipient = d.handicap < 0 ? row.side_a : row.side_b;
        if (!recipient?.id) return [];
        return [setDoublesHandicap.mutateAsync({ tripId, gameId, matchId: row.id, recipientPlayGroupId: recipient.id, strokes: Math.abs(d.handicap) })];
      });
      await Promise.all([...handicapWrites, activate.mutateAsync({ tripId, gameId })]);
    } else {
      const saved = await setPairings.mutateAsync({
        tripId,
        gameId,
        matches: matches.map((d, i) => ({
          sideA: { type: "user" as const, id: d.a[0] },
          sideB: { type: "user" as const, id: d.b[0] },
          matchNumber: i + 1,
        })),
      });
      const handicapWrites = matches.flatMap((d, i) => {
        const row = saved[i] as { id: string } | undefined;
        if (!row || d.handicap === 0) return [];
        const recipientUserId = d.handicap < 0 ? d.a[0] : d.b[0];
        return [setHandicap.mutateAsync({ tripId, gameId, matchId: row.id, recipientUserId, strokes: Math.abs(d.handicap) })];
      });
      await Promise.all([...handicapWrites, activate.mutateAsync({ tripId, gameId })]);
    }
    // Saving setup changes the configured match count → refresh the board so
    // "first to XX" reflects it on screen.
    await refreshAfterMatchCountChange();
    go("overview");
  }

  // Dynamic match count — mid-life +1 / −1 (the explicit "arm with 1, add a 2nd
  // mid-life" path). Each persists incrementally (NOT a bulk re-save, so
  // in-progress matches are untouched) and refreshes the board reactively.
  async function handleAddMatch() {
    if (!tripId || !gameId) return;
    try {
      await addMatch.mutateAsync({ tripId, gameId });
      await refreshAfterMatchCountChange();
    } catch {
      // surfaced via the global error toast
    }
  }
  async function handleRemoveMatch(matchId: string) {
    if (!tripId || !gameId) return;
    try {
      await removeMatch.mutateAsync({ tripId, gameId, matchId });
      await refreshAfterMatchCountChange();
    } catch {
      // surfaced via the global error toast
    }
  }

  async function handleFinish() {
    if (!tripId || !gameId) return;
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
      go("overview");
    } catch {
      // Stay put (no silent advance). The global error toast surfaces the
      // failure; Finish stays tappable to retry (the recompute is idempotent).
    }
  }

  // Phase 2B.3: Disable scoring — close to the crew, KEEP scores, and STAY in
  // Configuration (continue configuring right here; NOT a hub reverse-transform).
  // Invalidate the board (incl. faceBootstrap, CLAUDE.md #10) so the row drops
  // back to the muted-icon Ready state.
  async function handleDisable() {
    if (!tripId || !gameId) return;
    try {
      await disableScoring.mutateAsync({ tripId, gameId });
      await Promise.all([gameQ.refetch(), matchesQ.refetch()]);
      if (competitionId) {
        utils.competitions.leaderboard.invalidate({ tripId, competitionId });
        utils.games.listByTrip.invalidate({ tripId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
      }
      // Stay on the Configuration screen (manualScreen === "config" holds).
    } catch {
      // surfaced via the global error toast
    }
  }

  // Phase 2B.3: re-Enable from Configuration → back to the score-entry hub. The
  // pairings are already persisted, so this just flips the flag + publishes.
  async function handleEnableFromConfig() {
    if (!tripId || !gameId) return;
    try {
      await activate.mutateAsync({ tripId, gameId });
      await Promise.all([gameQ.refetch(), matchesQ.refetch()]);
      if (competitionId) {
        utils.competitions.leaderboard.invalidate({ tripId, competitionId });
        utils.games.listByTrip.invalidate({ tripId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
      }
      go("overview");
    } catch {
      // surfaced via the global error toast
    }
  }

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
          return {
            matchId: mm.id as string,
            label: `Match ${(mm.match_number as number) ?? i + 1}`,
            a: sideParticipant(a.id),
            b: sideParticipant(b.id),
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
    return (
      <div className="fixed inset-0 z-50">
        {view === "grid" ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              {/* When locked, the grid is the read-only result — back returns to
                  the hub and cells don't open editable entry (#7). */}
              <button onClick={() => (locked ? go("overview") : setView("entry"))} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{locked ? "Scorecard · Final" : "Scorecard"}</span>
            </div>
            <div className="min-h-0 flex-1">
              <StandardGrid
                units={scUnits}
                tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
                participants={entryParticipants}
                values={values}
                direction="low_wins"
                pips={entryPips}
                saveStatus={saveStatus}
                onCellTap={locked ? undefined : (label) => {
                  setCurrentHole(Number(label) || 1);
                  setView("entry");
                }}
              />
            </div>
          </div>
        ) : (
          <MatchEntryView
            gameName={`${selectedGroup.a.name} v ${selectedGroup.b.name}`}
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
            onBack={goBack}
            onOpenGrid={() => setView("grid")}
            onFinish={goBack}
            finishLabel="Back to matches"
            finishSubtext="Scores save as you enter"
            meId={me?.id}
          />
        )}
      </div>
    );
  }

  // ── Configuration page (§B 2B.3) — the post-Enable editing home. Full-screen
  // (own header), reached from the hub's top-right. ──
  if (screen === "config" && gameQ.data) {
    return (
      <GameConfigurationView
        subtitle={sided ? "Doubles · 2v2 Match Play" : "Singles · 1v1 Match Play"}
        onBack={goBack}
        tripId={tripId}
        competitionId={gameCompId}
        game={gameQ.data as unknown as GameRow}
        canEdit={canEdit}
        onChanged={() => {
          void gameQ.refetch();
          if (competitionId) {
            utils.competitions.leaderboard.invalidate({ tripId, competitionId });
            utils.competitions.faceBootstrap.invalidate({ tripId });
            utils.games.listByTrip.invalidate({ tripId });
          }
        }}
        whosPlayingLabel={`${groups.length} ${groups.length === 1 ? "matchup" : "matchups"} · pairings & strokes`}
        onEditWhosPlaying={startSetup}
        scoringEnabled={scoringEnabled}
        onEnable={handleEnableFromConfig}
        onDisable={handleDisable}
        busy={disableScoring.isPending || activate.isPending}
      />
    );
  }

  // ── Shell for the setup screens ──
  const headerTitle = screen === "new" ? "New game" : screen === "setup" ? "Set Pairings" : "Matches";
  return (
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
      <SetupHeader
        title={headerTitle}
        subtitle={sided ? "Doubles · 2v2 Match Play" : "Singles · 1v1 Match Play"}
        onBack={goBack}
        right={
          screen === "overview" && canEdit && status !== "complete" ? (
            // §B (2B.3): the score-entry hub's top-right opens Configuration (the
            // post-Enable editing home — Enable/Disable + the field editors live
            // there now, not inline on the hub).
            <button onClick={() => go("config")} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>
              Configuration
            </button>
          ) : null
        }
      />

      <div className="w-full px-4 py-5">
      {screen === "new" && (
        <NewGame
          sided={sided}
          matchCount={matchCount}
          setMatchCount={setMatchCount}
          maxMatches={maxMatches}
          crewCount={crewCount}
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

      {screen === "member-wait" && <MemberNotReady gameName={gameQ.data?.name as string | undefined} />}

      {screen === "setup" && (
        <>
          {/* §B setup shell (Phase 2B.2): the standardized course + Name·Format·
              Points drill-down rows above the format's own who's-playing body
              (the pairing cards). Handicaps stay inline per pairing; "Enable
              scoring" is MatchSetup's bottom CTA. */}
          {gameQ.data && (
            <div style={{ marginBottom: 14 }}>
              <GameSetupRows
                tripId={tripId}
                competitionId={gameCompId}
                game={gameQ.data as unknown as GameRow}
                canEdit={canEdit}
                onChanged={() => {
                  void gameQ.refetch();
                  if (competitionId) {
                    utils.competitions.leaderboard.invalidate({ tripId, competitionId });
                    utils.competitions.faceBootstrap.invalidate({ tripId });
                    utils.games.listByTrip.invalidate({ tripId });
                  }
                }}
              />
            </div>
          )}
          <MatchSetup
            tripId={tripId}
            draft={draft}
            setDraft={setDraft}
            playersPerSide={playersPerSide}
            teamA={teamForSlot("a")}
            teamB={teamForSlot("b")}
            nameOf={nameOf}
            colorOf={colorOf}
            avatarIconOf={avatarIconOf}
            openSelector={(matchIdx, slot, memberIdx) => setSelector({ matchIdx, slot, memberIdx })}
            onReady={attemptReady}
            saving={setPairings.isPending || setHandicap.isPending || setDoublesPairings.isPending || setDoublesHandicap.isPending || activate.isPending}
          />
        </>
      )}

      {screen === "overview" && (
        <Overview
          groups={groups}
          myId={me?.id}
          published={published}
          complete={status === "complete"}
          teeLabel={formatTee(gameQ.data?.tee_time as string | null | undefined)}
          gameName={gameQ.data?.name as string | undefined}
          canEdit={canEdit}
          decidedFor={decidedFor}
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
            // Locked → open the read-only scorecard grid; otherwise editable entry.
            setView(locked ? "grid" : "entry");
            go("score");
          }}
          // +1 mid-life: persist an empty match, then land on setup to pick its
          // players. The board's clinch goalpost moves once the match is PAIRED
          // (a match = assigned), not the instant the empty slot is added.
          onAddMatch={async () => {
            await handleAddMatch();
            go("setup");
          }}
          onRemoveMatch={handleRemoveMatch}
          mutatingCount={addMatch.isPending || removeMatch.isPending}
        />
      )}
      </div>

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
            avatarIconOf={avatarIconOf}
            onPick={(userId) => {
              setDraft((prev) => assignInDraft(prev, selector.matchIdx, selector.slot, selector.memberIdx, userId, playersPerSide));
              setSelector(null);
            }}
            onClose={() => setSelector(null)}
          />
        );
      })()}

      {/* Collapse-on-incomplete confirm — fires only when teeing off with some
          slots unfilled. States the real drop (filled count · points) and that
          the cup clinch recalculates; confirming discards the unfilled slots. */}
      {confirmCollapse && (
        <CollapseConfirm
          filled={filledDraft.length}
          total={draft.length}
          perMatchValue={(gameQ.data?.points_distribution as { value?: number } | null)?.value ?? null}
          inCompetition={!!gameCompId}
          pending={setPairings.isPending || setDoublesPairings.isPending || activate.isPending}
          onConfirm={() => void commitReady()}
          onCancel={() => setConfirmCollapse(false)}
        />
      )}
    </div>
  );
}

/**
 * Collapse confirm (advance with unfilled slots). A consequence notice, not a
 * scold: the unfilled matches aren't being created, so the game drops to the
 * filled count, its points-in-play drop with it, and — in a competition — the
 * cup's first-to-win total recalculates (the surprising part, so say it).
 * Recovery is adding matches later, not an undo.
 */
function CollapseConfirm({
  filled,
  total,
  perMatchValue,
  inCompetition,
  pending,
  onConfirm,
  onCancel,
}: {
  filled: number;
  total: number;
  perMatchValue: number | null;
  inCompetition: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const unfilled = total - filled;
  const pts = perMatchValue != null ? filled * perMatchValue : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full" style={{ maxWidth: 360, background: "var(--color-bt-card-float)", borderRadius: 18, padding: 20, border: "1px solid var(--color-bt-border)" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {unfilled} {unfilled === 1 ? "match isn’t" : "matches aren’t"} set
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-bt-text-dim)", marginTop: 10 }}>
          Enable scoring now and this game collapses to{" "}
          <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
            {filled} {filled === 1 ? "match" : "matches"}
            {pts != null ? ` · ${pts} pts` : ""}
          </span>
          . The unfilled {unfilled === 1 ? "slot is" : "slots are"} discarded.
          {inCompetition && " The cup’s first-to-win total recalculates from the lower total."}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onConfirm}
            disabled={pending}
            className="w-full disabled:opacity-40"
            style={{ height: 48, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}
          >
            {pending ? "Enabling…" : `Enable with ${filled}`}
          </button>
          <button
            onClick={onCancel}
            disabled={pending}
            className="w-full disabled:opacity-40"
            style={{ height: 46, borderRadius: 12, background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", fontSize: 15, fontWeight: 600 }}
          >
            Keep setting up
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function serverDraftFrom(
  serverMatches: unknown[],
  handicapOf: Map<string, number>,
  membersOfSide: Map<string, string[]>,
  sided: boolean
): DraftMatch[] {
  // A server side → its member user ids. Singles: the user is the side. Doubles:
  // the play_group's members (looked up by side id).
  const members = (side: SideRef): string[] => {
    if (!side?.id) return [];
    return sided ? (membersOfSide.get(side.id) ?? []) : [side.id];
  };
  return (serverMatches as { match_number: number; side_a: SideRef; side_b: SideRef }[]).map((mm, i) => {
    const hcA = mm.side_a?.id ? (handicapOf.get(mm.side_a.id) ?? 0) : 0;
    const hcB = mm.side_b?.id ? (handicapOf.get(mm.side_b.id) ?? 0) : 0;
    return { matchNumber: mm.match_number ?? i + 1, a: members(mm.side_a), b: members(mm.side_b), handicap: hcA > 0 ? -hcA : hcB > 0 ? hcB : 0 };
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
  userId: string,
  playersPerSide: number
): DraftMatch[] {
  const next = prev.map((d) => ({ ...d, a: [...d.a], b: [...d.b] }));
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
  sided,
  matchCount,
  setMatchCount,
  maxMatches,
  crewCount,
  teeTime,
  setTeeTime,
  courseName,
  onPickCourse,
  onCreate,
  pending,
  canEdit,
}: {
  sided: boolean;
  matchCount: number;
  setMatchCount: (n: number) => void;
  maxMatches: number;
  crewCount: number;
  teeTime: string;
  setTeeTime: (t: string) => void;
  courseName: string | null;
  onPickCourse: () => void;
  onCreate: () => void;
  pending: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return <MemberNotReady />;
  // Clamp the displayed value to the crew-derived cap (state may still hold an
  // old value while the crew query resolves).
  const value = Math.min(Math.max(1, matchCount), maxMatches);
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

        {/* Matches — count stepper. */}
        <div>
          <FieldLabel>Matches to add</FieldLabel>
          <div className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5" style={pillStyle}>
            <span style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
              {value} {value === 1 ? "match" : "matches"}
            </span>
            <div className="flex items-center gap-2">
              <Stepper dir="dec" disabled={value <= 1} onClick={() => setMatchCount(Math.max(1, value - 1))} />
              <Stepper dir="inc" disabled={value >= maxMatches} onClick={() => setMatchCount(Math.min(maxMatches, value + 1))} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 6, paddingLeft: 2 }}>
            {crewCount} in the crew · up to {maxMatches} {sided ? "2v2" : "singles"} match{maxMatches === 1 ? "" : "es"}
          </p>
        </div>
      </div>

      <PrimaryButton label="Create game" onClick={onCreate} disabled={pending} />
    </div>
  );
}

function MatchSetup({
  draft,
  setDraft,
  playersPerSide,
  teamA,
  teamB,
  nameOf,
  colorOf,
  avatarIconOf,
  openSelector,
  onReady,
  saving,
}: {
  tripId: string;
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  playersPerSide: number;
  /** The teams bound to side A / side B (2-team competition). Undefined → no
   *  team binding (standalone), and the per-side team header is hidden. */
  teamA?: { name: string; color: string };
  teamB?: { name: string; color: string };
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  avatarIconOf: Map<string, string | null>;
  openSelector: (matchIdx: number, slot: "a" | "b", memberIdx: number) => void;
  onReady: () => void;
  saving: boolean;
}) {
  // Drag-to-reorder (mirrors the news composer): `ins` is the insertion slot in
  // the original array (0..length). The accent line shows only once the cursor
  // crosses a neighbour's midpoint, and never on the dragged card's own two
  // adjacent slots (a no-op). Drag is armed only while the grip is held so the
  // slots/stepper inside the card stay tappable.
  const [dragState, setDragState] = useState<{ from: number; ins: number | null } | null>(null);
  const [armedIdx, setArmedIdx] = useState<number | null>(null);

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
      color: colorOf.get(userId) ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(userId) ?? null,
    };
  }
  // A whole side as one Participant ("Alice & Bob") — for the handicap control.
  function sidePart(members: string[]): Participant | null {
    if (members.length === 0) return null;
    const name = members.map((u) => nameOf.get(u) ?? "Player").join(" & ");
    return {
      id: members.join("+"),
      name,
      color: colorOf.get(members[0]) ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(members[0]) ?? null,
    };
  }
  // The member slots for one side — 1 for singles, 2 stacked for doubles. Each
  // sub-slot picks a single player into that member position. A team header
  // (Blue / Red) names the side's team so the constraint is legible.
  const sideSlots = (members: string[], matchIdx: number, slot: "a" | "b") => {
    const team = slot === "a" ? teamA : teamB;
    return (
      <div className="flex flex-col gap-1.5">
        {team && (
          <div className="flex items-center gap-1.5" style={{ paddingLeft: 2, marginBottom: 1 }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: team.color }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: team.color }}>{team.name}</span>
          </div>
        )}
        {Array.from({ length: playersPerSide }).map((_, k) => (
          <Slot key={k} player={memberPart(members[k])} teamColor={team?.color} onTap={() => openSelector(matchIdx, slot, k)} />
        ))}
      </div>
    );
  };

  // Filled = both sides fully assigned (a real match). Drives the advance
  // affordance: outlined until every slot is filled, disabled with none filled.
  const filledCount = draft.filter((d) => d.a.length === playersPerSide && d.b.length === playersPerSide).length;
  const allFilled = draft.length > 0 && filledCount === draft.length;

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginBottom: 14 }}>
        Tap a slot to pick a player · drag to reorder.
      </p>

      <div className="flex flex-col gap-3">
        {draft.map((d, i) => {
          // Both sides complete (full pairs in doubles) → show the handicap control.
          const aFull = d.a.length === playersPerSide;
          const bFull = d.b.length === playersPerSide;
          const both = aFull && bFull;
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
              style={{ position: "relative", padding: "12px 12px 14px", borderRadius: 14, background: "var(--color-bt-card)", border: `1px solid ${dragging ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`, opacity: dragging ? 0.4 : 1 }}
            >
              {dropIndicator && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    [dropIndicator === "top" ? "top" : "bottom"]: -8,
                    height: 2,
                    borderRadius: 2,
                    background: "var(--color-bt-accent)",
                    boxShadow: "0 0 0 2px var(--color-bt-accent-faint)",
                    pointerEvents: "none",
                  }}
                />
              )}
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>Match {i + 1}</span>
                <div className="flex items-center gap-1">
                  {/* Remove this match (down to the minimum of 1). Pre-tee-off
                      draft has no persisted scores, so removal is free here. */}
                  {draft.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove match"
                      aria-label={`Remove match ${i + 1}`}
                      className="flex items-center justify-center"
                      style={{ width: 24, height: 24, color: "var(--color-bt-danger)" }}
                    >
                      <Minus size={16} />
                    </button>
                  )}
                  <span
                    onMouseDown={() => setArmedIdx(i)}
                    onMouseUp={() => setArmedIdx(null)}
                    title="Drag to reorder"
                    aria-label="Drag to reorder"
                    className="flex cursor-grab items-center justify-center active:cursor-grabbing"
                    style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)", touchAction: "none" }}
                  >
                    <GripVertical size={16} />
                  </span>
                </div>
              </div>
              {/* Grid with minmax(0,1fr) columns → the two slots are always
                  equal width regardless of name length, vs stays centered. */}
              <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 8 }}>
                {sideSlots(d.a, i, "a")}
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
                {sideSlots(d.b, i, "b")}
              </div>
              {both && (
                <div style={{ marginTop: 12 }}>
                  <RelHandicapControl
                    a={sidePart(d.a)!}
                    b={sidePart(d.b)!}
                    value={d.handicap}
                    onChange={(v) => setDraft((prev) => prev.map((x, j) => (j === i ? { ...x, handicap: v } : x)))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add another match — dynamic count grows one at a time (up to the cap). */}
      {draft.length < MAX_MATCHES && (
        <button
          type="button"
          onClick={() => setDraft((prev) => [...prev, { matchNumber: prev.length + 1, a: [], b: [], handicap: 0 }])}
          className="mt-3 flex w-full items-center justify-center gap-1.5"
          style={{ height: 46, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
        >
          <Plus size={16} />
          Add match
        </button>
      )}

      {/* Advance is a SIGNAL, not a gate (collapse-on-incomplete): clickable
          while slots are unfilled, outlined until every slot is assigned, filled
          once complete. Disabled only with nothing to tee off (no full match). */}
      <PrimaryButton
        label={saving ? "Enabling…" : "Enable scoring"}
        onClick={onReady}
        disabled={saving || filledCount === 0}
        outlined={!allFilled}
      />
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
  groups,
  myId,
  published,
  complete,
  teeLabel,
  gameName,
  canEdit,
  decidedFor,
  holeCount,
  onFinish,
  finishing,
  correcting,
  canCorrect,
  onCorrect,
  correctingPending,
  onOpenMatch,
  onAddMatch,
  onRemoveMatch,
  mutatingCount,
}: {
  groups: MatchGroupData[];
  myId: string | undefined;
  published: boolean;
  complete: boolean;
  teeLabel: string;
  gameName?: string;
  canEdit: boolean;
  decidedFor: (g: MatchGroupData) => HoleResult[];
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
  /** Dynamic match count — mid-life +1 / −1. */
  onAddMatch: () => void;
  onRemoveMatch: (matchId: string) => void;
  mutatingCount: boolean;
}) {
  if (!published) return <MemberNotReady gameName={gameName} />;
  const decideds = groups.map(decidedFor);
  const allOver = groups.length > 0 && decideds.every((d) => matchState(d, holeCount).over);
  const underway = decideds.some((d) => d.length > 0);
  return (
    <div>
      {/* Pre-round banner — disappears once the first match starts. Edit lives in
          the title bar; round-complete keeps its banner. */}
      {(complete || !underway) && (
        <div className="flex items-center gap-2" style={{ padding: "10px 14px", borderRadius: 12, background: "var(--color-bt-place-1-bg)", border: "1px solid rgba(34,197,94,0.25)", marginBottom: 10 }}>
          <Flag size={15} style={{ color: "var(--color-bt-place-1-text)", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>
            {complete
              ? correcting
                ? "Correcting — edit a score, then re-lock"
                : "Final · locked"
              : `Matchups are set${teeLabel ? ` · tees off ${teeLabel}` : ""}`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {groups.map((g, i) => (
          <div key={g.matchId} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <MatchCard
                a={g.a}
                b={g.b}
                results={decideds[i]}
                label={`Match ${i + 1}`}
                youId={myId}
                leftColor={g.leftColor}
                rightColor={g.rightColor}
                hideFormat
                onClick={() => onOpenMatch(g.matchId)}
              />
            </div>
            {/* −1: remove this match (live count). Warn first if it has scores —
                never silently drop entry. Down to the minimum of 1. */}
            {canEdit && !complete && groups.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const scored = decideds[i].length > 0;
                  if (scored && !window.confirm(`Match ${i + 1} has scores entered. Remove it and discard them?`)) return;
                  onRemoveMatch(g.matchId);
                }}
                disabled={mutatingCount}
                title="Remove match"
                aria-label={`Remove match ${i + 1}`}
                className="flex shrink-0 items-center justify-center disabled:opacity-40"
                style={{ width: 34, height: 34, borderRadius: 9999, color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-danger-border)" }}
              >
                <Minus size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* +1: add another match mid-life (lands on setup to pick its players).
          The board's "first to XX" moves once the new match is PAIRED. */}
      {canEdit && !complete && groups.length < MAX_MATCHES && (
        <button
          type="button"
          onClick={onAddMatch}
          disabled={mutatingCount}
          className="mt-3 flex w-full items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ height: 46, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
        >
          <Plus size={16} />
          Add match
        </button>
      )}

      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", margin: "12px 0 0 2px" }}>
        {complete
          ? correcting
            ? "Tap a match to fix a score."
            : "Tap a match to view the scorecard."
          : underway
            ? `${groups.length} ${groups.length === 1 ? "match" : "matches"} · tap one to keep scoring.`
            : `${groups.length} ${groups.length === 1 ? "match" : "matches"} · tap one to enter scores — the round starts on your first score.`}
      </p>

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
  avatarIconOf,
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
  avatarIconOf: Map<string, string | null>;
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
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full" style={{ background: "var(--color-bt-card-float)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px 28px", maxHeight: "75vh", overflowY: "auto" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {teamColor && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: teamColor }} />}
          {title}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 14 }}>Available</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {available.length === 0 && <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Everyone&apos;s assigned.</span>}
          {available.map((id) => (
            <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} avatarIcon={avatarIconOf.get(id) ?? null} teamColor={teamColor} onClick={() => onPick(id)} />
          ))}
        </div>
        {taken.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 16 }}>Already in a match</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {taken.map((id) => (
                <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} avatarIcon={avatarIconOf.get(id) ?? null} teamColor={teamColor} sub={`Match ${(inMatch.get(id) ?? 0) + 1}`} dim onClick={() => onPick(id)} />
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

function Stepper({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center justify-center disabled:opacity-30" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}>
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

function Slot({ player, onTap, teamColor }: { player: Participant | null; onTap: () => void; teamColor?: string | null }) {
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
  // Filled block — lighter card-raised pill so the player stands out on the card.
  // Avatar is always left of the name (we never put it after the name).
  return (
    <button
      onClick={onTap}
      className="flex items-center gap-2"
      style={{ width: "100%", minWidth: 0, height: 44, padding: "0 10px", borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      <Avatar name={player.name} avatarIcon={player.avatarIcon} teamColor={teamColor ?? player.color} sizePx={30} />
      <span style={{ minWidth: 0, fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.name}</span>
    </button>
  );
}

function SelectorRow({ name, avatarIcon, teamColor, sub, dim, onClick }: { name: string; avatarIcon?: string | null; teamColor?: string | null; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 text-left" style={{ padding: "9px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: dim ? 0.55 : 1 }}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={30} />
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
