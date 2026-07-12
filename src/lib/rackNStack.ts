/**
 * Rack-n-Stack scoring core (Slice C part 3) — PURE, client-safe.
 *
 * Net stroke play with a derived, rank-paired scoreboard: sort EACH team by
 * net-to-par ascending, pair by rank (A[k] vs B[k]); each slot is a 1v1 where
 * the lower net-to-par wins a point for their team (a tie halves ½/½). The unit
 * you SCORE in (the foursome) ≠ the unit the board DISPLAYS (the rank slot) —
 * this module only computes the display/standings read-model; entry is ordinary
 * stroke play. Same shared module feeds the live client board and the server
 * finish so they can't diverge (CLAUDE.md pattern #8).
 *
 * Net per hole uses the GolfCard contract: gross − (stroke received on that hole
 * via `strokeHoles`), then minus par for net-to-par. `strokeHoles` is reused
 * unchanged.
 */

import { strokeHoles } from "./matchPlay";

export type RackMode = "current" | "projected";
export type Team = "A" | "B";

export interface RackStats {
  /** Net strokes − par, summed over holes played. */
  netToPar: number;
  /** Net strokes (gross − handicap allocation), summed over holes played. */
  netStrokes: number;
  /** Gross strokes summed over holes played (tie-break). */
  gross: number;
  /** Holes with a posted score. */
  thru: number;
}

/** Per-player net-to-par / thru over the holes they've actually scored. */
export function playerStats(
  grossByHole: Record<string, number | null | undefined>,
  handicapStrokes: number,
  par: number[],
  strokeIndex: number[]
): RackStats {
  const received = strokeHoles(handicapStrokes, strokeIndex);
  let netToPar = 0;
  let netStrokes = 0;
  let gross = 0;
  let thru = 0;
  for (let h = 1; h <= par.length; h++) {
    const g = grossByHole[String(h)];
    if (g == null) continue;
    const net = g - (received.has(h) ? 1 : 0);
    netToPar += net - par[h - 1];
    netStrokes += net;
    gross += g;
    thru += 1;
  }
  return { netToPar, netStrokes, gross, thru };
}

/** Pace-normalized net-to-par: (net ÷ holes) × 18 − course par. Projects from
 *  the first hole played — it's a projection, and the user can toggle it off if
 *  the early-round values swing too much (Zach). null only when nothing's played
 *  yet (thru 0: no basis to project, and avoids ÷0). */
export function projectedNetToPar(netStrokes: number, thru: number, coursePar: number): number | null {
  if (thru === 0) return null;
  return (netStrokes / thru) * 18 - coursePar;
}

export interface RackPlayer {
  id: string;
  team: Team;
  stats: RackStats;
}

export interface RackSlotPlayer {
  id: string;
  team: Team;
  /** The net-to-par shown in the active mode (current, or projected when set). */
  value: number;
  netToPar: number;
  projected: number | null;
  thru: number;
}

export interface RackSlot {
  slot: number; // 1-based rank
  a: RackSlotPlayer;
  b: RackSlotPlayer;
  /** Slot winner by the active mode's value; null = tie (halve). */
  leader: Team | null;
  /** Net gap between the two values (≥0); the board renders "Up by {gap}". */
  gap: number;
}

export interface RackResult {
  slots: RackSlot[];
  /** Surplus bottom players on the larger team — no slot, no point. */
  sitOut: RackSlotPlayer[];
  /** Team points from slot wins (halves = ½), in the active mode. */
  points: { A: number; B: number };
}

/** The net-to-par a slot pairs/leads on in `mode`: projected when available, else current. */
function valueOf(p: RackPlayer, mode: RackMode, coursePar: number): number {
  const proj = projectedNetToPar(p.stats.netStrokes, p.stats.thru, coursePar);
  return mode === "projected" && proj != null ? proj : p.stats.netToPar;
}

function toSlotPlayer(p: RackPlayer, mode: RackMode, coursePar: number): RackSlotPlayer {
  return {
    id: p.id,
    team: p.team,
    value: valueOf(p, mode, coursePar),
    netToPar: p.stats.netToPar,
    projected: projectedNetToPar(p.stats.netStrokes, p.stats.thru, coursePar),
    thru: p.stats.thru,
  };
}

/**
 * Build the rack: exclude not-started players (thru 0), sort each team by the
 * active value (then net-to-par, gross, id — deterministic so the board doesn't
 * flicker), pair by rank, resolve slots, and surplus the larger team's bottom.
 */
export function computeRack(players: RackPlayer[], mode: RackMode, coursePar: number): RackResult {
  const started = players.filter((p) => p.stats.thru > 0);
  const key = (p: RackPlayer): [number, number, number] => [
    valueOf(p, mode, coursePar),
    p.stats.netToPar,
    p.stats.gross,
  ];
  const cmp = (x: RackPlayer, y: RackPlayer) => {
    const kx = key(x);
    const ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  };
  const A = started.filter((p) => p.team === "A").sort(cmp);
  const B = started.filter((p) => p.team === "B").sort(cmp);
  const n = Math.min(A.length, B.length);

  const slots: RackSlot[] = [];
  let pa = 0;
  let pb = 0;
  for (let k = 0; k < n; k++) {
    const sa = toSlotPlayer(A[k], mode, coursePar);
    const sb = toSlotPlayer(B[k], mode, coursePar);
    const leader: Team | null = sa.value < sb.value ? "A" : sa.value > sb.value ? "B" : null;
    if (leader === "A") pa += 1;
    else if (leader === "B") pb += 1;
    else {
      pa += 0.5;
      pb += 0.5;
    }
    slots.push({ slot: k + 1, a: sa, b: sb, leader, gap: Math.abs(sa.value - sb.value) });
  }
  const surplus = (A.length > B.length ? A.slice(n) : B.slice(n)).map((p) => toSlotPlayer(p, mode, coursePar));
  return { slots, sitOut: surplus, points: { A: pa, B: pb } };
}

/**
 * Rack PROJECTED competition points per team = raw projected slot points ×
 * `perSlotValue` (the `per_match` field, which in rack means **points per slot**;
 * defaults to 1 for a legacy/placement rack). This mirrors the DECIDED path's
 * downstream multiply (`computeRackNStackResults`: `teamPoints × value`) — the
 * projected path historically returned RAW slots, so a rack pill read in a
 * different currency than a match pill. Applying the multiply HERE (a consumer-
 * layer helper, NOT inside `computeRack`) keeps the decided path — which does its
 * own downstream multiply — from double-applying.
 *
 * The multiply is linear over the summed slot points (incl. ½ halves and the
 * min(A,B) pairing `computeRack` already resolves), so `points × value` is exactly
 * "each won slot worth `value`" (2½ slots × 2 = 5). Both projected consumers (the
 * board's `liveProjection.ts` and the rack game page) call this, so they stay
 * equal by construction.
 */
export function rackProjectedTeamPoints(
  players: RackPlayer[],
  coursePar: number,
  perSlotValue: number
): { A: number; B: number } {
  const { points } = computeRack(players, "projected", coursePar);
  return { A: points.A * perSlotValue, B: points.B * perSlotValue };
}

/** Format a net-to-par for display: "E" / "+n" / "−n" (rounds projected). */
export function fmtToPar(value: number): string {
  const r = Math.round(value);
  if (r === 0) return "E";
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`;
}

/** Format a team point total with a ½ glyph (1.5 → "1½"). */
export function fmtPoints(p: number): string {
  const whole = Math.floor(p);
  const half = p - whole >= 0.5;
  if (half) return whole === 0 ? "½" : `${whole}½`;
  return String(whole);
}
