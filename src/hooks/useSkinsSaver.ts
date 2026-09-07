"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { skinsOutboxPut, skinsOutboxClear, skinsOutboxEntries } from "@/lib/skinsOutbox";
import { isTerminalRefusal, refusalMessage, retryUnlessRefused } from "@/lib/terminalRefusal";
import { showToast } from "@/lib/toast";
import { skinsCellKey } from "@/components/games/skins/SkinsEntryView";
import type { CellSaveState } from "@/components/games/types";
import type { SkinsOutcomeRow } from "@/lib/skins";

/**
 * useSkinsSaver — the skins write path, the third sibling of `useScoreSaver` and
 * `useOutcomeSaver`.
 *
 * Same durability contract as both (CLAUDE.md #15): optimistic local value →
 * durable outbox written BEFORE the mutation settles → retried on a blip, never
 * on a decision → visible on failure, and NEVER rolled back to blank. See
 * `useScoreSaver`'s header for the full rationale; it is identical and is not
 * re-argued here.
 *
 * ── The local shape is the ENGINE's, not a display map ────────────────────
 *
 * `useOutcomeSaver` keeps a `Record<matchId, Record<holeLabel, result>>` because
 * that is what its view renders. This keeps `Record<groupingId,
 * SkinsOutcomeRow[]>` — the exact input `tallyGrouping` takes — so the entry
 * screen, the board and the scorecard all fold the same rows and there is no
 * second shape to convert between. A carryover pot depends on every hole behind
 * it, so a per-cell map would have to be re-assembled into this on every render
 * anyway.
 *
 * ── The active enterer wins ───────────────────────────────────────────────
 *
 * `reconcile` overlays the server's rows EXCEPT for cells that are in flight,
 * errored, or still in the outbox — the same protected-keys rule score entry
 * uses, and the contract the sync loop depends on.
 */

const MAX_RETRIES = 4;
const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);
const retry = retryUnlessRefused(MAX_RETRIES);

/** groupingId → its recorded holes, the shape the pure fold consumes. */
export type SkinsRows = Record<string, SkinsOutcomeRow[]>;

function upsertRow(rows: SkinsOutcomeRow[], next: SkinsOutcomeRow): SkinsOutcomeRow[] {
  const out = rows.filter((r) => r.hole !== next.hole);
  out.push(next);
  out.sort((a, b) => a.hole - b.hole);
  return out;
}

