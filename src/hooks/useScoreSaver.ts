"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { outboxPut, outboxClear, outboxClearAll, outboxEntries } from "@/lib/scoreOutbox";
import { reconcileScores } from "@/lib/scoreReconcile";
import { isTerminalRefusal, refusalMessage, retryUnlessRefused } from "@/lib/terminalRefusal";
import { showToast } from "@/lib/toast";
import {
  scoreCellKey,
  type CellSaveState,
  type SaveStatusMap,
  type ScoreValues,
} from "@/components/games/types";

/**
 * useScoreSaver — the score-entry write path (Connectivity Layer 1).
 *
 * The on-course problem: a score posted at 1–2 bars used to fire-and-forget,
 * and on failure silently roll back to blank with no retry — the score just
 * vanished. This hook makes every save VISIBLE and RETRIED:
 *
 *  - Optimistic: the value lands in local state the instant it's tapped.
 *  - Retried: the upsert/delete mutations carry exponential backoff over a short
 *    window, so brief blips ("walked behind a tree") self-heal with no user
 *    action. The writes are idempotent (deterministic id
 *    `gameId:participantId:unitLabel`, upsert/onConflict), so a retry — or a
 *    double-tap — is always safe.
 *  - Visible on failure: when retries are exhausted, the entered value STAYS on
 *    screen and the cell is flagged `error` (never rolled back to blank), with a
 *    per-cell retry. Visible-and-flagged beats rolled-back-and-gone.
 *
 * CRITICAL: this never consults `navigator.onLine`. That flag lies at 1 bar
 * (reports online when requests will fail), so every write is simply attempted
 * and retried regardless — retry-everything beats trust-the-online-flag.
 *
 * Persistence lives here (the parent page hook), NOT inside the persistence-
 * agnostic scorecard components — they receive `values` + `saveStatus` as props
 * and emit through `onChange`/`onClear`/`onRetryCell`.
 *
 * Layer 2 (Spec 1a — durability): every entry is ALSO written to a small
 * localStorage `scoreOutbox` (keyed by the SAME idempotent id) BEFORE the write
 * settles, and cleared ONLY when the server confirms it (`saved`). So a nav /
 * reload / app-kill between "typed" and "confirmed" can't drop the score: on the
 * next mount `outboxEntries` is re-sent through this same idempotent path and
 * reflected in the UI as recovering. Scores only, cleared-on-confirm — not a
 * long-running offline queue.
 */

const MAX_RETRIES = 4;
/** 0.5s, 1s, 2s, 4s … capped at 8s — a few attempts over ~15s, then surface. */
const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

/**
 * Retry a blip; never retry a decision (#1230).
 *
 * This was a bare `retry: MAX_RETRIES`, which spent the full backoff on a 403
 * the server had already thought about — "This round is posted" is not going to
 * become true on the fourth attempt. Worse, the exhausted write stayed in the
 * durable outbox and was re-sent on EVERY subsequent mount, forever.
 *
 * The predicate itself is shared with `useOutcomeSaver` rather than copied —
 * see `terminalRefusal.ts`.
 */
const retry = retryUnlessRefused(MAX_RETRIES);

/**
 * How long a CONFIRMED cell stays protected from removal.
 *
 * `reconcileScores` now drops unprotected local cells the server doesn't have,
 * which is what makes a remote clear propagate. That creates one narrow race the
 * overlay-only merge didn't have: a score is saved and confirmed, so it leaves
 * both the outbox and the `saving` flag — and a scores response that was already
 * in flight, built BEFORE the write landed, arrives without it and would drop a
 * score the user just watched save. #15's "never roll back to blank" covers
 * exactly that, so a confirmed cell keeps its protection for a few seconds.
 *
 * Generous against the round-trip it guards (a fetch in flight), short against
 * the thing it delays (someone else's clear reaching this device). Not a
 * correctness knob: the cell is server truth either way once a fetch issued
 * after the write lands.
 */
const CONFIRM_GRACE_MS = 10_000;

