"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { outcomeOutboxPut, outcomeOutboxClear, outcomeOutboxEntries } from "@/lib/outcomeOutbox";
import { reconcileOutcomes } from "@/lib/outcomeReconcile";
import { isTerminalRefusal, refusalMessage, retryUnlessRefused } from "@/lib/terminalRefusal";
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

/** Retry a blip; never retry a decision (#1230) — the SAME predicate
 *  `useScoreSaver` uses, imported rather than re-derived. */
const retry = retryUnlessRefused(MAX_RETRIES);

export function useOutcomeSaver(
  tripId: string | undefined,
  gameId: string | null | undefined,
  // Fired once a clear (Reset hole) is CONFIRMED by the server — mirrors
  // useScoreSaver's `onCleared`. A cleared hole has no local value to shadow
  // the poll-loaded server snapshot with, so the match-list/scorecard
  // surfaces that read `mergedOutcomeFor` stay on the pre-reset result until
  // the next scheduled poll; the caller uses this to refetch immediately.
  onCleared?: () => void,
) {
  const [values, setValues] = useState<OutcomeValues>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatusMap>({});
  /** cellKey → the server's own sentence for a TERMINAL refusal (#1230). A
   *  separate channel, not a fourth `CellSaveState`: the cell stays `error` so
   *  every existing gate keeps blocking. See `useScoreSaver` for the argument. */
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const upsertOutcome = trpc.matchOutcomes.upsertOutcome.useMutation({
    retry,
    retryDelay,
    meta: { suppressErrorToast: true },
  });
  const deleteOutcome = trpc.matchOutcomes.deleteOutcome.useMutation({
    retry,
    retryDelay,
    meta: { suppressErrorToast: true },
  });

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
          noteRefusal(key, null);
        })
        // Terminal → drop the outbox entry, or it is re-sent on every mount
        // forever against a server that has already refused it (#1230).
        .catch((err: unknown) => {
          mark(key, "error");
          if (isTerminalRefusal(err)) outcomeOutboxClear(gameId, matchId, Number(hole));
          noteRefusal(key, refusalMessage(err));
        });
    },
    [tripId, gameId, upsertOutcome, mark, noteRefusal],
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
        // Confirmed gone server-side — let the caller refresh whatever else
        // reads the poll-loaded snapshot (see `onCleared` above).
        .then(() => onCleared?.())
        .catch((err: unknown) => {
          if (prevValue != null) {
            setValues((v) => ({
              ...v,
              [matchId]: { ...(v[matchId] ?? {}), [hole]: prevValue },
            }));
            mark(key, "error");
            noteRefusal(key, refusalMessage(err));
          }
        });
    },
    [tripId, gameId, values, deleteOutcome, mark, noteRefusal, onCleared],
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
    /** cellKey → the server's own sentence for TERMINALLY refused holes (#1230). */
    refusals,
    errorCount,
    onChange,
    onClear,
    retryCell,
    reconcile,
  };
}
