"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { outcomeOutboxPut, outcomeOutboxClear, outcomeOutboxEntries } from "@/lib/outcomeOutbox";
import { reconcileOutcomes } from "@/lib/outcomeReconcile";
import { showToast } from "@/lib/toast";
import {
  outcomeCellKey,
  type CellSaveState,
  type SaveStatusMap,
  type OutcomeValues,
} from "@/components/games/types";
import type { HoleOutcomeResult } from "@/lib/matchPlay";

/**
 * useOutcomeSaver — the hole-outcome-entry write path (Refactor B2), the outcome
 * counterpart to `useScoreSaver`. One tap records a WHOLE hole (no per-player
 * cells) — every mechanic below mirrors useScoreSaver's durability contract
 * exactly (optimistic → durable outbox → retried → visible-on-failure), just
 * keyed by match+hole instead of participant+unit. See useScoreSaver's header
 * comment for the full rationale (never consults navigator.onLine, etc.) — not
 * re-explained here since it's identical.
 */

const MAX_RETRIES = 4;
const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

export function useOutcomeSaver(tripId: string | undefined, gameId: string | null | undefined) {
  const [values, setValues] = useState<OutcomeValues>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatusMap>({});
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const upsertOutcome = trpc.matchOutcomes.upsertOutcome.useMutation({
    retry: MAX_RETRIES,
    retryDelay,
    meta: { suppressErrorToast: true },
  });
  const deleteOutcome = trpc.matchOutcomes.deleteOutcome.useMutation({
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
    (matchId: string, hole: string, result: HoleOutcomeResult) => {
      if (!tripId || !gameId) return;
      const key = outcomeCellKey(matchId, Number(hole));
      setValues((v) => ({
        ...v,
        [matchId]: { ...(v[matchId] ?? {}), [hole]: result },
      }));
      mark(key, "saving");
      outcomeOutboxPut(gameId, matchId, Number(hole), result);
      upsertOutcome
        .mutateAsync({ tripId, gameId, matchId, holeNumber: Number(hole), result })
        .then(() => {
          mark(key, "saved");
          outcomeOutboxClear(gameId, matchId, Number(hole));
        })
        .catch(() => mark(key, "error"));
    },
    [tripId, gameId, upsertOutcome, mark],
  );

  const onClear = useCallback(
    (matchId: string, hole: string) => {
      if (!tripId || !gameId) return;
      const key = outcomeCellKey(matchId, Number(hole));
      const prevValue = values[matchId]?.[hole];
      setValues((v) => {
        const row = { ...(v[matchId] ?? {}) };
        delete row[hole];
        return { ...v, [matchId]: row };
      });
      mark(key, null);
      outcomeOutboxClear(gameId, matchId, Number(hole));
      deleteOutcome
        .mutateAsync({ tripId, gameId, matchId, holeNumber: Number(hole) })
        .catch(() => {
          if (prevValue != null) {
            setValues((v) => ({
              ...v,
              [matchId]: { ...(v[matchId] ?? {}), [hole]: prevValue },
            }));
            mark(key, "error");
          }
        });
    },
    [tripId, gameId, values, deleteOutcome, mark],
  );

  /** Reflect server outcome truth into the local view without clobbering the
   *  active enterer — same contract as useScoreSaver.reconcile. */
  const reconcile = useCallback(
    (server: OutcomeValues) => {
      setValues((cur) => {
        const protectedKeys = new Set<string>();
        for (const [k, st] of Object.entries(saveStatusRef.current)) {
          if (st === "saving" || st === "error") protectedKeys.add(k);
        }
        if (gameId) {
          for (const e of outcomeOutboxEntries(gameId)) {
            protectedKeys.add(outcomeCellKey(e.matchId, e.holeNumber));
          }
        }
        return reconcileOutcomes(cur, server, protectedKeys);
      });
    },
    [gameId],
  );

  /** Re-fire the save for a flagged cell using its current value. */
  const retryCell = useCallback(
    (matchId: string, hole: string) => {
      const value = values[matchId]?.[hole];
      if (value == null) return;
      onChange(matchId, hole, value);
    },
    [values, onChange],
  );

  // Recover-on-mount: any entries still in the outbox are unconfirmed (a prior
  // nav/reload/kill left them un-acked) — re-send through the same idempotent
  // path. Runs once per game.
  const recoveredForGame = useRef<string | null>(null);
  useEffect(() => {
    if (!tripId || !gameId) return;
    if (recoveredForGame.current === gameId) return;
    recoveredForGame.current = gameId;
    const pending = outcomeOutboxEntries(gameId);
    if (pending.length === 0) return;
    const t = setTimeout(() => {
      for (const e of pending) onChange(e.matchId, String(e.holeNumber), e.result);
      showToast(
        `Recovered ${pending.length} unsaved outcome${pending.length > 1 ? "s" : ""} — retrying`,
        "info",
      );
    }, 0);
    return () => clearTimeout(t);
  }, [tripId, gameId, onChange]);

  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;

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
