import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelChip } from "./TravelChip";

// The shared two-line travel chip (Part 1) — one component for arrivals AND
// departures. Rendered via react-dom/server (node env, no RTL). Static markup
// reflects the collapsed initial state; the tap-to-expand interaction is
// covered by-eye on preview.
describe("TravelChip", () => {
  it("renders the detail on a second line (previously invisible)", () => {
    const html = renderToStaticMarkup(
      <TravelChip
        person={{ displayName: "Zach Grether", time: "08:15", detail: "Delta 1733, landing PNS — need a pickup" }}
      />
    );
    expect(html).toContain("Zach"); // first-name primary line
    expect(html).toContain("Delta 1733, landing PNS"); // detail second line
  });

  it("truncates the collapsed detail line (one line + ellipsis affordance)", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Alice", time: "09:00", detail: "A very long travel detail that should be clamped" }} />
    );
    // Collapsed = the `truncate` utility (overflow-hidden + ellipsis + nowrap).
    expect(html).toContain("truncate");
  });

  it("is an expandable button only when there is detail", () => {
    const withDetail = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Alice", time: "09:00", detail: "Driving up from Charlotte" }} />
    );
    expect(withDetail).toContain("aria-expanded");
    expect(withDetail).toContain("<button");
  });

  it("stays single-line (no second line, inert) when there is no detail", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Bob", time: "10:30", detail: null }} />
    );
    // No expand affordance and not a button — nothing to expand.
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("truncate");
  });

  it("renders TBD for an untimed leg", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Cara", time: null, detail: null }} />
    );
    expect(html).toContain("TBD");
  });
});
