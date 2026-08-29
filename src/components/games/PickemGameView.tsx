"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { trpc } from "@/lib/trpc-client";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import {
  configToPickemDraft,
  pickemDraftToPayload,
  pickemDraftsEqual,
  type PickemConfigDraft,
} from "@/lib/configDraft";
import { useGameSurfaceChrome } from "@/components/games/GameChrome";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { useRealtimeGame } from "@/hooks/useRealtimeGame";
import { useNow } from "@/hooks/useNow";
import { GameSettingsPage } from "@/components/games/GameSettingsPage";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { GameStandaloneHeader } from "@/components/games/GameStandaloneHeader";
import { Spinner } from "@/components/Spinner";
import { TYPE_SCALE } from "@/lib/typeScale";
import { showToast } from "@/lib/toast";
import { PickemSlateModal, type SlateDraftGame } from "@/components/games/pickem/PickemSlateModal";
import {
  PickemScoringRows,
  type PickemSettingsDraft,
} from "@/components/games/pickem/PickemScoringRows";
import { PickemSheet, PickemClosedBanner } from "@/components/games/pickem/PickemSheet";
import { explanationCopy, PARA_BREAK } from "@/lib/pickemSheet";
import { PickemPhaseStrip } from "@/components/games/pickem/PickemPhaseStrip";
import { PickemRunView } from "@/components/games/pickem/PickemRunView";
import { PickemBoard } from "@/components/games/pickem/PickemBoard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { matchesComplete, type PickemPair } from "@/lib/pickemPairing";
import { effectiveDistribution, type PointsDistribution } from "@/lib/pointsDistribution";
import { resolvedCount, sheetPoints } from "@/lib/pickemScoring";
import { ridingOn } from "@/lib/pickemBoard";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { PickemMatchBuilder } from "@/components/games/pickem/PickemMatchBuilder";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { PickemTwoUp, type PickemPanel } from "@/components/games/pickem/PickemTwoUp";
import { PickemNoMatches } from "@/components/games/pickem/PickemNoMatches";
import { PickemProxyBanner, type ProxyTarget } from "@/components/games/pickem/PickemProxyPanel";
import {
  PickemSheetsList,
  PickemSheetsButton,
} from "@/components/games/pickem/PickemSheetsList";
import type { SheetSubject } from "@/components/games/pickem/PickemSheet";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import {
  msUntilDeadline,
  picksEverOpened,
  picksOpen,
  pickemClosure,
  pickemPhase,
  scoringSettingsEditable,
  scoringFrozenReason,
  slateEditable,
} from "@/lib/pickemLifecycle";

/**
 * The pick'em game surface.
 *
 * ── One page for everyone ───────────────────────────────────────────────────
 * The body below branches on the CLOCK, never on who is looking. A member and
 * the runner in state 1 see the same words — "Picks open soon" — because spec
 * §3.1's first fairness rule is that 1a (nothing added) and 1b (a finished
 * slate, unpublished) are indistinguishable from outside. What the runner has
 * extra is the settings gear, which every format's chrome already gives an
 * editor, so its presence leaks nothing pick'em-specific.
 *
 * The rule is enforced in RLS as well (migration 146 hides slate rows from
 * non-staff until picks open), so a member who reads the API directly learns
 * nothing either. This component is the polite half; the policy is the real one.
 *
 * ── What Phase 2 builds, and what it doesn't ────────────────────────────────
 * This is the slate phase. The sheet (Phase 3), the lock and pairing (Phase 4),
 * Every phase is built now: the slate, the sheet, the lock and pairing, Run,
 * and the board. Nothing on this page is a placeholder any more, which is why
 * the `Placeholder` helper that used to sit at the bottom is gone.
 */
