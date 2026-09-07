"use client";

import { skinsCellKey } from "@/components/games/skins/SkinsEntryView";

/**
 * skinsOutbox — the durable write-ahead log for recorded holes, the skins
 * counterpart to `scoreOutbox` and `outcomeOutbox`.
 *
 * Same durability contract as both: cover the gap between "the hole was
 * confirmed" and "the server acknowledged it", so a nav / reload / app-kill on
 * poor signal cannot silently drop a hole. Written on OK, cleared only on server
 * confirmation, re-sent on the next mount.
 *
 * ── The key FORKS again, and the value carries two fields ─────────────────
 *
 * `outcomeOutbox`'s header records that its key forked from `scoreCellKey`
 * rather than widening it, because an outcome belongs to a match+hole and not to
 * a participant+unit. This forks once more for the same kind of reason: a skins
 * hole belongs to a GROUPING+hole, and its value is not a single enum — it is a
 * result and a winner, which are a pair.
 *
 * They are stored as a pair rather than collapsed into "winnerId or null"
 * precisely because that collapse is the mistake the whole format guards
 * against: a null winner would mean both "tied" and "nothing recorded", and this
 * log exists to replay a hole faithfully.
 */

/** One unconfirmed hole. `winnerId` is non-null exactly when `result` is `won` —
 *  the same pairing the table's CHECK enforces. */
export interface SkinsOutboxEntry {
  groupingId: string;
  holeNumber: number;
  result: "won" | "tied";
  winnerId: string | null;
}

/** { [skinsCellKey]: entry } — the persisted unconfirmed holes for one game. */
export type SkinsOutboxMap = Record<string, SkinsOutboxEntry>;

// ── Pure map ops (unit-tested) ───────────────────────────────────────────────
export function putIn(map: SkinsOutboxMap, entry: SkinsOutboxEntry): SkinsOutboxMap {
  return { ...map, [skinsCellKey(entry.groupingId, entry.holeNumber)]: entry };
}
export function clearIn(map: SkinsOutboxMap, groupingId: string, holeNumber: number): SkinsOutboxMap {
  const key = skinsCellKey(groupingId, holeNumber);
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}
export function entriesOf(map: SkinsOutboxMap): SkinsOutboxEntry[] {
  return Object.values(map);
}

// ── localStorage wrappers (best-effort, SSR-safe) ────────────────────────────
const NS = "bt.skinsOutbox.v1";
const storeKey = (gameId: string) => `${NS}:${gameId}`;

function read(gameId: string): SkinsOutboxMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storeKey(gameId));
    return raw ? (JSON.parse(raw) as SkinsOutboxMap) : {};
  } catch {
    return {};
  }
}
function write(gameId: string, map: SkinsOutboxMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(storeKey(gameId));
    else window.localStorage.setItem(storeKey(gameId), JSON.stringify(map));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into scoring. */
  }
}

/** Persist an unconfirmed hole (on OK). */
export function skinsOutboxPut(gameId: string, entry: SkinsOutboxEntry): void {
  write(gameId, putIn(read(gameId), entry));
}
/** Remove a hole from the outbox (on server confirmation, or on clear). */
export function skinsOutboxClear(gameId: string, groupingId: string, holeNumber: number): void {
  write(gameId, clearIn(read(gameId), groupingId, holeNumber));
}
/** All still-unconfirmed holes for a game (read on mount → re-send + reflect). */
export function skinsOutboxEntries(gameId: string): SkinsOutboxEntry[] {
  return entriesOf(read(gameId));
}
