"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { trpc } from "@/lib/trpc-client";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useGameSurfaceChrome } from "@/components/games/GameChrome";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { GameSettingsPage } from "@/components/games/GameSettingsPage";
import { GameStandaloneHeader } from "@/components/games/GameStandaloneHeader";
import { Spinner } from "@/components/Spinner";
import { TYPE_SCALE } from "@/lib/typeScale";
import { showToast } from "@/lib/toast";
import {
  PickemSlateModal,
  type PickemSettingsDraft,
  type SlateDraftGame,
} from "@/components/games/pickem/PickemSlateModal";
import { PickemSheet } from "@/components/games/pickem/PickemSheet";
import { msUntilDeadline, picksOpen, pickemPhase, slateEditable } from "@/lib/pickemLifecycle";

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

  const q = trpc.pickem.get.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId }
  );

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
        settings={settingsDraft}
        editable={canEditSlate}
        showRollUp={q.data.game.competition_id != null}
        saving={saveConfig.isPending}
        onSave={(next) =>
          saveConfig.mutate({
            tripId: tripId!,
            gameId,
            slate: next.slate,
            settings: next.settings,
          })
        }
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
              phase={phase}
              canEdit={canEdit}
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
  phase,
  canEdit,
  onOpenSlate,
  onOpenPicks,
  onLock,
  onReopen,
  busy,
}: {
  slateCount: number;
  phase: ReturnType<typeof pickemPhase>;
  canEdit: boolean;
  onOpenSlate: () => void;
  onOpenPicks: () => void;
  onLock: () => void;
  onReopen: () => void;
  busy: boolean;
}) {
  if (!canEdit) return null;
  return (
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
              : `${slateCount} games · confidence 1–${slateCount}`}
          </span>
        </span>
        <span style={{ color: "var(--color-bt-text-dim)" }}>›</span>
      </button>

      {/* ── The lifecycle, in the place people look for it ──────────────────
          Reopen lived here on its own, which meant settings held the way BACK
          out of every state and none of the ways forward. Open and Lock are the
          other two transitions on the same axis, so they belong beside it. The
          game page keeps its own Open button — that is the one a runner reaches
          first, and this is where he looks when he has already dismissed it. */}
      {phase === "building" && slateCount > 0 && (
        <LifecycleRow
          title="Open picks"
          body="Everyone can start filling in their sheet. The slate freezes until you reopen it."
          action="Open picks"
          onClick={onOpenPicks}
          busy={busy}
          testId="pickem-open-picks-settings"
        />
      )}

      {phase === "picks_open" && (
        <LifecycleRow
          title="Lock picks now"
          body="Closes every sheet immediately and reveals them to the trip. Use this when there is no deadline set, or to close early."
          action="Lock picks"
          onClick={onLock}
          busy={busy}
          testId="pickem-lock-picks"
        />
      )}

      {phase !== "building" && (
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>Reopen the slate</div>
          <div
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", margin: "2px 0 8px" }}
          >
            Picks go back to not-open so you can change the games. Everyone keeps their
            winners but has to rank them again.
          </div>
          <button
            type="button"
            onClick={onReopen}
            disabled={busy}
            data-testid="pickem-reopen-slate"
            className="rounded-lg px-3 py-1.5"
            style={{
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 600,
              color: "var(--color-bt-danger)",
              background: "var(--color-bt-danger-faint, transparent)",
              border: "1px solid var(--color-bt-danger)",
            }}
          >
            Reopen
          </button>
        </div>
      )}
    </div>
  );
}

/** One lifecycle transition: what it is, what it does, and the button. The body
 *  copy is not decoration — each of these changes what sixteen other people can
 *  see or do, and none of them is guessable from a two-word label. */
function LifecycleRow({
  title,
  body,
  action,
  onClick,
  busy,
  testId,
}: {
  title: string;
  body: string;
  action: string;
  onClick: () => void;
  busy: boolean;
  testId: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>{title}</div>
      <div
        style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", margin: "2px 0 8px", lineHeight: 1.5 }}
      >
        {body}
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        data-testid={testId}
        className="rounded-lg px-3 py-1.5 disabled:opacity-40"
        style={{
          fontSize: TYPE_SCALE.bodyDense,
          fontWeight: 700,
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-base)",
          minHeight: 36,
        }}
      >
        {busy ? "Working…" : action}
      </button>
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
