import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ZoneHeader } from "./ZoneHeader";

// The shared section divider (Spec 6) — non-golf settings reuse it for golf-parity
// grouping. Rendered via react-dom/server (node env, no RTL).
describe("ZoneHeader", () => {
  const html = renderToStaticMarkup(<ZoneHeader>Game Management</ZoneHeader>);

  it("renders the caption text", () => {
    expect(html).toContain("Game Management");
  });

  it("is a quiet uppercase, token-styled caption with a hairline rule", () => {
    expect(html).toContain("uppercase");
    expect(html).toContain("var(--color-bt-text-dim)"); // caption color token
    expect(html).toContain("var(--color-bt-border)"); // the trailing rule token
  });
});
