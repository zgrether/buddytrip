import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelChip } from "./TravelChip";

// The shared travel chip — one component for arrivals AND departures. Rendered
// via react-dom/server (node env, no RTL); static markup reflects the COLLAPSED
// initial state (detail hidden, "Details" affordance shown). The tap-to-expand
// interaction (Details → Close, detail revealed + wrapped) is covered by-eye.
describe("TravelChip", () => {
  it("shows a teal Details toggle when there is a detail, with the detail hidden by default", () => {
    const html = renderToStaticMarkup(
      <TravelChip
        person={{ displayName: "Zach Grether", time: "08:15", detail: "Delta 1733, landing PNS — need a pickup" }}
      />
    );
    expect(html).toContain("Zach"); // first-name primary line
    expect(html).toContain("Details"); // teal toggle affordance
    expect(html).toContain("aria-expanded"); // it's an expandable button
    expect(html).toContain("<button");
    // Collapsed by default → the detail text is NOT rendered yet.
    expect(html).not.toContain("Delta 1733, landing PNS");
  });

  it("is inert single-line (no Details, not a button) when there is no detail", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Bob", time: "10:30", detail: null }} />
    );
    expect(html).not.toContain("Details");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<button");
  });

  it("treats whitespace-only detail as no detail (single-line)", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Ann", time: "09:00", detail: "   " }} />
    );
    expect(html).not.toContain("Details");
    expect(html).not.toContain("<button");
  });

  it("renders TBD for an untimed leg", () => {
    const html = renderToStaticMarkup(
      <TravelChip person={{ displayName: "Cara", time: null, detail: null }} />
    );
    expect(html).toContain("TBD");
  });
});
