import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArmedWarning, ConfirmDeleteButton } from "./ConfirmDeleteButton";

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
    //
    // The ATTRIBUTE, not the word: every button here carries the Tailwind class
    // `disabled:opacity-40`, so `toContain("disabled")` was true of an ENABLED
    // button too (CLAUDE.md's ninth inert instrument, the same file's sibling).
    // The control below proves this form can tell the two apart.
    const pending = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} pending />
    );
    const idle = renderToStaticMarkup(<ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} />);
    expect(pending).toContain('disabled=""');
    expect(idle).not.toContain('disabled=""');
  });
});

/**
 * The `warning` arm (PR 8d-3): the action goes ahead, and arming says what it
 * means first. Same placement rule as `blocked` — nothing at rest — and,
 * unlike `blocked`, the confirm is REACHABLE from the warning.
 *
 * The armed state is behind a click and this suite renders statically, so the
 * armed markup is asserted through `ArmedWarning`, the component the button
 * renders when armed with a warning.
 */
describe("ConfirmDeleteButton — warning", () => {
  const WARNING = <p>Their history stays</p>;

  it("renders identically at rest with or without a warning — nobody reads one they didn't ask for", () => {
    const warned = renderToStaticMarkup(
      <ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} warning={WARNING} />
    );
    const plain = renderToStaticMarkup(<ConfirmDeleteButton label="Remove from trip" onConfirm={() => {}} />);
    expect(warned).toBe(plain);
    expect(warned).not.toContain("history stays");
  });

  it("armed: the warning AND a live confirm, in one panel", () => {
    const html = renderToStaticMarkup(
      <ArmedWarning
        warning={WARNING}
        pending={false}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        testId="remove-member"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    expect(html).toContain('data-testid="confirm-warning"');
    expect(html).toContain("Their history stays");
    // The confirm is the element carrying the caller's testId, and it is live.
    const confirm = html.match(/<button[^>]*data-testid="remove-member"[^>]*>/)?.[0];
    expect(confirm, "the confirm button is rendered").toBeTruthy();
    expect(confirm).not.toContain('disabled=""');
  });

  it("armed and pending: the confirm is held", () => {
    const html = renderToStaticMarkup(
      <ArmedWarning
        warning={WARNING}
        pending
        confirmLabel="Leave"
        pendingLabel="Leaving…"
        testId="leave-trip"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    const confirm = html.match(/<button[^>]*data-testid="leave-trip"[^>]*>/)?.[0];
    expect(confirm).toContain('disabled=""');
    expect(html).toContain("Leaving…");
  });

  it("takes the caller's icon in place of the trash can", () => {
    const html = renderToStaticMarkup(
      <ConfirmDeleteButton label="Leave trip" onConfirm={() => {}} icon={<span data-icon="leave" />} />
    );
    const trash = renderToStaticMarkup(<ConfirmDeleteButton label="Leave trip" onConfirm={() => {}} />);
    expect(html).toContain('data-icon="leave"');
    // The default icon is gone, not added beside the caller's.
    expect(html.match(/<svg/g)?.length ?? 0).toBe(0);
    expect(trash.match(/<svg/g)?.length ?? 0).toBe(1);
  });
});