export function PickemGameView() {
  const { tripId } = useTripId();
  const search = useSearchParams();
  const gameId = search.get("game");
  const settingsDeepLink = search.get("settings") === "1";

  const { canEdit, canManageGame } = useGameEditAccess(tripId, gameId);
  const me = useCurrentUser();
  const utils = trpc.useUtils();

  /**
   * ── Cross-device sync, which pick'em had NONE of ─────────────────────────
   *
   * Reported from a run-through: the runner could lock, unlock and reopen and
   * the player's sheet did not change at all. Cause — match, rack, stroke and
   * non-golf all mount `useRealtimeGame`; pick'em, the fifth format, mounted
   * neither realtime nor a poll, so its clock reached other devices only on a
   * manual reload. CLAUDE.md #24's shape again: a new format skipping a shared
   * mechanism.
   *
   * Realtime is the instant half (`pickem_games` joined the publication in
   * migration 151). The poll is the reconnect/dead-zone backstop CLAUDE.md #19
   * insists on and explicitly forbids removing as "redundant" — a golf course
   * is exactly where a socket dies quietly.
   *
   * 60s rather than the golf views' ~20s, deliberately: pick'em's clock changes
   * a handful of times in a game's whole life, where scores change every few
   * minutes. Every poll costs an auth round-trip through the middleware
   * (see #1097), so the cadence is matched to how often the answer can
   * actually differ.
   */
  const q = trpc.pickem.get.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, refetchInterval: 60_000 }
  );
  useRealtimeGame(tripId, gameId);

  // The delegates slice. Deliberately NOT on STRUCTURE_QUERY's staleTime, for
  // the reason `useGameEditAccess` gives: a revoked grant must stop rendering.
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId }
  );
  const serverDelegates = useMemo(
    () => ((orgQ.data as { user_id: string }[] | undefined) ?? []).map((d) => d.user_id),
    [orgQ.data]
  );

  const [slateOpen, setSlateOpen] = useState(false);
  /**
   * ── The settings page is a DRAFT now (#18) ──────────────────────────────
   *
   * It used to carry four write models at once: Total Points wrote to the
   * server on every stepper press; the deadline and the two scoring settings
   * each had a private draft with its own commit button; and name, rules and
   * delegates were rendered but wired to NOTHING — typing Rules of the Day and
   * closing the panel lost it silently.
   *
   * That last one is why this landed before the cosmetic half: it destroys
   * work rather than committing it early.
   *
   * What unblocked it was migration 157 giving all three scoring settings ONE
   * freeze point (the first result). Two boundaries could not be committed by a
   * single atomic Save — `points_total` had been carved out of the picks-open
   * freeze precisely so a 0-point game could be fixed mid-trip, so any Save
   * spanning both would have been refused whole the moment picks opened.
   *
   * Null / undefined means UNTOUCHED, so the draft falls through to the server
   * mirror — the same shape the other four views use.
   */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [rollUpDraft, setRollUpDraft] = useState<PickemSettingsDraft["rollUp"] | undefined>(undefined);
  const [useConfidenceDraft, setUseConfidenceDraft] = useState<boolean | undefined>(undefined);

  const clock = q.data?.clock ?? { picksOpenedAt: null, picksDeadline: null, picksLockedAt: null };

  /**
   * ONE CLOCK for every time-dependent answer on this page.
   *
   * The countdown used to be computed once at render and never moved — and,
   * worse, so did `picksOpen`, so a sheet could show 0:00 and stay editable.
   * Every derivation below now reads the SAME ticking `now`, which is what
   * makes crossing the deadline correct without a reload: the tick that shows
   * 0:00 is the tick that flips the sheet read-only and produces the closed
   * message.
   *
   * Ticking only matters while a deadline exists — a hand-locked or
   * no-deadline game has nothing counting down — so the timer is gated on one
   * rather than run on every pick'em page forever.
   */
  const now = useNow(1000, clock.picksDeadline != null);
  const phase = pickemPhase(clock, now);
  const canEditSlate = canEdit && slateEditable(clock, now);

  const saveConfig = trpc.pickem.saveConfig.useMutation({
    onSuccess: async () => {
      setSlateOpen(false);
      showToast("Slate saved", "info");
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  /**
   * The participant's own write. No toast on success: the save bar already says
   * "Saved" and a toast on top of it is the app congratulating someone for
   * doing the thing they came to do, sixteen taps in.
   *
   * The error is held in state rather than thrown at a toast, because it has to
   * survive next to the sheet it failed to save — a toast that has faded leaves
   * a person looking at unsaved picks with nothing on screen saying so (§7.4,
   * CLAUDE.md #15).
   */
  /**
   * Which of the two-up row's panels is open on a locked page, or neither.
   *
   * ONE value rather than a boolean each: they are alternatives, and two
   * booleans that must never both be true is how a screen ends up showing two
   * things stacked that were each designed to be the only one.
   */
  const [openPanel, setOpenPanel] = useState<PickemPanel | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePicks = trpc.pickem.savePicks.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => setSaveError(e.message),
  });

  /**
   * PROXY ENTRY (migration 163) — whose sheet is being edited. `null` is their
   * own.
   *
   * Held as an ID rather than the whole target object so a refetch cannot leave
   * a stale name in the banner while the sheet under it has moved on — and the
   * banner is the one thing that must never be wrong.
   */
  const [proxyFor, setProxyFor] = useState<string | null>(null);
  /** Is the Sheets list covering the page. Never a permission — see the list. */
  const [sheetsOpen, setSheetsOpen] = useState(false);
  /** The subject's name as it was when Save was pressed — the toast reports a
   *  past action, so it must not follow a later rename or refetch. */
  const proxyTargetName = useRef<string | null>(null);

  /**
   * WHO the viewer may act for. This list IS the affordance's gate: the server
   * returns exactly the people `_pickem_can_proxy_for` admits, so a plain
   * participant gets one row — themselves — and the control never renders for
   * them. Deliberately not a role check here; a role check in the client is a
   * second copy of the policy, and two copies drift.
   */
  const sheetStatusQ = trpc.pickem.sheetStatus.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId }
  );

  const savePicksFor = trpc.pickem.savePicksFor.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      // Both: `get` carries the sheet, `sheetStatus` carries the "who is
      // still missing" list the panel reads. Invalidating only the first leaves
      // the list saying someone has no sheet seconds after one was entered.
      await Promise.all([
        utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! }),
        utils.pickem.sheetStatus.invalidate({ tripId: tripId!, gameId: gameId! }),
      ]);
      setProxyFor(null);
      // "info", not "success" — ToastTone is error|info. Naming a tone the
      // system does not have is how a toast silently falls back to the error
      // colour and a good outcome reads as a bad one.
      showToast(`Saved ${proxyTargetName.current ?? "their"} sheet`, "info");
    },
    onError: (e) => setSaveError(e.message),
  });

  const setDeadline = trpc.pickem.setDeadline.useMutation({
    onSuccess: async () => {
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  const setPhase = trpc.pickem.setPhase.useMutation({
    onSuccess: async () => {
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  /**
   * Run (Phase 5) — one outcome at a time.
   *
   * `busyResultId` is per-ROW, not a page-level flag: results land in any
   * order, often in a burst, and a single spinner would freeze fifteen rows for
   * one write.
   */
  const [busyResultId, setBusyResultId] = useState<string | null>(null);
  const setResult = trpc.pickem.setResult.useMutation({
    onSuccess: async () => {
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
      // The board reads results — #10: the child alone is silently undone by
      // the face's re-seed.
      const cid = q.data?.game.competition_id as string | null;
      if (cid) {
        utils.competitions.leaderboard.invalidate({ tripId: tripId!, competitionId: cid });
        utils.competitions.faceBootstrap.invalidate({ tripId: tripId! });
      }
    },
    onError: (e) => showToast(e.message, "error"),
    onSettled: () => setBusyResultId(null),
  });

  /**
   * The PAIRINGS, drafted (critique r1 §2).
   *
   * They lived on the game page and wrote immediately through
   * `save_pickem_matches`. Both halves were wrong: pairing is SETUP, and a
   * control on a settings surface that writes on its own action is the thing
   * #18 exists to prevent. Now a slice like every other, committed by the one
   * `save_game_config` at the bottom of the page.
   *
   * `null` = untouched, so it follows the server.
   */
  const [matchesDraft, setMatchesDraft] = useState<DraftMatchConfig[] | null>(null);
  /** Which slot is waiting for a name — the selector's own state, as match play
   *  holds it. Not drafted: it is a cursor, not a value. */
  const [selector, setSelector] = useState<{
    matchIdx: number;
    slot: "a" | "b";
    memberIdx: number;
  } | null>(null);

  // NOTE — `pickem.saveMatches` has no client caller any more. The pairing is a
  // slice of the settings draft and commits through the page's one
  // `save_game_config`, so the immediate-write path this used is gone. The
  // procedure and `save_pickem_matches` are left in place: they carry 18 tests
  // and removing a server surface is its own decision, not a side effect of
  // moving a control.

  /** §4: the matches surface exists ONLY under individual matches. Team totals
   *  has no matches at all, so it is ABSENT rather than rendered empty. */
  /**
   * POINTS MODE (Phase 7) — the competition is an ordering of N teams.
   *
   * It comes from the COMPETITION, not from anything the runner picks on the
   * game. Standalone games have no competition and so no model, which falls
   * through to the match-play shape correctly: they have no teams either, so
   * nothing orders.
   */
  const pointsMode = q.data?.scoringModel === "points";

  /**
   * `roll_up` is INERT in a points cup, so this reads the model first.
   *
   * Everything gated on this is the MATCHES surface — the matches list and the
   * pairing grid — which is what it should have gated all along. Run (Phase 5)
   * and the board (Phase 6) both once lived inside this branch and both were
   * invisible because the surface fell through to something else; both were
   * hoisted above it with a comment, which is why adding a third condition here
   * cannot swallow a surface a third time.
   */
  /**
   * SERVER truth — what the game currently IS. Drives the game-page surfaces:
   * the matches list, the board's branch, the results gate. Those describe a
   * saved game, so a staged roll-up must not change them.
   */
  const individualMatches =
    !pointsMode && q.data?.settings.rollUp === "individual_matches";
  const pointsTotal =
    (q.data?.game as { points_total?: number | null } | undefined)?.points_total ?? null;
  const matchPairs = useMemo(
    () => (q.data?.matches ?? []).map((m) => ({ a: m.sideAId, b: m.sideBId })),
    [q.data?.matches]
  );
  /**
   * Names for the grid. `listMembers` already computes `displayName` with the
   * right priority — trip nickname → account name → email → short id — so this
   * reuses that rather than re-deriving a fourth version of "what do we call
   * this person".
   */
  const membersQ = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });
  const nameByUser = useMemo(() => {
    const rows = (membersQ.data ?? []) as { memberId?: string; displayName?: string }[];
    return new Map(rows.map((m) => [m.memberId ?? "", m.displayName ?? "Unknown"]));
  }, [membersQ.data]);
  const nameOf = useCallback(
    (userId: string) => nameByUser.get(userId) ?? "Unknown",
    [nameByUser]
  );

  /** The team's NAME, for a row a person reads — `teamOf` gives the id. */
  const teamNameOf = useCallback(
    (userId: string) =>
      (q.data?.teams ?? []).find((t) => t.memberIds.includes(userId))?.name ?? null,
    [q.data?.teams]
  );

  /**
   * Identity for the head-to-head header: the person's chosen icon, and the
   * colour of the team they are ON.
   *
   * Both come from sources already on the page — `tripMembers.list` for the
   * icon, the competition's teams for the colour — rather than a new query. The
   * colour is the PLAYER's roster team, never the side of the match they
   * occupy: a side is a slot, a team is a roster, and an unassigned player
   * correctly shows neutral.
   */
  const iconByUser = useMemo(() => {
    const rows = (membersQ.data ?? []) as {
      memberId?: string;
      user?: { avatar_icon?: string | null } | null;
    }[];
    return new Map(rows.map((m) => [m.memberId ?? "", m.user?.avatar_icon ?? null]));
  }, [membersQ.data]);

  const colorByTeam = useMemo(
    () =>
      new Map(
        ((q.data?.teams ?? []) as { id: string; color?: string | null }[]).map((t) => [
          t.id,
          t.color ?? null,
        ])
      ),
    [q.data?.teams]
  );

  /** Everyone the viewer may act for, EXCLUDING themselves — this panel is
   *  about other people, and their own sheet is the surface right below it. */
  const proxyTargets = useMemo<ProxyTarget[]>(() => {
    const rows = (membersQ.data ?? []) as {
      memberId?: string;
      displayName?: string;
      isGuest?: boolean;
    }[];
    const byId = new Map(rows.map((r) => [r.memberId ?? "", r]));
    return (sheetStatusQ.data ?? [])
      .filter((r) => r.userId !== me?.id)
      .map((r) => ({
        userId: r.userId,
        name: byId.get(r.userId)?.displayName ?? "Unknown",
        submitted: r.submitted,
        isGuest: byId.get(r.userId)?.isGuest ?? false,
        // The row's second line. Resolved here because the list takes people,
        // not rosters — and a name is what a reader recognises, not a team id.
        side: teamNameOf(r.userId),
      }));
  }, [sheetStatusQ.data, membersQ.data, me?.id, teamNameOf]);

  /** Resolved from the list each render rather than stored, so a name edit or a
   *  submitted-state change reaches the banner without a stale copy. */
  const proxyTarget = useMemo(
    () => proxyTargets.find((t) => t.userId === proxyFor) ?? null,
    [proxyTargets, proxyFor]
  );

  /**
   * Whose sheet the component is about. Never derived inside `PickemSheet` by
   * comparing ids: the caller knows, and a component that guesses its own
   * subject is one refactor away from guessing wrong.
   */
  const subject = useMemo<SheetSubject>(
    () =>
      proxyTarget
        ? {
            userId: proxyTarget.userId,
            name: proxyTarget.name,
            isSelf: false,
            isGuest: proxyTarget.isGuest,
          }
        : { userId: me?.id ?? "", name: "You", isSelf: true, isGuest: false },
    [proxyTarget, me?.id]
  );



  // NOT `router.back()`. A bare back is only the inverse of a PANEL open; on the
  // standalone route or a cold deep-link there is no entry to pop and it exits
  // the app (#808). `oneFinalizePath.test.ts` enumerates every game surface and
  // fails the build for exactly this — it caught this file.
  const exitToBoard = useExitToBoard(tripId, q.data?.game.competition_id as string | null);

  const slateDraft: SlateDraftGame[] = useMemo(
    () =>
      (q.data?.slate ?? []).map((g) => ({
        id: g.id,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        spread: g.spread,
        kickoff: g.kickoff,
        note: g.note,
        multiplier: g.multiplier,
      })),
    [q.data?.slate]
  );

  const serverConfigDraft = useMemo<PickemConfigDraft>(
    () =>
      configToPickemDraft(
        (q.data?.game ?? {}) as Parameters<typeof configToPickemDraft>[0],
        serverDelegates,
        {
          rollUp: q.data?.settings.rollUp ?? "team_totals",
          useConfidence: q.data?.settings.useConfidence ?? true,
        },
        // The pairings as stored, in the SAME row shape match play drafts —
        // one person a side, so `playersPerSide` is 1 and the golf scalars sit
        // at their neutral values.
        (q.data?.matches ?? []).map((m, i) => ({
          matchNumber: i + 1,
          playersPerSide: 1 as const,
          a: m.sideAId ? [m.sideAId] : [],
          b: m.sideBId ? [m.sideBId] : [],
          handicap: 0,
          pointValue: null,
        }))
      ),
    [q.data?.game, q.data?.settings, q.data?.matches, serverDelegates]
  );

  const anyTouched =
    nameDraft !== null ||
    rulesDraft !== null ||
    delegatesDraft !== null ||
    pointsTotalDraft !== undefined ||
    rollUpDraft !== undefined ||
    useConfidenceDraft !== undefined ||
    matchesDraft !== null;

  const configDraft = useMemo<PickemConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      rollUp: rollUpDraft !== undefined ? rollUpDraft : serverConfigDraft.rollUp,
      useConfidence:
        useConfidenceDraft !== undefined ? useConfidenceDraft : serverConfigDraft.useConfidence,
      matches: matchesDraft ?? serverConfigDraft.matches,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, delegatesDraft, pointsTotalDraft, rollUpDraft, useConfidenceDraft, matchesDraft]
  );

  /**
   * The lookups `MatchSetup` takes. Maps, because that is the shape match play
   * hands it — pick'em holds a `nameOf` function, so it is adapted here rather
   * than the shared component growing a second accessor style.
   */
  /**
   * Everyone who could appear in a SLOT — both rosters PLUS anyone already
   * paired.
   *
   * Roster-only was wrong and the grid said so: a person paired before being
   * dropped from their team is still in the pairing, and with no entry in this
   * map `MatchSetup` falls back to a generic "Player". That hides exactly the
   * state the runner needs to see — the mismatch note on the board names these
   * people, so the builder must not anonymise them.
   */
  const rosterIds = useMemo(() => {
    const ids = new Set((q.data?.teams ?? []).flatMap((t) => t.memberIds));
    for (const m of q.data?.matches ?? []) {
      if (m.sideAId) ids.add(m.sideAId);
      if (m.sideBId) ids.add(m.sideBId);
    }
    return [...ids];
  }, [q.data?.teams, q.data?.matches]);
  const nameMap = useMemo(
    () => new Map(rosterIds.map((id) => [id, nameOf(id)])),
    [rosterIds, nameOf]
  );
  const colorMap = useMemo(
    () => new Map(rosterIds.map((id, i) => [id, PLAYER_COLORS[i % PLAYER_COLORS.length]])),
    [rosterIds]
  );
  const avatarIconMap = useMemo(
    () => new Map(rosterIds.map((id) => [id, null as string | null])),
    [rosterIds]
  );
  /** A player's TEAM colour, from their roster assignment — team identity is the
   *  person, never the slot (the shared rule `teamColorOf` documents). */
  const teamColorOf = useCallback(
    (userId: string) => (q.data?.teams ?? []).find((t) => t.memberIds.includes(userId))?.color,
    [q.data?.teams]
  );
  /** Side A is the first team, side B the second — the binding that makes the
   *  selector's pool one roster per side, which is what stops a cross-team pair
   *  being built on the wrong side. Exactly match play's mapping. */
  const teamForSlot = useCallback(
    (slot: "a" | "b") => {
      const t = (q.data?.teams ?? [])[slot === "a" ? 0 : 1];
      return t ? { id: t.id, name: t.name, color: t.color } : undefined;
    },
    [q.data?.teams]
  );

  /**
   * DRAFT truth — what Save WILL make it. Drives the settings page only.
   *
   * The builder's gate read `individualMatches` (the server) while the roll-up
   * toggle beside it wrote the draft, so choosing "Individual matches" staged
   * the setting and the grid did not appear until you saved — the page offering
   * a choice and then not honouring it.
   *
   * That is #18's staged-state lie, the seventh in this project, and the rule it
   * produced names this exact trap: every server→draft repoint requires a sweep
   * of everything downstream of it. The roll-up was repointed in the toggle and
   * this reader was not swept.
   *
   * Two values on purpose, not one. A single "is it individual matches" would
   * have to be either the server's or the draft's, and the game page and the
   * settings page genuinely need different answers.
   */
  const individualMatchesStaged = !pointsMode && configDraft.rollUp === "individual_matches";

  /** The settings shape the scoring rows speak, read off the DRAFT — so the
   *  toggle reflects what will be saved, not what the server currently holds.
   *  Reading the server here while the toggle wrote the draft is the
   *  "staged-state lie" the match page produced six times over (#18). */
  const settingsDraft: PickemSettingsDraft = {
    rollUp: configDraft.rollUp,
    useConfidence: configDraft.useConfidence,
  };

  const draftBundle = useMemo(
    () => ({
      name: nameDraft,
      rules: rulesDraft,
      delegates: delegatesDraft,
      pointsTotal: pointsTotalDraft,
      rollUp: rollUpDraft,
      useConfidence: useConfidenceDraft,
    }),
    [nameDraft, rulesDraft, delegatesDraft, pointsTotalDraft, rollUpDraft, useConfidenceDraft]
  );
  function resetSlices() {
    setNameDraft(null);
    setRulesDraft(null);
    setDelegatesDraft(null);
    setPointsTotalDraft(undefined);
    setRollUpDraft(undefined);
    setUseConfidenceDraft(undefined);
  }
  const applyBundle = useCallback((b: typeof draftBundle) => {
    if (b.name !== null) setNameDraft(b.name);
    if (b.rules !== null) setRulesDraft(b.rules);
    if (b.delegates !== null) setDelegatesDraft(b.delegates);
    if (b.pointsTotal !== undefined) setPointsTotalDraft(b.pointsTotal);
    if (b.rollUp !== undefined) setRollUpDraft(b.rollUp);
    if (b.useConfidence !== undefined) setUseConfidenceDraft(b.useConfidence);
  }, []);

  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});

  // The DRAFT's name, not the server's: an edit in the panel retitles the app
  // bar immediately, and a Cancel puts it back. Reading the server here while
  // the field wrote the draft is how one game showed two names at once (#18).
  const gameName = q.data ? configDraft.name || "Pick'em" : "Pick'em";

  /**
   * §6.1 — the gate, said BEFORE the runner tries.
   *
   * The completeness state is knowable when Run renders, so a banner beats a
   * rejection. The RPC still refuses (and names the same person) — this is the
   * courteous half, not the enforcement.
   *
   * Only under `individual_matches`: team totals has no gate, because every
   * sheet sums into its side whatever the pairings look like — and neither does
   * a POINTS cup, which has no matches at all.
   *
   * Reads `individualMatches`, not `settings.rollUp`. That derived value already
   * carries the points override, and this was the fourth site to branch on the
   * raw column: it told a points-cup runner to "set the matches before entering
   * results" on a competition where the matches surface correctly does not
   * render, so the instruction named something they could not do. Migration 164
   * is the server half of the same mistake.
   */
  const runBlockedReason = useMemo(() => {
    if (!q.data) return null;
    if (!individualMatches) return null;
    const pairs: PickemPair[] = (q.data.matches ?? []).map((m) => ({
      a: m.sideAId ?? null,
      b: m.sideBId ?? null,
    }));
    if (matchesComplete(pairs)) return null;
    const stranded = pairs.find((p) => (p.a == null) !== (p.b == null));
    const who = stranded ? nameOf((stranded.a ?? stranded.b) as string) : null;
    return who
      ? `${who} has no opponent yet — every match needs both sides before a result can be split.`
      : "Set the matches before entering results — points are split across them.";
  }, [q.data, nameOf, individualMatches]);

  /** Which side a person plays for — the team-totals grouping. Derived from
   *  `teams[].memberIds`, which the payload already carries, rather than a
   *  second read of `team_assignments`. */
  const teamOf = useCallback(
    (userId: string) =>
      (q.data?.teams ?? []).find((t) => t.memberIds.includes(userId))?.id ?? null,
    [q.data?.teams]
  );

  const avatarFor = useCallback(
    (userId: string) => {
      const teamId = teamOf(userId);
      return {
        avatarIcon: iconByUser.get(userId) ?? null,
        teamColor: teamId ? (colorByTeam.get(teamId) ?? null) : null,
      };
    },
    [iconByUser, colorByTeam, teamOf]
  );

  const settings = useGameSettingsOverlay({
    canEdit,
    deepLink: settingsDeepLink,
    isDirty: () => dirtyRef.current,
    onDiscard: () => discardRef.current(),
  });

  const {
    dirty,
    saveError: configSaveError,
    saving: configSaving,
    handleSave: handleSaveConfig,
  } = useConfigDraft<PickemConfigDraft, typeof draftBundle>({
    tripId,
    gameId,
    view: "pickem",
    canEdit,
    showConfig: settings.open,
    dirtyRef,
    discardRef,
    // EVERY query feeding `serverConfigDraft`: the pick'em read (the game row
    // AND its settings) and the delegates list. A baseline frozen against a
    // half-loaded mirror would make Save diff against defaults the user never
    // saw.
    ready: !!q.data && !!orgQ.data,
    serverConfigDraft,
    configDraft,
    anyTouched,
    draftsEqual: pickemDraftsEqual,
    toPayload: pickemDraftToPayload,
    bundle: draftBundle,
    applyRecovered: applyBundle,
    reset: resetSlices,
    onSaved: async () => {
      await q.refetch();
      utils.games.listOrganizers.invalidate({ tripId: tripId!, gameId: gameId! });
      // The board reads name and points; #10 — the child alone is silently
      // undone by the face's re-seed.
      const competitionId = q.data?.game.competition_id as string | null;
      if (competitionId) {
        utils.competitions.leaderboard.invalidate({ tripId: tripId!, competitionId });
        utils.competitions.faceBootstrap.invalidate({ tripId: tripId! });
        utils.games.listByTrip.invalidate({ tripId: tripId! });
      }
    },
  });


  /**
   * The derived explanation, as the rules sheet's STARTER.
   *
   * Same text the settings page already seeds — one derivation, two places that
   * show it before a runner has written anything of their own. It follows the
   * settings, so confidence-off drops the ranking paragraphs and a points cup
   * drops head-to-head; the catalog blurb this overrides could do neither.
   */
  const rulesStarter = useMemo(
    () =>
      q.data
        ? explanationCopy(q.data.settings, q.data.slate, { pointsMode })
            .map((p) => p.text)
            .join(PARA_BREAK)
        : undefined,
    [q.data, pointsMode]
  );

  /**
   * Chrome. `rules` is what the other four formats have published all along —
   * it puts the rules button in the game action row and opens the shared
   * `GameRulesSheet`, reachable at every depth.
   *
   * Pick'em published only title + settings, so it grew its own "How this
   * works" collapsible on the sheet instead. That left TWO explanations of one
   * game — a hardcoded panel nobody could correct, and an editable field in
   * settings nobody could see — free to disagree the moment a runner wrote
   * their own. The panel is gone; this is the surface.
   */
  const standaloneHeader = useGameSurfaceChrome(
    q.data
      ? {
          title: gameName,
          onSettings: canEdit ? settings.openConfig : undefined,
          rules: tripId
            ? {
                tripId,
                gameId: gameId!,
                gameTypeId: (q.data.game as { game_type_id?: string | null })
                  .game_type_id ?? null,
                text: (q.data.game as { rules_for_today?: string | null })
                  .rules_for_today ?? null,
                starterText: rulesStarter,
                canEdit,
              }
            : undefined,
        }
      : null
  );


  if (!gameId) return null;
  if (q.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (!q.data) return null;

  /**
   * What the two-up row says. Derived here rather than inside the row, which
   * takes numbers and knows nothing about sheets — the persistence-agnostic
   * split every game component in this directory follows.
   *
   * Presence in `sheets` IS having picked: a sheet is written whole or not at
   * all (`_pickem_write_sheet` refuses an incomplete one), so there is no state
   * where a row exists and the person has not submitted.
   */
  /**
   * Does the runner's phase strip render? Read by the strip itself AND by the
   * closed banner, which stands in for it when it is absent.
   */
  const runnerStrip = canEdit;

  const { resolved: resolvedGames, total: totalGames } = resolvedCount(q.data.slate);

  /**
   * What hangs on each unmarked game. Derived here and handed down as numbers,
   * so the results screen stays free of matches, sheets and scoring — the
   * persistence-agnostic split every component in this directory follows.
   *
   * Empty on a team-totals game, which has no matches at all, and the line is
   * then absent rather than reading zero.
   */
  const riding = ridingOn(
    q.data.slate,
    q.data.matches,
    q.data.sheets,
    q.data.settings.useConfidence
  );
  const sheetTotals = Object.entries(q.data.sheets).map(([userId, picks]) => ({
    userId,
    total: sheetPoints(q.data!.slate, picks, q.data!.settings.useConfidence),
  }));
  const mySheet = me?.id ? (sheetTotals.find((s) => s.userId === me.id) ?? null) : null;
  /**
   * Competition ranking: everyone strictly above me, plus one. Ties SHARE a
   * place (two on 41 are both 2nd, and the next is 4th), which is the only
   * reading that does not have to pick a winner between two identical sheets.
   */
  const myRank = mySheet ? 1 + sheetTotals.filter((s) => s.total > mySheet.total).length : null;

  return (
    <div
      className="flex flex-col gap-3"
      style={{
        /**
         * Clear the bottom nav ourselves.
         *
         * The panel already sets this exact padding (CompetitionFace's
         * `navUnderPanel`) and it does not reach us. That padding shrinks the
         * panel's content box, which is what the golf formats' `absolute
         * inset-0` surfaces resolve against — so it works for them. In-flow
         * content OVERFLOWS that box instead, and a scroll container's end
         * padding is not re-applied after an overflowing descendant: the
         * scrollable region is the union of descendant border boxes, and it
         * stops at the last card.
         *
         * Measured rather than reasoned: at max scroll the last match card's
         * bottom sat at 843.9 in an 844px viewport, under a nav occupying the
         * last ~58px. With this padding it sits at 779.9.
         *
         * Pick'em is the first long in-flow game view, so it is the first to
         * meet it. The shell-level fix is #1131 — this goes at the source when
         * the stroke spine can be run against it.
         */
        paddingBottom: "calc(64px + env(safe-area-inset-bottom))",
      }}
    >
      {standaloneHeader && (
        <GameStandaloneHeader
          title="Pick'em"
          onBack={exitToBoard}
          chrome={standaloneHeader}
        />
      )}

      {/* The runner's control, above everything the participant sees. It does
          NOT replace the countdown below: the runner is a participant too —
          there is no separate runner's sheet — so "picks close in 4h 59m" is
          their picker copy and still has to be there.

          `runnerStrip` rather than `canEdit` inline, because the closed banner
          below reads the SAME fact from the other side — it renders only when
          this does not. Two conditions that must always disagree drift exactly
          like two that must always agree (#13), so there is one of them. */}
      {/* ...but not while the Sheets list is up. That is a SCREEN — its own
          back chevron, its own title — and the strip above it made two headers
          for one surface, the second of them about a different subject. Same
          shape as the STANDINGS-over-TEAM-TOTALS pair, which no test could see
          because both halves were correct. */}
      {runnerStrip && !sheetsOpen && (
        <PickemPhaseStrip
          // Migration 165 refuses unlock once anything is scored; this is why
          // the move is not offered. Same predicate the server uses, mirrored
          // in TypeScript the way `pickemLifecycle` mirrors the clock.
          hasResults={q.data.hasResults}
          phase={phase}
          // The SAME ticking clock every other derivation on this page reads,
          // so the strip's lead time and the countdown under it cannot drift.
          now={now}
          slateCount={q.data.slate.length}
          deadline={clock.picksDeadline ?? null}
          busy={setPhase.isPending || setDeadline.isPending}
          onOpenPicks={() => setPhase.mutate({ tripId: tripId!, gameId, action: "open" })}
          onLock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "lock" })}
          onUnlock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "unlock" })}
          onDeadlineChange={(deadline) => setDeadline.mutate({ tripId: tripId!, gameId, deadline })}
        />
      )}

      {phase === "locked" ? (
        /**
         * ── The locked page IS the matches ────────────────────────────────
         *
         * While picks are open the page is the sheet and nothing else: one job,
         * no navigation. At the lock the sheet stops being a task and becomes a
         * record, and the question changes to "how am I doing" — which the
         * matches answer. So the two things that WERE the page collapse into
         * the two-up row and the board takes their place.
         *
         * ONE arm for both roll-up shapes, which is the simplification this
         * composition buys. The board previously sat above the phase branch
         * precisely BECAUSE the branch swallowed it: a `team_totals` game took
         * the sheet arm and showed no board, and Run took the same fall. There
         * is no longer a shape-keyed branch here to fall through, so the board
         * can live where it is read.
         */
        <>
          {/* FIRST, because this is what a person lands in the instant their
              countdown reaches zero — and until it was hoisted out of the sheet
              that transition was silent.

              For a MEMBER only. The runner's strip two blocks up already says
              "Picks are locked · Every sheet is closed and revealed to the
              trip", so a runner was reading one fact twice within 100px — and
              the banner is the weaker of the two, since the strip also carries
              the way back. The sheet keeps `closedBannerHoisted` either way: it
              must not grow a third copy for the reader who loses this one. */}
          {!runnerStrip && <PickemClosedBanner closure={pickemClosure(clock, now)} />}

          <PickemTwoUp
            /* Null, not zero, for somebody with no sheet: "0 pts · 16 of 16"
               reads as a bad weekend rather than as an absence. */
            myPoints={mySheet?.total ?? null}
            myRank={myRank}
            sheetCount={sheetTotals.length}
            resolved={resolvedGames}
            total={totalGames}
            canEdit={canEdit}
            open={openPanel}
            onOpen={(p) => setOpenPanel((cur) => (cur === p ? null : p))}
          />

          {/* Their own sheet, read-only and one tap away. They spent time on it
              and should not have to hunt for what they submitted (§5). */}
          {openPanel === "picks" && (
            <PickemSheet
              gameId={gameId}
              slate={q.data.slate}
              settings={q.data.settings}
              picks={q.data.myPicks}
              subject={{ userId: me?.id ?? "", name: "You", isSelf: true, isGuest: false }}
              editable={false}
              saving={false}
              saveError={null}
              deadlineMs={null}
              closedBannerHoisted
              closure={pickemClosure(clock, now)}
              onSave={() => {}}
            />
          )}

          {/* Results are visible to everyone as they land — no embargo, since
              the whole point is watching it resolve (§7). `canEdit` decides
              whether the BUTTONS are there, not whether the outcomes are. */}
          {openPanel === "results" && (
            <PickemRunView
              slate={q.data.slate}
              canEdit={canEdit}
              busyId={busyResultId}
              blockedReason={runBlockedReason}
              ridingOn={riding.byGame}
              matchesPending={riding.matchesPending}
              onSetResult={(slateGameId, result) => {
                setBusyResultId(slateGameId);
                setResult.mutate({ tripId: tripId!, gameId, slateGameId, result });
              }}
            />
          )}

          {/* Never an empty grid: §12 forbids it, and a runner is under no
              pressure to pair before the deadline (§5), so "locked, unpaired"
              is a normal state that must read as waiting rather than broken. */}
          {individualMatches && matchPairs.length === 0 ? (
            <PickemNoMatches
              canEdit={canEdit}
              // The same opener the chrome gear uses, so the card cannot send a
              // runner somewhere the gear would not.
              onOpenSettings={settings.openConfig}
            />
          ) : (
            <PickemBoard
              slate={q.data.slate}
              sheets={q.data.sheets}
              matches={q.data.matches}
              rollUp={q.data.settings.rollUp}
              useConfidence={q.data.settings.useConfidence}
              meId={me?.id ?? null}
              nameOf={nameOf}
              teams={q.data.teams}
              teamOf={teamOf}
              avatarFor={avatarFor}
              pointsMode={pointsMode}
              /* The SHARED accessor, not a fourth hand-rolled
                 `isPlacement(d) ? d.values : []` — its own comment records that
                 three call sites had already written that line before it
                 existed. Falls back to the points total as a winner-takes-all
                 schedule, so a points game with no authored split still pays
                 rather than showing nothing. */
              distribution={effectiveDistribution(
                (q.data.game as { points_distribution?: PointsDistribution | null })
                  .points_distribution,
                pointsTotal
              )}
            />
          )}
        </>
      ) : phase === "building" ? (
        <PhaseBody
          slateCount={q.data.slate.length}
          canEdit={canEdit}
          onOpenSlate={() => setSlateOpen(true)}
          onOpenPicks={() =>
            setPhase.mutate({ tripId: tripId!, gameId, action: "open" })
          }
          opening={setPhase.isPending}
        />
      ) : sheetsOpen && !proxyTarget ? (
        /**
         * The list COVERS the page rather than sitting under the sheet. It is
         * one job — pick a person — and the sheet behind it is not that job.
         *
         * `targets` is exactly what `pickem_sheet_status` returned, minus the
         * viewer. Nothing filters it here and nothing may: the list IS the
         * permission, and a client-side role check would be a second copy of a
         * policy that already exists in one place.
         */
        <PickemSheetsList
          targets={proxyTargets}
          /* A LABEL, not a gate — it names the list and admits nobody. */
          runner={canEdit}
          scopeName={me?.id ? teamNameOf(me.id) : null}
          avatarFor={avatarFor}
          onBack={() => setSheetsOpen(false)}
          onPick={(t) => {
            setProxyFor(t.userId);
            setSheetsOpen(false);
            setSaveError(null);
          }}
        />
      ) : (
        <>
          {/* ONE component for both states. `editable` comes from the CLOCK —
              `picksOpen`, the same predicate `pickem_picks_write` calls — so the
              screen cannot offer an edit the policy will refuse, and cannot
              refuse one it would allow. The alternative (a separate read-only
              component) is how the two definitions of "picks open" get created,
              which is the risk this phase was flagged on. */}
          {/* PROXY ENTRY (migration 163).

              The banner is a BAND, not a subtitle, and it sits above a sheet
              that is POPULATED — proxy mode looks exactly like a filled-in
              sheet, because it is one. The copy underneath is swept of "your"
              in the same breath: a banner over second-person text is a mixed
              message, and mixed is how somebody edits what they think is their
              own sheet. That is the only way this feature goes badly. */}
          {/* The way in, above the sheet rather than below sixteen rows of the
              viewer's own picks. Gated on the server having given them somebody
              to act for — the row count, never a role. */}
          {!proxyTarget && picksOpen(clock, now) && (
            <PickemSheetsButton
              count={proxyTargets.length}
              waiting={proxyTargets.filter((t) => !t.submitted).length}
              onOpen={() => setSheetsOpen(true)}
            />
          )}
          {proxyTarget && (
            <PickemProxyBanner
              name={proxyTarget.name}
              isGuest={proxyTarget.isGuest}
              submitted={proxyTarget.submitted}
              onBack={() => setProxyFor(null)}
            />
          )}
          <PickemSheet
            /* Remounts when the subject changes. The sheet holds a draft keyed
               on a fingerprint of the server picks, and two people who have not
               submitted fingerprint IDENTICALLY — so without a key the draft
               would survive a subject switch and carry one person's picks into
               another's sheet. Same collision the outbox scope closes, one
               layer up; both have to hold. */
            key={subject.userId}
            gameId={gameId}
            slate={q.data.slate}
            settings={q.data.settings}
            picks={
              proxyTarget ? (q.data.sheets[proxyTarget.userId] ?? []) : q.data.myPicks
            }
            subject={subject}
            editable={picksOpen(clock, now)}
            saving={proxyTarget ? savePicksFor.isPending : savePicks.isPending}
            saveError={saveError}
            deadlineMs={msUntilDeadline(clock, now)}
            closure={pickemClosure(clock, now)}
            onSave={(picks) => {
              if (proxyTarget) {
                proxyTargetName.current = proxyTarget.name;
                savePicksFor.mutate({
                  tripId: tripId!,
                  gameId: gameId!,
                  targetUserId: proxyTarget.userId,
                  picks,
                });
              } else {
                savePicks.mutate({ tripId: tripId!, gameId, picks });
              }
            }}
          />

          {/* The builder used to sit HERE, on the game page, writing straight
              through on its own Save. It is in settings now (critique r1 §2):
              pairing is setup, not something you do while the game runs, and
              every other configuration lives there. What remains on this page
              is the post-lock matchups DISPLAY above — a different job. */}
        </>
      )}

      <PickemSlateModal
        open={slateOpen}
        onClose={() => setSlateOpen(false)}
        slate={slateDraft}
        editable={canEditSlate}
        saving={saveConfig.isPending}
        // Slate only. The scoring settings moved to the settings page and save
        // through the same RPC with the other half absent, which
        // `save_pickem_config` already supports.
        // Warn only if there is something to lose: rankings exist once picks
        // have been opened, and only when confidence is on.
        rankedSheetsExist={picksEverOpened(clock) && q.data.settings.useConfidence}
        onSave={(next) => saveConfig.mutate({ tripId: tripId!, gameId, slate: next.slate })}
      />

      {/* Confirm-on-leave — the standard on every settings surface.
          `useGameSettingsOverlay` was already wired here with `isDirty` and
          `onDiscard`, so the guard RAN and raised `confirmingClose` — but
          nothing rendered the prompt, so closing with unsaved changes just
          closed. The hook tracked the intent and no one drew it.
          Same shape as the four game-settings surfaces (`MatchGameView` is the
          reference): Save commits and then leaves, Keep editing cancels,
          Discard drops the draft. */}
      {settings.confirmingClose && (
        <DiscardChangesPrompt
          onDiscard={settings.confirmDiscard}
          onKeepEditing={settings.cancelClose}
          onSave={() => {
            settings.cancelClose();
            void handleSaveConfig().then((ok) => {
              if (ok) settings.leave();
            });
          }}
          saving={configSaving}
        />
      )}

      {settings.open && (
        <GameSettingsPage
          surface="pickem"
          onClose={settings.closeConfig}
          tripId={tripId!}
          competitionId={q.data.game.competition_id as string | null}
          game={q.data.game as never}
          canEdit={canEdit}
          canDelegate={canManageGame}
          canManageGame={canManageGame}
          nameValue={configDraft.name}
          onNameChange={setNameDraft}
          // WIRED (was `null` / a no-op). The picker is gated on
          // `canDelegate` above; this is the draft slice behind it, so a grant
          // rides the same atomic Save as everything else on the page.
          delegateValue={configDraft.delegates[0] ?? null}
          onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
          // Finding 4: the catalog description explains ranking unconditionally,
          // so with confidence OFF the rules starter described a game nobody was
          // playing. `explanationCopy` is the same derived source the sheet
          // itself reads, so the two cannot disagree about what the rules are.
          rulesStarterText={explanationCopy(q.data.settings, q.data.slate, { pointsMode })
            .map((para) => para.text)
            .join(PARA_BREAK)}
          rulesValue={configDraft.rulesForToday ?? ""}
          onRulesChange={setRulesDraft}
          // The page-level draft Phase 2 did not have. Name, rules,
          // delegates, the points total and the two scoring settings all commit
          // through ONE `games.saveConfig` here — nothing on this page
          // self-persists any more.
          saveBar={
            <SettingsSaveBar
              dirty={dirty}
              saving={configSaving}
              error={configSaveError}
              onSave={handleSaveConfig}
              onDiscard={settings.confirmDiscard}
              onLeave={settings.leave}
            />
          }
          // NOT RENDERED for pick'em — `FORMAT_SURFACE.pickem.gameState` is false,
          // because pick'em's go-live is `picks_opened_at`, not `scoring_enabled`
          // (migration 146; 135's CHECK refuses the state picks-open occupies).
          // The values below are the inert shape the prop type still requires.
          //
          // The first attempt passed `ready: false` with an explanatory
          // `blockedReason`, on the theory that a blocked control is honest. It
          // is not: the panel's own line read "Not live — scoring disabled" on a
          // game whose picks WERE open, with the explanation underneath where the
          // eye lands second. Caught by looking at the rendered page, which is
          // the entire argument for the Cadence rule.
          management={{
            scoringEnabled: false,
            ready: false,
            onEnable: () => {},
            onDisable: () => {},
            pending: false,
            staged: false,
          }}
          onDeleted={exitToBoard}
          onScoresReset={() => utils.pickem.get.invalidate({ tripId: tripId!, gameId })}
          settingsRows={
            <SlateSettingsRows
              slateCount={q.data.slate.length}
              useConfidence={q.data.settings.useConfidence}
              canEdit={canEdit}
              scoringRows={
                <PickemScoringRows
                  settings={settingsDraft}
                  editable={canEdit && scoringSettingsEditable(q.data.hasResults)}
                  frozenReason={canEdit ? scoringFrozenReason(q.data.hasResults) : null}
                  // Absent in a POINTS cup for the same reason it is absent
                  // standalone: the setting means nothing there. Offering an
                  // inert control is the state Phase 7 rejected a third roll_up
                  // CHECK value for — it reads as configured and is not.
                  showRollUp={q.data.game.competition_id != null && !pointsMode}
                  pointsTotal={configDraft.pointsTotal}
                  // Points share the ONE freeze point now (migration 157): the
                  // first result, not the slate's lock. 152's carve-out existed
                  // because the two used to disagree.
                  canEditPoints={canEdit && scoringSettingsEditable(q.data.hasResults)}
                  matches={q.data.matches}
                  onPointsChange={setPointsTotalDraft}
                  onChange={(next) => {
                    setRollUpDraft(next.rollUp);
                    setUseConfidenceDraft(next.useConfidence);
                  }}
                />
              }
              matchesRow={
                individualMatchesStaged && q.data.teams.length >= 2 ? (
                  <PickemMatchBuilder
                    draft={configDraft.matches}
                    setDraft={(fn) =>
                      setMatchesDraft((prev) => fn(prev ?? serverConfigDraft.matches))
                    }
                    teams={q.data.teams}
                    nameMap={nameMap}
                    colorMap={colorMap}
                    avatarIconMap={avatarIconMap}
                    teamColorOf={teamColorOf}
                    teamForSlot={teamForSlot}
                    canEdit={canEdit}
                    pointsTotal={configDraft.pointsTotal}
                    selector={selector}
                    setSelector={setSelector}
                  />
                ) : null
              }
              // Opens the slate ON TOP of settings rather than closing settings
              // first. Closing first looked tidier and was broken: on the
              // `?settings=1` DEEP-LINK path the overlay's open-ness is derived
              // from the URL, so `closeConfig` navigates — and the navigation
              // discarded the `setSlateOpen(true)` that had just run. Settings
              // closed, the slate never appeared, and nothing errored.
              // (Related to the known deep-link gap in `useGameSettingsOverlay`:
              // the gear path and the deep-link path do not close the same way.)
              //
              // The Sheet it opens now portals to body (#1091) — rendered inline
              // it was capped inside the game panel's `z-30` stacking context and
              // opened UNDERNEATH this very overlay, which is what made "The
              // slate" look like a dead button.
              onOpenSlate={() => setSlateOpen(true)}
            />
          }
          onChanged={() => utils.pickem.get.invalidate({ tripId: tripId!, gameId })}
        />
      )}
    </div>
  );
}

