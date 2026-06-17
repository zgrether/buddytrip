"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc-client";
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
 * This is Layer 1 (visibility + retry). It deliberately does NOT persist the
 * mutation across an app-kill or flush a queue on reconnect — that is Layer 2
 * (the persisted write-queue), a separate follow-on.
 */

const MAX_RETRIES = 4;
/** 0.5s, 1s, 2s, 4s … capped at 8s — a few attempts over ~15s, then surface. */
const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

export function useScoreSaver(
  tripId: string | undefined,
  gameId: string | null | undefined,
) {
  const [values, setValues] = useState<ScoreValues>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatusMap>({});

  const upsertEntry = trpc.scores.upsertEntry.useMutation({
    retry: MAX_RETRIES,
    retryDelay,
  });
  const deleteEntry = trpc.scores.deleteEntry.useMutation({
    retry: MAX_RETRIES,
    retryDelay,
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
      upsertEntry.mutate(
        { tripId, gameId, participantId, unitLabel, value },
        {
          onSuccess: () => mark(key, "saved"),
          // KEEP the optimistic value — flag it, never roll back to blank.
          onError: () => mark(key, "error"),
        },
      );
    },
    [tripId, gameId, upsertEntry, mark],
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
      deleteEntry.mutate(
        { tripId, gameId, participantId, unitLabel },
        {
          // A failed delete means the value is still on the server — restore it
          // (accurate) and flag it so the user knows the clear didn't take.
          onError: () => {
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
          },
        },
      );
    },
    [tripId, gameId, values, deleteEntry, mark],
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
  };
}
