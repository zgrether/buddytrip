import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationsSheetBody } from "./NotificationsSheetBody";
import type { DevicePushState } from "@/lib/devicePushState";

/**
 * The four permission states, rendered.
 *
 * ── Why this is a render test and not four calls to `activationCopy` ────────
 * `activationCopy` already has unit coverage, and it would keep passing with
 * this component wired to none of it. What can only break HERE is the pairing:
 * whether a control is drawn beside copy that says no control can help, and
 * whether the category list appears for a device that cannot deliver to it.
 * Those are render decisions, so they are asserted against rendered output.
 *
 * Rendered with `react-dom/server` — the suite is `environment: "node"`, which
 * is why this component takes props and owns no data (see its doc comment).
 *
 * The category list is passed as a SENTINEL rather than as the real rows: what
 * is under test is whether the slot renders, not what is in it. A real row
 * would drag `useNotificationPreference` and tRPC in, and the assertion would
 * then be satisfiable by the rows failing to render for unrelated reasons.
 */

const CATEGORIES = <div>CATEGORY-SENTINEL</div>;

function render(state: DevicePushState, opts: { settling?: boolean; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <NotificationsSheetBody
      state={state}
      settling={opts.settling ?? false}
      busy={opts.busy ?? false}
      onToggleActivation={() => {}}
      categorySlot={CATEGORIES}
      sectionLabelStyle={{}}
    />
  );
}

/** The activation checkbox, identified by its aria-label rather than by shape. */
const hasToggle = (html: string) =>
  html.includes('aria-label="Activate push notifications on this device"');
const hasCategories = (html: string) => html.includes("CATEGORY-SENTINEL");

describe("NotificationsSheetBody — not yet asked", () => {
  const html = render("off");

  it("offers the activation control, and names the ACT", () => {
    expect(hasToggle(html)).toBe(true);
    expect(html.toLowerCase()).toContain("activate push notifications on this device");
  });

  it("shows NO categories — there is nothing subscribed to deliver them", () => {
    expect(hasCategories(html)).toBe(false);
  });
});

describe("NotificationsSheetBody — granted and subscribed", () => {
  const html = render("on");

  it("shows the categories", () => {
    expect(hasCategories(html)).toBe(true);
  });

  it("keeps the activation control, checked", () => {
    expect(hasToggle(html)).toBe(true);
    expect(html).toContain('aria-checked="true"');
  });

  /**
   * The categories are for turning things OFF. Someone arriving here has
   * everything on already (every category defaults ON — NOTIFICATIONS.md), so
   * copy that reads as an invitation to opt IN describes a screen they are not
   * looking at.
   */
  it("frames the list as opting out, not opting in", () => {
    expect(html.toLowerCase()).toContain("uncheck");
    expect(html.toLowerCase()).not.toContain("turn on the ones");
  });
});

describe("NotificationsSheetBody — denied", () => {
  const html = render("blocked");

  /**
   * THE STATE MOST LIKELY TO BE SKIPPED AND MOST NEEDED. A person who blocked
   * the prompt months ago otherwise has no way to find out why nothing arrives.
   */
  it("says blocked, and points at browser settings", () => {
    expect(html.toLowerCase()).toContain("blocked");
    expect(html.toLowerCase()).toContain("browser settings");
  });

  /**
   * NO CONTROL AT ALL — not a disabled one.
   *
   * Browsers do not show the permission prompt again after a denial, so a
   * checkbox here could not be wired to anything that works. This is the
   * assertion that would catch a well-meaning "let them tap it to retry",
   * which is the exact shape of control-that-lies the parent replaced.
   */
  it("draws no activation control, because a tap cannot achieve anything", () => {
    expect(hasToggle(html)).toBe(false);
  });

  it("shows no categories", () => {
    expect(hasCategories(html)).toBe(false);
  });
});

