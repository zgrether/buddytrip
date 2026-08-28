import { describe, it, expect } from "vitest";
import {
  leaderId,
  leaderClinched,
  orderByTotal,
  tiedWithPrevious,
  sideClinched,
  type TeamStanding,
} from "./pickemBoard";
import { explanationCopy, type SheetSettings, type SheetSlateGame } from "./pickemSheet";
import { placementPointsByTeam } from "./placementGroups";

/**
 * Points mode — N teams ordered, placement pays (Phase 7).
 *
 * ── The two wrong builds these are written against ─────────────────────────
 *
 *   1. "a suite that only runs match_play passes against a build that ignores
 *      points mode"   → every case here runs points, and the copy cases assert
 *      the head-to-head paragraphs are GONE, which a build ignoring the model
 *      would still render.
 *   2. "a suite that only runs four teams passes against a build that
 *      special-cases two"  → the two-team cases assert an ORDERING with a
 *      placement payout, which a build that special-cased two into a match
 *      would not produce.
 *
 * The four-team cases carry their own guard in the other direction: every one
 * of them would pass against `const [x, y] = standings` if it only ever looked
 * at the top two, so the decisive cases put the danger in THIRD place.
 */

const st = (id: string, total: number, upside: number): TeamStanding => ({
  id,
  standing: { total, upside },
});

describe("leaderId", () => {
  it("names the sole leader", () => {
    expect(leaderId([st("a", 10, 5), st("b", 7, 5), st("c", 3, 5)])).toBe("a");
  });

  it("is NULL when the top is tied — the board makes no claim of its own", () => {
    expect(leaderId([st("a", 10, 5), st("b", 10, 5), st("c", 3, 5)])).toBeNull();
  });

  it("is not fooled by a tie further down", () => {
    expect(leaderId([st("a", 10, 5), st("b", 7, 5), st("c", 7, 5)])).toBe("a");
  });
});

describe("leaderClinched — beyond EVERY other team, not just the runner-up", () => {
  it("clinches when no other team can reach the leader", () => {
    // Lead of 6 over b and 8 over c; both upsides are 4.
    expect(leaderClinched([st("a", 20, 0), st("b", 14, 4), st("c", 12, 4)], 3)).toBe(true);
  });

  it("does NOT clinch when a team in THIRD can still catch up", () => {
    /**
     * THE case for this whole generalisation, and the one `const [x, y]` could
     * not express. The leader is clear of the runner-up — a binary check
     * against second place says clinched — but third place has a large upside
     * from further back and can still overtake.
     *
     * A build that checked only the nearest challenger passes every other case
     * in this file and fails this one.
     */
    const standings = [st("a", 20, 0), st("b", 14, 2), st("c", 5, 30)];
    expect(leaderClinched(standings, 3)).toBe(false);
    // ...and the runner-up alone WOULD have said clinched, which is what makes
    // this a real discriminator rather than a restatement.
    expect(sideClinched(standings[0].standing, standings[1].standing, 3)).toBe(true);
  });

  it("never clinches with nothing left to play", () => {
    // Not "the leader has won" — clinching is a statement about the future, and
    // with no games left there is no future to be beyond.
    expect(leaderClinched([st("a", 20, 0), st("b", 1, 99)], 0)).toBe(false);
  });

  it("never clinches on a tied top", () => {
    expect(leaderClinched([st("a", 10, 0), st("b", 10, 0), st("c", 1, 0)], 3)).toBe(false);
  });

  it("still behaves exactly as the two-team predicate did", () => {
    // `sideClinched` delegates here, so this pins that generalising to N did
    // not move what two teams do.
    expect(sideClinched({ total: 10, upside: 0 }, { total: 4, upside: 5 }, 2)).toBe(true);
    expect(sideClinched({ total: 10, upside: 0 }, { total: 4, upside: 7 }, 2)).toBe(false);
  });
});

