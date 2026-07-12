"use client";

import { outcomeCellKey, parseOutcomeCellKey } from "@/components/games/types";
import type { HoleOutcomeResult } from "@/lib/matchPlay";

/**
 * outcomeOutbox — the hole-outcome-entry counterpart to `scoreOutbox` (Refactor
 * B2 Phase 0 finding: the key scheme FORKS rather than widens — an outcome
 * belongs to a MATCH+HOLE, not a participant+unit, so `scoreCellKey` doesn't fit).
 * Same durability contract: a tiny write-ahead log covering the gap between "the
 * outcome was tapped" and "the server confirmed the write," so a nav/reload/
 * app-kill on poor signal can't silently drop a recorded hole.
 *
 * Shape: localStorage, one entry-map per game (separate namespace from the score
 * outbox), entries keyed by `outcomeCellKey(matchId, holeNumber)`. Written on tap,
 * cleared ONLY on server confirmation; on failure it stays for the next mount's
 * re-send (idempotent upsert on `UNIQUE(match_id, hole_number)` → safe).
 */

/** { [outcomeCellKey]: result } — the persisted unconfirmed outcomes for one game. */
export type OutcomeOutboxMap = Record<string, HoleOutcomeResult>;
export interface OutcomeOutboxEntry {
  matchId: string;
  holeNumber: number;
  result: HoleOutcomeResult;
}

// ── Pure map ops (unit-tested) ───────────────────────────────────────────────
export function putIn(map: OutcomeOutboxMap, matchId: string, holeNumber: number, result: HoleOutcomeResult): OutcomeOutboxMap {
  return { ...map, [outcomeCellKey(matchId, holeNumber)]: result };
}
export function clearIn(map: OutcomeOutboxMap, matchId: string, holeNumber: number): OutcomeOutboxMap {
  const key = outcomeCellKey(matchId, holeNumber);
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}
export function entriesOf(map: OutcomeOutboxMap): OutcomeOutboxEntry[] {
  return Object.entries(map).map(([key, result]) => ({ ...parseOutcomeCellKey(key), result }));
}

// ── localStorage wrappers (best-effort, SSR-safe) ────────────────────────────
const NS = "bt.outcomeOutbox.v1";
const storeKey = (gameId: string) => `${NS}:${gameId}`;

function read(gameId: string): OutcomeOutboxMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storeKey(gameId));
    return raw ? (JSON.parse(raw) as OutcomeOutboxMap) : {};
  } catch {
    return {};
  }
}
function write(gameId: string, map: OutcomeOutboxMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(storeKey(gameId));
    else window.localStorage.setItem(storeKey(gameId), JSON.stringify(map));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into scoring. */
  }
}

/** Persist an unconfirmed outcome (on tap). */
export function outcomeOutboxPut(gameId: string, matchId: string, holeNumber: number, result: HoleOutcomeResult): void {
  write(gameId, putIn(read(gameId), matchId, holeNumber, result));
}
/** Remove an outcome from the outbox (on server confirmation, or on reset). */
export function outcomeOutboxClear(gameId: string, matchId: string, holeNumber: number): void {
  write(gameId, clearIn(read(gameId), matchId, holeNumber));
}
/** All still-unconfirmed outcomes for a game (read on mount → re-send + reflect). */
export function outcomeOutboxEntries(gameId: string): OutcomeOutboxEntry[] {
  return entriesOf(read(gameId));
}
