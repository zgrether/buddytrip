import { describe, it, expect } from "vitest";
import {
  contributionRefusalMessage,
  type ContributionBlockers,
  type GameBlocker,
} from "./participationGuard";

/**
 * The refusal STRING. A pure unit test — no database, no fixture.
 *
 * ── Why the golf message is pinned character for character ────────────────
 *
 * #1151 gave this function its first branch. The regression that branch makes
 * possible is invisible in review: a reworded clause on the path that 100% of
 * BBMI's golf games take, sitting inside a diff whose subject is pick'em. Every
 * other assertion here would still pass. So the golf string is asserted as an
 * exact equality rather than by `toContain`, which is the only form that fails
 * on a stray word.
 *
 * It is a literal rather than a snapshot file deliberately: an `.snap` is
 * updated by running the suite with `-u`, which is exactly the reflex a copy
 * change produces, and it would record the regression as the new truth.
 */

const game = (gameName: string, opts: Partial<GameBlocker> = {}): GameBlocker => ({
  gameId: gameName,
  gameName,
  reasons: ["played-game"],
  hasScores: false,
  isPickem: false,
  ...opts,
});

const blockers = (games: GameBlocker[], money: Partial<ContributionBlockers> = {}) => ({
  games,
  expensesPaid: 0,
  expenseSplits: 0,
  ...money,
});

describe("contributionRefusalMessage — the suggested move names a real button", () => {
  it("GOLF ONLY — pinned exactly; this is the path every golf game takes", () => {
    const msg = contributionRefusalMessage(
      "Marcus",
      blockers([game("Saturday Stroke", { hasScores: true })])
    );
    expect(msg).toBe(
      `Marcus can't be removed — has scores in 1 game: "Saturday Stroke". ` +
        `Removing them would change results other people are part of. You can ` +
        `enter a score for them if they can't play, rename them if the name is wrong, ` +
        `or leave them on the roster — either way their history stays attached.`
    );
  });

  it("PICK'EM ONLY — names picks, not a score", () => {
    const msg = contributionRefusalMessage(
      "Marcus",
      blockers([game("NFL Week 1", { isPickem: true })])
    );
    expect(msg).toContain("enter picks for them if they can't play");
    // The mechanism, not just the presence of the new words: the golf clause
    // must be GONE, or a build that appended rather than branched would pass.
    expect(msg).not.toContain("enter a score for them");
  });

  it("MIXED — one clause naming both actions, and the list stays three items", () => {
    const msg = contributionRefusalMessage(
      "Marcus",
      blockers([
        game("Saturday Stroke", { hasScores: true }),
        game("NFL Week 1", { isPickem: true }),
      ])
    );
    expect(msg).toContain("enter a score or picks for them if they can't play");
    // Option B — two separate list items — would produce a second "enter"
    // clause and a fourth comma-separated option. This is what refuses it.
    expect(msg).not.toContain("enter picks for them if they can't play");
    expect(msg.match(/enter /g) ?? []).toHaveLength(1);
  });

  it("MONEY ONLY — no enter-clause at all, whatever the games would have said", () => {
    // The category half of the rule, which the format half must not have
    // broken: with no game blocking, suggesting an entry of any kind is the
    // dead end this function exists to avoid.
    const msg = contributionRefusalMessage("Marcus", blockers([], { expensesPaid: 2 }));
    expect(msg).toContain("paid for 2 expenses");
    expect(msg).not.toContain("enter a score");
    expect(msg).not.toContain("enter picks");
  });

  it("names every blocking game, pick'em and golf alike", () => {
    const msg = contributionRefusalMessage(
      "Marcus",
      blockers([game("Saturday Stroke"), game("NFL Week 1", { isPickem: true })])
    );
    expect(msg).toContain(`"Saturday Stroke"`);
    expect(msg).toContain(`"NFL Week 1"`);
  });
});