describe("NotificationsSheetBody — unsupported", () => {
  const html = render("unsupported");

  it("explains the device, with no controls of any kind", () => {
    expect(html.toLowerCase()).toContain("support");
    expect(hasToggle(html)).toBe(false);
    expect(hasCategories(html)).toBe(false);
  });
});

describe("NotificationsSheetBody — still settling", () => {
  /**
   * While the browser and server reads are in flight the state is not yet
   * known, and `deriveDevicePushState` reports `off` in the meantime. Claiming
   * "Activate push notifications" during that window states something we have
   * not established, and drawing the control invites a tap that races the read.
   */
  it("claims nothing and offers nothing until the reads land", () => {
    const html = render("off", { settling: true });
    expect(html).toContain("Checking…");
    expect(html.toLowerCase()).not.toContain("activate push notifications on this device");
    expect(hasToggle(html)).toBe(false);
  });

  /**
   * `settling` must not be able to hide the two EXPLANATION states. It gates the
   * control, not the account of why there isn't one — and a device that is
   * blocked or unsupported is knowable without waiting for a server read.
   */
  it("still renders the blocked explanation if the state is already known", () => {
    const html = render("blocked");
    expect(hasToggle(html)).toBe(false);
    expect(html.toLowerCase()).toContain("browser settings");
  });
});

describe("NotificationsSheetBody — no expander anywhere", () => {
  /**
   * The collapse/expand pattern is gone, deliberately and entirely: it is what
   * hid the categories behind a chevron nobody tapped. Pinned so it cannot come
   * back as a tidy-up — in every state, whatever is on screen is on screen.
   */
  it.each(["off", "on", "blocked", "unsupported"] as const)(
    "renders no disclosure affordance in the %s state",
    (state) => {
      const html = render(state);
      expect(html).not.toContain("aria-expanded");
    }
  );
});

describe("NotificationsSheetBody — the whole row is the target", () => {
  /**
   * Reported from a device: the checkbox alone was the control, and it is a 20px
   * box beside a 300px label that did nothing. People aim at the words.
   *
   * Asserted structurally rather than by clicking: the ROW must be the element
   * carrying `role="checkbox"`, and there must be exactly ONE such element for
   * the activation control — a nested button would be invalid HTML and would
   * also give the row two competing targets again.
   */
  it("puts role=checkbox on the row, not on a nested button", () => {
    const html = render("on");
    // One control for activation...
    const controls = html.match(/role="checkbox"/g) ?? [];
    expect(controls.length).toBe(1);
    // ...and it is a button that also contains the label text, i.e. the row.
    const rowStart = html.indexOf('role="checkbox"');
    const rowTag = html.lastIndexOf("<button", rowStart);
    expect(rowTag).toBeGreaterThan(-1);
    const rowEnd = html.indexOf("</button>", rowStart);
    expect(html.slice(rowTag, rowEnd)).toContain("Push notifications are activated");
  });

  it("never nests a button inside the activation control", () => {
    for (const state of ["off", "on"] as const) {
      const html = render(state);
      const start = html.indexOf('role="checkbox"');
      const end = html.indexOf("</button>", start);
      expect(html.slice(start, end)).not.toContain("<button");
    }
  });

  /**
   * The states with nothing to toggle must not render a DISABLED button. A
   * greyed-out control reads as "this action failed" rather than "there is no
   * action here", which is the opposite of what `blocked` needs to communicate.
   */
  it.each(["blocked", "unsupported"] as const)(
    "renders %s as text, not as a disabled control",
    (state) => {
      const html = render(state);
      expect(html).not.toContain('role="checkbox"');
      expect(html).not.toContain("disabled");
    }
  );

  /**
   * "Your browser will ask permission first" is gone. It narrated the next
   * screen instead of the control — the same class as the "tap to turn them off
   * here" line already removed from `devicePushCopy` — and the prompt announces
   * itself perfectly well.
   */
  it("does not narrate the permission prompt", () => {
    const html = render("off");
    expect(html.toLowerCase()).not.toContain("ask permission");
    expect(html.toLowerCase()).not.toContain("will ask");
  });
});
