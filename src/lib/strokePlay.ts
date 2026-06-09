/**
 * Shared stroke-play standings — the ONE place the tie/leader rule lives.
 *
 * Used by both halves of the live experience so they can never diverge:
 *  (a) the **live standings strip** (client) sums the already-loaded
 *      `score_entries` and renders running totals + "Leading" as scores land —
 *      no DB write per keystroke; and
 *  (b) the **persisted final record** (server `computeStrokePlayResults`,
 *      `src/server/lib/strokePlay.ts`) writes `game_results` on Finish.
 *
 * Rule: gross total, lowest leads; ties share a position (standard 1, 2, 2, 4).
 * `position === 1` ⇒ "Leading" (ties → multiple leaders share position 1).
 *
 * No server/DB deps — safe to import from client components (the live strip).
 */

export interface StrokeEntry {
  participant_id: string;
  value: number | null;
}

export interface StrokeStanding {
  entityId: string;
  rawScore: number;
  position: number;
}

export function computeStrokePlayStandings(
  participantIds: string[],
  entries: StrokeEntry[]
): StrokeStanding[] {
  const totals = new Map<string, number>();
  for (const id of participantIds) totals.set(id, 0);
  for (const e of entries) {
    if (e.value == null) continue;
    totals.set(e.participant_id, (totals.get(e.participant_id) ?? 0) + e.value);
  }

  const rows = Array.from(totals, ([entityId, rawScore]) => ({ entityId, rawScore }));
  rows.sort((a, b) => a.rawScore - b.rawScore); // low wins
  return rows.map((r) => ({
    entityId: r.entityId,
    rawScore: r.rawScore,
    // ties share position; next position skips (standard competition ranking).
    position: 1 + rows.filter((o) => o.rawScore < r.rawScore).length,
  }));
}
