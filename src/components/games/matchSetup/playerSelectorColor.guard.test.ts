import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — the player picker colours each row by the PLAYER's team.
 *
 * Zach's look on PR 5 (2026-09-26): in a points race the picker listed every
 * player with a grey initial, so nobody's team showed until they were placed.
 * Each row took the SLOT's team colour, which is right in a Match Play cup (the
 * list is that one team) and empty in a points race (a slot has no team there).
 * Team identity is the person's roster, never the slot — the rule
 * `teamColorOf` already follows everywhere else on these pages.
 *
 * A source check, deliberately and stated: `PlayerSelector` portals to
 * `document.body` and renders nothing without a DOM, and this suite runs in
 * `node`, so it cannot be rendered here. What can be pinned is the wiring: the
 * rows read `colorOf` first, and every caller passes it.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const SELECTOR = read("MatchSetup.tsx");

describe("PlayerSelector rows take the player's own team colour", () => {
  it("both row lists — available and already-in-a-match — read colorOf first", () => {
    const rows = SELECTOR.split("teamColor={colorOf?.(id) ?? teamColor}").length - 1;
    expect(rows).toBe(2);
    expect(SELECTOR).not.toContain("<SelectorRow key={id} name={nameOf.get(id) ?? \"Player\"} teamColor={teamColor}");
  });

  it.each([
    ["golf match play", "../MatchGameView.tsx"],
    ["non-golf Matches", "../MatchesBuilder.tsx"],
    ["pick'em", "../pickem/PickemMatchBuilder.tsx"],
  ])("%s passes each player's team colour to the picker", (_name, rel) => {
    expect(read(rel)).toContain("colorOf={teamColorOf}");
  });
});
