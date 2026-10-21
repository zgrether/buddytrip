import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartingPointPicker } from "./StartingPointPicker";

/**
 * The create panel's first screen (Zach's rulings, 2026-10-21): four tiles in
 * his order, then Build your own as a separate row. Pick'em pool is held, so it
 * must not appear. Anchored on each tile's own test id.
 */

const html = renderToStaticMarkup(
  <StartingPointPicker onPick={() => {}} onJustKeepScore={() => {}} onBuildYourOwn={() => {}} />
);
const tileIds = [...html.matchAll(/data-testid="starting-point-([a-z_]+)"/g)].map((m) => m[1]).filter((id) => id !== "picker"); // the container shares the prefix

describe("StartingPointPicker", () => {
  it("asks what you are playing", () => {
    expect(html).toContain(">What are you playing?</h2>");
  });

  it("offers the four tiles in order, then Build your own", () => {
    // The id pattern has no hyphen, so Build your own's id is not a tile here.
    expect(tileIds).toEqual(["team_cup_weekend", "golf_week", "bar_night_bracket", "just_keep_score"]);
    // It renders after the grid: a separate row, not a fifth tile.
    expect(html.indexOf('data-testid="starting-point-build-your-own"')).toBeGreaterThan(
      html.indexOf('data-testid="starting-point-just_keep_score"')
    );
  });

  it("names each tile as Zach did", () => {
    for (const name of ["Team cup weekend", "Golf week", "Bar-night bracket", "Just keep score", "Build your own"]) {
      expect(html).toContain(name);
    }
  });

  it("holds Pick'em pool back", () => {
    expect(html).not.toMatch(/pick.?em/i);
  });

  it("the art is decoration: hidden from assistive technology", () => {
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
