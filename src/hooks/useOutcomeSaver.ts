"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { outcomeOutboxPut, outcomeOutboxClear, outcomeOutboxEntries } from "@/lib/outcomeOutbox";
import { reconcileOutcomes, outcomeOverwrites, type OutcomeOverwrite } from "@/lib/outcomeReconcile";
import { CONFIRM_GRACE_MS } from "@/lib/cellReconcile";
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
  // Fired when a hole THIS device entered has been overwritten by a different
  // value (or cleared) on another device — #1437's notice. The hook decides
  // WHEN (pure: `outcomeOverwrites`); the caller owns the words, since only it
  // knows the sides' names.
  onOverwritten?: (overwrites: OutcomeOverwrite[]) => void,
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
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  /** cellKey → when this device's write was CONFIRMED. Protected for
   *  CONFIRM_GRACE_MS so a response already in flight when the write landed
   *  cannot revert it — the same guard useScoreSaver has (#1437). */
  const confirmedAtRef = useRef<Map<string, number>>(new Map());
  /** Keys this device entered and still holds — the only holes an overwrite
   *  notice can be about. A hole this device only watched stays silent. */
  const enteredRef = useRef<Set<string>>(new Set());

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
          confirmedAtRef.current.set(key, Date.now());
          enteredRef.current.add(key);
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
      confirmedAtRef.current.delete(key);
      enteredRef.current.delete(key);
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

  /**
   * Reflect server outcome truth into the local view without clobbering the
   * active enterer — useScoreSaver.reconcile's contract, now actually called
   * (#1437: MatchGameView never took it, so a tap overrode the server for the
   * life of the view and two phones stayed out of sync indefinitely).
   *
   * Protected: saving / error, in the outbox, or confirmed within
   * CONFIRM_GRACE_MS. Everything else is server truth — including REMOVAL of a
   * hole cleared on another device. `server` must be the game's complete set.
   *
   * The overwrite decision is made against `valuesRef` BEFORE the merge, and
   * each reported key leaves `enteredRef` at once — so a second call with the
   * same snapshot (StrictMode, a re-render) reports nothing twice.
   */
  const reconcile = useCallback(
    (server: OutcomeValues) => {
      const protectedKeys = new Set<string>();
      for (const [k, st] of Object.entries(saveStatusRef.current)) {
        if (st === "saving" || st === "error") protectedKeys.add(k);
      }
      if (gameId) {
        for (const e of outcomeOutboxEntries(gameId)) {
          protectedKeys.add(outcomeCellKey(e.matchId, e.holeNumber));
        }
      }
      const now = Date.now();
      for (const [k, at] of confirmedAtRef.current) {
        if (now - at < CONFIRM_GRACE_MS) protectedKeys.add(k);
        else confirmedAtRef.current.delete(k);
      }

      const overwrites = outcomeOverwrites(valuesRef.current, server, protectedKeys, enteredRef.current);
      for (const o of overwrites) enteredRef.current.delete(outcomeCellKey(o.matchId, o.hole));

      setValues((cur) => reconcileOutcomes(cur, server, protectedKeys));
      if (overwrites.length > 0) onOverwritten?.(overwrites);
    },
    [gameId, onOverwritten],
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
