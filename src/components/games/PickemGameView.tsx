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
import { PickemMatchesPanel } from "@/components/games/pickem/PickemMatchesPanel";
import {
  PickemProxyPanel,
  PickemProxyBanner,
  type ProxyTarget,
} from "@/components/games/pickem/PickemProxyPanel";
import type { SheetSubject } from "@/components/games/pickem/PickemSheet";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import {
  msUntilDeadline,
  picksEverOpened,
  picksOpen,
  picksRevealed,
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
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const saveMatches = trpc.pickem.saveMatches.useMutation({
    onSuccess: async () => {
      showToast("Matches saved", "info");
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  /** §4: the matches surface exists ONLY under individual matches. Team totals
   *  has no matches at all, so it is ABSENT rather than rendered empty. */
  const individualMatches = q.data?.settings.rollUp === "individual_matches";
  const revealed = picksRevealed(clock, now);
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
      }));
  }, [sheetStatusQ.data, membersQ.data, me?.id]);

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
        }
      ),
    [q.data?.game, q.data?.settings, serverDelegates]
  );

  const anyTouched =
    nameDraft !== null ||
    rulesDraft !== null ||
    delegatesDraft !== null ||
    pointsTotalDraft !== undefined ||
    rollUpDraft !== undefined ||
    useConfidenceDraft !== undefined;

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
    }),
    [serverConfigDraft, nameDraft, rulesDraft, delegatesDraft, pointsTotalDraft, rollUpDraft, useConfidenceDraft]
  );

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
   * sheet sums into its side whatever the pairings look like.
   */
  const runBlockedReason = useMemo(() => {
    if (!q.data) return null;
    if (q.data.settings.rollUp !== "individual_matches") return null;
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
  }, [q.data, nameOf]);

  /** Which side a person plays for — the team-totals grouping. Derived from
   *  `teams[].memberIds`, which the payload already carries, rather than a
   *  second read of `team_assignments`. */
  const teamOf = useCallback(
    (userId: string) =>
      (q.data?.teams ?? []).find((t) => t.memberIds.includes(userId))?.id ?? null,
    [q.data?.teams]
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


  const standaloneHeader = useGameSurfaceChrome(
    q.data
      ? {
          title: gameName,
          onSettings: canEdit ? settings.openConfig : undefined,
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

  return (
    <div className="flex flex-col gap-3">
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
          their picker copy and still has to be there. */}
      {canEdit && (
        <PickemPhaseStrip
          phase={phase}
          slateCount={q.data.slate.length}
          deadline={clock.picksDeadline ?? null}
          busy={setPhase.isPending || setDeadline.isPending}
          onOpenPicks={() => setPhase.mutate({ tripId: tripId!, gameId, action: "open" })}
          onLock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "lock" })}
          onUnlock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "unlock" })}
          onDeadlineChange={(deadline) => setDeadline.mutate({ tripId: tripId!, gameId, deadline })}
        />
      )}

      {/* THE BOARD (Phase 6) — "am I winning, and is it still live."
          Everything on it derives from the sheets and the results; nothing is
          stored, so a result landing anywhere recomputes every total, margin
          and clinch on the next render.

          ABOVE the phase branch, for the same reason Run is: it first went
          inside the sheet branch, so a game on INDIVIDUAL MATCHES — which takes
          the other branch once revealed — showed no board at all. The branch
          exists to swap the sheet for the pairing grid; what the board reads is
          the same either way, and it renders its own two shapes off `rollUp`.
          Second time that branch has swallowed a surface, which is why the
          board is out here rather than duplicated into both arms.

          Rendered for everyone: the reveal happened at the lock, and what a
          member may SEE is decided by RLS on `pickem_picks` rather than by a
          condition here. */}
      {phase === "locked" && (
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
        />
      )}

      {/* RUN — every revealed game, BOTH roll-ups.
          It first went inside the `revealed && individualMatches` branch,
          which meant a TEAM TOTALS game showed no Run surface at all: that
          branch exists to swap the sheet for the pairing grid, and team totals
          has no grid, so it correctly falls through to the sheet — taking Run
          with it. Caught by looking at a team-totals game, which is exactly the
          kind of thing only a render shows.
          Results have no roll-up of their own: a slate game finished or it did
          not, and how the points are then shared out is a different question.

          Rendered for everyone, not only the runner: results are visible as
          they land — no embargo, since the whole point is watching it resolve
          (§7). `canEdit` decides whether the BUTTONS are there, not whether
          the outcomes are. */}
      {revealed && (
        <PickemRunView
          slate={q.data.slate}
          canEdit={canEdit}
          busyId={busyResultId}
          blockedReason={runBlockedReason}
          onSetResult={(slateGameId, result) => {
            setBusyResultId(slateGameId);
            setResult.mutate({ tripId: tripId!, gameId, slateGameId, result });
          }}
        />
      )}

      {phase === "building" ? (
        <PhaseBody
          slateCount={q.data.slate.length}
          canEdit={canEdit}
          onOpenSlate={() => setSlateOpen(true)}
          onOpenPicks={() =>
            setPhase.mutate({ tripId: tripId!, gameId, action: "open" })
          }
          opening={setPhase.isPending}
        />
      ) : revealed && individualMatches ? (
        /**
         * §5/§6 — ONE PAGE, TWO STATES. Not a restructure: the sheet does not
         * become a sub-view, the PAGE changes what it renders at the lock,
         * keyed on `picksRevealed` — the same predicate the policy uses, so the
         * screen cannot reveal something the API would refuse.
         *
         * Matches when set; the coming-soon note when not. Never an empty grid:
         * §12 forbids it, and a runner is under no pressure to pair before the
         * deadline (§5), so "locked, unpaired" is a normal state that must read
         * as waiting rather than broken.
         */
        <>
          {/* FIRST on the page, because this branch is what a person lands in
              the instant their countdown reaches zero — and until this was
              hoisted out of the sheet, that transition was silent. The sheet
              collapses behind a button here, so a banner inside it explains the
              change only to someone who already went looking for it. */}
          <PickemClosedBanner closure={pickemClosure(clock, now)} />

          {matchPairs.length > 0 ? (
            <PickemMatchesPanel
              teams={q.data.teams}
              nameOf={nameOf}
              pairs={matchPairs}
              pointsTotal={pointsTotal}
              canEdit={canEdit}
              saving={saveMatches.isPending}
              onSave={(pairs) => saveMatches.mutate({ tripId: tripId!, gameId, pairs })}
            />
          ) : (
            <Empty
              icon="◷"
              heading="Matches coming soon"
              body="Picks are locked. Whoever's running it hasn't set the matchups yet — they'll appear here."
            />
          )}
          {/* Their own sheet, read-only and one tap away. They spent time on it
              and should not have to hunt for what they submitted (§5). */}
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            data-testid="pickem-view-my-sheet"
            className="mx-1 rounded-xl px-3 py-2.5 text-left"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
              fontSize: TYPE_SCALE.body,
              fontWeight: 600,
            }}
          >
            {sheetOpen ? "Hide my picks" : "See my picks"}
          </button>
          {sheetOpen && (
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
        </>
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
                  gameId,
                  targetUserId: proxyTarget.userId,
                  picks,
                });
              } else {
                savePicks.mutate({ tripId: tripId!, gameId, picks });
              }
            }}
          />
          {/* Under the sheet, where a captain already is ten minutes before the
              deadline. NOT the phase strip — that carries commands, and this is
              not one. Renders only when the server says there is somebody to
              act for, so a plain participant never sees it. */}
          {!proxyTarget && picksOpen(clock, now) && (
            <div className="mt-3">
              <PickemProxyPanel
                targets={proxyTargets}
                onPick={(t) => {
                  setProxyFor(t.userId);
                  setSaveError(null);
                }}
              />
            </div>
          )}
          {/* The runner pairs whenever they like — §1 deletes the
              pairing-after-lock rule. Participants still see nothing until the
              lock; that is the reveal above, not a gate on this. */}
          {canEdit && individualMatches && (
            <div className="mt-2">
              <PickemMatchesPanel
                teams={q.data.teams}
                nameOf={nameOf}
                pairs={matchPairs}
                pointsTotal={pointsTotal}
                canEdit={canEdit}
                saving={saveMatches.isPending}
                onSave={(pairs) => saveMatches.mutate({ tripId: tripId!, gameId, pairs })}
              />
            </div>
          )}
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
          rulesStarterText={explanationCopy(q.data.settings, q.data.slate)
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
                  showRollUp={q.data.game.competition_id != null}
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
