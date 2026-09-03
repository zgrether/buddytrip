import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SettingsSaveBar,
  saveHintFor,
  NOT_READY_HINT,
  UNKNOWN_STATE_HINT,
} from "./SettingsSaveBar";
import type { SaveState } from "@/lib/configDraft";

/**
 * SettingsSaveBar (#1255) — the bar must say WHY Save is disabled.
 *
 * The defect being guarded against is a COLLAPSE: "nothing to change", "not known yet"
 * and "this will be refused" all rendered as the same grey button with no words. So the
 * assertions below are about the three states producing THREE DIFFERENT things, not
 * about any one of them producing the right string — a test that only checked one state
 * would pass against the very code this replaces.
 *
 * ── What is and isn't covered here ──────────────────────────────────────────────────
 * The suite is `environment: "node"` and renders via `renderToStaticMarkup`, so EFFECTS
 * DO NOT RUN. That is a limitation and also a convenience:
 *  - it lets the render tests assert the GRACE PERIOD directly (pre-effect is exactly
 *    the "not-ready, clock not yet elapsed" frame), and
 *  - it means the post-grace frame can only be reached through `saveHintFor`, which is
 *    why that function is exported and tested separately rather than only through JSX.
 * The timer itself (that `notReadyElapsed` flips after NOT_READY_GRACE_MS) is NOT
 * covered by this file. Stated rather than implied.
 */

/** The opening tag of one button, found by its testid — so an assertion about it cannot
 *  be satisfied by some other element in the markup (the substring corollary). */
function buttonTag(html: string, testId: string): string {
  const tags = html.match(/<button[^>]*>/g) ?? [];
  const found = tags.find((t) => t.includes(`data-testid="${testId}"`));
  if (!found) throw new Error(`no <button> carrying data-testid="${testId}"`);
  return found;
}

/** Is this button ACTUALLY disabled?
 *
 *  Matches the rendered ATTRIBUTE (`disabled=""`), not the word "disabled" — every
 *  button here carries the Tailwind class `disabled:opacity-40`, so a substring check
 *  reports true for all of them, enabled or not. Written the loose way first and caught
 *  by these tests failing: the exact shape CLAUDE.md's substring corollary describes,
 *  where the assertion looks specific and the haystack looks small. */
function isDisabled(tag: string): boolean {
  return /\sdisabled=""/.test(tag);
}

const noop = () => {};
const neverSaves = async () => false;

function render(props: {
  saveState: SaveState;
  saving?: boolean;
  error?: string | null;
  saveDisabledReason?: string | null;
}) {
  return renderToStaticMarkup(
    <SettingsSaveBar
      saveState={props.saveState}
      saving={props.saving ?? false}
      error={props.error ?? null}
      onSave={neverSaves}
      onDiscard={noop}
      onLeave={noop}
      saveDisabledReason={props.saveDisabledReason ?? null}
    />,
  );
}

