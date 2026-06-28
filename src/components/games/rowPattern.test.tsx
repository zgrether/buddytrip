import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DragHandle } from "./DragHandle";
import { RowNumber } from "./RowNumber";
import { PlayerChip } from "./PlayerChip";

// Matches/Handicaps shared row pattern (Phase 1b — RowGutter split into two
// independent grid cells). The primitives render in isolation (no live screen
// consumes them yet; visual verification lands in Phases 2/3 when wired in).
// Rendered via react-dom/server (the test env is node, no RTL).

describe("DragHandle", () => {
  it("renders the grip and forwards the arm handler (owns no drag state)", () => {
    const onMouseDown = vi.fn();
    const el = DragHandle({ onMouseDown }) as React.ReactElement<{ onMouseDown?: () => void }>;
    expect(el.props.onMouseDown).toBe(onMouseDown); // forwarded, not swallowed
    const html = renderToStaticMarkup(<DragHandle />);
    expect(html).toContain("Drag to reorder"); // the grip's aria-label/title
    expect(html).toContain("cursor-grab");
  });
});

describe("RowNumber", () => {
  it("renders the number as a quiet tabular-nums index — no handle", () => {
    const html = renderToStaticMarkup(<RowNumber number={3} />);
    expect(html).toContain(">3<");
    expect(html).toContain("tabular-nums");
    expect(html).not.toContain("Drag to reorder"); // independent of DragHandle
  });
});

describe("PlayerChip", () => {
  it("renders the name + a size-30 team-colored Avatar on the card-raised surface", () => {
    const html = renderToStaticMarkup(<PlayerChip name="Jeremy" teamColor="#ef4444" />);
    expect(html).toContain("Jeremy"); // name
    expect(html).toContain("#ef4444"); // team color → the avatar background (competition mode)
    expect(html).toContain("width:30px"); // Avatar sizePx 30 (the reconciled size, not 22)
    expect(html).toContain("var(--color-bt-card-raised)"); // the chip surface
  });

  it("renders the team INITIAL, never an avatarIcon", () => {
    const html = renderToStaticMarkup(<PlayerChip name="Rob Smith" teamColor="#a855f7" />);
    expect(html).toContain('aria-label="Rob Smith initials"'); // the initials path, not the icon path
  });
});
