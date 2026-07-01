"use client";

import { scoreCellKey, parseScoreCellKey } from "@/components/games/types";

/**
 * scoreOutbox — a tiny write-ahead log for score entries (Spec 1a, the missing
 * "Layer 2"). DURABILITY, not offline-first: it covers only the gap between "the
 * score was typed" and "the server confirmed the write", so a nav / reload /
 * app-kill on poor signal can't silently drop an unconfirmed score.
 *
 * Shape: localStorage, one entry-map per game (namespaced key), entries keyed by
 * the SAME idempotent `scoreCellKey(participantId, unitLabel)` the saver + server
 * upsert already use — one id scheme, one home. An entry is written on score
 * entry and cleared ONLY when the server CONFIRMS that write (`saved`); on failure
 * it stays, so on the next mount it's re-sent (idempotent upsert → safe). If the
 * same cell is re-entered before confirmation the map holds the latest value
 * (last-write-wins locally, matching the idempotent upsert). Scores only,
 * cleared-on-confirm — no sync engine, no conflict resolution, no long-running
 * queue.
 *
 * The map operations are pure (testable without a DOM); the localStorage wrappers
 * are thin and best-effort (a disabled/full store degrades to no-op, never throws
 * into the score path).
 */

/** { [scoreCellKey]: value } — the persisted unconfirmed writes for one game. */
export type OutboxMap = Record<string, number>;
export interface OutboxEntry {
  participantId: string;
  unitLabel: string;
  value: number;
}

// ── Pure map ops (unit-tested) ───────────────────────────────────────────────
export function putIn(map: OutboxMap, participantId: string, unitLabel: string, value: number): OutboxMap {
  return { ...map, [scoreCellKey(participantId, unitLabel)]: value };
}
export function clearIn(map: OutboxMap, participantId: string, unitLabel: string): OutboxMap {
  const key = scoreCellKey(participantId, unitLabel);
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}
export function entriesOf(map: OutboxMap): OutboxEntry[] {
  return Object.entries(map).map(([key, value]) => ({ ...parseScoreCellKey(key), value }));
}

// ── localStorage wrappers (best-effort, SSR-safe) ────────────────────────────
const NS = "bt.scoreOutbox.v1";
const storeKey = (gameId: string) => `${NS}:${gameId}`;

function read(gameId: string): OutboxMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storeKey(gameId));
    return raw ? (JSON.parse(raw) as OutboxMap) : {};
  } catch {
    return {};
  }
}
function write(gameId: string, map: OutboxMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(storeKey(gameId));
    else window.localStorage.setItem(storeKey(gameId), JSON.stringify(map));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into scoring. */
  }
}

/** Persist an unconfirmed score (on entry). */
export function outboxPut(gameId: string, participantId: string, unitLabel: string, value: number): void {
  write(gameId, putIn(read(gameId), participantId, unitLabel, value));
}
/** Remove a score from the outbox (on server confirmation, or on clear). */
export function outboxClear(gameId: string, participantId: string, unitLabel: string): void {
  write(gameId, clearIn(read(gameId), participantId, unitLabel));
}
/** All still-unconfirmed scores for a game (read on mount → re-send + reflect). */
export function outboxEntries(gameId: string): OutboxEntry[] {
  return entriesOf(read(gameId));
}
