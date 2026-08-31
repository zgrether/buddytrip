import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchesAccordionRow } from "../MatchesAccordionRow";
import type { DraftMatchConfig } from "@/lib/configDraft";

/**
 * The match pairing table's column header is a LABEL slot — the team name sits in
 * a ~115px column beside a `vs`, saying which column the rows below belong to.
 * It carries the SHORT name (STYLE_GUIDE "Team names — subject slots vs label
 * slots").
 *
 * WHY THIS FILE EXISTS. The bug was reported against the cup HEADER, and the
 * cup header is a different component in a different file. A fix that changed
 * only what was reported would leave this row rendering the full name in 115px,
 * where a real team name truncates mid-phrase — and nothing else in the suite
 * would have noticed, because every assertion about this row is about pairings.
 * So this is the case that separates "fixed the header" from "applied the rule",
 * and it is deliberately written against the surface nobody complained about.
 *
 * `renderToStaticMarkup` per this repo's convention (no jsdom/RTL — see
 * `gamePanelView.test.tsx`'s header).
 */
describe("match pairing column header", () => {
  const draftRow = (a: string[], b: string[]): DraftMatchConfig => ({
    matchNumber: 1,
    playersPerSide: 1,
    a,
    b,
    handicap: 0,
    pointValue: null,
  });

  // The real pair from the trip this was reported on. The full name is 30
  // characters; the column is ~115px at the 412px floor.
  const teamForSlot = (slot: "a" | "b") =>
    slot === "a"
      ? { name: "Booty Hunters & Scurvy Hookers", short_name: "BS", color: "#ef4444" }
      : { name: "Huge PNS Energy", short_name: "HPE", color: "#3b82f6" };

  const panel = (over?: { teamForSlot?: (slot: "a" | "b") => { name: string; short_name: string; color: string } | undefined }) =>
    renderToStaticMarkup(
      <MatchesAccordionRow
        draft={[draftRow(["u1"], ["u2"])]}
        setDraft={() => {}}
        nameOf={new Map()}
        colorOf={new Map()}
        teamColorOf={() => undefined}
        avatarIconOf={new Map()}
        teamForSlot={over?.teamForSlot ?? teamForSlot}
        maxMatches={24}
        twoTeams
        teamedUserIds={new Set(["u1", "u2"])}
        openSelector={() => {}}
        expanded
        onToggle={() => {}}
        canEdit
      />
    );

  it("names each column by its SHORT name", () => {
    const html = panel();
    expect(html).toContain("BS");
    expect(html).toContain("HPE");
  });

  it("never spells the full name here, however long it is", () => {
    /**
     * The load-bearing half. The assertion above passes against the OLD build
     * too — "Booty Hunters & Scurvy Hookers" contains neither "BS" nor "HPE",
     * but a partial-fix build that switched one column and not the other would
     * still satisfy one of them, and a build rendering both full names would
     * satisfy neither only by luck of the substrings. This one cannot pass
     * unless both columns actually changed.
     */
    const html = panel();
    expect(html).not.toContain("Booty Hunters");
    expect(html).not.toContain("Huge PNS Energy");
  });

  it("keeps the neutral Side A/B fallback for a game with no teams", () => {
    // A standalone game has no teams to short-name. The fallback is already a
    // label at six characters and must not have been swept up in the change.
    const html = panel({ teamForSlot: () => undefined });
    expect(html).toContain("Side A");
    expect(html).toContain("Side B");
  });
});
