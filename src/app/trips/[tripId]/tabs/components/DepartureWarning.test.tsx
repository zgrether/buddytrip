import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DepartureWarning, type DepartureSummary } from "./DepartureWarning";
import { linkSettings } from "./LeaveTripButton";

/**
 * The departure confirms (PR 8d-3, after Zach's look): the title, plus ONE
 * line only when the person is in an expense — nothing else.
 *
 * The copy was ruled word for word, so it is pinned by the sheet's whole
 * visible text, not by fragments: a `toContain` on a fragment would pass a
 * sheet that grew a second sentence again, which is the regression the look
 * was about.
 */

const summary = (over: Partial<DepartureSummary> = {}, money = { expensesPaid: 0, expenseSplits: 0 }): DepartureSummary => ({
  hasHistory: false,
  history: { games: [], ...money },
  ownerRefusal: null,
  tripTitle: "Lake Week",
  displayName: "Biscuit",
  ownerName: "Zach",
  ...over,
});

/** The sheet's visible text, entities decoded. */
const text = (html: string) =>
  html
    .replace(/<\/p><p/g, "</p> <p")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

describe("Leave — the person leaving", () => {
  it("not in an expense: the title, and nothing else", () => {
    const html = renderToStaticMarkup(<DepartureWarning who="self" summary={summary()} />);
    expect(text(html)).toBe("Leave Lake Week?");
  });

  it("in expenses: one line, counting paid and split-into together, naming the Owner", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning who="self" summary={summary({}, { expensesPaid: 1, expenseSplits: 2 })} />
    );
    expect(text(html)).toBe("Leave Lake Week? You’re part of 3 expenses here — check back with Zach to settle up.");
  });

  it("one expense is singular", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning who="self" summary={summary({}, { expensesPaid: 0, expenseSplits: 1 })} />
    );
    expect(text(html)).toBe("Leave Lake Week? You’re part of 1 expense here — check back with Zach to settle up.");
  });

  it("games are history the app keeps — they never reach the sheet", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning
        who="self"
        summary={summary({
          hasHistory: true,
          history: {
            games: [{ gameId: "g1", gameName: "Saturday Stroke", reasons: ["scores"], hasScores: true }],
            expensesPaid: 0,
            expenseSplits: 0,
          },
        })}
      />
    );
    expect(text(html)).toBe("Leave Lake Week?");
  });
});

describe("Remove — someone being removed", () => {
  it("not in an expense: the title, and nothing else", () => {
    const html = renderToStaticMarkup(<DepartureWarning who="them" summary={summary()} />);
    expect(text(html)).toBe("Remove Biscuit from Lake Week?");
  });

  it("in an expense: the remover's line, never the leaver's", () => {
    const html = renderToStaticMarkup(
      <DepartureWarning who="them" summary={summary({}, { expensesPaid: 1, expenseSplits: 0 })} />
    );
    expect(text(html)).toBe("Remove Biscuit from Lake Week? They’re part of 1 expense here — settle up with them.");
  });
});

describe("the Owner's refusal links Trip settings", () => {
  const MESSAGE = "You own Lake Week. Transfer ownership in Trip settings, then you can leave.";

  it("with an opener, the place name becomes the link and the sentence is otherwise unchanged", () => {
    const html = renderToStaticMarkup(<p>{linkSettings(MESSAGE, () => {})}</p>);
    expect(html).toMatch(/<button[^>]*data-testid="leave-open-trip-settings"[^>]*>Trip settings<\/button>/);
    expect(text(html)).toBe(MESSAGE);
  });

  it("without one, plain text — never a link to nothing", () => {
    const html = renderToStaticMarkup(<p>{linkSettings(MESSAGE, null)}</p>);
    expect(html).not.toContain("<button");
    expect(text(html)).toBe(MESSAGE);
  });
});
