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

/** A raw per-hole gross entry — carries the hole label so net can be derived. */
export interface RawStrokeEntry {
  participant_id: string;
  unit_label: string;
  value: number | null;
}

/**
 * Derive NET stroke entries from raw per-hole gross + each player's stroked
 * holes. This is the ONE place gross→net happens, so the live standings strip
 * (client) and the persisted final (server `computeStrokePlayResults`) can't
 * diverge — both feed the result into `computeStrokePlayStandings`.
 *
 * `strokedByPlayer[participant_id]` is the set of hole LABELS where that player
 * gets a stroke (computed once via `strokeHoles(handicap, courseStrokeIndex)`,
 * keyed by the SAME `unit_label` the entries carry). A hole in that set deducts
 * one stroke. Players absent from the map — no handicap, or no course index —
 * net to gross unchanged, so a handicap-less game stays byte-identical to
 * summing gross directly. `score_entries.value` always stays raw gross in the
 * DB; net is derived here.
 */
export function netStrokeEntries(
  entries: RawStrokeEntry[],
  strokedByPlayer: Record<string, Set<string>>
): StrokeEntry[] {
  return entries
    .filter((e) => e.value != null)
    .map((e) => ({
      participant_id: e.participant_id,
      value:
        (e.value as number) -
        (strokedByPlayer[e.participant_id]?.has(e.unit_label) ? 1 : 0),
    }));
}

export interface StrokeStanding {
  entityId: string;
  rawScore: number;
  position: number;
}

/**
 * A traditional-golf leaderboard row for the stroke game SURFACE — total strokes +
 * to-par + holes-played, ranked by to-par (best/lowest first). Extends the standings
 * shape with the two fields the surface needs (`toPar`, `holesPlayed`) but the live
 * strip / final don't.
 */
export interface StrokeLeaderboardRow {
  entityId: string;
  /** Net total strokes over the holes this player has scored. */
  totalStrokes: number;
  /** Count of scored holes (the "thru" number). 0 = hasn't started. */
  holesPlayed: number;
  /** totalStrokes − Σ par(scored holes) — RELATIVE TO HOLES PLAYED, so a player thru 9
   *  and a player thru 18 are compared on equal footing (the acceptance-scenario gate D). */
  toPar: number;
  /** 1-based rank among STARTED players (ties share). Not-started players all share the
   *  trailing position and sort to the bottom — a thru-0 late arrival is never "leading". */
  position: number;
  started: boolean;
}

/**
 * The stroke SURFACE leaderboard (holes-played-relative). Ranks the WHOLE field by
 * to-par, so it aggregates across every grouping (score_entries aren't group-scoped) and
 * stays coherent when players are thru different hole counts:
 *  - to-par is computed over SCORED holes only (net strokes − their par), never a full-
 *    round par, so a mid-round player isn't penalized for holes not yet played;
 *  - STARTED players rank by to-par asc (tie-break: more holes played ranks higher);
 *  - NOT-started players (thru 0) sort to the BOTTOM as "—", never mis-ranked to the top.
 *
 * `entries` are NET per-hole entries (participant_id + unit_label + value) — feed them
 * through `netStrokeEntries` first so the surface agrees with the persisted final (which
 * nets too). `parByHole` maps a hole's `unit_label` → its par (from the course snapshot).
 */
export function computeStrokeLeaderboard(
  participantIds: string[],
  entries: { participant_id: string; unit_label: string; value: number }[],
  parByHole: Record<string, number>
): StrokeLeaderboardRow[] {
  const agg = new Map<string, { strokes: number; holes: number; par: number }>();
  for (const id of participantIds) agg.set(id, { strokes: 0, holes: 0, par: 0 });
  for (const e of entries) {
    const a = agg.get(e.participant_id);
    if (!a) continue; // an entry for a participant not in the field (e.g. ungrouped) is ignored
    a.strokes += e.value;
    a.holes += 1;
    a.par += parByHole[e.unit_label] ?? 0;
  }

  const rows = participantIds.map((id) => {
    const a = agg.get(id)!;
    return {
      entityId: id,
      totalStrokes: a.strokes,
      holesPlayed: a.holes,
      toPar: a.strokes - a.par,
      started: a.holes > 0,
    };
  });

  const sorted = [...rows].sort((x, y) => {
    if (x.started !== y.started) return x.started ? -1 : 1; // started before not-started
    if (!x.started) return x.entityId < y.entityId ? -1 : 1; // stable order for not-started
    if (x.toPar !== y.toPar) return x.toPar - y.toPar; // lower to-par leads
    if (x.holesPlayed !== y.holesPlayed) return y.holesPlayed - x.holesPlayed; // more holes ranks higher
    return x.entityId < y.entityId ? -1 : 1;
  });

  const startedRows = sorted.filter((r) => r.started);
  const trailingPos = startedRows.length + 1;
  return sorted.map((r) => ({
    ...r,
    position: r.started
      ? 1 + startedRows.filter((o) => o.toPar < r.toPar).length
      : trailingPos,
  }));
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