export function useScoreSaver(
  tripId: string | undefined,
  gameId: string | null | undefined,
  // The scoring unit's type per write. Omitted → 'user' (singles/stroke — server
  // default). A constant tags every write (a uniform game). A RESOLVER
  // `(participantId) => type` tags each write by its own participant — needed by a
  // MIXED match-play game (A2a), where a 1v1 match writes 'user' entries and a 2v2
  // match writes 'play_group' entries in the SAME game. Memoize a resolver so the
  // callbacks stay identity-stable.
  participantType?:
    | "user"
    | "play_group"
    | ((participantId: string) => "user" | "play_group" | undefined),
  // Fired once a clear is CONFIRMED by the server. A cleared cell has no local
  // value to shadow the poll-loaded server snapshot with, so any OTHER surface
  // reading that snapshot (a match-list "THRU"/margin header, a scorecard grid)
  // stays stale until the next scheduled poll — up to GAME_SYNC_INTERVAL_MS.
  // The caller uses this to refetch that snapshot immediately instead of
  // waiting out the interval.
  onCleared?: () => void,
) {
  const typeOf = useCallback(
    (participantId: string): "user" | "play_group" | undefined =>
      typeof participantType === "function" ? participantType(participantId) : participantType,
    [participantType],
  );
  const [values, setValues] = useState<ScoreValues>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatusMap>({});
  /**
   * cellKey → the server's own sentence, for cells refused TERMINALLY (#1230).
   *
   * Deliberately a SEPARATE channel rather than a fourth `CellSaveState`. A
   * refused cell is still `error` for every existing reader, which is what keeps
   * `unconfirmedOnHole` / `unconfirmedCount` blocking Advance and Finish without
   * my having to remember to add a new state to each of them — a refused write
   * is NOT on the server, and `games.finish` computes standings from
   * `score_entries`, so letting one through would trade a visible failure for a
   * silently wrong result. This map is strictly extra information about a cell
   * that is already flagged, never a second answer to "did it save".
   */
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  // A live mirror of saveStatus so `reconcile` can read the latest without being
  // recreated on every status change (it must stay identity-stable — a view polls
  // scores and calls it in an effect keyed on the fetched data, not on this hook).
  // reconcile always runs from a post-commit effect, so the committed value is
  // current by then.
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  // cellKey → when the server confirmed it. Read by `reconcile` for the
  // CONFIRM_GRACE_MS protection; a ref because it must not re-render anything.
  const confirmedAtRef = useRef<Map<string, number>>(new Map());

  // suppressErrorToast: these own per-cell save UI (badge + banner), so the
  // global connectivity toast would double-signal — opt out of it.
  const upsertEntry = trpc.scores.upsertEntry.useMutation({
    retry,
    retryDelay,
    meta: { suppressErrorToast: true },
  });
  const deleteEntry = trpc.scores.deleteEntry.useMutation({
    retry,
    retryDelay,
    meta: { suppressErrorToast: true },
  });

  const mark = useCallback((key: string, state: CellSaveState | null) => {
    setSaveStatus((s) => {
      if (state === null) {
        if (!(key in s)) return s;
        const next = { ...s };
        delete next[key];
        return next;
      }
      if (s[key] === state) return s;
      return { ...s, [key]: state };
    });
  }, []);

  /**
   * Record why a cell will never save, or clear a stale reason.
   *
   * Called on every settle — success and failure — so a cell that is retried
   * after (say) the round is reopened does not keep a refusal string from the
   * attempt before.
   */
  const noteRefusal = useCallback((key: string, message: string | null) => {
    setRefusals((r) => {
      if (message === null) {
        if (!(key in r)) return r;
        const next = { ...r };
        delete next[key];
        return next;
      }
      if (r[key] === message) return r;
      return { ...r, [key]: message };
    });
  }, []);

  const onChange = useCallback(
    (participantId: string, unitLabel: string, value: number) => {
      if (!tripId || !gameId) return;
      const key = scoreCellKey(participantId, unitLabel);
      // Optimistic: show the number immediately.
      setValues((v) => ({
        ...v,
        [participantId]: { ...(v[participantId] ?? {}), [unitLabel]: value },
      }));
      mark(key, "saving");
      // Layer 2: persist to the durable outbox BEFORE the write settles, so a
      // nav/reload/kill in the gap can't lose it. Cleared on confirmation below.
      outboxPut(gameId, participantId, unitLabel, value);
      // mutateAsync — NOT mutate. Concurrent saves share ONE mutation observer,
      // and the inline mutate() callbacks fire only for the observer's CURRENT
      // (latest) mutation: a rapid foursome left every cell but the last
      // spinning forever, because the earlier saves' onSuccess never ran (their
      // mutation was no longer the one the observer tracked). Each mutateAsync
      // call resolves its OWN promise, so every cell flags its own status
      // independently. The writes themselves were never the problem — all of
      // them reach the server (idempotent upserts); this restores per-cell
      // STATUS only.
      upsertEntry
        .mutateAsync({ tripId, gameId, participantId, unitLabel, value, participantType: typeOf(participantId) })
        // Confirmed on the server → safe to drop the durable copy.
        .then(() => {
          mark(key, "saved");
          outboxClear(gameId, participantId, unitLabel);
          // A retry that succeeded (the round was reopened, say) must not keep
          // the reason it failed last time.
          noteRefusal(key, null);
          // Hands off to the CONFIRM_GRACE_MS protection as the outbox entry and
          // the `saving` flag both go — so the cell is never briefly unprotected.
          confirmedAtRef.current.set(key, Date.now());
        })
        /**
         * KEEP the optimistic value on failure — flag it, never roll back.
         *
         * The OUTBOX entry, though, depends on which failure it was (#1230).
         * Transient: keep it, and the next mount re-sends — that is the whole
         * point of Layer 2. TERMINAL: drop it, because re-sending a write the
         * server has already refused on its merits achieves nothing except
         * doing it again on every future mount, forever.
         *
         * The error object was previously discarded here (`.catch(() =>
         * mark(...))`), which is why the banner had nothing to say but "Retry".
         * The server's messages are written for a human and name a real action.
         */
        .catch((err: unknown) => {
          mark(key, "error");
          const refusal = refusalMessage(err);
          if (isTerminalRefusal(err)) outboxClear(gameId, participantId, unitLabel);
          noteRefusal(key, refusal);
        });
    },
    [tripId, gameId, upsertEntry, mark, noteRefusal, typeOf],
  );

  const onClear = useCallback(
    (participantId: string, unitLabel: string) => {
      if (!tripId || !gameId) return;
      const key = scoreCellKey(participantId, unitLabel);
      const prevValue = values[participantId]?.[unitLabel];
      // Optimistic removal.
      setValues((v) => {
        const row = { ...(v[participantId] ?? {}) };
        delete row[unitLabel];
        return { ...v, [participantId]: row };
      });
      mark(key, null);
      // A cleared cell has no pending upsert to recover — drop any outbox entry.
      outboxClear(gameId, participantId, unitLabel);
      // …and its confirmation, or the grace window would protect a cell we are
      // deliberately removing and the clear would bounce back on the next poll.
      confirmedAtRef.current.delete(key);
      // mutateAsync per call (see onChange): concurrent clears must each resolve
      // their own outcome, never be orphaned by a later one on the shared observer.
      deleteEntry
        .mutateAsync({ tripId, gameId, participantId, unitLabel, participantType: typeOf(participantId) })
        // Confirmed gone server-side — let the caller refresh whatever else
        // reads the poll-loaded snapshot (see `onCleared` above).
        .then(() => onCleared?.())
        // A failed delete means the value is still on the server — restore it
        // (accurate) and flag it so the user knows the clear didn't take.
        .catch((err: unknown) => {
          if (prevValue != null) {
            setValues((v) => ({
              ...v,
              [participantId]: {
                ...(v[participantId] ?? {}),
                [unitLabel]: prevValue,
              },
            }));
            mark(key, "error");
            // Same split as onChange: a refused DELETE (a posted round) is not
            // going to start succeeding either, so say why rather than offering
            // a Retry that cannot work. No outbox entry to drop — a clear never
            // has one.
            noteRefusal(key, refusalMessage(err));
          }
        });
    },
    [tripId, gameId, values, deleteEntry, mark, noteRefusal, typeOf, onCleared],
  );

  /**
   * Reconcile incoming SERVER score truth into the local view so a remote
   * device's entries reflect here (game-state sync), WITHOUT ever clobbering the
   * person actively entering (the #543 durable-outbox writes win locally).
   *
   * Semantics: take the server's cells as truth — EXCEPT protected cells, which
   * keep their local value. Protected means a local write the server hasn't
   * confirmed (`saving`/`error`, or still in the durable outbox) OR one confirmed
   * within CONFIRM_GRACE_MS. So a teammate's new/corrected score appears; a value
   * the enterer just saved is never overwritten or dropped by a poll that raced
   * the save.
   *
   * Removal included: an unprotected local cell the server doesn't have was
   * CLEARED elsewhere and goes. That used to be a documented gap — the merge only
   * overlaid, so a clear (expressed as absence) reached no other device until a
   * full exit and re-entry, the same asymmetry #807 hit on reset. It was
   * defensible while "never clobber the enterer" and "drop to server truth"
   * looked mutually exclusive; `protectedKeys` is what makes them compatible.
   *
   * This makes the payload's COMPLETENESS load-bearing: only ever pass the whole
   * game's scores (`scores.listByGame`), never a filtered subset, or the missing
   * cells read as deletions.
   *
   * Idempotent + safe every poll tick; with TanStack's structural sharing the
   * caller's effect only fires when the fetched scores actually change.
   */
  const reconcile = useCallback(
    (server: ScoreValues) => {
      setValues((cur) => {
        // Protect cells with an unconfirmed local write — flagged saving/error, or
        // still in the durable outbox (#543) — so the active enterer always wins.
        const protectedKeys = new Set<string>();
        for (const [k, st] of Object.entries(saveStatusRef.current)) {
          if (st === "saving" || st === "error") protectedKeys.add(k);
        }
        if (gameId) {
          for (const e of outboxEntries(gameId)) {
            protectedKeys.add(scoreCellKey(e.participantId, e.unitLabel));
          }
        }
        // Just-confirmed cells (see CONFIRM_GRACE_MS) — the server has them, but a
        // response already in flight when the write landed wouldn't. Pruned as we
        // go so the map can't grow for the life of the round.
        const now = Date.now();
        for (const [k, at] of confirmedAtRef.current) {
          if (now - at < CONFIRM_GRACE_MS) protectedKeys.add(k);
          else confirmedAtRef.current.delete(k);
        }
        return reconcileScores(cur, server, protectedKeys);
      });
    },
    [gameId],
  );

  /** Re-fire the save for a flagged cell using its current value. */
  const retryCell = useCallback(
    (participantId: string, unitLabel: string) => {
      const value = values[participantId]?.[unitLabel];
      if (value == null) return;
      onChange(participantId, unitLabel, value);
    },
    [values, onChange],
  );

  // Recover-on-mount (Layer 2): any entries still in the outbox are unconfirmed
  // (a prior nav/reload/kill left them un-acked). Re-send each through the same
  // idempotent path — which re-marks it `saving`, re-optimistically shows the
  // value, and clears the outbox on confirmation. Runs ONCE per game (the ref
  // guards against re-runs when onChange's identity churns). This is what makes a
  // dropped-on-the-course score come BACK on return instead of vanishing.
  const recoveredForGame = useRef<string | null>(null);
  useEffect(() => {
    if (!tripId || !gameId) return;
    if (recoveredForGame.current === gameId) return;
    recoveredForGame.current = gameId;
    const pending = outboxEntries(gameId);
    if (pending.length === 0) return;
    // Defer the re-send out of the effect body (each onChange setStates; a
    // microtask keeps it off the synchronous effect path). One tick's delay is
    // immaterial for recovering already-unconfirmed writes.
    const t = setTimeout(() => {
      for (const e of pending) onChange(e.participantId, e.unitLabel, e.value);
      // Honest UI: tell the user their scores survived and are being re-sent.
      showToast(
        `Recovered ${pending.length} unsaved score${pending.length > 1 ? "s" : ""} — retrying`,
        "info",
      );
    }, 0);
    return () => clearTimeout(t);
  }, [tripId, gameId, onChange]);

  const errorCount = Object.values(saveStatus).filter(
    (s) => s === "error",
  ).length;

  /**
   * Wipe every score this hook is holding — local values, per-cell save status,
   * and the durable outbox.
   *
   * For the Danger-zone reset, and ONLY that. `reconcileScores` cannot express
   * this: it starts from `local` and only ever OVERLAYS server values on top, so
   * a cell present locally and absent from the server survives. That asymmetry is
   * deliberate and load-bearing — it is what protects the active enterer's
   * in-flight cells (#15/#16) — but it means the server's answer to "what are the
   * scores" cannot be "none", because that answer is expressed by ABSENCE and
   * absence is precisely what the overlay ignores.
   *
   * So resetting invalidated everything correctly, refetched an empty set, merged
   * nothing, and left every score on screen until the view remounted. Which is
   * exactly the reported symptom: leave the game and come back and it is right.
   *
   * The outbox wipe is not optional. Without it `outboxEntries` would re-send the
   * survivors on the next mount and undo the reset a second time.
   */
  const clearAll = useCallback(() => {
    setValues({});
    setSaveStatus({});
    // The refusal reasons go with the cells they were about (#1230) — a reset
    // clears the scores, so a sentence explaining why one of them wouldn't save
    // would outlive its subject.
    setRefusals({});
    if (gameId) outboxClearAll(gameId);
  }, [gameId]);

  return {
    values,
    setValues,
    clearAll,
    saveStatus,
    /** cellKey → the server's own sentence, for TERMINALLY refused cells (#1230).
     *  Empty for the ordinary transient failure, where "Retry" is the right
     *  advice and a raw transport message would be worse than none. */
    refusals,
    errorCount,
    onChange,
    onClear,
    retryCell,
    reconcile,
  };
}
