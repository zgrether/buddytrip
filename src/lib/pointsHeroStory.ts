import type { ClinchWatch } from "./pointsClinch";
import { CLINCH_STORY_WORD as WORD, fmtPts, GAME_STATE_WORD, joinAnd, ordinalShort, RACE_WORD } from "./vocabulary";

/**
 * The points hero's middle tier as lines (docs/CLINCH_AND_PODIUM.md §3): who it
 * is about, the headline and the dim line under it. Pure, so every row of the
 * spec's table is a test rather than a look at a screen.
 *
 * It says what the banked math says and nothing more. Numbers go through
 * `fmtPts`, so a half is 2.5 (the 2026-10-22 rule), and it never names a "next
 * game": a game is only named because it would clinch, or is being led.
 */

export interface StoryUnit {
  id: string;
  name: string;
  /** A team's short name. A person has none, and reads by name. */
  shortName: string | null;
}

export interface HeroStory {
  /** The unit above the headline, or null when the story is about nobody yet. */
  unitId: string | null;
  headline: string;
  sub: string;
  /** The headline is the winner's score: the Final row's big number. */
  isScore: boolean;
}

/** Places two or more units finished level on, below 1st: "3rd shared". */
function sharedPlaces(units: readonly StoryUnit[], totals: Readonly<Record<string, number>>): number[] {
  const scores = units.map((u) => totals[u.id] ?? 0);
  const places = scores.map((s) => scores.filter((x) => x > s).length + 1);
  return [...new Set(places.filter((p, i) => p > 1 && places.indexOf(p) !== places.lastIndexOf(p) && places[i] === p))].sort((a, b) => a - b);
}

export function pointsHeroStory(
  w: ClinchWatch,
  units: readonly StoryUnit[],
  totals: Readonly<Record<string, number>>,
  final: boolean
): HeroStory {
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? "";
  const shortOf = (id: string) => {
    const unit = units.find((u) => u.id === id);
    return unit?.shortName ?? unit?.name ?? "";
  };
  const story = (unitId: string | null, headline: string, sub: string): HeroStory => ({ unitId, headline, sub, isScore: false });
  const gamesLeft = WORD.gamesLeft(w.gamesLeft);

  if (final) {
    const top = Math.max(...units.map((u) => totals[u.id] ?? 0));
    const tail = sharedPlaces(units, totals).map((p) => WORD.placeShared(ordinalShort(p)));
    if (w.clincherId) {
      const sub = [GAME_STATE_WORD.final, RACE_WORD.wins(nameOf(w.clincherId)), ...tail].join(WORD.separator);
      return { unitId: w.clincherId, headline: fmtPts(top), sub, isScore: true };
    }
    return { unitId: null, headline: fmtPts(top), sub: [GAME_STATE_WORD.final, RACE_WORD.shared, ...tail].join(WORD.separator), isScore: true };
  }

  if (w.bankedGames === 0) return story(null, WORD.anyonesCup, gamesLeft);

  const clinchedLine = w.clincherId ? WORD.clinchedTheCup(nameOf(w.clincherId)) : gamesLeft;

  // Every place is settled with something still to play or under correction.
  if (w.place == null) {
    if (!w.clincherId) return story(null, WORD.tiedAtTop, gamesLeft);
    const scores = units.map((u) => totals[u.id] ?? 0).sort((a, b) => b - a);
    return story(w.clincherId, WORD.leadBy(fmtPts(scores[0] - (scores[1] ?? 0))), clinchedLine);
  }

  const placeWord = ordinalShort(w.place);
  if (w.leaderIds.length > 1) {
    return w.place === 1
      ? story(null, WORD.tiedAtTop, [WORD.joinLevel(w.leaderIds.map(shortOf)), gamesLeft].join(WORD.separator))
      : story(null, WORD.upForGrabs(placeWord), clinchedLine);
  }

  const leader = w.leaderIds[0];
  const tail =
    w.newlyOutIds.length > 0
      ? WORD.isOut(joinAnd(w.newlyOutIds.map(nameOf)), w.newlyOutIds.length)
      : WORD.stillAlive(w.alive, w.field.length);
  const line = (head: string) => [head, tail].join(WORD.separator);
  const winsFrom = (wins: 1 | 2) => (w.place === 1 ? WORD.winsFromTheCup(wins) : WORD.winsFromPlace(wins, placeWord));

  if (w.clinchesIfHolds) return story(leader, winsFrom(1), WORD.leadingGame(w.clinchesIfHolds));

  if (w.wins?.wins === 1) {
    const anyOf = w.wins.anySet && w.gamesLeft > 1;
    return story(leader, winsFrom(1), line(anyOf ? WORD.winAnyOf(w.gamesLeft) : WORD.aWinIn(w.winGameNames)));
  }
  if (w.wins?.wins === 2) {
    return story(leader, winsFrom(2), line(w.wins.anySet ? WORD.winAnyTwoOf(w.gamesLeft) : gamesLeft));
  }

  return w.place === 1 ? story(leader, WORD.leadBy(fmtPts(w.lead)), line(gamesLeft)) : story(null, WORD.upForGrabs(placeWord), clinchedLine);
}
