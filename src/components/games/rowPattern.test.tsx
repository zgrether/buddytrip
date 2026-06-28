import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RowGutter } from "./RowGutter";
import { PlayerChip } from "./PlayerChip";

// Matches/Handicaps shared row pattern, Phase 1 — the primitives render in
// isolation (no live screen consumes them yet; visual verification lands in Phases
// 2/3 when wired in). Rendered via react-dom/server (the test env is node, no RTL).

describe("RowGutter", () => {
  it("renders the row number, with the drag handle by default", () => {
    const html = renderToStaticMarkup(<RowGutter number={3} />);
    expect(html).toContain(">3<"); // the number
    expect(html).toContain("Drag to reorder"); // the handle (aria-label/title)
  });

  it("hides the handle when showHandle=false but RESERVES its slot (alignment) + keeps the number", () => {
    const html = renderToStaticMarkup(<RowGutter number={1} showHandle={false} />);
    expect(html).toContain(">1<");
    expect(html).not.toContain("Drag to reorder"); // no handle
    expect(html).toContain("width:22px"); // the handle slot is still reserved so the number aligns
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
