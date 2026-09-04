import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveProgressBar, SettingsSaveBar } from "./SettingsSaveBar";
import { SAVE_PROGRESS_DONE } from "@/lib/saveProgress";

/**
 * The save bar's progress indicator — the RENDERED half.
 *
 * `saveProgress.test.ts` owns the curve. This owns what reaches the screen, and
 * the two facts that are easy to get wrong in a way no curve test can see:
 * the fill's width must track the number it is given, and the bar must be
 * ABSENT when nothing is saving.
 *
 * Anchored to `data-testid`, not to the percentage text or a class — a width
 * assertion on a substring like "90" would be satisfied by any number in the
 * markup, and this component renders inside a bar that carries other numbers.
 */

const noop = () => {};
const bar = (percent: number) => renderToStaticMarkup(<SaveProgressBar percent={percent} />);

describe("SaveProgressBar", () => {
  it("sets the fill width from the percent it is given", () => {
    expect(bar(0)).toContain("width:0%");
    expect(bar(45.5)).toContain("width:45.5%");
    expect(bar(SAVE_PROGRESS_DONE)).toContain("width:100%");
  });

  it("is announced as INDETERMINATE — a progressbar with no aria-valuenow", () => {
    // Deliberate, and the assertion is the negative one: the client cannot know
    // how far through the save it is, so announcing a number would claim more to
    // a screen-reader user than the pixels claim to a sighted one.
    const html = bar(60);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Saving"');
    expect(html).not.toContain("aria-valuenow");
  });

  it("uses palette tokens, never a literal colour", () => {
    // STYLE_GUIDE / CLAUDE.md: no hardcoded hex or rgba anywhere in the app.
    const html = bar(50);
    expect(html).toContain("var(--color-bt-accent)");
    expect(html).toContain("var(--color-bt-card-raised)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("rgba(");
  });
});

describe("SettingsSaveBar shows the progress bar only while saving", () => {
  const props = {
    saveState: "ready" as const,
    error: null,
    onSave: async () => true,
    onDiscard: noop,
    onLeave: noop,
  };

  it("renders NO progress bar on an idle, dirty page", () => {
    // The state a runner is in for all but a few seconds of their session. A bar
    // sitting at 0% under the buttons would read as a stalled save.
    const html = renderToStaticMarkup(<SettingsSaveBar {...props} saving={false} />);
    expect(html).not.toContain('data-testid="save-progress"');
    expect(html).toContain('data-testid="settings-save"');
  });

  it("renders the progress bar while saving", () => {
    const html = renderToStaticMarkup(<SettingsSaveBar {...props} saving={true} />);
    expect(html).toContain('data-testid="save-progress"');
    expect(html).toContain('data-testid="save-progress-fill"');
  });

  it("does not disturb what the bar already did — Saving…, and both controls disabled", () => {
    // The pre-existing contract, asserted here because this change adds an
    // element INTO that row: a second tap must stay inert, and Cancel must stay
    // disabled mid-write. Anchored to the rendered attribute rather than the
    // word "disabled", which every button in this file carries as a Tailwind
    // class (`disabled:opacity-40`) whether or not the attribute is set.
    const html = renderToStaticMarkup(<SettingsSaveBar {...props} saving={true} />);
    expect(html).toContain("Saving…");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