/**
 * The `building` state, and only that one — the other two are the sheet itself
 * (Phase 3), which is why this no longer takes a `phase`.
 *
 * Still branches on the CLOCK and never on the viewer: a member and the runner
 * read the same words here, because spec §3.1's first fairness rule is that
 * "nothing added yet" and "a finished slate, unpublished" must be
 * indistinguishable from outside.
 */
export function PhaseBody({
  slateCount,
  canEdit,
  onOpenSlate,
  onOpenPicks,
  opening,
}: {
  slateCount: number;
  canEdit: boolean;
  onOpenSlate: () => void;
  onOpenPicks: () => void;
  opening: boolean;
}) {
  return (
    <Empty
      icon="◷"
      heading="Picks open soon"
      body="The slate is still being put together. You'll get a countdown to the deadline once picks are open."
    >
        {/* The runner's controls sit UNDER the same words a member reads, rather
            than replacing them — so what he sees is what they see, plus a door.

            THE PRIMARY ACTION FOLLOWS THE STATE, and getting that backwards is
            what made this screen look like it had no way forward. With no slate
            there is one job: build it. With a slate, the job is to OPEN PICKS —
            that is the transition sixteen people are waiting on, and editing the
            slate again is the lesser action.

            It was the other way round: "Edit the slate · N games" took the
            filled primary and "Open picks" was bare accent text under it, at
            12px with no background, border or padding. It read as a caption, and
            was reported as the switch not existing. It existed and had been
            styled as a label. */}
        {canEdit && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {slateCount === 0 ? (
              <Primary onClick={onOpenSlate}>Build the slate</Primary>
            ) : (
              <>
                <Primary onClick={onOpenPicks} disabled={opening} testId="pickem-open-picks">
                  {opening ? "Opening…" : `Open picks · ${slateCount} games`}
                </Primary>
                {/* Says what the button DOES before it is pressed. Opening picks
                    is reversible (Reopen the slate), but it is the moment the
                    game becomes visible to everyone, so it should not be a
                    surprise. */}
                <p
                  style={{
                    fontSize: TYPE_SCALE.caption,
                    color: "var(--color-bt-text-dim)",
                    maxWidth: 260,
                    lineHeight: 1.5,
                  }}
                >
                  Everyone can start filling in their sheet. The slate freezes —
                  you can still reopen it from settings.
                </p>
                <Secondary onClick={onOpenSlate} testId="pickem-edit-slate">
                  Edit the slate
                </Secondary>
              </>
            )}
          </div>
        )}
      </Empty>
  );
}