describe("orderByTotal + tiedWithPrevious", () => {
  it("orders highest first", () => {
    const ordered = orderByTotal([st("a", 3, 0), st("b", 9, 0), st("c", 6, 0)]);
    expect(ordered.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("marks a team tied with the one above it", () => {
    const ordered = orderByTotal([st("a", 9, 0), st("b", 9, 0), st("c", 2, 0)]);
    expect([...tiedWithPrevious(ordered)]).toEqual([ordered[1].id]);
  });

  it("does not mark the FIRST team as tied with anything", () => {
    // An off-by-one here would hand the leader a shared placement and average
    // its payout down — silently, since the number would still look plausible.
    const ordered = orderByTotal([st("a", 9, 0), st("b", 9, 0)]);
    expect(tiedWithPrevious(ordered).has(ordered[0].id)).toBe(false);
  });
});

describe("placement payout — the historical BBMI schedule", () => {
  const BBMI = [2, 1.5, 0.5, 0];

  it("pays 2 / 1.5 / 0.5 / 0 across four teams", () => {
    const ordered = orderByTotal([
      st("a", 40, 0),
      st("b", 30, 0),
      st("c", 20, 0),
      st("d", 10, 0),
    ]);
    const pay = placementPointsByTeam(
      ordered.map((o) => o.id),
      tiedWithPrevious(ordered),
      BBMI
    );
    expect(pay.get("a")).toBe(2);
    expect(pay.get("b")).toBe(1.5);
    expect(pay.get("c")).toBe(0.5);
    expect(pay.get("d")).toBe(0);
  });

  it("AVERAGES a tie across the places it spans", () => {
    // Two tied for 2nd take (1.5 + 0.5) / 2 = 1 each, and 4th still takes 0.
    const ordered = orderByTotal([
      st("a", 40, 0),
      st("b", 30, 0),
      st("c", 30, 0),
      st("d", 10, 0),
    ]);
    const pay = placementPointsByTeam(
      ordered.map((o) => o.id),
      tiedWithPrevious(ordered),
      BBMI
    );
    expect(pay.get("a")).toBe(2);
    expect(pay.get("b")).toBe(1);
    expect(pay.get("c")).toBe(1);
    expect(pay.get("d")).toBe(0);
  });

  it("works at TWO teams as a degenerate ordering, not a match", () => {
    // §4: two teams in points mode is a winner and a loser paid by the
    // schedule. No special case — the same call, one fewer entry.
    const ordered = orderByTotal([st("a", 12, 0), st("b", 9, 0)]);
    const pay = placementPointsByTeam(
      ordered.map((o) => o.id),
      tiedWithPrevious(ordered),
      BBMI
    );
    expect(pay.get("a")).toBe(2);
    expect(pay.get("b")).toBe(1.5);
  });
});

describe("the explainer drops head-to-head in a points cup", () => {
  const slate = (n: number): SheetSlateGame[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `g${i}`,
      awayTeam: "A",
      homeTeam: "H",
      spread: null,
      multiplier: 1,
    }));

  const ids = (settings: SheetSettings, pointsMode: boolean) =>
    explanationCopy(settings, slate(3), { pointsMode }).map((p) => p.id);

  const MATCHES: SheetSettings = { useConfidence: true, rollUp: "individual_matches" };

  it("renders NO head-to-head copy, even with roll_up = individual_matches", () => {
    /**
     * The decisive case. `roll_up` is INERT in a points cup, so a build that
     * read the roll-up and ignored the model would still render "you have to be
     * right where they're wrong" — a claim that is false when you are
     * contributing to a total, because there is nobody whose wrongness helps
     * you.
     *
     * That is also the "only runs match_play" wrong build: it never passes
     * pointsMode, so it never sees this.
     */
    const out = ids(MATCHES, true);
    expect(out).not.toContain("head-to-head");
    expect(out).not.toContain("edge");
    expect(out).toContain("points-placement");
  });

  it("does not use two-team language in the points paragraph", () => {
    // "the higher total takes the points" is the team_totals sentence and is
    // wrong at four teams — the payout is a POSITION, not a winner.
    const para = explanationCopy(MATCHES, slate(3), { pointsMode: true }).find(
      (p) => p.id === "points-placement"
    )!;
    expect(para.text).not.toContain("higher total");
    expect(para.text).toContain("finish in order");
  });

  it("still renders head-to-head in a MATCH-PLAY cup — the control", () => {
    // Without this, a build that dropped the paragraphs unconditionally would
    // pass every case above.
    const out = ids(MATCHES, false);
    expect(out).toContain("head-to-head");
    expect(out).toContain("edge");
    expect(out).not.toContain("points-placement");
  });

  it("replaces the team-totals sentence too, not only head-to-head", () => {
    const TEAMS: SheetSettings = { useConfidence: false, rollUp: "team_totals" };
    expect(ids(TEAMS, true)).toContain("points-placement");
    expect(ids(TEAMS, true)).not.toContain("team-totals");
    expect(ids(TEAMS, false)).toContain("team-totals");
  });
});
