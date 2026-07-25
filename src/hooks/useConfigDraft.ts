"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "@/lib/trpc-client";
import { GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import type { DraftView } from "@/lib/draftOutbox";
import type { SaveConfigPayload } from "@/lib/configDraft";

/**
 * useConfigDraft — the ONE draft-then-save lifecycle for the game-settings page, shared by
 * all four format views (match / non-golf / rack / stroke). It owns everything that was
 * copy-pasted across those four parents (#626): the frozen `{ draft, hash }` baseline,
 * `dirty`, the config-hash poll, `justSaved` / `saveError`, the hard-teardown outbox +
 * recovery, the confirm-on-leave sync, and the atomic Save/Cancel. (The settings overlay
 * itself stays in the view — see the note below.)
 *
 * The FORMAT-SPECIFIC parts stay in each view and are passed in: the draft slices are
 * assembled there into `serverConfigDraft` (the server mirror) + `configDraft` (slices over
 * the mirror) + `anyTouched`, and the view supplies its pure `draftsEqual` / `toPayload`,
 * its outbox `bundle` + `applyRecovered` + `reset`, and an `onSaved` that refetches its own
 * game/child queries (so the baseline re-freezes on the new server state).
 *
 * Invariants:
 *  - ONE value feeds BOTH the outbox `base` and Save's `baseHash` — the FROZEN BASELINE's
 *    hash. (It was the raw `serverHash` with the outbox tracking a second copy of its own;
 *    #700 is what happens when those two disagree. Don't reintroduce a second copy.) The
 *    baseline freezes once the draft is touched, so the ~20s poll can't move it mid-edit.
 *  - `dirty = anyTouched && !!baseline && !draftsEqual(configDraft, baseline.draft)` — the
 *    `anyTouched` gate kills the post-save transient (a refetched server draft briefly ≠ the
 *    stale baseline before it re-seeds). This is the SAVE gate and it requires a baseline:
 *    no baseline means no concurrency base, so there is nothing safe to write against.
 *  - confirm-on-leave gates on `unsavedRisk`, NOT `dirty` — the two are deliberately
 *    asymmetric, because a needless prompt costs a tap while a missing one destroys work.
 *    Before the baseline freezes, divergence is unknowable, so leaving assumes the worst
 *    while saving stays blocked. Wired via latest-refs (guardDirty reads `showConfig`,
 *    which the overlay returns — a direct pass would be circular). Cancel bypasses this
 *    ref entirely (the overlay's `confirmDiscard`), so it still always leaves.
 *
 * The settings OVERLAY (`useGameSettingsOverlay`) stays in the view — several views open it
 * early (before `configDraft` exists) to publish the app-bar chrome. The view creates the
 * two latest-refs, passes them to the overlay's `isDirty`/`onDiscard`, and hands the hook
 * `showConfig` + the refs; the hook writes them (guardDirty sync) each render.
 */
export function useConfigDraft<D, B>(params: {
  tripId: string | undefined;
  gameId: string | null | undefined;
  view: DraftView;
  canEdit: boolean;
  /** The overlay's open flag + the two latest-refs the view passed to the overlay's
   *  `isDirty`/`onDiscard`. The hook writes them from `guardDirty` / `handleCancel`. */
  showConfig: boolean;
  dirtyRef: MutableRefObject<boolean>;
  discardRef: MutableRefObject<() => void>;
  /** True once the server data backing `serverConfigDraft` has loaded — the baseline won't
   *  freeze against empty defaults. (`serverHash` already gates this too; this is the extra
   *  per-view guard, e.g. `!!game`.) Defaults to true. */
  ready?: boolean;
  serverConfigDraft: D;
  configDraft: D;
  anyTouched: boolean;
  draftsEqual: (a: D, b: D) => boolean;
  toPayload: (draft: D, baseline: D) => SaveConfigPayload;
  /** The serializable outbox bundle (the view's slice values) + how to re-apply a recovered
   *  one to the slices, and how to reset all slices to untouched. `reset(committed)` is called
   *  with `true` after a successful Save and `false` on Cancel — match uses it to re-seed its
   *  matches slice from the just-SAVED set (no flash) vs the SERVER set (discard); the other
   *  three take no args and are assignable as-is (a 0-arg fn satisfies the 1-arg type). */
  bundle: B;
  applyRecovered: (b: B) => void;
  reset: (committed: boolean) => void;
  /** Refetch the view's own game/child queries after a Save so the baseline re-freezes on
   *  the new server state (the hook already refetches the config hash). */
  onSaved?: () => void | Promise<void>;
}) {
  const {
    tripId, gameId, view, canEdit, showConfig, dirtyRef, discardRef, ready = true,
    serverConfigDraft, configDraft, anyTouched, draftsEqual, toPayload,
    bundle, applyRecovered, reset, onSaved,
  } = params;

  // The server config hash — ONE value fed to BOTH the outbox base and Save's baseHash.
  const hashQ = trpc.games.configHash.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );
  const serverHash = hashQ.data?.hash;

  // Frozen baseline (+hash): the dirty reference AND the concurrency base, frozen the moment
  // the draft is touched so the poll can't move it mid-edit; re-frozen (self-healing) while
  // untouched as the server changes underneath.
  //
  // The guard is on ALREADY-FROZEN, not on `anyTouched`. It used to be the latter, which meant
  // a draft touched BEFORE `games.configHash` first resolved could never freeze a baseline at
  // all: the effect returned early on every subsequent run, so `baseline` stayed null for the
  // rest of the session, `dirty` stayed false, and Save was dead with no error — unrecoverable
  // short of a reload (which lost the edit, see the outbox note below). The settings UI paints
  // off `games.getById`, which lands in a DIFFERENT batch from `games.configHash`, so the panel
  // is interactive while the hash is still in flight; the exposed path is the common one
  // (GameRow deep-links an unconfigured game straight to `?settings=1`).
  //
  // Freezing LATE is still correct — `serverConfigDraft` is the server mirror, not the user's
  // edits — and the #18 invariant is unchanged: once `prev` exists and the draft is touched we
  // return it untouched, so the ~20s poll still can't move a live baseline mid-edit. `ready`
  // must cover EVERY query feeding the mirror (not just the game row), or the first freeze can
  // land on a half-loaded mirror and Save would then diff against it — clean-replacing groups
  // or matches the user never touched.
  const [baseline, setBaseline] = useState<{ draft: D; hash: string } | null>(null);
  useEffect(() => {
    if (!ready || !serverHash) return;
    setBaseline((prev) => {
      if (prev && anyTouched) return prev; // frozen — the poll must not move it (#18)
      return prev && prev.hash === serverHash && draftsEqual(prev.draft, serverConfigDraft)
        ? prev
        : { draft: serverConfigDraft, hash: serverHash };
    });
    // draftsEqual is a stable pure fn; react to the data inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyTouched, serverConfigDraft, serverHash, ready]);

  // SAVE gate — requires a real baseline: no baseline means no optimistic-concurrency
  // base, so there is nothing safe to write against. Unchanged.
  const dirty = anyTouched && !!baseline && !draftsEqual(configDraft, baseline.draft);

  // LEAVE gate — deliberately NOT the same predicate, because the two failures are not
  // symmetric. A prompt shown unnecessarily costs one tap; a prompt suppressed destroys
  // the user's edits with no warning. Between the first edit and the baseline freezing we
  // genuinely cannot tell whether the draft diverges from the server — so assume it does.
  // (Before the freeze fix above this was permanent; now it is only the load window, but
  // that window sits on the highest-traffic path: GameRow deep-links a not-yet-live game
  // straight to `?settings=1`, so an owner's first tap lands here with a cold hash.)
  // Conservative where it protects, unchanged where it could cause a bad write.
  const unsavedRisk = anyTouched && (!baseline || !draftsEqual(configDraft, baseline.draft));

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { if (anyTouched) setJustSaved(false); }, [anyTouched]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveConfigM = trpc.games.saveConfig.useMutation();

  // Hard-teardown durability (localStorage). Base = the frozen baseline's hash — literally the
  // SAME value Save sends as `baseHash`, so restore-vs-discard and the conflict check cannot
  // disagree. (It used to be the raw `serverHash`, tracked independently inside the outbox by
  // its own ref. Two mechanisms for one concept, and they diverged in exactly the window above:
  // with the hash unresolved the outbox was disabled, so its ref never advanced past its ""
  // seed and the edit was mirrored with `base: ""` — a fingerprint no server hash can ever
  // equal, so recovery took the stale branch and DELETED the entry. The durable layer erased
  // the very edit it exists to protect. One value, sourced from the baseline, removes that.)
  const { recover: recoverDraft, clear: clearDraftOutbox } = useDraftOutbox<B>({
    view,
    gameId: gameId ?? null,
    draft: bundle,
    touched: anyTouched,
    serverFingerprint: baseline?.hash ?? "",
    enabled: !!gameId && !!baseline,
  });
  const recoveredRef = useRef(false);
  useEffect(() => {
    // Gated on the BASELINE (not the raw hash): recovery compares the stored `base` against the
    // same frozen hash the outbox now writes, so both sides of the comparison share one source.
    if (recoveredRef.current || !baseline) return;
    recoveredRef.current = true;
    const r = recoverDraft();
    if (r) applyRecovered(r);
  }, [baseline, recoverDraft, applyRecovered]);

  /** Commit the draft. Returns `true` only when the write LANDED — the caller (the save
   *  bar) closes the panel on success and leaves it open (with the inline error) on
   *  failure. A no-op call (not dirty / already saving) returns `false`: nothing landed. */
  async function handleSave(): Promise<boolean> {
    if (!tripId || !gameId || !baseline || !dirty || saveConfigM.isPending) return false;
    setSaveError(null);
    try {
      await saveConfigM.mutateAsync({ tripId, gameId, baseHash: baseline.hash, payload: toPayload(configDraft, baseline.draft) });
    } catch (e) {
      setSaveError((e as { message?: string })?.message || "Couldn’t save your changes — try again.");
      return false;
    }
    clearDraftOutbox();
    reset(true);
    setJustSaved(true);
    await onSaved?.();
    void hashQ.refetch();
    return true;
  }
  function handleCancel() {
    reset(false);
    setSaveError(null);
    setJustSaved(false);
    clearDraftOutbox();
  }

  // Confirm-on-leave sync: gate the guard on the overlay being OPEN + editable — the
  // scoreboard underneath (and a member's read-only view) must never trap a back-press.
  // Written to the view's refs in an effect (not during render) so it stays pure; effects
  // flush before any back-press event can arrive. (The overlay itself lives in the view.)
  //
  // Reads `unsavedRisk`, NOT `dirty` — see the note at its definition. This only affects
  // the GUARDED exits (the ✕ and OS/browser back, which route through `closeConfig`).
  // Cancel is untouched: it calls the overlay's `confirmDiscard`, which sets the one-shot
  // force flag and closes directly without ever consulting this ref, so "Cancel always
  // leaves" keeps its meaning and cannot start prompting.
  const guardDirty = showConfig && canEdit && unsavedRisk;
  useEffect(() => {
    dirtyRef.current = guardDirty;
    discardRef.current = handleCancel;
  });

  return {
    dirty,
    baseline,
    justSaved,
    saveError,
    /** Exposed so a view's course-staging handlers can surface a course-load failure into
     *  the SAME error slot the Save uses (rack / stroke / match). */
    setSaveError,
    saving: saveConfigM.isPending,
    handleSave,
    handleCancel,
  };
}
