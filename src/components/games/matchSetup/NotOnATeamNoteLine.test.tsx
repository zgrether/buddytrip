import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotOnATeamNoteLine } from "../NotOnATeam";
import { rostersHref } from "@/lib/gameRoutes";

/**
 * What the match builder tells a viewer who cannot add (9b look).
 *
 * A message that names the fix takes you there: "Rosters" is a LINK that opens
 * the Rosters overlay on the Games page (`?rosters=1`, read by
 * `CompetitionFace`). Asserted on the link's own testid, so neither the
 * paragraph around it nor another "Rosters" on the page can satisfy it.
 */

/** The opening tag and text of one element, by testid. */
function node(html: string, testId: string): { tag: string; text: string } | null {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at === -1) return null;
  const open = html.indexOf(">", at) + 1;
  const close = html.indexOf("</", open);
  return { tag: html.slice(html.lastIndexOf("<", at), open), text: html.slice(open, close) };
}

/** The whole note as a reader sees it: the paragraph, tags stripped. */
function sentence(html: string): string {
  const at = html.indexOf(`data-testid="not-on-a-team-note"`);
  const open = html.indexOf(">", at) + 1;
  return html.slice(open, html.indexOf("</p>", open)).split(/<[^>]*>/).join("");
}

describe("NotOnATeamNoteLine", () => {
  const href = rostersHref("trip-1");

  it("rostersHref opens the Games page with Rosters up", () => {
    expect(href).toBe("/trips/trip-1?view=cup&rosters=1");
  });

  it("an organizer with no preview: 'Rosters' is a link to Rosters", () => {
    const html = renderToStaticMarkup(<NotOnATeamNoteLine note="rosters" rostersHref={href} />);
    const link = node(html, "not-on-a-team-rosters-link");
    expect(link?.text).toBe("Rosters");
    expect(link?.tag).toContain(`href="/trips/trip-1?view=cup&amp;rosters=1"`);
    expect(sentence(html)).toBe("Add them to a team in Rosters.");
  });

  it("anyone else is told who can, with no link", () => {
    const html = renderToStaticMarkup(<NotOnATeamNoteLine note="organizer" rostersHref={href} />);
    expect(sentence(html)).toBe("An organizer can add them to a team.");
    expect(node(html, "not-on-a-team-rosters-link")).toBeNull();
  });

  it("says nothing to a viewer who can add", () => {
    expect(renderToStaticMarkup(<NotOnATeamNoteLine note={null} rostersHref={href} />)).toBe("");
  });
});
