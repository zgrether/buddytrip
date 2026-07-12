"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { outboxPut, outboxClear, outboxEntries } from "@/lib/scoreOutbox";
import { reconcileScores } from "@/lib/scoreReconcile";
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
  // A live mirror of saveStatus so `reconcile` can read the latest without being
  // recreated on every status change (it must stay identity-stable — a view polls
  // scores and calls it in an effect keyed on the fetched data, not on this hook).
  // reconcile always runs from a post-commit effect, so the committed value is
  // current by then.
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  // suppressErrorToast: these own per-cell save UI (badge + banner), so the
  // global connectivity toast would double-signal — opt out of it.
  const upsertEntry = trpc.scores.upsertEntry.useMutation({
    retry: MAX_RETRIES,
    retryDelay,
    meta: { suppressErrorToast: true },
  });
  const deleteEntry = trpc.scores.deleteEntry.useMutation({
    retry: MAX_RETRIES,
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
        })
        // KEEP the optimistic value AND the outbox entry on failure — flag it,
        // never roll back; the outbox re-sends it on the next mount.
        .catch(() => mark(key, "error"));
    },
    [tripId, gameId, upsertEntry, mark, typeOf],
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
      // mutateAsync per call (see onChange): concurrent clears must each resolve
      // their own outcome, never be orphaned by a later one on the shared observer.
      deleteEntry
        .mutateAsync({ tripId, gameId, participantId, unitLabel, participantType: typeOf(participantId) })
        // Confirmed gone server-side — let the caller refresh whatever else
        // reads the poll-loaded snapshot (see `onCleared` above).
        .then(() => onCleared?.())
        // A failed delete means the value is still on the server — restore it
        // (accurate) and flag it so the user knows the clear didn't take.
        .catch(() => {
          if (prevValue != null) {
            setValues((v) => ({
              ...v,
              [participantId]: {
                ...(v[participantId] ?? {}),
                [unitLabel]: prevValue,
              },
            }));
            mark(key, "error");
          }
        });
    },
    [tripId, gameId, values, deleteEntry, mark, typeOf, onCleared],
  );

  /**
   * Reconcile incoming SERVER score truth into the local view so a remote
   * device's entries reflect here (game-state sync), WITHOUT ever clobbering the
   * person actively entering (the #543 durable-outbox writes win locally).
   *
   * Semantics: keep every local cell, then OVERLAY the server's value for each
   * cell the server has — EXCEPT cells with an unconfirmed local write (flagged
   * `saving`/`error`, or still in the durable outbox), which keep their local
   * value. So a teammate's new/corrected score appears; a value the enterer just
   * saved is never overwritten by a poll that raced the save (a server response
   * lacking that cell can't drop it — overlay only SETS server-present cells).
   *
   * Deliberate gap: a score DELETED on another device isn't removed here (its
   * cell is simply absent from the server payload, and we never drop a local
   * cell). Reflecting adds/edits is the requirement; never-clobber-the-enterer is
   * the hard rule, and full drop-to-server-truth couldn't guarantee both. Remote
   * clears are rare and self-correct on the next real edit or a reopen.
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

  return {
    values,
    setValues,
    saveStatus,
    errorCount,
    onChange,
    onClear,
    retryCell,
    reconcile,
  };
}
