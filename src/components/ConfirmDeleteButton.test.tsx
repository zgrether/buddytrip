import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

/**
 * The `blocked` arm (#1034).
 *
 * The bug this pins is PLACEMENT, not content: the crew-member modal replaced
 * its Delete button with an always-visible "Can't remove them yet" panel, so
 * everyone opening the modal read a list of blocking games and expenses whether
 * or not they were removing anyone — and the majority case (nothing blocking)
 * paid for it too.
 *
 * ── Why the negative assertion is the load-bearing one ─────────────────────
 * "The button renders" alone is weak — a component that ignored `blocked`
 * entirely would satisfy it. The assertion that the OLD shape cannot satisfy is
 * that the explanation is ABSENT from the resting state, because the old shape
 * was the explanation and nothing else. Both halves are asserted together.
 *
 * Rendered with `renderToStaticMarkup` (no RTL/jsdom in this repo — same
 * convention as `MatchEntryView.test.tsx`), so this covers the RESTING state.
 * The armed state is not reachable without a click; its behaviour is stated in
 * the component and left to the device pass.
 */

const BLOCKER = <p>Can&rsquo;t remove them yet</p>;

describe("ConfirmDeleteButton — blocked", () => {
  it("still renders the action when blocked — it is not replaced", () => {
    const html = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} blocked={BLOCKER} />
    );
    expect(html).toContain("Remove from trip");
  });

  it("does NOT show the explanation until the action is attempted", () => {
    const html = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} blocked={BLOCKER} />
    );
    // The reported complaint, stated as an assertion the OLD shape fails:
    // the blocker content was the resting state.
    expect(html).not.toContain("remove them yet");
    // …and the panel container the explanation lives in is absent too, so this
    // can't pass merely because the copy was reworded.
    expect(html).not.toContain('data-testid="removal-blocked"');
  });

  it("renders identically blocked or not, at rest", () => {
    // The resting state must not leak whether the action is currently refused —
    // that is what makes the majority case frictionless.
    const blocked = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} blocked={BLOCKER} />
    );
    const free = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} />
    );
    expect(blocked).toBe(free);
  });

  it("pending disables the resting button, so an unresolved guard can't be armed", () => {
    // MemberEditor passes the guard's own `isPending` here: before the answer
    // arrives, `blocked` is undefined only because it is unknown.
    const html = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} pending />
    );
    expect(html).toContain("disabled");
  });
});
