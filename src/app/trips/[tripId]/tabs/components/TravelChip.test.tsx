import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TravelChip } from "./TravelChip";
import type { TravelChipModel } from "./travelBands";

// The shared travel chip — one component for arrivals AND departures. Rendered
// via react-dom/server (node env, no RTL); static markup reflects the COLLAPSED
// initial state (detail hidden). The tap-to-expand interaction is covered
// by-eye — the affordance itself now lives in the card header's legend, not on
// the chip, so there is no per-chip "Details" label to assert on.

function chip(over: Partial<TravelChipModel> = {}): TravelChipModel {
  const names = over.names ?? ["Zach"];
  return {
    key: "k",
    time: "08:15",
    mode: "flying",
    detail: null,
    names,
    personCount: names.length,
    ...over,
  };
}

describe("TravelChip", () => {
  it("is an expandable button with the detail hidden by default", () => {
    const html = renderToStaticMarkup(
      <TravelChip
        chip={chip({ detail: "Delta 1733, landing PNS — need a pickup" })}
        direction="arrival"
      />
    );
    expect(html).toContain("Zach");
    expect(html).toContain("8:15 AM"); // 12h time in the fixed left column
    expect(html).toContain("aria-expanded");
    expect(html).toContain("<button");
    // Collapsed by default → the detail text is NOT rendered yet.
    expect(html).not.toContain("Delta 1733, landing PNS");
  });

  it("carries no per-chip Details label — the header legend explains the tap", () => {
    const html = renderToStaticMarkup(
      <TravelChip chip={chip({ detail: "SW 1403 from BNA" })} direction="arrival" />
    );
    expect(html).not.toContain("Details");
    expect(html).not.toContain("Close");
  });

  it("is inert (not a button) when there is no detail", () => {
    const html = renderToStaticMarkup(<TravelChip chip={chip({ detail: null })} direction="arrival" />);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<button");
  });

  it("treats whitespace-only detail as no detail", () => {
    const html = renderToStaticMarkup(<TravelChip chip={chip({ detail: "   " })} direction="arrival" />);
    expect(html).not.toContain("<button");
  });

  it("renders a dashed TBD chip for an untimed leg", () => {
    const html = renderToStaticMarkup(
      <TravelChip chip={chip({ time: null, names: ["Cara"] })} direction="arrival" />
    );
    expect(html).toContain("TBD");
    expect(html).toContain("1px dashed var(--color-bt-border)");
  });

  it("joins a merged chip's names with a comma", () => {
    const html = renderToStaticMarkup(
      <TravelChip chip={chip({ time: "09:30", names: ["Brad", "Jason", "Rob"] })} direction="arrival" />
    );
    expect(html).toContain("Brad, Jason, Rob");
  });

  it("labels the mode icon per mode, and departures fly a different glyph", () => {
    const arriving = renderToStaticMarkup(<TravelChip chip={chip()} direction="arrival" />);
    const departing = renderToStaticMarkup(<TravelChip chip={chip()} direction="departure" />);
    expect(arriving).toContain('aria-label="Flying"');
    expect(departing).toContain('aria-label="Flying"');
    // Same mode, different direction → a different lucide glyph (plane vs
    // plane-takeoff), so the markup must differ.
    expect(departing).not.toBe(arriving);

    const driving = renderToStaticMarkup(<TravelChip chip={chip({ mode: "driving" })} direction="arrival" />);
    expect(driving).toContain('aria-label="Driving"');
    expect(driving).toContain("var(--color-bt-ready)");

    const other = renderToStaticMarkup(<TravelChip chip={chip({ mode: "other" })} direction="arrival" />);
    expect(other).toContain('aria-label="Other"');
  });
});
