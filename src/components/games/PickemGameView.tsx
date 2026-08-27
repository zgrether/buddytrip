"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { trpc } from "@/lib/trpc-client";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useGameSurfaceChrome } from "@/components/games/GameChrome";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { useRealtimeGame } from "@/hooks/useRealtimeGame";
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
import { PickemSheet } from "@/components/games/pickem/PickemSheet";
import { PickemDeadlineRow } from "@/components/games/pickem/PickemDeadlineRow";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import {
  msUntilDeadline,
  picksOpen,
  pickemPhase,
  scoringSettingsEditable,
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
 * Run (Phase 5) and the board (Phase 6) are placeholders here — deliberately
 * named as such on screen rather than left as blank space, so the surface reads
 * as unfinished rather than broken.
 */
export function PickemGameView() {
  const { tripId } = useTripId();
  const search = useSearchParams();
  const gameId = search.get("game");
  const settingsDeepLink = search.get("settings") === "1";

  const { canEdit, isOwner, canManageGame } = useGameEditAccess(tripId, gameId);
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

  const [slateOpen, setSlateOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [rules, setRules] = useState<string | null>(null);

  const clock = q.data?.clock ?? { picksOpenedAt: null, picksDeadline: null, picksLockedAt: null };
  const phase = pickemPhase(clock);
  const canEditSlate = canEdit && slateEditable(clock);

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePicks = trpc.pickem.savePicks.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => setSaveError(e.message),
  });

  const setPointsTotal = trpc.pickem.setPointsTotal.useMutation({
    onSuccess: async () => {
      await utils.pickem.get.invalidate({ tripId: tripId!, gameId: gameId! });
    },
    onError: (e) => showToast(e.message, "error"),
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

  const gameName = name ?? q.data?.game.name ?? "Pick'em";

  const settings = useGameSettingsOverlay({ canEdit, deepLink: settingsDeepLink });
  // NOT `router.back()`. A bare back is only the inverse of a PANEL open; on the
  // standalone route or a cold deep-link there is no entry to pop and it exits
  // the app (#808). `oneFinalizePath.test.ts` enumerates every game surface and
  // fails the build for exactly this — it caught this file.
  const exitToBoard = useExitToBoard(tripId, q.data?.game.competition_id as string | null);

  const standaloneHeader = useGameSurfaceChrome(
    q.data
      ? {
          title: gameName,
          onSettings: canEdit ? settings.openConfig : undefined,
        }
      : null
  );

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

  const settingsDraft: PickemSettingsDraft = {
    rollUp: q.data?.settings.rollUp ?? "team_totals",
    useConfidence: q.data?.settings.useConfidence ?? true,
  };

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

      {phase === "building" ? (
        <PhaseBody
          slateCount={q.data.slate.length}
          canEdit={canEdit}
          onOpenSlate={() => setSlateOpen(true)}
          onOpenPicks={() =>
            setPhase.mutate({ tripId: tripId!, gameId, action: "open", deadline: null })
          }
          opening={setPhase.isPending}
        />
      ) : (
        <>
          {/* ONE component for both states. `editable` comes from the CLOCK —
              `picksOpen`, the same predicate `pickem_picks_write` calls — so the
              screen cannot offer an edit the policy will refuse, and cannot
              refuse one it would allow. The alternative (a separate read-only
              component) is how the two definitions of "picks open" get created,
              which is the risk this phase was flagged on. */}
          <PickemSheet
            gameId={gameId}
            slate={q.data.slate}
            settings={q.data.settings}
            myPicks={q.data.myPicks}
            editable={picksOpen(clock)}
            saving={savePicks.isPending}
            saveError={saveError}
            deadlineMs={msUntilDeadline(clock)}
            onSave={(picks) => savePicks.mutate({ tripId: tripId!, gameId, picks })}
          />
          {phase === "locked" && <Placeholder>The board lands in Phase 6.</Placeholder>}
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
          isOwner={isOwner}
          canManageGame={canManageGame}
          nameValue={gameName}
          onNameChange={setName}
          delegateValue={null}
          onDelegateChange={() => {}}
          rulesValue={rules ?? ""}
          onRulesChange={setRules}
          // Phase 2 has no page-level draft: the only things this page can
          // change are the slate and its two settings, and those commit through
          // the modal's own atomic Save. Name / rules / delegates are rendered
          // but not yet wired to `games.saveConfig` — see the note on
          // `management` below, and the Phase 2 report.
          saveBar={null}
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
              phase={phase}
              canEdit={canEdit}
              deadlineRow={
                <PickemDeadlineRow
                  deadline={clock.picksDeadline}
                  // ANY phase now. `set_pickem_deadline` (migration 153) writes
                  // one column, so there is nothing left for it to disturb —
                  // the restriction that used to stand in for that fix is gone.
                  editable={canEdit}
                  busy={setDeadline.isPending}
                  onChange={(deadline) =>
                    setDeadline.mutate({ tripId: tripId!, gameId, deadline })
                  }
                />
              }
              scoringRows={
                <PickemScoringRows
                  settings={settingsDraft}
                  editable={canEdit && scoringSettingsEditable(clock)}
                  showRollUp={q.data.game.competition_id != null}
                  saving={saveConfig.isPending}
                  pointsTotal={(q.data.game as { points_total?: number | null }).points_total ?? null}
                  // Points are NOT frozen with the slate (migration 152): the
                  // total decides what the game is worth, not anything a
                  // participant already chose.
                  canEditPoints={canEdit}
                  matches={q.data.matches}
                  onPointsChange={(total) =>
                    setPointsTotal.mutate({ tripId: tripId!, gameId, total })
                  }
                  onSave={(next) =>
                    saveConfig.mutate({ tripId: tripId!, gameId, settings: next })
                  }
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
              onOpenPicks={() =>
                setPhase.mutate({ tripId: tripId!, gameId, action: "open", deadline: null })
              }
              onLock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "lock" })}
              onUnlock={() => setPhase.mutate({ tripId: tripId!, gameId, action: "unlock" })}
              onReopen={() =>
                setPhase.mutate({ tripId: tripId!, gameId, action: "reopen" })
              }
              busy={setPhase.isPending}
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

/** Settings-zone rows: the door to the slate, and Reopen. */
export function SlateSettingsRows({
  slateCount,
  useConfidence,
  phase,
  canEdit,
  scoringRows,
  deadlineRow,
  onOpenSlate,
  onOpenPicks,
  onLock,
  onUnlock,
  onReopen,
  busy,
}: {
  slateCount: number;
  /** Drives the COPY, not just the sheet. A confidence-off game has no ranking,
   *  so "confidence 1–N" and "has to rank them again" are falsehoods on it. */
  useConfidence: boolean;
  phase: ReturnType<typeof pickemPhase>;
  canEdit: boolean;
  /** The two scoring settings, rendered by `PickemScoringRows`. Passed in
   *  rather than built here so this component stays free of tRPC. */
  scoringRows: React.ReactNode;
  /** The deadline control, passed in for the same reason as `scoringRows` —
   *  this component stays free of tRPC. */
  deadlineRow: React.ReactNode;
  onOpenSlate: () => void;
  onOpenPicks: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onReopen: () => void;
  busy: boolean;
}) {
  if (!canEdit) return null;

  /** The transitions available RIGHT NOW. One row of buttons, not three stacked
   *  cards — they are alternatives on one axis, and stacking them made the
   *  settings page read as a list of unrelated features. */
  const transitions: { label: string; onClick: () => void; testId: string; tone: "go" | "undo" }[] = [];
  if (phase === "building" && slateCount > 0) {
    transitions.push({ label: "Open picks", onClick: onOpenPicks, testId: "pickem-open-picks-settings", tone: "go" });
  }
  if (phase === "picks_open") {
    transitions.push({ label: "Lock picks", onClick: onLock, testId: "pickem-lock-picks", tone: "go" });
  }
  if (phase === "locked") {
    // The narrow inverse of Lock, available whenever picks are locked —
    // reversible without touching the slate or anyone's ranking, which is what
    // separates it from Reopen sitting beside it.
    transitions.push({ label: "Unlock picks", onClick: onUnlock, testId: "pickem-unlock-picks", tone: "go" });
  }
  if (phase !== "building") {
    transitions.push({ label: "Reopen the slate", onClick: onReopen, testId: "pickem-reopen-slate", tone: "undo" });
  }

  /** What each visible transition will DO. Two-word labels are not enough for
   *  actions that change what sixteen other people can see, so the row carries
   *  one line per available action rather than a single generic caption. */
  const consequence: Record<string, string> = {
    "pickem-open-picks-settings":
      "Open picks — everyone can start filling in their sheet, and the slate freezes.",
    "pickem-lock-picks":
      "Lock picks — closes every sheet immediately and reveals them to the trip.",
    "pickem-unlock-picks":
      "Unlock picks — reopens every sheet for editing and hides them again. Slate and rankings are untouched.",
    "pickem-reopen-slate": useConfidence
      ? "Reopen the slate — back to not-open so you can change the games. Everyone keeps their winners and re-ranks them."
      : "Reopen the slate — back to not-open so you can change the games. Everyone keeps their picks.",
  };

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

      {/* The deadline sits with the lifecycle it belongs to, above the buttons
          that change it — it IS a lock, just a scheduled one. Rendered in EVERY
          phase since migration 153: scheduling one while building is a real
          thing to do, and it no longer risks publishing the game. */}
      {deadlineRow}

      {/* ── The lifecycle, as ONE control ─────────────────────────────────
          Reopen used to live here alone, so settings held the way BACK out of
          every state and none of the ways in. Open and Lock are the other two
          transitions on the same axis — they belong in one row, showing only
          what is reachable from where the game actually is. */}
      {transitions.length > 0 && (
        <div className="flex flex-col gap-2">
          <ZoneHeader>Picks</ZoneHeader>
          <div
            className="rounded-xl px-3 py-3"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>{PHASE_LABEL[phase]}</div>
            <div
              className="mt-1 flex flex-col gap-0.5"
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.5 }}
            >
              {transitions.map((t) => (
                <span key={t.testId}>{consequence[t.testId]}</span>
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {transitions.map((t) => (
                <button
                  key={t.testId}
                  type="button"
                  onClick={t.onClick}
                  disabled={busy}
                  data-testid={t.testId}
                  className="rounded-lg px-3 disabled:opacity-40"
                  style={{
                    minHeight: 40,
                    fontSize: TYPE_SCALE.bodyDense,
                    fontWeight: 700,
                    background: t.tone === "go" ? "var(--color-bt-accent)" : "transparent",
                    color: t.tone === "go" ? "var(--color-bt-base)" : "var(--color-bt-danger)",
                    border: t.tone === "go" ? "none" : "1px solid var(--color-bt-danger)",
                  }}
                >
                  {busy ? "Working…" : t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What state the game is in, said plainly above the buttons that change it. */
const PHASE_LABEL: Record<ReturnType<typeof pickemPhase>, string> = {
  building: "Picks are not open yet",
  picks_open: "Picks are open",
  locked: "Picks are locked",
};


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
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto mt-4 rounded-lg px-3 py-2"
      style={{
        fontSize: TYPE_SCALE.caption,
        color: "var(--color-bt-text-dim)",
        border: "1px dashed var(--color-bt-border)",
        maxWidth: 290,
      }}
    >
      {children}
    </div>
  );
}

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
