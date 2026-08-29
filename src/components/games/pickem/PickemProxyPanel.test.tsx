import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemProxyBanner,
  sortTargets,
  targetStatusLabel,
  type ProxyTarget,
} from "./PickemProxyPanel";

/**
 * The proxy surface — entering a sheet for someone who cannot, or did not.
 *
 * The copy IS the deliverable here, so the assertions read it. The one way this
 * feature goes badly is a captain editing what they think is their own sheet,
 * and the sheet is POPULATED in proxy mode, so nothing but the words
 * distinguishes the two states.
 */

const t = (over: Partial<ProxyTarget> & { userId: string; name: string }): ProxyTarget => ({
  submitted: false,
  isGuest: false,
  ...over,
});

describe("sortTargets — who needs chasing, in order", () => {
  it("puts GUESTS WITHOUT A SHEET first", () => {
    // They can never enter their own, so nobody else will do it if the runner
    // does not. Everyone else at least might.
    const sorted = sortTargets([
      t({ userId: "1", name: "Zach" }),
      t({ userId: "2", name: "Ghost", isGuest: true }),
      t({ userId: "3", name: "Done", submitted: true }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Ghost", "Zach", "Done"]);
  });

  it("does NOT lift a guest who already has a sheet", () => {
    // The ordering is about who still needs doing, not about being a guest.
    // Ranking on `isGuest` alone would float a finished sheet to the top of the
    // chase list, which is the opposite of useful.
    const sorted = sortTargets([
      t({ userId: "1", name: "Alice" }),
      t({ userId: "2", name: "Ghost", isGuest: true, submitted: true }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Alice", "Ghost"]);
  });

  it("breaks ties by name, so the list does not reshuffle between renders", () => {
    const sorted = sortTargets([
      t({ userId: "1", name: "Wes" }),
      t({ userId: "2", name: "Brad" }),
      t({ userId: "3", name: "Matt" }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Brad", "Matt", "Wes"]);
  });
});

describe("targetStatusLabel — a guest reads differently on purpose", () => {
  it("says a guest HASN'T SIGNED UP, not that they have not submitted", () => {
    // "Nothing submitted" is what happened, and it is what everyone else reads. It
    // `auth.uid()`, so `pickem_picks_write` can never match them — chasing them
    // is wasted effort, and the honest label says so.
    expect(targetStatusLabel(t({ userId: "1", name: "G", isGuest: true }))).toBe(
      "Hasn’t signed up"
    );
    expect(targetStatusLabel(t({ userId: "2", name: "R" }))).toBe("Nothing submitted");
  });

  it("says SHEET IN once there is one — guest or not", () => {
    expect(
      targetStatusLabel(t({ userId: "1", name: "G", isGuest: true, submitted: true }))
    ).toBe("Sheet in");
    expect(targetStatusLabel(t({ userId: "2", name: "R", submitted: true }))).toBe("Sheet in");
  });
});

describe("PickemProxyBanner — whose sheet this is", () => {
  const render = (over: Partial<Parameters<typeof PickemProxyBanner>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemProxyBanner
        name="Ty"
        isGuest={false}
        submitted={false}
        onBack={() => {}}
        {...over}
      />
    );

  it("names the subject in the second person, unmissably", () => {
    expect(render()).toContain("You’re entering Ty’s sheet");
  });

  it("WARNS when the target submitted their own sheet", () => {
    // §6: overwriting someone's actual picks is different from filling an empty
    // one, and the proxy should be told which they are doing.
    expect(render({ submitted: true })).toContain("Ty submitted their own sheet — saving replaces it.");
  });

  it("does NOT warn when they have not submitted — the common case", () => {
    // Friction here is noise, and noise is what teaches people to ignore the
    // banner that matters.
    expect(render({ submitted: false })).not.toContain("replaces it");
  });

  it("explains a GUEST rather than warning about them", () => {
    const html = render({ isGuest: true });
    expect(html).toContain("Ty has no account, so this is the only way they get a sheet.");
    expect(html).not.toContain("replaces it");
  });

  it("prefers the OVERWRITE warning when a guest somehow has a sheet", () => {
    // Reachable: a guest's sheet is always proxy-entered, so a second proxy is
    // overwriting someone else's work — the fact that matters more.
    const html = render({ isGuest: true, submitted: true });
    expect(html).toContain("replaces it");
    expect(html).not.toContain("no account");
  });
});
