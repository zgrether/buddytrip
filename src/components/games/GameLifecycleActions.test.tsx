import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameLifecycleActions } from "./GameLifecycleActions";
import { RELOCK_BLOCKED_HOLES, RELOCK_BLOCKED_MATCHES } from "@/lib/gameLifecycle";

/**
 * #1431 — "Save scoring changes" in a correction that has left the game
 * incomplete: shown DISABLED with a line naming what enables it (Zach), not
 * hidden and not live.
 *
 * Anchors are attributes, not words: every button here carries the Tailwind
 * class `disabled:opacity-40`, so `toContain("disabled")` is true of an
 * ENABLED button. `disabled=""` is what React renders for the attribute itself.
 */

const noop = () => {};
const correcting = (over: Partial<Parameters<typeof GameLifecycleActions>[0]> = {}) =>
  renderToStaticMarkup(
    <GameLifecycleActions
      canEdit
      status="complete"
      correctionsOpen
      allComplete={false}
      onFinalize={noop}
      onCorrect={noop}
      {...over}
    />
  );

describe("Save scoring changes while a correction leaves the game incomplete", () => {
  it("renders the button disabled, with the match line by default", () => {
    const html = correcting();
    expect(html).toContain('data-testid="game-relock"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-testid="game-relock-blocked"');
    expect(html).toContain(`>${RELOCK_BLOCKED_MATCHES}</p>`);
  });

  it("takes the holes line where the format has no matches (stroke, skins)", () => {
    const html = correcting({ relockBlockedLine: RELOCK_BLOCKED_HOLES });
    expect(html).toContain(`>${RELOCK_BLOCKED_HOLES}</p>`);
    expect(html).not.toContain(RELOCK_BLOCKED_MATCHES);
  });

  it("control: a complete correction renders the button live, with no line", () => {
    const html = correcting({ allComplete: true });
    expect(html).toContain('data-testid="game-relock"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="game-relock-blocked"');
  });

  it("shows a non-editor nothing at all — hidden, never disabled", () => {
    const html = correcting({ canEdit: false });
    expect(html).not.toContain('data-testid="game-relock"');
    expect(html).not.toContain('data-testid="game-relock-blocked"');
  });
});

describe("Save results when finalize would refuse the split (#1679)", () => {
  const LINE = "This split awards points to 3 places, but only 2 can finish. Change it in settings.";
  const ready = (over: Partial<Parameters<typeof GameLifecycleActions>[0]> = {}) =>
    renderToStaticMarkup(
      <GameLifecycleActions canEdit status="active" correctionsOpen={false} allComplete onFinalize={noop} onCorrect={noop} {...over} />
    );

  it("stays where it is, disabled, with the reason under it", () => {
    const html = ready({ finalizeBlockedLine: LINE });
    expect(html).toContain('data-testid="game-finalize"');
    expect(html).toContain('disabled=""');
    expect(html).toContain(`data-testid="game-finalize-blocked"`);
    expect(html).toContain(`>${LINE}</p>`);
  });

  it("CONTROL: with nothing to refuse it is live and says nothing", () => {
    const html = ready();
    expect(html).toContain('data-testid="game-finalize"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="game-finalize-blocked"');
  });

  it("a correction's Save scoring changes is held by the same refusal", () => {
    const html = renderToStaticMarkup(
      <GameLifecycleActions canEdit status="complete" correctionsOpen allComplete onFinalize={noop} onCorrect={noop} finalizeBlockedLine={LINE} />
    );
    expect(html).toContain('data-testid="game-relock"');
    expect(html).toContain('disabled=""');
    expect(html).toContain(`>${LINE}</p>`);
  });
});
