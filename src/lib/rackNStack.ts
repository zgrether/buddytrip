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
  /** Has a score on at least one unit. A not-started player's `value` and
   *  `netToPar` are 0, which reads as level par, so show `started` first. */
  started: boolean;
}

export interface RackSlot {
  slot: number; // 1-based rank
  a: RackSlotPlayer;
  b: RackSlotPlayer;
  /** Slot winner by the active mode's value; null = tie (halve). Always null
   *  while `undecided`, which is NOT a halve. */
  leader: Team | null;
  /** Net gap between the two values (≥0); the board renders "Up by {gap}". */
  gap: number;
  /** One side has not started (#1368): nobody leads, and the slot pays nothing
   *  until both have. Distinct from a halve, which pays ½ each. */
  undecided: boolean;
}

export interface RackResult {
  slots: RackSlot[];
  /** Surplus bottom players on the larger ROSTER — no slot, no point. */
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
    started: p.stats.thru > 0,
  };
}

/**
 * Build the rack over the FULL roster: sort each team by the active value (then
 * net-to-par, gross, id — deterministic so the board doesn't flicker) with
 * not-started players (thru 0) after everyone who has started, pair by rank,
 * resolve slots, and surplus the larger roster's bottom.
 *
 * #1368: this used to drop not-started players before pairing, so the board
 * left them off entirely (fifteen rows where there were seventeen people) while
 * the points-per-slot divisor counted the full roster. Pairing them last is
 * points-neutral: a slot only decides when BOTH sides have started, and every
 * slot below min(startedA, startedB) pairs exactly the players it paired before.
 * A slot with a not-started side is `undecided`: no leader, no points.
 */
export function computeRack(players: RackPlayer[], mode: RackMode, coursePar: number): RackResult {
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
  const isStarted = (p: RackPlayer) => p.stats.thru > 0;
  // Started first (by the rack's own order), then not-started, by id alone: a
  // not-started player has no value to rank on.
  const order = (x: RackPlayer, y: RackPlayer) => {
    const sx = isStarted(x);
    const sy = isStarted(y);
    if (sx !== sy) return sx ? -1 : 1;
    if (sx) return cmp(x, y);
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  };
  const A = players.filter((p) => p.team === "A").sort(order);
  const B = players.filter((p) => p.team === "B").sort(order);
  const n = Math.min(A.length, B.length);

  const slots: RackSlot[] = [];
  let pa = 0;
  let pb = 0;
  for (let k = 0; k < n; k++) {
    const sa = toSlotPlayer(A[k], mode, coursePar);
    const sb = toSlotPlayer(B[k], mode, coursePar);
    if (!sa.started || !sb.started) {
      slots.push({ slot: k + 1, a: sa, b: sb, leader: null, gap: 0, undecided: true });
      continue;
    }
    const leader: Team | null = sa.value < sb.value ? "A" : sa.value > sb.value ? "B" : null;
    if (leader === "A") pa += 1;
    else if (leader === "B") pb += 1;
    else {
      pa += 0.5;
      pb += 0.5;
    }
    slots.push({ slot: k + 1, a: sa, b: sb, leader, gap: Math.abs(sa.value - sb.value), undecided: false });
  }
  const surplus = (A.length > B.length ? A.slice(n) : B.slice(n)).map((p) => toSlotPlayer(p, mode, coursePar));
  return { slots, sitOut: surplus, points: { A: pa, B: pb } };
}

/**
 * The thrus of the slots that SCORE (both sides started) — what "every slot is
 * played out" means for the finalize gate and the re-lock refusal (#1431).
 * #1368 pairs not-started players into undecided slots, and reading every
 * slot's thru would block finalizing any game with a no-show, which today
 * finalizes. These are exactly the slots `computeRack` returned before #1368.
 * ONE home, so the client's gate and the server's refusal cannot disagree.
 */
export function scoringSlotThrus(rack: Pick<RackResult, "slots">): number[] {
  return rack.slots.filter((s) => !s.undecided).flatMap((s) => [s.a.thru, s.b.thru]);
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

/** Format a team point total with a ½ glyph (1.5 → "1½"); other fractions kept
 *  exact to 2dp (1.25 → "1.25") so fractional shares survive display (#585). */
export function fmtPoints(p: number): string {
  if (Number.isInteger(p)) return String(p);
  const whole = Math.floor(p);
  if (Math.abs(p - whole - 0.5) < 0.001) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(p * 100) / 100);
}

/**
 * Rack's two sides are the COMPETITION's two teams (ruling 12, PR 4) — the one
 * answer to "which two teams is this rack between", read by the finalize
 * (`computeRackNStackResults`), the board's projection (`projectRack`) and the
 * rack screen (`RackGameView`).
 *
 * Those three used to derive it three ways: the finalize from every roster
 * assignment in the cup, sorted by id; the projection from the teams of the
 * game's own participants, sorted by id; the screen from the cup's team list in
 * creation order. Since PR 4 a head-to-head cup is exactly two teams and every
 * participant is rostered on one of them, so the three agreed on WHICH two teams
 * in every state the app can produce — they differed only in which was A, and
 * `computeRack` is symmetric in A and B. This removes duplication, not a live
 * divergence; what it prevents is a fourth derivation, and a cup that ever holds
 * a third team being split three ways at once.
 *
 * Takes the cup's teams in the order the caller holds them and returns them as
 * sides A and B — or null when the cup does not have exactly two, which is not a
 * rack a person can build.
 */
export function rackSides(cupTeamIds: readonly string[]): { A: string; B: string } | null {
  return cupTeamIds.length === 2 ? { A: cupTeamIds[0], B: cupTeamIds[1] } : null;
}
