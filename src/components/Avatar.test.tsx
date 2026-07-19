import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./Avatar";

// Progressive degradation (disk → dot → drop) is driven by container-query
// variant classes the Avatar emits; the actual collapse happens in-browser
// against a parent `@container` (verified live). These tests pin the CONTRACT:
// what classes/markup the component renders, so the tier thresholds and the
// "off by default" guarantee can't silently regress. Rendered via
// react-dom/server (node env, no RTL).

describe("Avatar — collapse OFF (default, the 39 non-opted call sites)", () => {
  const html = renderToStaticMarkup(<Avatar name="Zach Grether" />);

  it("emits no container-query classes and no dot sibling", () => {
    expect(html).not.toContain("@max-");
    // no aria-hidden dot span — just the single labelled disk
    expect(html).toContain("initials");
    expect(html).not.toContain('aria-hidden="true"');
  });
});

describe("Avatar — collapse ON, default 'row' tier", () => {
  const html = renderToStaticMarkup(<Avatar name="Zach Grether" collapse />);

  it("hides the disk below the dot threshold (280px)", () => {
    expect(html).toContain("@max-[280px]:hidden");
  });

  it("renders a dot sibling that fills the 220–280 band then drops below 220", () => {
    // dot is hidden by default (no @container ancestor → disk-only, safe),
    // revealed in the band, hidden again below the drop threshold.
    expect(html).toContain("@max-[280px]:inline-flex");
    expect(html).toContain("@max-[220px]:hidden");
    expect(html).toContain('aria-hidden="true"');
  });

  it("dot is muted-neutral when no team color", () => {
    expect(html).toContain("var(--color-bt-text-dim)");
  });
});

describe("Avatar — collapse dot carries the team color in competition mode", () => {
  const html = renderToStaticMarkup(
    <Avatar name="Zach Grether" teamColor="#3b82f6" collapse />
  );
  it("uses the team color as the dot background", () => {
    expect(html).toContain("#3b82f6");
    expect(html).toContain("@max-[280px]:inline-flex"); // still the row tier
  });
});

describe("Avatar — collapseAt tiers select different thresholds", () => {
  it("'dense' → 300/240 (stat-heavy rows)", () => {
    const html = renderToStaticMarkup(<Avatar name="A" collapse collapseAt="dense" />);
    expect(html).toContain("@max-[300px]:hidden");
    expect(html).toContain("@max-[240px]:hidden");
  });

  it("'chip' → 130/92 (chips, grid cells, narrow containers)", () => {
    const html = renderToStaticMarkup(<Avatar name="A" collapse collapseAt="chip" />);
    expect(html).toContain("@max-[130px]:hidden");
    expect(html).toContain("@max-[92px]:hidden");
  });
});
