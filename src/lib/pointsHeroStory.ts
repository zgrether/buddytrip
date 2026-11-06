import { finalPlaces, sharedPlaces } from "./finalPlaces";
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
  /** False for a unit with no finished result: it holds no place. */
  hasResult?: boolean;
}

/** Where the cup stands beyond the math (spec §5). */
export interface HeroCupState {
  /** The board is empty and nobody has finished the cup. */
  awaitingFinish?: boolean;
  /** A clinch went out while games remained, so it can still be said. */
  announced?: boolean;
  tiebreakOrder?: readonly string[] | null;
}

export interface HeroStory {
  /** The units above the headline: one, both at a shared 1st, or nobody yet. */
  unitIds: string[];
  headline: string;
  sub: string;
  /** The headline is the winner's score: the Final row's big number. */
  isScore: boolean;
}

export function pointsHeroStory(
  w: ClinchWatch,
  units: readonly StoryUnit[],
  totals: Readonly<Record<string, number>>,
  final: boolean,
  cup: HeroCupState = {}
): HeroStory {
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? "";
  const shortOf = (id: string) => {
    const unit = units.find((u) => u.id === id);
    return unit?.shortName ?? unit?.name ?? "";
  };
  const story = (unitId: string | null, headline: string, sub: string): HeroStory => ({
    unitIds: unitId ? [unitId] : [],
    headline,
    sub,
    isScore: false,
  });
  const gamesLeft = WORD.gamesLeft(w.gamesLeft);

  if (final) {
    const placed = units.filter((u) => u.hasResult !== false).map((u) => u.id);
    const places = finalPlaces(placed, totals, cup.tiebreakOrder);
    const winners = placed.filter((id) => places.get(id)?.place === 1);
    const top = Math.max(...winners.map((id) => totals[id] ?? 0));
    const tail = sharedPlaces(placed, totals, cup.tiebreakOrder)
      .filter((s) => s.place > 1)
      .map((s) => WORD.placeShared(ordinalShort(s.place)));
    const result = winners.length === 1 ? RACE_WORD.wins(nameOf(winners[0])) : WORD.sharedFirst;
    return {
      unitIds: winners,
      headline: fmtPts(top),
      sub: [GAME_STATE_WORD.final, result, ...tail].join(WORD.separator),
      isScore: true,
    };
  }

  // Nothing left on the board and nobody has said it is over. The math calls every
  // place locked here, which is only true until someone adds a game, so the hero
  // claims no more than the banked lead. A clinch already announced stays said.
  if (cup.awaitingFinish) {
    if (cup.announced && w.clincherId) return story(w.clincherId, WORD.clinchedHeadline, WORD.everyGameDone);
    const [first, second] = units.map((u) => totals[u.id] ?? 0).sort((a, b) => b - a);
    const leaders = units.filter((u) => (totals[u.id] ?? 0) === first);
    if (leaders.length > 1) return story(null, WORD.tiedAtTop, WORD.everyGameDone);
    return story(leaders[0].id, WORD.leadBy(fmtPts(first - (second ?? 0))), WORD.everyGameDone);
  }

  if (w.bankedGames === 0) return story(null, WORD.anyonesCup, gamesLeft);

  const clinchedLine = w.clincherId ? WORD.clinchedTheCup(nameOf(w.clincherId)) : gamesLeft;

  // Every place is settled with something still to play or under correction.
  if (w.place == null) {
    if (!w.clincherId) return story(null, WORD.tiedAtTop, gamesLeft);
    const sub = w.gamesLeft > 0 ? [WORD.everyPlaceSet, gamesLeft].join(WORD.separator) : WORD.everyPlaceSet;
    return story(w.clincherId, WORD.clinchedHeadline, sub);
  }

  // Below 1st there is no ladder: the place is simply open.
  if (w.place > 1) return story(null, WORD.upForGrabs(ordinalShort(w.place)), clinchedLine);
  if (w.leaderIds.length > 1) {
    return story(null, WORD.tiedAtTop, [WORD.joinLevel(w.leaderIds.map(shortOf)), gamesLeft].join(WORD.separator));
  }

  const leader = w.leaderIds[0];
  const tail =
    w.newlyOutIds.length > 0
      ? WORD.isOut(joinAnd(w.newlyOutIds.map(nameOf)), w.newlyOutIds.length)
      : WORD.stillAlive(w.alive, w.field.length);
  const line = (head: string) => [head, tail].join(WORD.separator);
  const headline = w.wins?.wins ? WORD.winsFromTheCup(w.wins.wins) : WORD.leadBy(fmtPts(w.lead));

  // What is true today, under whichever headline the banked math allows.
  if (w.clinchesIfHolds) return story(leader, headline, WORD.leadingGame(w.clinchesIfHolds));

  if (w.wins?.wins === 1) {
    const anyOf = w.wins.anySet && w.gamesLeft > 1;
    return story(leader, headline, line(anyOf ? WORD.winAnyOf(w.gamesLeft) : WORD.aWinIn(w.winGameNames)));
  }
  if (w.wins?.wins === 2) {
    return story(leader, headline, line(w.wins.anySet ? WORD.winAnyTwoOf(w.gamesLeft) : gamesLeft));
  }
  return story(leader, headline, line(gamesLeft));
}
