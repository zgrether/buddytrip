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
 * Invariants preserved verbatim from the hand-rolled copies:
 *  - ONE `serverHash` value feeds BOTH the outbox `base` and Save's `baseHash`, frozen on
 *    the `!anyTouched` transition so the ~20s poll can't move it mid-edit.
 *  - `dirty = anyTouched && !!baseline && !draftsEqual(configDraft, baseline.draft)` — the
 *    `anyTouched` gate kills the post-save transient (a refetched server draft briefly ≠ the
 *    stale baseline before it re-seeds).
 *  - confirm-on-leave gates on `showConfig && canEdit && dirty` via latest-refs (guardDirty
 *    reads `showConfig`, which the overlay returns — a direct pass would be circular).
 *
 * The settings OVERLAY (`useGameSettingsOverlay`) stays in the view — several views open it
 * early (before `configDraft` exists) to publish the app-bar chrome. The view creates the
 * two latest-refs, passes them to the overlay's `isDirty`/`onDiscard`, and hands the hook
 * `showConfig` + the refs; the hook writes them (guardDirty sync) once `dirty` is known.
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
  const [baseline, setBaseline] = useState<{ draft: D; hash: string } | null>(null);
  useEffect(() => {
    if (anyTouched || !ready || !serverHash) return;
    setBaseline((prev) =>
      prev && prev.hash === serverHash && draftsEqual(prev.draft, serverConfigDraft)
        ? prev
        : { draft: serverConfigDraft, hash: serverHash },
    );
    // draftsEqual is a stable pure fn; react to the data inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyTouched, serverConfigDraft, serverHash, ready]);

  const dirty = anyTouched && !!baseline && !draftsEqual(configDraft, baseline.draft);

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { if (anyTouched) setJustSaved(false); }, [anyTouched]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveConfigM = trpc.games.saveConfig.useMutation();

  // Hard-teardown durability (localStorage). Base = the SAME serverHash the baseline freezes
  // on, so restore-vs-discard and Save's conflict check can't disagree.
  const { recover: recoverDraft, clear: clearDraftOutbox } = useDraftOutbox<B>({
    view,
    gameId: gameId ?? null,
    draft: bundle,
    touched: anyTouched,
    serverFingerprint: serverHash ?? "",
    enabled: !!gameId && !!serverHash,
  });
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current || !serverHash) return;
    recoveredRef.current = true;
    const r = recoverDraft();
    if (r) applyRecovered(r);
  }, [serverHash, recoverDraft, applyRecovered]);

  async function handleSave() {
    if (!tripId || !gameId || !baseline || !dirty || saveConfigM.isPending) return;
    setSaveError(null);
    try {
      await saveConfigM.mutateAsync({ tripId, gameId, baseHash: baseline.hash, payload: toPayload(configDraft, baseline.draft) });
    } catch (e) {
      setSaveError((e as { message?: string })?.message || "Couldn’t save your changes — try again.");
      return;
    }
    clearDraftOutbox();
    reset(true);
    setJustSaved(true);
    await onSaved?.();
    void hashQ.refetch();
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
  const guardDirty = showConfig && canEdit && dirty;
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
