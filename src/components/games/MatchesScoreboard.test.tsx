import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchesScoreboard, toggleMatchResult, type MatchScoreRow } from "./MatchesScoreboard";

/**
 * The scoreboard-page counterpart to `NonGolfSettingsRows.matches.test.tsx` —
 * same tool (`renderToStaticMarkup`, no RTL/jsdom in this repo), same reason:
 * this component is fully presentational (no tRPC hooks), unlike
 * `NonGolfScoreboard` itself, which owns `trpc.useUtils()` and can't render
 * outside a provider — so the branch DECISION (`isMatches`) is proven by
 * `matches.setResult.test.ts`'s integration coverage and by reading the code
 * (it now goes through `isMatchesGame`, the shared predicate, not a re-typed
 * comparison — see that file's commit), and this file proves what renders
 * ONCE the branch is taken.
 */

const singles = (
  id: string,
  aId: string,
  bId: string,
  result: MatchScoreRow["result"] = null,
  pointValue: number | null = null
): MatchScoreRow => ({
  id,
  number: Number(id) + 1,
  aPlayers: [{ id: aId, name: `A${aId}`, teamColor: "#ef4444" }],
  bPlayers: [{ id: bId, name: `B${bId}`, teamColor: "#3b82f6" }],
  result,
  pointValue,
});

const doubles = (id: string, result: MatchScoreRow["result"] = null): MatchScoreRow => ({
  id,
  number: Number(id) + 1,
  aPlayers: [
    { id: `${id}a1`, name: "Red One", teamColor: "#ef4444" },
    { id: `${id}a2`, name: "Red Two", teamColor: "#ef4444" },
  ],
  bPlayers: [
    { id: `${id}b1`, name: "Blue One", teamColor: "#3b82f6" },
    { id: `${id}b2`, name: "Blue Two", teamColor: "#3b82f6" },
  ],
  result,
  pointValue: null,
});

const render = (matches: MatchScoreRow[], canEdit = true) =>
  renderToStaticMarkup(<MatchesScoreboard matches={matches} onPick={() => {}} canEdit={canEdit} />);

describe("MatchesScoreboard", () => {
  it("empty pairing grid reads a neutral message, not an error", () => {
    const html = render([]);
    expect(html).toContain("No matches paired yet");
    expect(html).toContain("data-testid=\"matches-scoreboard-empty\"");
  });

  it("renders one three-way choice per match, labelled by match number", () => {
    const html = render([singles("0", "u1", "u2"), singles("1", "u3", "u4")]);
    expect(html).toContain("Match 1");
    expect(html).toContain("Match 2");
    expect(html).toContain('data-testid="match-0-win-a"');
    expect(html).toContain('data-testid="match-0-draw"');
    expect(html).toContain('data-testid="match-0-win-b"');
    expect(html).toContain('data-testid="match-1-win-a"');
  });

  it("a declared result selects its row and dims the other two — reflects `result`, not local state", () => {
    // Exact CSS markers `OutcomeChoiceRow` emits (confirmed by inspecting
    // its actual rendered output, not guessed): a SELECTED row's checkmark
    // fills with the side's color; an unselected row's checkmark stays
    // transparent AND its outer wrapper drops to opacity:0.5. Both must move
    // together, on the RIGHT row, for `result` to be proven as the control —
    // a build wired to local click state instead would render every row
    // "nothing selected" on a fresh render exactly like this one.
    const html = render([singles("0", "u1", "u2", "a_win")]);
    expect(html).toContain('data-testid="match-0-win-a"');

    // side A (win-a) is a_win's color, filled in — selected
    expect(html).toMatch(/data-testid="match-0-win-a"[^]*?background:#ef4444;color:var\(--color-bt-on-accent\)/);
    // Halved and side B are NOT selected — checkmark stays empty, row dims
    expect(html).toMatch(/data-testid="match-0-draw"[^]*?opacity:0\.5/);
    expect(html).toMatch(/data-testid="match-0-draw"[^]*?background:transparent;color:transparent/);
    expect(html).toMatch(/data-testid="match-0-win-b"[^]*?opacity:0\.5/);
    expect(html).toMatch(/data-testid="match-0-win-b"[^]*?background:transparent;color:transparent/);

    // An undecided render of the SAME match has none of the above — nothing
    // filled, nothing dimmed. Confirms the markers are `result`-driven, not
    // present unconditionally in every render.
    const undecided = render([singles("0", "u1", "u2", null)]);
    expect(undecided).not.toMatch(/background:#ef4444;color:var\(--color-bt-on-accent\)/);
    expect(undecided).not.toContain("opacity:0.5");
  });

  it("2v2 matches render stacked side chips (both player names), not a compound single label", () => {
    const html = render([doubles("0")]);
    expect(html).toContain("Red One");
    expect(html).toContain("Red Two");
    expect(html).toContain("Blue One");
    expect(html).toContain("Blue Two");
  });

  it("!canEdit disables every choice (a viewer, not an editor)", () => {
    const html = render([singles("0", "u1", "u2")], false);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(3); // all 3 rows
  });

  it("each match is its own bordered card with a header showing MATCH N, FINAL once decided, and its point value (feedback: separation + the golf header line)", () => {
    const decided = render([singles("0", "u1", "u2", "a_win", 6)]);
    expect(decided).toContain("Match 1");
    expect(decided).toContain("FINAL");
    expect(decided).toContain('data-testid="points-at-stake"');
    expect(decided).toContain(">6<"); // PointsAtStake's value span
    // The card boundary itself — background+border+radius on the match's own
    // wrapper, not just the eyebrow that used to float above three bare rows.
    expect(decided).toMatch(/data-testid="matches-scoreboard-match-0"[^]{0,80}border:1px solid var\(--color-bt-border\)/);

    const undecided = render([singles("0", "u1", "u2", null, 6)]);
    expect(undecided).not.toContain("FINAL");
    expect(undecided).toContain('data-testid="points-at-stake"'); // still worth showing pre-decision
  });

  it("a match worth nothing (no override, no even share) renders no points chip — PointsAtStake's own null-for-zero contract", () => {
    const html = render([singles("0", "u1", "u2", null, 0)]);
    expect(html).not.toContain('data-testid="points-at-stake"');
  });
});

describe("toggleMatchResult — tap-again-to-clear (feedback: no way to undo a mis-tap)", () => {
  it("tapping an undecided match's choice selects it", () => {
    expect(toggleMatchResult(null, "a_win")).toBe("a_win");
  });

  it("tapping the ALREADY-selected choice again clears it back to undecided", () => {
    expect(toggleMatchResult("a_win", "a_win")).toBeNull();
    expect(toggleMatchResult("halve", "halve")).toBeNull();
    expect(toggleMatchResult("b_win", "b_win")).toBeNull();
  });

  it("tapping a DIFFERENT choice switches to it — does not clear", () => {
    expect(toggleMatchResult("a_win", "b_win")).toBe("b_win");
    expect(toggleMatchResult("a_win", "halve")).toBe("halve");
  });
});