export function useSkinsSaver(
  tripId: string | undefined,
  gameId: string | null | undefined,
  /** Fired once a clear is CONFIRMED — a cleared hole has no local value left to
   *  shadow the server snapshot with, so the caller refetches immediately rather
   *  than waiting for the poll. Mirrors `useOutcomeSaver.onCleared`. */
  onCleared?: () => void
) {
  const [rows, setRows] = useState<SkinsRows>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, CellSaveState>>({});
  /** cellKey → the server's own sentence for a TERMINAL refusal (#1230). A
   *  separate channel, not a fourth `CellSaveState`: the cell stays `error`, so
   *  every existing gate keeps blocking. */
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const upsertHole = trpc.skinsOutcomes.upsertHole.useMutation({
    retry,
    retryDelay,
    meta: { suppressErrorToast: true },
  });
  const clearHoleMut = trpc.skinsOutcomes.clearHole.useMutation({
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
    (groupingId: string, hole: number, result: "won" | "tied", winnerId: string | null) => {
      if (!tripId || !gameId) return;
      const key = skinsCellKey(groupingId, hole);
      setRows((v) => ({ ...v, [groupingId]: upsertRow(v[groupingId] ?? [], { hole, result, winnerId }) }));
      mark(key, "saving");
      // Durable BEFORE the mutation settles — the whole point of the outbox is
      // that a kill between the tap and the ack does not lose the hole.
      skinsOutboxPut(gameId, { groupingId, holeNumber: hole, result, winnerId });
      upsertHole
        .mutateAsync({ tripId, gameId, groupingId, holeNumber: hole, result, winnerId })
        .then(() => {
          mark(key, "saved");
          skinsOutboxClear(gameId, groupingId, hole);
          noteRefusal(key, null);
        })
        .catch((err: unknown) => {
          // Never roll back to blank — the value stays and the cell is flagged.
          mark(key, "error");
          // Terminal → drop the outbox entry, or it is re-sent on every mount
          // forever against a server that has already refused it (#1230).
          if (isTerminalRefusal(err)) skinsOutboxClear(gameId, groupingId, hole);
          noteRefusal(key, refusalMessage(err));
        });
    },
    [tripId, gameId, upsertHole, mark, noteRefusal]
  );

  const onClear = useCallback(
    (groupingId: string, hole: number) => {
      if (!tripId || !gameId) return;
      const key = skinsCellKey(groupingId, hole);
      const prev = (rows[groupingId] ?? []).find((r) => r.hole === hole);
      setRows((v) => ({ ...v, [groupingId]: (v[groupingId] ?? []).filter((r) => r.hole !== hole) }));
      mark(key, null);
      skinsOutboxClear(gameId, groupingId, hole);
      clearHoleMut
        .mutateAsync({ tripId, gameId, groupingId, holeNumber: hole })
        .then(() => onCleared?.())
        .catch((err: unknown) => {
          if (prev) {
            setRows((v) => ({ ...v, [groupingId]: upsertRow(v[groupingId] ?? [], prev) }));
            mark(key, "error");
            noteRefusal(key, refusalMessage(err));
          }
        });
    },
    [tripId, gameId, rows, clearHoleMut, mark, noteRefusal, onCleared]
  );

  /**
   * Overlay the server's rows without clobbering the active enterer.
   *
   * A protected cell is one that is saving, errored, or still in the outbox —
   * the union score entry uses. Note this is per HOLE, not per grouping: a
   * teammate's confirmed hole 4 must land even while my hole 5 is in flight, and
   * dropping the whole grouping would hide it.
   */
  const reconcile = useCallback(
    (server: SkinsRows) => {
      setRows((cur) => {
        const protectedKeys = new Set<string>();
        for (const [k, st] of Object.entries(saveStatusRef.current)) {
          if (st === "saving" || st === "error") protectedKeys.add(k);
        }
        if (gameId) {
          for (const e of skinsOutboxEntries(gameId)) {
            protectedKeys.add(skinsCellKey(e.groupingId, e.holeNumber));
          }
        }
        const next: SkinsRows = {};
        const groupingIds = new Set([...Object.keys(cur), ...Object.keys(server)]);
        for (const gid of groupingIds) {
          const serverRows = server[gid] ?? [];
          const localRows = cur[gid] ?? [];
          const kept = localRows.filter((r) => protectedKeys.has(skinsCellKey(gid, r.hole)));
          const keptHoles = new Set(kept.map((r) => r.hole));
          next[gid] = [...serverRows.filter((r) => !keptHoles.has(r.hole)), ...kept].sort(
            (a, b) => a.hole - b.hole
          );
        }
        return next;
      });
    },
    [gameId]
  );

  /** Re-fire the save for a flagged cell using its current value. */
  const retryCell = useCallback(
    (groupingId: string, hole: number) => {
      const row = (rows[groupingId] ?? []).find((r) => r.hole === hole);
      if (!row) return;
      onChange(groupingId, hole, row.result, row.winnerId);
    },
    [rows, onChange]
  );

  // Recover-on-mount: anything still in the outbox is unconfirmed (a prior
  // nav/reload/kill left it un-acked) — re-send through the same idempotent
  // path. Once per game.
  const recoveredForGame = useRef<string | null>(null);
  useEffect(() => {
    if (!tripId || !gameId) return;
    if (recoveredForGame.current === gameId) return;
    recoveredForGame.current = gameId;
    const pending = skinsOutboxEntries(gameId);
    if (pending.length === 0) return;
    const t = setTimeout(() => {
      for (const e of pending) onChange(e.groupingId, e.holeNumber, e.result, e.winnerId);
      showToast(
        `Recovered ${pending.length} unsaved hole${pending.length > 1 ? "s" : ""} — retrying`,
        "info"
      );
    }, 0);
    return () => clearTimeout(t);
  }, [tripId, gameId, onChange]);

  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;
  const savingCount = Object.values(saveStatus).filter((s) => s === "saving").length;

  return {
    rows,
    setRows,
    saveStatus,
    refusals,
    errorCount,
    savingCount,
    onChange,
    onClear,
    retryCell,
    reconcile,
  };
}
