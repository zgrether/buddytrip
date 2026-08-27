import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemDeadlineRow,
  toLocalInputValue,
  fromLocalInputValue,
  formatDeadline,
} from "./PickemDeadlineRow";

/**
 * The deadline — the only pressure the game has, since reminders need a
 * scheduler and are deferred.
 *
 * The conversion helpers get the closest attention, because a timezone slip
 * here is silent: the runner sets 11:00, the input reads back 06:00, and
 * nothing errors.
 */

const render = (over: Partial<Parameters<typeof PickemDeadlineRow>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemDeadlineRow deadline={null} editable busy={false} onChange={() => {}} {...over} />
  );

describe("local ↔ instant conversion", () => {
  it("ROUND-TRIPS an instant through the input's local wall clock", () => {
    // The property that matters: set a time, reload, see the same time. A
    // `toISOString()` slice would pass a naive equality test while displaying
    // the UTC hour, so this asserts the round trip rather than the format.
    const iso = new Date(2026, 10, 8, 11, 0).toISOString();
    expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
  });

  it("renders the LOCAL hour, not the UTC one", () => {
    // Constructed in local time, so the input value must show that same hour
    // whatever zone the machine is in — which is exactly what `toISOString()`
    // would get wrong.
    const local = new Date(2026, 10, 8, 11, 30);
    expect(toLocalInputValue(local.toISOString())).toContain("T11:30");
  });

  it("treats an empty input as no deadline, not as an invalid date", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
  });

  it("refuses to invent a date from garbage", () => {
    // `new Date("nonsense")` is Invalid Date, whose toISOString() throws. A
    // deadline that throws on save is worse than one that does not set.
    expect(fromLocalInputValue("not-a-date")).toBeNull();
    expect(toLocalInputValue("not-a-date")).toBe("");
    expect(formatDeadline("not-a-date")).toBe("");
  });
});

describe("the row", () => {
  it("says there is no deadline when there is none — not a blank field", () => {
    const html = render({ deadline: null });
    expect(html).toContain("No deadline");
    expect(html).toContain("lock them by hand");
  });

  it("states the time and that sheets lock themselves", () => {
    const html = render({ deadline: new Date(2026, 10, 8, 11, 0).toISOString() });
    expect(html).toContain("Sheets lock automatically");
    expect(html).toContain("11:00");
  });

  it("warns that NOBODY IS NOTIFIED — the countdown is the whole mechanism", () => {
    // Reminders are deferred for want of a scheduler. A runner who assumes a
    // notification is coming will not chase anyone.
    expect(render()).toContain("Nobody is notified");
  });

  it("offers Clear only when there is something to clear", () => {
    expect(render({ deadline: null })).not.toContain('data-testid="pickem-deadline-clear"');
    expect(render({ deadline: new Date().toISOString() })).toContain(
      'data-testid="pickem-deadline-clear"'
    );
  });

  it("READ-ONLY when not editable — the state is still shown, the control is not", () => {
    // `editable` is now purely "can this person edit the game", not a phase
    // restriction: migration 153 gave the deadline its own single-column write,
    // so a member sees the state and no control, and a runner sees both in
    // every phase.
    const html = render({ editable: false, deadline: new Date(2026, 10, 8, 11, 0).toISOString() });
    expect(html).toContain("Sheets lock automatically");
    expect(html).not.toContain('data-testid="pickem-deadline-input"');
    expect(html).not.toContain('data-testid="pickem-deadline-save"');
  });

  it("uses a 16px input, or iOS zooms the page on focus", () => {
    expect(render()).toContain("font-size:16px");
  });

  it("Set is disabled until the value actually changes", () => {
    // Re-sending the same deadline would be a pointless write through an action
    // (`open`) that also touches other columns.
    const iso = new Date(2026, 10, 8, 11, 0).toISOString();
    const html = render({ deadline: iso });
    const at = html.indexOf('data-testid="pickem-deadline-save"');
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    expect(tag).toContain("disabled");
  });
});
