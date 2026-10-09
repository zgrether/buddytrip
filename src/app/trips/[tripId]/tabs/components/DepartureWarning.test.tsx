import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DepartureWarning, type DepartureHistory } from "./DepartureWarning";

/**
 * The words shown before someone leaves or is removed (PR 8d-3).
 *
 * Ruling 2's sentence is pinned EXACTLY: it was ruled word for word, and a
 * reworded copy would pass any `toContain` on a fragment.
 */

const RULING_2 = "You have expenses on this trip — you won’t be able to see them after you leave.";

const history = (over: Partial<DepartureHistory> = {}): DepartureHistory => ({
  games: [],
  expensesPaid: 0,
  expenseSplits: 0,
  ...over,
});

/** Visible text, entities decoded, tags dropped — what a reader sees. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("DepartureWarning — leaving (self)", () => {
  it("money: ruling 2's sentence, word for word", () => {
    const html = renderToStaticMarkup(<DepartureWarning who="self" history={history({ expenseSplits: 2 })} />);
    // Source uses a straight apostrophe in JSX; the renderer escapes it.
    expect(text(html).replace(/'/g, "’")).toContain(RULING_2);
    expect(text(html)).toContain("2 expenses — you're split into".replace(/'/g, "’"));
  });

  it("no money: the money sentence is absent, not shown with a zero", () => {
    const html = renderToStaticMarkup(<DepartureWarning who="self" history={history()} />);
    expect(text(html)).not.toContain("expenses");
    expect(text(html)).toContain("Leave this trip?");
  });

  it("games: each listed with what it holds", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning
        who="self"
        history={history({
          games: [
            { gameId: "g1", gameName: "Saturday Stroke", reasons: ["scores"], hasScores: true },
            { gameId: "g2", gameName: "Cornhole", reasons: ["result"], hasScores: false },
          ],
        })}
      />
    );
    expect(text(html)).toContain("Saturday Stroke — has scores");
    expect(text(html)).toContain("Cornhole — has a result");
  });
});

describe("DepartureWarning — removing someone (them)", () => {
  it("speaks about THEM, and never uses the leaver's money sentence", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning who="them" history={history({ expensesPaid: 1 })} />
    );
    const t = text(html).replace(/'/g, "’");
    expect(t).toContain("Their history stays");
    expect(t).toContain("1 expense — they paid");
    expect(t).not.toContain(RULING_2);
    expect(t).not.toMatch(/\byou\b/i);
  });
});
