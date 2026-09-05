import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeLeaderboard } from "./StrokeLeaderboard";
import { computeStrokeLeaderboard } from "@/lib/strokePlay";
import { AVATAR_ICON_COMPONENTS } from "@/lib/avatarIconComponents";
import type { Participant } from "@/components/games/types";

/**
 * A PLAYER'S CHOSEN ICON REACHES THE BOARD.
 *
 * ── The bug this pins, and why it was invisible ─────────────────────────────
 *
 * Every path to `Participant.avatarIcon` in `StrokeGameView` resolved to `null`.
 * `nameColorOf` is built from `game.participants`, which that view assembles as
 * `{id, name, color}` and has never carried an icon — so `meta?.avatarIcon ??
 * null` was structurally always `null`, and the group picker's crew list
 * hardcoded `avatarIcon: null as string | null` outright. Zach's rocket rendered
 * as the letters "ZG" on every stroke surface.
 *
 * Nothing was missing but the lookup: `tripMembers.list` has selected
 * `avatar_icon` throughout, and `RackGameView.avatarOf` already did it right.
 *
 * **The tell worth keeping is the expression.** `?? null` reads like a
 * considered fallback for a value that is sometimes absent, and is
 * indistinguishable from one that can never arrive. It sat one field away from
 * the team-colour bug, in the same object literal, and neither `tsc` nor a
 * source scan can see it — both halves are well-typed and the null is a legal
 * value. Only rendering it with a real icon shows the difference, which is what
 * this file does.
 *
 * ── What this covers ────────────────────────────────────────────────────────
 *
 * That the board RENDERS an icon it is given rather than initials, and that the
 * two states are distinguishable. It cannot see `StrokeGameView`'s resolver —
 * no harness here reaches a tRPC-hook component — so, as with the colour, the
 * wiring is asserted one seam short. Stated rather than implied.
 */

const ROWS = computeStrokeLeaderboard(
  ["zach", "plain"],
  [
    { participant_id: "zach", unit_label: "1", value: 4 },
    { participant_id: "plain", unit_label: "1", value: 5 },
  ],
  { "1": 4 },
  null
);

function board(participants: Participant[]) {
  return renderToStaticMarkup(
    <StrokeLeaderboard rows={ROWS} participants={participants} rubric={null} />
  );
}

describe("avatar icons on the stroke board", () => {
  it("renders the chosen icon instead of initials", () => {
    // "rocket" is a real key in the shared map, which is the registry the
    // Avatar looks up — asserted rather than assumed, because an icon name the
    // map does not know falls back to initials and would make this vacuous.
    expect(AVATAR_ICON_COMPONENTS).toHaveProperty("rocket");

    const html = board([
      { id: "zach", name: "Zach Grether", color: "#e11d48", avatarIcon: "rocket" },
      { id: "plain", name: "Plain Person", color: "#22c55e", avatarIcon: null },
    ]);

    /**
     * THE ASSERTION IS THE ABSENCE OF INITIALS, and the first version of this
     * test got it wrong in a way worth recording.
     *
     * It asserted `aria-label="Zach Grether avatar"`, which reads plausible and
     * is TRUE ABOUT THE WRONG THING: the Avatar derives that label from
     * `avatarIcon` directly, while the icon itself renders only if the name
     * resolves in `AVATAR_ICON_COMPONENTS`. Nulling the icon lookup left the
     * label saying "avatar" over a disc of initials, and the test passed
     * against that build — caught by mutation, not by reading.
     *
     * Initials and icon are mutually exclusive branches of one ternary, so
     * "ZG is absent" is a claim only the icon branch can satisfy, and the
     * neighbouring row still showing "PP" keeps it from being a vacuous
     * "nothing rendered".
     */
    expect(html).not.toContain(">ZG<");
    expect(html).toContain(">PP<");
  });

  it("still falls back to initials when nobody has picked an icon", () => {
    const html = board([
      { id: "zach", name: "Zach Grether", color: "#e11d48", avatarIcon: null },
      { id: "plain", name: "Plain Person", color: "#22c55e", avatarIcon: null },
    ]);
    expect(html).toContain(">ZG<");
    expect(html).toContain(">PP<");
  });

  it("an UNKNOWN icon name falls back to initials rather than rendering nothing", () => {
    // The state a stale or renamed key produces. It must degrade to the
    // initials the board showed before, not to an empty disc.
    const html = board([
      { id: "zach", name: "Zach Grether", color: "#e11d48", avatarIcon: "not-an-icon" },
      { id: "plain", name: "Plain Person", color: "#22c55e", avatarIcon: null },
    ]);
    expect(html).toContain("ZG");
  });
});
