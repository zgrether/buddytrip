import { computeStrokePlayStandings, netStrokeEntries, type RawStrokeEntry } from "@/lib/strokePlay";
import { fmtToPar } from "@/lib/rackNStack";
import { STROKE_PLAY_UNITS } from "@/lib/strokePlayConfig";
import type { Participant, ScoreValues } from "@/components/games/types";

/**
 * Quick Stroke Play's local-storage state shape + the read/summary helpers the
 * DASHBOARD needs — split out of `app/quick-game/page.tsx` so the card on
 * `/dashboard` can read the same state without importing a page component.
 *
 * The page remains the only WRITER (via `localStorage.setItem`); this module
 * only reads and derives.
 */
export const QUICK_GAME_STORAGE_KEY = "bt-quick-game";

export interface QuickGameState {
  players: Participant[];
  values: ScoreValues;
  finished: boolean;
  currentHole: number;
}

/** Client-only. Returns null on no saved game, corrupt JSON, or SSR. */
export function readQuickGameState(): QuickGameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUICK_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QuickGameState;
  } catch {
    return null;
  }
}

const DEFAULT_SUBTITLE = "Keep score right now — no trip needed";

/**
 * The dashboard card's subtitle for the current Quick Stroke Play state.
 *
 * Four states (in order of precedence):
 *   1. No saved game               → the always-available pitch line.
 *   2. Game exists, no scores yet  → "Hole N of 18 · no scores yet". "In
 *      progress" starts at CREATION, not at first score — a game with players
 *      and no scores must not name a leader.
 *   3. Someone leading             → "Zach leading at +7 thru 8".
 *   4. Tied                        → "Tied at +7 thru 8" (no name — more than
 *      one player shares position 1).
 *
 * The "who's leading" determination reuses `computeStrokePlayStandings` fed by
 * `netStrokeEntries` — the SAME two calls `ScoreEntryView`'s running total and
 * "Leading" badge run (#825, so a handicap game's total can't crown a different
 * player than the standings). Quick Stroke Play carries no handicaps, so
 * `netStrokeEntries` is a no-op here (net ≡ gross) — it's called anyway so this
 * stays byte-identical to the entry screen's derivation rather than a second,
 * independent one that could drift from it.
 *
 * `toPar` / `thru` are DISPLAY figures computed on top of whichever entityId the
 * shared call already named the leader — they don't participate in deciding WHO
 * leads, only in describing them, so they can't be the source of a disagreement
 * with the entry screen's own badge.
 */
export function quickGameSubtitle(state: QuickGameState | null): string {
  if (!state) return DEFAULT_SUBTITLE;

  const scoredIds = state.players
    .filter((p) => Object.keys(state.values[p.id] ?? {}).length > 0)
    .map((p) => p.id);

  if (scoredIds.length === 0) {
    return `Hole ${state.currentHole} of ${STROKE_PLAY_UNITS.length} · no scores yet`;
  }

  const rawEntries: RawStrokeEntry[] = [];
  for (const p of state.players) {
    for (const u of STROKE_PLAY_UNITS) {
      const v = state.values[p.id]?.[u.label];
      if (v != null) rawEntries.push({ participant_id: p.id, unit_label: u.label, value: v });
    }
  }
  const entries = netStrokeEntries(rawEntries, {});
  const standings = computeStrokePlayStandings(scoredIds, entries);
  const leaders = standings.filter((s) => s.position === 1);
  if (leaders.length === 0) return DEFAULT_SUBTITLE; // unreached — scoredIds.length > 0 guarantees a position 1

  const parByLabel = new Map(STROKE_PLAY_UNITS.map((u) => [u.label, u.par ?? 0]));
  const leaderId = leaders[0].entityId;
  const leaderScoredLabels = Object.keys(state.values[leaderId] ?? {});
  const thru = leaderScoredLabels.length;
  const parSum = leaderScoredLabels.reduce((sum, label) => sum + (parByLabel.get(label) ?? 0), 0);
  const toPar = fmtToPar(leaders[0].rawScore - parSum);

  if (leaders.length > 1) {
    return `Tied at ${toPar} thru ${thru}`;
  }
  const name = state.players.find((p) => p.id === leaderId)?.name.split(/\s+/)[0] ?? "Leader";
  return `${name} leading at ${toPar} thru ${thru}`;
}