describe("saveHintFor — the three states are distinguishable", () => {
  // The heart of the issue. If any two of these collapse to the same value, the button
  // is back to saying nothing.
  it("clean, elapsed not-ready, and blocked produce three DIFFERENT hints", () => {
    const clean = saveHintFor("clean", null, false);
    const notReady = saveHintFor("not-ready", null, true);
    const blocked = saveHintFor("clean", "Points must total 8 exactly.", false);

    expect(clean).toBeNull();
    expect(notReady).toEqual({ text: NOT_READY_HINT, tone: "quiet" });
    expect(blocked).toEqual({ text: "Points must total 8 exactly.", tone: "warning" });

    // Pairwise distinct — stated explicitly so a future change that merges any two of
    // them fails here rather than silently restoring the collapse.
    expect(notReady).not.toEqual(clean);
    expect(blocked).not.toEqual(clean);
    expect(blocked).not.toEqual(notReady);
  });

  it("says nothing at all when Save is available", () => {
    expect(saveHintFor("ready", null, false)).toBeNull();
    expect(saveHintFor("ready", null, true)).toBeNull();
  });

  it("stays silent through the grace period, then names the reload", () => {
    // A healthy settings open passes through `not-ready` for a few hundred ms. It must
    // not flash anything, or the hint becomes noise nobody reads.
    expect(saveHintFor("not-ready", null, false)).toBeNull();

    const elapsed = saveHintFor("not-ready", null, true);
    expect(elapsed?.tone).toBe("quiet");
    // NAMES AN ACTION (CLAUDE.md) — the whole point. Not just "can't save yet".
    expect(elapsed?.text).toContain("reload");
  });

  it("a load window is never dressed as a refusal", () => {
    // Tone is the distinction a reader actually sees. `quiet` is dim body text;
    // `warning` is amber with a border. Getting this backwards would report a problem
    // where there is only a wait — the empty-is-not-unknown failure in display form.
    expect(saveHintFor("not-ready", null, true)?.tone).toBe("quiet");
    expect(saveHintFor("clean", "anything", false)?.tone).toBe("warning");
  });

  it("a refusal outranks readiness, and is NOT gated on having edited first", () => {
    // The regression this guards: the old bar rendered the reason only on
    // `blocked && dirty`, so a page that would refuse your save said so only AFTER you
    // had done the work. `clean` here means nothing has been touched yet.
    const beforeAnyEdit = saveHintFor("clean", "5 places configured, 2 teams.", false);
    expect(beforeAnyEdit).toEqual({ text: "5 places configured, 2 teams.", tone: "warning" });

    // And it wins over the load window rather than being masked by it.
    expect(saveHintFor("not-ready", "5 places configured, 2 teams.", true)?.tone).toBe("warning");
  });

  it("an unknown state falls through to a SENTENCE, never to silence", () => {
    // `saveState` is a closed union and the `never` check fails the build first, so this
    // is unreachable today. It is asserted anyway because silence is the exact defect:
    // if a fourth member is ever added and someone forgets this switch, the button must
    // still say something rather than going quiet again.
    const bogus = "sideways" as unknown as SaveState;
    expect(saveHintFor(bogus, null, false)).toEqual({
      text: UNKNOWN_STATE_HINT,
      tone: "quiet",
    });
  });
});

describe("SettingsSaveBar — what the button does with each state", () => {
  it("enables Save only when ready", () => {
    expect(isDisabled(buttonTag(render({ saveState: "ready" }), "settings-save"))).toBe(false);
    expect(isDisabled(buttonTag(render({ saveState: "clean" }), "settings-save"))).toBe(true);
    expect(isDisabled(buttonTag(render({ saveState: "not-ready" }), "settings-save"))).toBe(true);
  });

  it("a blocked reason disables Save even when the draft is otherwise ready", () => {
    const html = render({ saveState: "ready", saveDisabledReason: "Points must total 8 exactly." });
    expect(isDisabled(buttonTag(html, "settings-save"))).toBe(true);
    expect(html).toContain('data-testid="settings-save-blocked"');
  });

  it("Cancel stays enabled in every disabled state — it means leave", () => {
    for (const s of ["clean", "not-ready", "ready"] as const) {
      expect(isDisabled(buttonTag(render({ saveState: s }), "settings-cancel"))).toBe(false);
    }
    // Only mid-save does Cancel go away.
    expect(isDisabled(buttonTag(render({ saveState: "ready", saving: true }), "settings-cancel"))).toBe(true);
  });

  it("renders nothing explanatory for clean, or for not-ready inside the grace period", () => {
    // Effects don't run under renderToStaticMarkup, so this IS the pre-grace frame.
    for (const s of ["clean", "not-ready"] as const) {
      const html = render({ saveState: s });
      expect(html).not.toContain('data-testid="settings-save-blocked"');
      expect(html).not.toContain('data-testid="settings-save-pending"');
    }
  });

  it("mid-save the hint yields to the button's own 'Saving…'", () => {
    const html = render({ saveState: "ready", saving: true, saveDisabledReason: "Points must total 8 exactly." });
    expect(html).not.toContain('data-testid="settings-save-blocked"');
    expect(isDisabled(buttonTag(html, "settings-save"))).toBe(true);
    expect(html).toContain("Saving");
  });

  it("a post-save error still renders in its own red slot, separately from the hint", () => {
    // `error` and `saveDisabledReason` are different things — a failed write vs a draft
    // that won't be accepted — and must not collapse into one another.
    const html = render({ saveState: "clean", error: "This game changed on another device." });
    expect(html).toContain('data-testid="settings-save-error"');
    expect(html).not.toContain('data-testid="settings-save-blocked"');
  });
});
