import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeKeypad } from "./StrokeKeypad";

/**
 * THE ERROR TAKES THE KEYPAD CAPTION'S LINE.
 *
 * The keypad was falling below the fold on a 2v2 with two-line names, so the
 * error could not have its own row. The caption's line already exists and an
 * error outranks knowing whose score you are typing.
 */

const base = {
  participantName: "JD Shumpert & Tyler Larson",
  value: null,
  onCommit: () => {},
  onClear: () => {},
  onConfirm: () => {},
};

const render = (over: Partial<Parameters<typeof StrokeKeypad>[0]> = {}) =>
  renderToStaticMarkup(<StrokeKeypad {...base} {...over} />);

describe("the keypad's error slot", () => {
  it("shows the caption when there is nothing wrong", () => {
    const html = render();
    expect(html).toContain("Enter score");
    expect(html).not.toContain("keypad-error");
  });

  /**
   * IT REPLACES the caption rather than joining it — that is what makes it cost
   * no vertical, and it is the assertion a build that appended an error row
   * would fail while looking correct in a screenshot.
   */
  it("replaces the caption, and does not sit beside it", () => {
    const html = render({ error: { text: "Tyler’s score didn’t save" } });
    expect(html).toContain("keypad-error");
    expect(html).not.toContain("Enter score");
  });

  /**
   * IT MUST READ AS AN ERROR, not merely as different text in the same place.
   *
   * The requirement was explicit, and the failure mode is a build that swaps the
   * string and keeps the caption's dim 13px — which passes "the message is
   * there" and communicates nothing. So the assertion is the TREATMENT:
   * `UnsavedScoresBanner`'s danger tint and border, reused rather than a second
   * error language invented for one slot.
   */
  it("carries the shared danger treatment, not the caption's", () => {
    const html = render({ error: { text: "Tyler’s score didn’t save" } });
    const slot = html.match(/data-testid="keypad-error"[^>]*style="([^"]*)"/)?.[1];
    expect(slot, "the error slot was not found").toBeDefined();
    expect(slot).toContain("var(--color-bt-danger-faint)");
    expect(slot).toContain("var(--color-bt-danger-border)");
    expect(html).toContain('role="alert"');
  });

  /**
   * THE RETRY TRAVELS WITH THE MESSAGE. The copy this replaced said "retry
   * above" while "above" already named two different controls — the banner's
   * Retry-all and the row's per-cell badge — and the row area can be scrolled
   * or covered by the keypad itself. A control in the same element beats a
   * direction to one somewhere else.
   */
  it("offers Retry in the same element as the message", () => {
    const html = render({ error: { text: "Tyler’s score didn’t save", onRetry: () => {} } });
    expect(html).toContain("keypad-error-retry");
    const slotStart = html.indexOf('data-testid="keypad-error"');
    const retryAt = html.indexOf('data-testid="keypad-error-retry"');
    const slotEnd = html.indexOf("</div>", retryAt);
    expect(retryAt).toBeGreaterThan(slotStart);
    expect(slotEnd).toBeGreaterThan(retryAt);
  });

  /**
   * AND IT IS HIDDEN WHEN IT CANNOT WORK — the #1230 rule. A terminally refused
   * cell passes no `onRetry`, and offering a button that can never succeed is
   * the refusal-with-no-action defect this codebase has already paid for twice.
   */
  it("shows no Retry when the failure is not retryable", () => {
    const html = render({ error: { text: "That round is posted" } });
    expect(html).toContain("keypad-error");
    expect(html).not.toContain("keypad-error-retry");
  });
});