/**
 * Settings-zone rows: the door to the slate, and the two scoring settings.
 *
 * ── It holds NO commands any more ──────────────────────────────────────────
 *
 * Open / Lock / Unlock and the deadline moved to `PickemPhaseStrip` on the game
 * page. Not for tidiness: once this page grew a Cancel/Save footer, a command
 * inside that frame made the screen promise two contradictory things. The
 * footer says nothing here is committed; the button had already committed.
 * Press "Open picks", then Cancel, and a reasonable person expects the open to
 * be undone.
 *
 * A setting drafts. A command executes. Everything left in here drafts, which
 * is what makes the footer's promise true.
 */
export function SlateSettingsRows({
  slateCount,
  useConfidence,
  canEdit,
  scoringRows,
  matchesRow,
  onOpenSlate,
}: {
  slateCount: number;
  /** Drives the COPY, not just the sheet. A confidence-off game has no ranking,
   *  so "confidence 1–N" is a falsehood on it. */
  useConfidence: boolean;
  canEdit: boolean;
  /** The two scoring settings, rendered by `PickemScoringRows`. Passed in
   *  rather than built here so this component stays free of tRPC. */
  scoringRows: React.ReactNode;
  /** The pairing grid, under the roll-up that turns it on. Null unless the game
   *  actually pairs — a settings page does not carry a section for something
   *  the current configuration has no use for. */
  matchesRow?: React.ReactNode;
  onOpenSlate: () => void;
}) {
  if (!canEdit) return null;

  /** The transitions available RIGHT NOW. One row of buttons, not three stacked
   *  cards — they are alternatives on one axis, and stacking them made the
   *  settings page read as a list of unrelated features. */

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenSlate}
          data-testid="pickem-open-slate"
          className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <span>
            <span style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>The slate</span>
            <span
              className="block"
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 2 }}
            >
              {slateCount === 0
                ? "No games yet — this is what people pick from"
                : useConfidence
                  ? `${slateCount} games · confidence 1–${slateCount}`
                  : `${slateCount} games`}
            </span>
          </span>
          <span style={{ color: "var(--color-bt-text-dim)" }}>›</span>
        </button>
      </div>

      {/* ── Scoring, one level up ─────────────────────────────────────────
          These were buried inside the slate modal behind sixteen rows of games
          and that modal's Save. They are settings; they live with settings. */}
      <div className="flex flex-col gap-2">
        <ZoneHeader>How scoring works</ZoneHeader>
        {scoringRows}
      {matchesRow}
      </div>

    </div>
  );
}



