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
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { useOpenCorrection } from "@/hooks/useGameCorrection";
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
  PickemTotalPointsRow,
  type PickemSettingsDraft,
} from "@/components/games/pickem/PickemScoringRows";
import { PickemSheet, PickemClosedBanner } from "@/components/games/pickem/PickemSheet";
import { explanationCopy, PARA_BREAK } from "@/lib/pickemSheet";
import { PickemPhaseStrip } from "@/components/games/pickem/PickemPhaseStrip";
import { PickemRunView } from "@/components/games/pickem/PickemRunView";
import { gameLockState } from "@/lib/gameLifecycle";
import { PickemBoard } from "@/components/games/pickem/PickemBoard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { effectiveDistribution, type PointsDistribution } from "@/lib/pointsDistribution";
import { resolvedCount, sheetPoints } from "@/lib/pickemScoring";
import { ridingOn } from "@/lib/pickemBoard";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { PickemMatchBuilder } from "@/components/games/pickem/PickemMatchBuilder";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { PickemTwoUp } from "@/components/games/pickem/PickemTwoUp";
import { pickemSurface, type PickemPanel, type PicksSub } from "@/lib/pickemSurface";
import {
  PickemOtherPicks,
  PickemPicksSubTabs,
  PickemReadingHeader,
  type OtherPicksColumn,
} from "@/components/games/pickem/PickemOtherPicks";
import { PickemNoMatches } from "@/components/games/pickem/PickemNoMatches";
import {
  PickemMatchesRequired,
  noMatchesDrawn as noMatchesDrawnFor,
} from "@/components/games/pickem/PickemMatchesRequired";
import {
  PickemProxyBanner,
  sheetAuthor,
  type ProxyTarget,
} from "@/components/games/pickem/PickemProxyPanel";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import type { SheetSubject } from "@/components/games/pickem/PickemSheet";
import type { SubmittedPick } from "@/lib/pickemSheet";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { ListChecks, Swords } from "lucide-react";
import {
  deadlineBlocksReopen,
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
    {
      enabled: !!tripId && !!gameId,
      refetchInterval: 60_000,
      // PAUSED while the tab is backgrounded — which all four other game
      // views already do, and the fifth format did not.
      //
      // It matters more than a saved request. A backgrounded tab is exactly
      // where an access token expires, and an expired token is what routes
      // `createTRPCContext` into the NETWORK `getUser()` — the call that
      // stalled in production on 2026-08-27 and again on 2026-08-29. So the
      // one view that kept polling in the background was also the one
      // generating token-refresh attempts from every sleeping device.
      //
      // Not claimed as the trigger; neither incident has one. It is a real
      // difference in call volume that this format alone introduced, which
      // is what made it worth checking rather than reasoning about.
      refetchIntervalInBackground: false,
    }
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

  /**
   * ── A SUCCESSFUL SLATE WRITE DISMISSES NOTHING ────────────────────────────
   *
   * This handler used to `setSlateOpen(false)` and toast "Slate saved", and both
   * were right when it was written (#1080): a Save button was the only caller,
   * so one tap meant one write and save-and-close was the whole interaction.
   *
   * #1184 changed who calls it, not what it does. `PickemSlateModal.mutate` now
   * writes on EVERY change — add, edit, delete, drag-reorder — so the dismissal
   * fired on each one and the runner was ejected mid-slate on every single add.
   * Reported as "it looks like it gets added but then closes the picks modal
   * immediately", and, from the same cause counted a different way, as a cap at
   * five games: there is no cap (the RPC takes 200), only a modal that had to be
   * reopened between additions.
   *
   * Neither half was wrong alone, which is why every per-component test passed.
   * The pair was.
   *
   * So: dismissal belongs to the person, not to the write. `Done` (and the
   * scrim, the cross, and back) call `onClose`; nothing else closes this sheet.
   *
   * The toast goes for the same reason rather than as a separate opinion — it
   * was the only feedback left once the sheet had vanished, and the sheet no
   * longer vanishes. Its footer says "Saving… / Changes saved / Changes save as
   * you make them" the whole time (#1201), so a toast per add is sixteen toasts
   * restating a line already on screen. `onError` keeps its toast: a failed
   * write must stay loud, and it is now the ONLY thing that can make an add
   * behave differently from any other.
   */
  const saveConfig = trpc.pickem.saveConfig.useMutation({
    onSuccess: async () => {
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
   * Which TAB is showing on a locked page. Never null — one is always selected,
   * and Matches is the default because it is what most people opened the game
   * to see.
   *
   * ONE value rather than a boolean each: they are alternatives, and two
   * booleans that must never both be true is how a screen ends up showing two
   * things stacked that were each designed to be the only one.
   */
  const [openPanel, setOpenPanel] = useState<PickemPanel>("matches");
  /**
   * Which half of the PICKS tab is showing, and whose sheet is open under it.
   *
   * Two pieces of state rather than one three-valued one, because they answer
   * different questions and only one of them survives a tab change: leaving
   * Picks and coming back should land where you were, but not still inside
   * somebody else's sheet.
   */
  const [picksSub, setPicksSub] = useState<PicksSub>("your");

  /**
   * ── LEAVING THE SHEET WITH UNSAVED PICKS ─────────────────────────────────
   *
   * The draft survives a reload through the outbox, but it does not survive
   * being navigated away from and coming back to a different subject — and
   * more to the point, a person who taps another tab mid-sheet has no reason
   * to think their picks are safe. So the move is intercepted and offered
   * back: Save, keep editing, or discard.
   *
   * IT MUST NOT FIRE ON AN UNTOUCHED SHEET. `dirty` inside `PickemSheet` is
   * already the honest predicate — false until the working sheet actually
   * differs from the server's — so simply opening the tab and leaving raises
   * nothing. A prompt that fires on a sheet nobody edited is one people learn
   * to dismiss without reading, which costs more than the guard is worth.
   *
   * Held in a REF rather than state: it is read inside handlers and never
   * rendered, so a re-render on every keystroke-equivalent would be churn for
   * nothing. `pendingLeave` is the state, because the prompt is what renders.
   *
   * `leaveSheet` is a PLAIN function, not a `useCallback`. Wrapping it tripped
   * the React Compiler ("existing memoization could not be preserved") because
   * it closes over a ref and stores a function in state, and nothing needs its
   * identity to be stable — it is called from JSX handlers and appears in no
   * dependency array. The compiler memoizes better than the hand-written hook
   * would have.
   */
  const sheetDirty = useRef(false);
  /** The draft as a payload, reported with the dirty flag so the leave prompt
   *  can actually save it rather than only offering to. */
  const sheetDraft = useRef<SubmittedPick[]>([]);
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null);

  /**
   * Run `go` now, or hold it behind the prompt if the sheet has unsaved work.
   *
   * One function for every leave, so a new exit cannot forget the guard by
   * being written somewhere the author did not think of it. Stored as a thunk
   * inside a thunk — `setPendingLeave(() => go)` would CALL `go`, since React
   * treats a function argument as an updater.
   */
  /**
   * ── AND ONLY WHILE THE DRAFT CAN STILL BE COMMITTED ──────────────────────
   *
   * The dirty flag outlived the ability to save, and that made a trap with one
   * exit that destroyed the work:
   *
   *   1. a sheet is open with unsaved picks
   *   2. the runner closes picking
   *   3. every tab is guarded, including the tab the sheet is ON, so tapping
   *      Picks raises the prompt instead of opening it
   *   4. Save is refused by the server — picks are closed, and will stay closed
   *   5. Keep editing dismisses the prompt and leaves you where you were, which
   *      is not the sheet, so it reads as a button that does nothing
   *   6. Discard is the only door, and it is the one that throws the work away
   *
   * The guard's premise is "you can still save this if you want to". Once picks
   * close that premise is false, so the guard has nothing to offer and asking
   * the question is worse than not asking it: two of its three answers are
   * walls.
   *
   * So it asks whether the draft is SAVEABLE, not merely whether it differs.
   * `picksOpen` is the same predicate the sheet's own `editable` uses and the
   * same one the server gates the write on, so the prompt cannot offer a save
   * the RPC then refuses.
   *
   * ── What is still lost, stated plainly ───────────────────────────────────
   *
   * Leaving now drops the draft, because the sheet unmounts with the tab. That
   * is not a regression — Discard did exactly this, and the picks were already
   * unsaveable by the time anyone could choose. What the reader gets instead of
   * a dialog is the closed banner on the sheet, and, if they tried to save, the
   * error below it. A one-time "your unsaved picks did not make it" notice
   * would be better still and is NOT built here; see the PR.
   */
  const leaveSheet = (go: () => void) => {
    if (sheetDirty.current && picksOpen(clock, now)) {
      setPendingLeave(() => go);
      return;
    }
    go();
  };
  const [readingSheetOf, setReadingSheetOf] = useState<string | null>(null);
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
  /** Is the Matches accordion open on the settings page. */
  const [matchesOpen, setMatchesOpen] = useState(false);
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
   * Individual matches, and nobody drawn yet — read by the Matches tab's
   * waiting panel AND the results scrim (r7 §11). The predicate lives with the
   * scrim; see its note for why the roll-up is part of the question.
   */
  const noMatchesDrawn = noMatchesDrawnFor({
    /* The RESOLVED flag. `individualMatches` above is where the points-mode
       override is applied, and this file is on `pickemRollUpOverride`'s
       allowlist for exactly that — so the answer travels rather than the
       column. */
    individualMatches,
    matchCount: matchPairs.length,
  });
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
        // The COUNT (migration 167). Before it, the pre-lock list could not tell
        // a half-finished sheet from a finished one and said nothing for both.
        picked: r.picked,
        total: r.total,
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
   * ── BACK UNWINDS THE IN-PAGE SCREENS ──────────────────────────────────────
   *
   * Opening somebody's sheet is a NAVIGATION — the page swaps its whole body
   * for a different subject with its own back control — but it was pure React
   * state, so it pushed nothing onto history. Back therefore found the next
   * entry down, which is the game panel's own `?game=`, and closed the game.
   * Re-opening mounts fresh, so the reader landed on Matches: not a tab reset,
   * a panel teardown that looked like one.
   *
   * `useModalBackButton` is the app's existing answer — a phantom entry per
   * layer, a shared stack so only the topmost reacts, and depth-tagged
   * ownership so a foreign pop passes through rather than being eaten. Reused
   * rather than re-derived: the ownership rules are exactly where a second
   * implementation would go wrong, and this hook has already paid for them
   * twice (the spurious-popstate window, the programmatic-pop marker).
   *
   * ABOVE the `!q.data` early return, with the rest of the hooks. Placed by
   * the state they read, they sat below it and fired the rules-of-hooks lint
   * immediately — which is the guard working: a loading render would have
   * called two fewer hooks than a loaded one.
   *
   * The two are exclusive by phase — a proxy sheet needs picks open, a
   * read-only one needs them closed — so they can never stack. Registered
   * separately anyway, because "they cannot both be open" is a fact about
   * today's conditions and not about this hook.
   */
  useModalBackButton(() => setReadingSheetOf(null), readingSheetOf != null);
  useModalBackButton(() => setProxyFor(null), proxyFor != null);

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

  /**
   * ── THE RESULTS AXIS, adopted wholesale rather than a column at a time ─────
   *
   * Pick'em had none of this: no `gameLockState`, no finalize, no way back from
   * one. `set_pickem_result` was the only thing that knew a game could be
   * closed, and it knew it on the wrong axis until migration 167.
   *
   * The shared pieces are taken as a set — the predicate, the CTAs, the
   * correction entry, the exit — because CLAUDE.md #24's eight incidents are all
   * a format that took some of them. `useGameFinalize` is not optional either:
   * `oneFinalizePath` fails the build if `games.finish` is called anywhere else,
   * which is what stops the aftermath (the optimistic lock, the three board
   * invalidations, `faceBootstrap` included) being rewritten here.
   *
   * PICKS are a SEPARATE axis and stay separate — see `pickemPhase`. The only
   * crossing is `allComplete` below.
   */
  // Read ONCE, raw. `gameLifecycle` and `gameLockState` both take the COLUMN and
  // derive from it; handing either a value already derived from the other is how
  // two readings of one row start disagreeing.
  const correctionsOpen =
    ((q.data?.game as { corrections_open?: boolean | null } | undefined)?.corrections_open) ??
    false;
  const gameStatus = (q.data?.game.status as string | null) ?? null;
  const lock = gameLockState({ status: gameStatus, correctionsOpen });
  /**
   * May a result be ENTERED right now — the role answer AND the lifecycle one.
   *
   * `canEdit` alone is a role answer, and on a locked game it left the four
   * outcome buttons live: the runner taps, `set_pickem_result` refuses with
   * `GAME_LOCKED`, and the segment springs back. That is CLAUDE.md #24's seventh
   * incident — a lock-dependent behaviour each view had to remember — and it is
   * the same fix non-golf made, reading the same `gameLockState` so the buttons
   * and the CTA underneath them cannot disagree about whether the game is open.
   *
   * LOCKED → read-only, with "Correct a result" as the way back. CORRECTING →
   * editable again. No permission changed; `canEdit` is only ANDed.
   */
  const resultsEditable = canEdit && !lock.isLocked;
  const { correct: correctGame, isPending: correctPending } = useOpenCorrection(
    tripId,
    gameId,
    (q.data?.game.competition_id as string | null) ?? null
  );
  const { finalize: finalizeGame, isPending: finalizePending } = useGameFinalize({
    tripId,
    gameId,
    competitionId: (q.data?.game.competition_id as string | null) ?? null,
    // This surface reads its own everything from `pickem.get` — the status the
    // CTA branches on included — so that is what has to come back.
    refreshSelf: () => void utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! }),
    onExit: exitToBoard,
  });

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
          /**
           * THE STORED NUMBER. This was `i + 1` — a positional fiction that is
           * only true while no row has ever been dropped.
           *
           * `matchesToSaveRows` drops unfilled matches and preserves each
           * survivor's own number, so a pairing cleared in the middle stores
           * 1,3. Renumbering that to 1,2 made every later unchanged save ask
           * the RPC for a match_number that does not exist, and its fields-only
           * branch raised STRUCTURE_MISMATCH — which says "this game changed on
           * another device", the same sentence as the optimistic-concurrency
           * check. So a trapped game read as a conflict, and stayed trapped,
           * because nothing about a clean read would fix it.
           *
           * Falling back to `i + 1` only where the column is null, which no row
           * `save_game_config` writes ever is.
           */
          matchNumber: m.matchNumber ?? i + 1,
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
      return t ? { id: t.id, name: t.name, short_name: t.shortName, color: t.color } : undefined;
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
  /**
   * What the Matches row says about itself.
   *
   * Both counts come from the DRAFT, so the subtitle moves as a runner pairs
   * rather than after the Save — the same rule the divisor line follows, and
   * the reason a half-filled slot counts toward the total but not toward
   * "assigned": scaffolding is not a match.
   */
  const pairsTotal = configDraft.matches.length;
  const pairsAssigned = configDraft.matches.filter(
    (m) => m.a[0] != null && m.b[0] != null
  ).length;

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
   * DELETED: `runBlockedReason`.
   *
   * It warned, before the runner tapped, that results could not be entered
   * until every match had both sides — the client half of migration 159's
   * completeness gate, which migration 167 removes.
   *
   * The gate was wrong: a slate game's result is a fact about the world, and
   * whether Alabama covered does not depend on who has been paired against
   * whom. And the arithmetic never needed it — entering a result scores every
   * SHEET, which works with no matches at all. Only the match totals need
   * matches, and those derive; an unpaired match has no total yet, which the
   * board has always rendered as a display state rather than an error.
   *
   * It was also HALF of a double treatment: this amber banner said the
   * condition, and the RPC then refused with a red error saying it again. Two
   * voices for one fact is its own defect, and removing the gate removes both
   * at once rather than picking which voice to keep.
   */

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
   * Everyone else in this game, for the Picks tab's second half.
   *
   * ── The FIELD, not the sheets ──────────────────────────────────────────────
   *
   * Built from the union of three sources rather than from `sheets` alone:
   * whoever has a visible sheet, whoever is on a team, and whoever is a side of
   * a match. Sheets alone would render fifteen rows where there are seventeen
   * people, and the reader has no way to tell a short field from a dropped one
   * — the empty-versus-unknown rule, in a list.
   *
   * The three overlap almost entirely in practice. They are unioned anyway
   * because each is the only source for one real case: a person on no team who
   * submitted (sheets), an unpaired person who did not (teams), and a match
   * side belonging to somebody the roster read missed.
   *
   * `points` is null — never 0 — for a person with no sheet. Zero-because-they
   * -missed and zero-because-they-never-picked are the same number and opposite
   * facts, and the row copy branches on exactly this.
   */
  /**
   * WHAT IS ON THIS PAGE — read, never re-derived here.
   *
   * The four conditions this replaces (the tab row, the three panel bodies, the
   * sub-tab bar) each carried their own idea of when they belonged on screen
   * and only happened to agree. `pickemSurface` is the one answer, and the
   * reason its tests mean anything is that this line is the only caller.
   */
  const surface = pickemSurface({
    phase,
    openPanel,
    picksSub,
    proxyTargetCount: proxyTargets.length,
  });


  /**
   * Everyone else, GROUPED BY TEAM and in each team's own roster order.
   *
   * ── The field, not the sheets ─────────────────────────────────────────────
   *
   * Built from the union of three sources: whoever has a visible sheet,
   * whoever is on a team, and whoever is a side of a match. Sheets alone would
   * render fifteen rows where there are seventeen people, and the reader has no
   * way to tell a short field from a dropped one.
   *
   * ── Roster order, and it is free ─────────────────────────────────────────
   *
   * `teams[].memberIds` arrives ordered by `team_assignments.sort_order` — the
   * router already sorts it — so this iterates that array rather than sorting
   * anything. That matters beyond convenience: it is the SAME order the team is
   * written down in everywhere else in the app, and a list that reorders itself
   * as results land is a list nobody can learn.
   *
   * A trailing column holds anyone the teams do not: a person on no team, or a
   * match side whose assignment is missing. They would otherwise vanish, which
   * is the same short-field problem one level up.
   */
  /**
   * ── THE SAME SURFACE ON BOTH SIDES OF THE LOCK ───────────────────────────
   *
   * While picks are open, Other picks used to be a different component
   * entirely: a flat list with the team name under each person and the retired
   * "Hasn't signed up" wording. Two shapes in one tab, and only the post-lock
   * one had been brought up to date — which is the layout deviation §2 exists
   * to remove, and the phrase §3 explicitly retired, both still on screen.
   *
   * Same columns, same roster order, same state lines. What differs is the
   * SOURCE and what a tap does, which is the only thing that should differ:
   * before the lock these are people you may enter FOR, so tapping opens their
   * sheet to write; after it, people whose sheet you may read.
   *
   * ── What is NOT knowable before the lock ─────────────────────────────────
   *
   * Their totals (RLS hides other people's picks) and how far along they are —
   * `pickem_sheet_status` answers with a boolean rather than a count. So
   * `points` is null and `picked` is null-for-started, which the state line
   * renders as silence rather than as a guess. A count needs that function to
   * return one; until then, saying nothing is the honest half.
   */
  const proxyColumns: OtherPicksColumn[] = (() => {
    const byUser = new Map(proxyTargets.map((t) => [t.userId, t]));
    const row = (t: ProxyTarget) => ({
      userId: t.userId,
      name: t.name,
      // The real count now. `pickem_sheet_status` returned a boolean until
      // migration 167, so this said "started, distance unknown" and rendered as
      // silence — honest, but it could not tell a half-finished sheet from a
      // finished one, which is the state a captain is chasing.
      picked: t.picked,
      total: t.total,
      isGuest: t.isGuest,
      // Still null: RLS hides other people's PICKS until the reveal, so there
      // is no score to show even though the count is now knowable. Two
      // different questions, and only one of them was answered by 167.
      points: null,
      // Every one of these is somebody the SERVER said this viewer may enter
      // for. The row count is the permission, exactly as it was when this list
      // was a page.
      openable: true,
    });

    const placed = new Set<string>();
    const cols: OtherPicksColumn[] = q.data.teams.map((t) => {
      const people = t.memberIds.filter((uid) => byUser.has(uid));
      for (const uid of people) placed.add(uid);
      return {
        // SHORT — a column eyebrow over a list of that team's people. The team
        // labels the column; the people are its content. Label slot, and the
        // columns floor at 150px, where a full name wrapped and left the
        // columns at different heights.
        teamId: t.id,
        teamName: t.shortName,
        people: people.map((uid) => row(byUser.get(uid)!)),
      };
    });
    const loose = proxyTargets.filter((t) => !placed.has(t.userId));
    if (loose.length > 0) {
      cols.push({ teamId: null, teamName: "No team", people: loose.map(row) });
    }
    return cols;
  })();

  const otherColumns: OtherPicksColumn[] = (() => {
    const field = new Set<string>(Object.keys(q.data.sheets));
    for (const t of q.data.teams) for (const uid of t.memberIds) field.add(uid);
    for (const m of q.data.matches) {
      if (m.sideAId) field.add(m.sideAId);
      if (m.sideBId) field.add(m.sideBId);
    }
    if (me?.id) field.delete(me.id);

    const guestOf = new Map(
      ((membersQ.data ?? []) as { memberId?: string; isGuest?: boolean }[]).map((r) => [
        r.memberId ?? "",
        r.isGuest ?? false,
      ])
    );
    const total = q.data!.slate.length;
    const row = (userId: string) => {
      const picks = q.data!.sheets[userId] ?? [];
      return {
        userId,
        name: nameOf(userId),
        picked: picks.length,
        total,
        isGuest: guestOf.get(userId) ?? false,
        points: picks.length
          ? sheetPoints(q.data!.slate, picks, q.data!.settings.useConfidence)
          : null,
        // After the lock a sheet is readable exactly when it exists.
        openable: picks.length > 0,
      };
    };

    const placed = new Set<string>();
    const cols: OtherPicksColumn[] = q.data.teams.map((t) => {
      const people = t.memberIds.filter((uid) => field.has(uid));
      for (const uid of people) placed.add(uid);
      // SHORT — same column eyebrow, post-lock shape. See the pre-lock branch
      // above; these two render the same surface and must not disagree.
      return { teamId: t.id, teamName: t.shortName, people: people.map(row) };
    });

    const loose = [...field].filter((uid) => !placed.has(uid)).sort();
    if (loose.length > 0) {
      cols.push({ teamId: null, teamName: "No team", people: loose.map(row) });
    }
    return cols;
  })();

  return (
    <div
      /* px-4 is the gutter Match, Rack and Stroke all use. Pick'em was
         inset by `mx-1` on each child — 4px, so its cards ran to the edges
         while every other game page sat 16px in. The shell only pads at lg+,
         so the mobile gutter is the view's own job and this is the answer the
         rest of the app already gave. */
      className="flex flex-col gap-3 px-4"
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
      {/* The panel used to be suppressed while the Sheets PAGE was up — that
          page was a screen with its own header, and the strip above it made two
          headings for one surface. There is no such page now: Other picks is a
          sub-tab under a tab bar, with the runner's panel above the whole
          thing, so there is nothing left to suppress it for. */}
      {runnerStrip && (
        <PickemPhaseStrip
          // Migration 165 refuses unlock once anything is scored; this is why
          // the move is not offered. Same predicate the server uses, mirrored
          // in TypeScript the way `pickemLifecycle` mirrors the clock.
          hasResults={q.data.hasResults}
          phase={phase}
          slateCount={q.data.slate.length}
          deadline={clock.picksDeadline ?? null}
          busy={setPhase.isPending || setDeadline.isPending}
          /* The strip SAYS what Start will do; this DOES it. One answer, from
             `deadlineBlocksReopen`, so the sentence and the behaviour cannot
             disagree about where the boundary is. */
          deadlinePassed={deadlineBlocksReopen(clock, now)}
          /* ── THE FINALIZE MOVED HERE (r7 §10) ──────────────────────────
             It was at the end of the results list. The panel's action slot is
             empty by the time results are being entered — Start and Close are
             both spent — and this is where the runner's other standing
             controls already are.

             `allComplete` is the CLOCK, not the results, which is why the
             button appears mid-way through the list at all and therefore why
             it has a quiet treatment: see `PickemRunLifecycle`. */
          lifecycle={{
            canEdit,
            status: gameStatus,
            correctionsOpen,
            /**
             * ── PICK'EM'S COMPLETENESS INPUT IS THE CLOCK, NOT THE RESULTS ──
             *
             * `allComplete` means "can the server compute a real result from
             * this yet". For golf that is every score entered; here it is that
             * picking has CLOSED, which is exactly what `computePickemResults`
             * refuses on.
             *
             * Counting resolved contests would have been the obvious reading
             * and it is the wrong one — it would refuse a finalize the runner
             * is entitled to make, because a postponed Tuesday game must not
             * hold the cup open. That case is a QUESTION at the tap, in a
             * treatment that does not disable anything.
             *
             * Derived from the SAME predicate the server gates on, so the CTA
             * cannot offer an action the RPC then refuses.
             */
            allComplete: picksRevealed(clock, now),
            finalizePending,
            correctPending,
            onFinalize: () => void finalizeGame(),
            onCorrect: correctGame,
            unresolvedCount: q.data.slate.filter((g) => g.result == null).length,
          }}
          onOpenPicks={() => setPhase.mutate({ tripId: tripId!, gameId, action: "open" })}
          onLock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "lock" })}
          onUnlock={async () => {
            /**
             * START, on a game whose deadline has already gone.
             *
             * `unlock` clears `picks_locked_at` and NOTHING else — three
             * migrations say so in as many words. So on a past-deadline game it
             * writes a column, the page re-reads, and `picksOpen` still fails
             * on `now <= deadline`: the runner presses the only action they
             * have and watches nothing happen.
             *
             * Clearing the spent deadline is the honest completion of the
             * intent, not an extra: a deadline in the past is no longer a
             * schedule, it is a record of when picks shut, and "reopen picks"
             * cannot mean anything else while it stands.
             *
             * Sequenced with `mutateAsync` and the deadline FIRST, so the two
             * writes cannot land in an order that leaves the game momentarily
             * open against a stale deadline — and so a failure to clear it
             * aborts before the unlock rather than after, leaving the game
             * exactly as it was instead of half-moved.
             */
            if (deadlineBlocksReopen(clock, now)) {
              await setDeadline.mutateAsync({ tripId: tripId!, gameId, deadline: null });
            }
            setPhase.mutate({ tripId: tripId!, gameId, action: "unlock" });
          }}
          onDeadlineChange={(deadline) => setDeadline.mutate({ tripId: tripId!, gameId, deadline })}
        />
      )}

      {phase === "building" ? (
        /* No props: it takes no viewer and no counts because it says the same
           thing to everybody. The runner's half is the panel above it. */
        <PhaseBody />
      ) : (
        /**
         * ── THE TAB ROW ARRIVES AT THE LOCK ───────────────────────────────
         *
         * Before it, two of the three tabs are about things that do not exist:
         * nobody is in a match and no result has been entered. And for a
         * participant the matches never mattered at pick time anyway — whether
         * a sheet rolls into a team total or a head-to-head changes not one
         * pick. The only question before the lock is whether your sheet is in.
         *
         * So while picks are open the page IS the sheet, with Other picks
         * beside it for anyone who can enter for somebody. At the lock the
         * sheet stops being a task and becomes a record, the question becomes
         * "how am I doing", and the tabs appear to answer it.
         *
         * ONE arm for both phases rather than two, because PICKS is common to
         * them: the same sub-tabs, the same two components, differing only in
         * whether they are editable. Splitting the arm is what produced two
         * routes to a person's sheet in the first place.
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
          {surface.showTabs && !runnerStrip && (
            <PickemClosedBanner closure={pickemClosure(clock, now)} />
          )}

          {surface.showTabs && (
          <PickemTwoUp
            /* The first tab's own count. Under team totals there are no
               matches to count, so it says what that shape has instead. */
            matchesLabel={
              individualMatches
                ? `${matchPairs.length} match${matchPairs.length === 1 ? "" : "es"}`
                : `${q.data.teams.length} teams`
            }
            /* Null, not zero, for somebody with no sheet: "0 pts · 16 of 16"
               reads as a bad weekend rather than as an absence. */
            myPoints={mySheet?.total ?? null}
            resolved={resolvedGames}
            total={totalGames}
            canEdit={canEdit}
            open={openPanel}
            /* A tab bar SELECTS. Tapping the open one again is not a close —
               there is no closed state for a page to be in. */
            /* Every tab change is a leave. The guard is here rather than in
               the tab bar because the bar has no idea a sheet exists. */
            onOpen={(panel) => leaveSheet(() => setOpenPanel(panel))}
          />
          )}

          {/* PICKS — the viewer's own sheet, and everybody else's.
              Reading another sheet used to be reachable only from the
              picks-OPEN page, through the proxy button. So the one phase where
              every sheet is deliberately readable was the one phase with
              nowhere to read them. */}
          {surface.panel === "picks" && (
            <>
              {/* The sub-tabs, in BOTH phases — but only when there is a second
                  half to switch to. While picks are open that is "has the
                  server given me somebody to enter for", decided on the row
                  count and never on a role: the same rule the deleted Sheets
                  button followed, since a client-side role test would be a
                  second copy of a policy that lives in one place. Once locked
                  every sheet is readable, so the bar is always there. */}
              {surface.showPicksSubTabs && (
                <PickemPicksSubTabs
                  open={picksSub}
                  onOpen={(sub) =>
                    leaveSheet(() => {
                    setPicksSub(sub);
                    // Leaving the list closes whoever was open in it. Coming
                    // back to a sheet you did not choose this time is the same
                    // stale-subject bug the proxy sheet's remount key exists
                    // for.
                    setReadingSheetOf(null);
                    setProxyFor(null);
                    })
                  }
                />
              )}

              {/* YOUR sheet — ONE component across both phases, with
                  `editable` coming from the CLOCK. `picksOpen` is the same
                  predicate `pickem_picks_write` calls, so the screen cannot
                  offer an edit the policy refuses or refuse one it would allow.
                  A separate read-only component is how two definitions of
                  "picks open" get created. */}
              {surface.sub === "your" && (
                <PickemSheet
                  gameId={gameId}
                  slate={q.data.slate}
                  settings={q.data.settings}
                  picks={q.data.myPicks}
                  subject={{ userId: me?.id ?? "", name: "You", isSelf: true, isGuest: false }}
                  editable={picksOpen(clock, now)}
                  saving={savePicks.isPending}
                  saveError={proxyTarget ? null : saveError}
                  deadlineMs={msUntilDeadline(clock, now)}
                  /* The runner's panel already says picks are closed, and the
                     member gets the hoisted banner above — either way the sheet
                     must not print a third copy. */
                  closedBannerHoisted
                  closure={pickemClosure(clock, now)}
                  onSave={(picks) => savePicks.mutate({ tripId: tripId!, gameId, picks })}
                  onDirtyChange={(d, picks) => {
                    sheetDirty.current = d;
                    sheetDraft.current = picks;
                  }}
                />
              )}

              {/* OTHER picks — the same slot, a different question either side
                  of the lock.

                  Open: whose sheet may I WRITE (`pickem_sheet_status`, the
                  list that IS the permission). Locked: whose may I READ, which
                  after the lock is everybody — and that list must NOT come from
                  `pickem_sheet_status`, which answers nobody once picks close.
                  Same place on screen, two sources, and conflating them is what
                  would empty this tab for every member on a locked game. */}
              {surface.sub === "other" && readingSheetOf == null && !proxyTarget && (
                picksOpen(clock, now) ? (
                  <PickemOtherPicks
                    /* The same component the locked phase uses. Nothing filters
                       these columns here and nothing may: they are built from
                       what `pickem_sheet_status` returned, the list IS the
                       permission, and a client-side role check would be a
                       second copy of a policy that lives in one place. */
                    columns={proxyColumns}
                    avatarFor={avatarFor}
                    onOpen={(userId) => {
                      setProxyFor(userId);
                      setSaveError(null);
                    }}
                  />
                ) : (
                  <PickemOtherPicks
                    columns={otherColumns}
                    avatarFor={avatarFor}
                    onOpen={setReadingSheetOf}
                  />
                )
              )}

              {/* PROXY ENTRY (migration 163) — reached from Other picks while
                  picks are open.

                  The banner is a BAND, not a subtitle, and it sits above a
                  sheet that is POPULATED, because proxy mode looks exactly like
                  a filled-in sheet — it is one. The copy underneath is swept of
                  "your" in the same breath: a banner over second-person text is
                  a mixed message, and mixed is how somebody edits what they
                  think is their own sheet. That is the only way this feature
                  goes badly. */}
              {surface.sub === "other" && proxyTarget && (
                <>
                  <PickemProxyBanner
                    name={proxyTarget.name}
                    isGuest={proxyTarget.isGuest}
                    /* From the ROWS, not from `proxyTarget.submitted` — which is
                       a count and cannot say who typed them. These are the same
                       rows the sheet below renders, so the banner cannot end up
                       describing a sheet other than the one on screen. */
                    author={sheetAuthor(
                      q.data.sheets[proxyTarget.userId] ?? [],
                      proxyTarget.userId,
                      me?.id ?? null
                    )}
                    onBack={() => setProxyFor(null)}
                  />
                  <PickemSheet
                    /* Remounts when the subject changes. The sheet holds a
                       draft keyed on a fingerprint of the server picks, and two
                       people who have not submitted fingerprint IDENTICALLY —
                       so without a key the draft would survive a subject switch
                       and carry one person's picks into another's sheet. Same
                       collision the outbox scope closes, one layer up; both
                       have to hold. */
                    key={proxyTarget.userId}
                    gameId={gameId}
                    slate={q.data.slate}
                    settings={q.data.settings}
                    picks={q.data.sheets[proxyTarget.userId] ?? []}
                    subject={subject}
                    editable={picksOpen(clock, now)}
                    saving={savePicksFor.isPending}
                    saveError={saveError}
                    deadlineMs={msUntilDeadline(clock, now)}
                    closure={pickemClosure(clock, now)}
                    onSave={(picks) => {
                      proxyTargetName.current = proxyTarget.name;
                      savePicksFor.mutate({
                        tripId: tripId!,
                        gameId: gameId!,
                        targetUserId: proxyTarget.userId,
                        picks,
                      });
                    }}
                    onDirtyChange={(d, picks) => {
                      sheetDirty.current = d;
                      sheetDraft.current = picks;
                    }}
                  />
                </>
              )}

              {surface.sub === "other" && readingSheetOf != null && (
                <>
                  {/* NOT `PickemProxyBanner`. That band says "You are
                      entering Charlie’s sheet · saving replaces it" over a
                      surface that cannot be entered or saved — every clause
                      false, in the loudest treatment on the page. The two
                      headers answer the same question for opposite reasons: one
                      is a warning about the only way proxy entry goes badly,
                      this is a title. */}
                  <PickemReadingHeader
                    name={nameOf(readingSheetOf)}
                    onBack={() => setReadingSheetOf(null)}
                  />
                  <PickemSheet
                    /* Keyed on the SUBJECT. The sheet holds a draft stamped
                       with a fingerprint of the server picks, and two people
                       who have not submitted fingerprint identically — so
                       without this, switching subjects can carry one person's
                       sheet into another's. Read-only here, but the key costs
                       nothing and the failure it prevents is the one this
                       feature must never have. */
                    key={readingSheetOf}
                    gameId={gameId}
                    slate={q.data.slate}
                    settings={q.data.settings}
                    picks={q.data.sheets[readingSheetOf] ?? []}
                    subject={{
                      userId: readingSheetOf,
                      name: nameOf(readingSheetOf),
                      isSelf: false,
                      isGuest: false,
                    }}
                    editable={false}
                    saving={false}
                    saveError={null}
                    deadlineMs={null}
                    closedBannerHoisted
                    closure={pickemClosure(clock, now)}
                    onSave={() => {}}
                  />
                </>
              )}
            </>
          )}

          {/* Results are visible to everyone as they land — no embargo, since
              the whole point is watching it resolve (§7). `canEdit` decides
              whether the BUTTONS are there, not whether the outcomes are. */}
          {surface.panel === "results" && (
            /* ── §11 · THE PREREQUISITE, BEFORE THE DOOR SHUTS ─────────────
               Migration 162 freezes the pairings on the first result, so a
               runner who enters results before drawing matches can then never
               draw them — and the refusal they meet names a rule they can no
               longer satisfy.

               Only where there is something to draw: `noMatchesDrawn` is false
               on team totals, which has no matches and no freeze.

               Not gated on `resultsEditable`. A member arriving here would
               otherwise see an entry list with nothing in it and no reason
               given, and the sentence is true for them too — it is a fact about
               the game, not an instruction only the runner can act on. The
               second line names the gear, which a member simply does not
               have; that is the same shape as every other "ask whoever is
               running it" surface in the app. */
            <div className="relative">
              <PickemRunView
                slate={q.data.slate}
                /* The lifecycle-narrowed answer — a locked game's results are read
                   only. `lifecycle.canEdit` below is deliberately the RAW role
                   answer, because `gameLifecycle` ANDs it with the lock itself and
                   narrowing it first would make "Correct a result" unreachable on
                   exactly the games that need it. */
                canEdit={resultsEditable}
                busyId={busyResultId}
                ridingOn={riding.byGame}
                matchesPending={riding.matchesPending}
                onSetResult={(slateGameId, result) => {
                  setBusyResultId(slateGameId);
                  setResult.mutate({ tripId: tripId!, gameId, slateGameId, result });
                }}
              />
              {noMatchesDrawn && <PickemMatchesRequired />}
            </div>
          )}

          {/* Behind the first TAB now, not under the other two. Never an empty
              grid: §12 forbids it, and a runner is under no pressure to pair
              before the deadline (§5), so "locked, unpaired" is a normal state
              that must read as waiting rather than broken. */}
          {surface.panel === "matches" &&
            (noMatchesDrawn ? (
            <PickemNoMatches />
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
          ))}
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
      {/* The SHEET's confirm-on-leave. Deliberately a second instance of
          `DiscardChangesPrompt` rather than a second design: this is the
          app's answer to "you are about to lose an edit", and a bespoke
          dialog here would be a second thing to keep in step.

          Its message names PICKS, because that is what is at stake — the
          default copy is about game settings and would be describing the
          wrong thing on this screen. */}
      {pendingLeave && (
        <DiscardChangesPrompt
          message="Your picks haven’t been saved yet. Leaving now discards them."
          onKeepEditing={() => setPendingLeave(null)}
          onDiscard={() => {
            const go = pendingLeave;
            setPendingLeave(null);
            sheetDirty.current = false;
            go();
          }}
          onSave={() => {
            /* It SAVES. A dialog whose Save button only dismisses would be a
               button that lies, and this feature has spent five rounds
               removing those. The sheet reports its draft alongside its dirty
               flag precisely so this can reach it. Leaves on success, the same
               shape the settings prompt uses. */
            const go = pendingLeave;
            void savePicks
              .mutateAsync({ tripId: tripId!, gameId, picks: sheetDraft.current })
              .then(() => {
                setPendingLeave(null);
                sheetDirty.current = false;
                go();
              })
              .catch(() => {
                /* The mutation surfaces its own error. Keep them here rather
                   than leaving with the picks unsaved. */
                setPendingLeave(null);
              });
          }}
          saving={savePicks.isPending || savePicksFor.isPending}
        />
      )}

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
          totalPointsRow={
            <PickemTotalPointsRow
              pointsTotal={configDraft.pointsTotal}
              // Points share the ONE freeze point (migration 157): the first
              // result, not the slate's lock. 152's carve-out existed because
              // the two used to disagree.
              canEditPoints={canEdit && scoringSettingsEditable(q.data.hasResults)}
              matches={q.data.matches}
              rollUp={settingsDraft.rollUp}
              onPointsChange={setPointsTotalDraft}
            />
          }
          onDeleted={exitToBoard}
          onScoresReset={() => utils.pickem.get.invalidate({ tripId: tripId!, gameId })}
          settingsRows={
            canEdit && (
                <PickemScoringRows
                  settings={settingsDraft}
                  editable={canEdit && scoringSettingsEditable(q.data.hasResults)}
                  frozenReason={canEdit ? scoringFrozenReason(q.data.hasResults) : null}
                  // Absent in a POINTS cup for the same reason it is absent
                  // standalone: the setting means nothing there. Offering an
                  // inert control is the state Phase 7 rejected a third roll_up
                  // CHECK value for — it reads as configured and is not.
                  showRollUp={q.data.game.competition_id != null && !pointsMode}
                  slateCount={q.data.slate.length}
                  onChange={(next) => {
                    setRollUpDraft(next.rollUp);
                    setUseConfidenceDraft(next.useConfidence);
                  }}
                  slateRow={
                    <PickemSlateRow
                      slateCount={q.data.slate.length}
                      weightedCount={q.data.slate.filter((g) => (g.multiplier ?? 1) > 1).length}
                      useConfidence={q.data.settings.useConfidence}
                      // Opens the slate ON TOP of settings rather than closing
                      // settings first. Closing first looked tidier and was
                      // broken: on the `?settings=1` DEEP-LINK path the
                      // overlay's open-ness is derived from the URL, so
                      // `closeConfig` navigates — and the navigation discarded
                      // the `setSlateOpen(true)` that had just run. Settings
                      // closed, the slate never appeared, and nothing errored.
                      //
                      // The Sheet it opens portals to body (#1091) — rendered
                      // inline it was capped inside the game panel's `z-30`
                      // stacking context and opened UNDERNEATH this overlay,
                      // which is what made "The slate" look like a dead button.
                      onOpenSlate={() => setSlateOpen(true)}
                    />
                  }
                  matchesRow={
                    /* Rendered whenever the game HAS sides. Under team totals it
                       is covered by the Requires: scrim rather than hidden —
                       same treatment as "Requires: Golf Course" — because the
                       setting is not missing, its prerequisite is. Hiding it
                       would make the page change shape between two roll-ups and
                       leave a runner hunting for a row that was there a moment
                       ago.

                       Below two teams there is nothing to pair at all, so the
                       row is genuinely absent — a scrim there would promise a
                       prerequisite that this game can never meet. */
                    q.data.teams.length >= 2 ? (
                      <ChecklistRow
                        icon={Swords}
                        title="Matches"
                        testId="row-matches"
                        state={pairsAssigned > 0 ? "resolved" : "empty"}
                        subtitle={
                          pairsTotal === 0
                            ? "Nobody paired yet"
                            : `${pairsTotal} singles · ${pairsAssigned} of ${pairsTotal} assigned`
                        }
                        /* The STAGED roll-up, not the server's: this page is a
                           draft, and a scrim reading the saved value would lift
                           only after a Save the runner has not pressed yet. */
                        requires={individualMatchesStaged ? undefined : ["Individual matches"]}
                        expanded={matchesOpen}
                        onToggle={() => setMatchesOpen((v) => !v)}
                      >
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
                      </ChecklistRow>
                    ) : null
                  }
                />
            )
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
export function PhaseBody() {
  /**
   * ── The runner sees the MEMBER's screen, and their panel above it ─────────
   *
   * This used to branch: a runner got their own banner with Configure, and
   * under it a full-width "Open picks · N games" with a paragraph explaining
   * what pressing it would do. Together with the phase strip that made THREE
   * calls to action for one job, two of them the same action.
   *
   * All of it is now the one panel in `PickemPhaseStrip`, so there is no
   * branch left here. The runner sees what everyone else sees — because that
   * is what everyone else sees — plus their controls above it.
   *
   * Configure went entirely rather than moving into the panel: the header gear
   * is the way to settings on all five formats, and a second right-justified
   * action would have put a detour beside the phase action.
   */
  return (
    <Empty
      icon="◷"
      heading="Picks open soon"
      body="The slate of games is still being put together. Check back later."
    />
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
/**
 * The Picks — the way into the slate builder.
 *
 * Built here rather than inside `PickemScoringRows` because it opens a modal
 * this file owns; passed in as a slot so the rows component keeps the order.
 */
export function PickemSlateRow({
  slateCount,
  weightedCount,
  useConfidence,
  onOpenSlate,
}: {
  slateCount: number;
  weightedCount: number;
  useConfidence: boolean;
  onOpenSlate: () => void;
}) {
  return (
    <ChecklistRow
      icon={ListChecks}
      title="The Picks"
      testId="row-the-picks"
      state={slateCount === 0 ? "empty" : "resolved"}
      subtitle={
        <>
          {slateCount === 0
            ? "No games yet — this is what people pick from"
            : [
                `${slateCount} game${slateCount === 1 ? "" : "s"}`,
                weightedCount > 0 ? `${weightedCount} weighted` : null,
                useConfidence ? `confidence ${slateCount}–1` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
          {/*
            ── STOPGAP (#1208). REMOVE THIS WHEN THE SLATE MOVES. ────────────
            Expectation management, not the fix.

            The slate writes on change and everything else on this page is a
            draft committed by the bar at the bottom, so Cancel reverts the
            switches and keeps the games — a PARTIAL undo, on edits made
            seconds apart on one screen. This line does not repair that. It
            only stops the reader being surprised by it, and it says so on the
            way IN, because the modal's own footer says the same thing and is
            only readable once you are already inside.

            It names Cancel deliberately — that is the control that misled
            somebody, and a note that said merely "saves immediately" would
            leave them to draw the wrong conclusion about the button anyway.
            That coupling to this container is fine BECAUSE it is temporary:
            the fix is that the slate is CONTENT and belongs in the game
            page's admin panel rather than behind the settings door, at which
            point there is no Cancel to be wrong about and this line goes with
            it.
          */}
          <span className="mt-0.5 block" style={{ color: "var(--color-bt-text-dim)" }}>
            Saves as you go — Cancel below won&rsquo;t undo it.
          </span>
        </>
      }
      onClick={onOpenSlate}
    />
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
