import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UnsavedScoresBanner } from "./UnsavedScoresBanner";

/**
 * The banner's job after #1230: never name an action the reader cannot take.
 *
 * It used to render "N scores didn't save" + Retry for EVERY failure. For a
 * terminal refusal — a posted round, someone else's match — that button could
 * never succeed, so the only advice on screen did nothing, forever. The reader
 * had no way to tell which kind of failure they had.
 *
 * Rendered via `react-dom/server` (node env), matching the idiom in
 * `MatchOutcomeEntryView.test.tsx`.
 */

const html = (props: Parameters<typeof UnsavedScoresBanner>[0]) =>
  renderToStaticMarkup(<UnsavedScoresBanner {...props} />);

const noop = () => {};
const POSTED = "This round is posted — tap ‘Correct a score’ to reopen it.";

describe("UnsavedScoresBanner", () => {
  it("renders nothing when there is nothing unsaved", () => {
    expect(html({ count: 0, onRetry: noop })).toBe("");
  });

  it("TRANSIENT failure: keeps Retry, because retrying is the right advice", () => {
    // The unchanged case, asserted so the fix cannot quietly remove the button
    // from the failure it was correct for.
    const out = html({ count: 2, onRetry: noop });
    expect(out).toContain("didn’t save");
    expect(out).toContain("Retry");
    expect(out).not.toContain("wouldn’t save");
  });

  it("ALL REFUSED: drops Retry entirely and gives the server's reason", () => {
    // The defect, inverted. `<button` rather than the word "Retry" — the word
    // also appears in this file's own copy elsewhere, and a substring assertion
    // is only valid if nothing else in the region can produce it.
    const out = html({
      count: 1,
      onRetry: noop,
      refusals: { "p1:1": POSTED },
    });
    expect(out).not.toContain("<button");
    expect(out).toContain("wouldn’t save");
    expect(out).toContain(POSTED);
  });

  it("MIXED: keeps Retry — there is real work for it — and still explains", () => {
    // Two unsaved, one of them refused. Hiding Retry here would strand the
    // blip; hiding the reason would leave the count mysteriously stuck above
    // zero after a successful retry.
    const out = html({
      count: 2,
      onRetry: noop,
      refusals: { "p1:1": POSTED },
    });
    expect(out).toContain("<button");
    expect(out).toContain("didn’t save");
    expect(out).toContain(POSTED);
  });

  it("de-duplicates one reason across many cells", () => {
    // A posted round refuses every cell for the same reason. Sixteen identical
    // sentences is not an explanation, it is a wall.
    const out = html({
      count: 3,
      onRetry: noop,
      refusals: { "p1:1": POSTED, "p2:1": POSTED, "p3:1": POSTED },
    });
    const occurrences = out.split('data-testid="unsaved-scores-reason"').length - 1;
    expect(occurrences).toBe(1);
    // ...and with every cell refused, Retry is gone.
    expect(out).not.toContain("<button");
  });

  it("shows two DIFFERENT reasons separately", () => {
    const other = "You can only enter scores for your own match.";
    const out = html({
      count: 2,
      onRetry: noop,
      refusals: { "p1:1": POSTED, "p2:1": other },
    });
    expect(out).toContain(POSTED);
    expect(out).toContain(other);
    const occurrences = out.split('data-testid="unsaved-scores-reason"').length - 1;
    expect(occurrences).toBe(2);
  });

  it("is unchanged when the caller passes no refusals at all", () => {
    // Every existing call site before this change, and the outcome-entry views
    // that may have nothing to report.
    expect(html({ count: 1, onRetry: noop, refusals: {} })).toContain("<button");
    expect(html({ count: 1, onRetry: noop, refusals: undefined })).toContain("<button");
  });

  it("keeps role=alert on every path, so the failure is announced", () => {
    // The banner is the safety net for a hole the user has navigated away from
    // (see the component header). Losing the live region on the refused path
    // would make the worst case the quietest one.
    expect(html({ count: 1, onRetry: noop })).toContain('role="alert"');
    expect(html({ count: 1, onRetry: noop, refusals: { "p1:1": POSTED } })).toContain('role="alert"');
  });
});