function Empty({
  icon,
  heading,
  body,
  children,
}: {
  icon: string;
  heading: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 700, marginBottom: 5 }}>{heading}</div>
      <p
        className="mx-auto"
        style={{
          fontSize: TYPE_SCALE.body,
          color: "var(--color-bt-text-dim)",
          lineHeight: 1.55,
          maxWidth: 290,
        }}
      >
        {body}
      </p>
      {children}
    </div>
  );
}

/** Names an unbuilt phase rather than leaving blank space — an empty area reads
 *  as broken, and a person looking at this early needs to know which. */

function Primary({
  onClick,
  children,
  disabled = false,
  testId = "pickem-build-slate",
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** The primary slot changes job with the state (build → open), so the id
   *  travels with the ACTION rather than being fixed to the slot. */
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="rounded-xl px-4 py-2.5 disabled:opacity-40"
      style={{
        background: "var(--color-bt-accent)",
        color: "var(--color-bt-base)",
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: 700,
        minHeight: 44,
      }}
    >
      {children}
    </button>
  );
}

/** The lesser action beside a Primary — outlined, never a bare text link. A
 *  bordered control reads as a control at a glance; that distinction is the
 *  whole reason this pair exists. */
function Secondary({
  onClick,
  children,
  testId,
}: {
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="rounded-xl px-4 py-2"
      style={{
        background: "transparent",
        color: "var(--color-bt-text-dim)",
        border: "1px solid var(--color-bt-border)",
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: 600,
        minHeight: 40,
      }}
    >
      {children}
    </button>
  );
}
