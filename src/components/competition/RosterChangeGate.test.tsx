import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RosterChangeSheet, rosterGateDecision, type RosterPreview } from "./RosterChangeGate";

/**
 * The roster-change gate (PR 8b-2): which changes stop for a preview, and what
 * the preview says. Rendered via react-dom/server (node env, no RTL).
 *
 * Every copy assertion reads ONE element by its `data-testid`, never a
 * substring of the whole sheet: the sheet names the person, both teams and the
 * games several times over, so "contains Alice" or "contains Red" would be
 * satisfied by the wrong line (CLAUDE.md's substring corollary).
 */

/** The text inside the element carrying `data-testid={id}`, entities decoded.
 *  Null when no such element rendered — absence is an answer, not a crash. */
function textOf(html: string, id: string): string | null {
  const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`));
  if (!m) return null;
  return m[1]
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const allOf = (html: string, id: string) =>
  [...html.matchAll(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`, "g"))].map((m) => m[1].replace(/&#x27;/g, "'"));

const preview = (over: Partial<RosterPreview> = {}): RosterPreview => ({
  fingerprint: "fp", hasResults: true, finishedGames: 3, moving: [], blocking: [], ...over,
});

const render = (props: Parameters<typeof RosterChangeSheet>[0]) => renderToStaticMarkup(<RosterChangeSheet {...props} />);
const noop = () => undefined;

describe("rosterGateDecision — what stops for a preview", () => {
  it("before results: nothing stops, for anyone", () => {
    for (const staff of [true, false]) {
      expect(rosterGateDecision({ staff, hasResults: false, kind: "assign", currentTeamId: "red", toTeamId: "blue" })).toBe("direct");
      expect(rosterGateDecision({ staff, hasResults: false, kind: "remove", currentTeamId: "red" })).toBe("direct");
    }
  });

  it("after results, for staff: a MOVE, an ADD and a removal all stop (ruling 20); a same-team no-op does not", () => {
    expect(rosterGateDecision({ staff: true, hasResults: true, kind: "assign", currentTeamId: "red", toTeamId: "blue" })).toBe("preview");
    expect(rosterGateDecision({ staff: true, hasResults: true, kind: "remove", currentTeamId: "red" })).toBe("preview");
    expect(rosterGateDecision({ staff: true, hasResults: true, kind: "assign", currentTeamId: null, toTeamId: "blue" })).toBe("preview");
    expect(rosterGateDecision({ staff: true, hasResults: true, kind: "assign", currentTeamId: "red", toTeamId: "red" })).toBe("direct");
  });

  it("after results, for a non-staff caller: direct (a captain's path is the server's refusal, not a preview)", () => {
    expect(rosterGateDecision({ staff: false, hasResults: true, kind: "assign", currentTeamId: "red", toTeamId: "blue" })).toBe("direct");
    expect(rosterGateDecision({ staff: false, hasResults: true, kind: "remove", currentTeamId: "red" })).toBe("direct");
  });
});

describe("RosterChangeSheet — a move", () => {
  const move = { kind: "move" as const, userId: "u", personName: "Alice", fromTeamName: "Red", toTeamName: "Blue" };

  it("asks, and promises the points stay where they were won", () => {
    const html = render({ request: move, state: { phase: "ready", preview: preview() }, onCancel: noop, onConfirm: noop });
    expect(textOf(html, "roster-change-title")).toBe("Move Alice to Blue?");
    expect(textOf(html, "roster-change-no-points")).toBe("No points move. Finished games stay with the team they were played for.");
    expect(textOf(html, "roster-change-confirm")).toBe("Move to Blue");
    // A move is not a removal: no "stays on the trip" line.
    expect(textOf(html, "roster-change-stays")).toBeNull();
  });

  it("names each unfinished team-independent game whose credit moves with them", () => {
    const html = render({
      request: move,
      state: { phase: "ready", preview: preview({ moving: [{ gameId: "g", name: "Sunday Stroke" }] }) },
      onCancel: noop, onConfirm: noop,
    });
    expect(allOf(html, "roster-change-moving")).toEqual([
      "Sunday Stroke isn’t finished — Alice’s result in it will count for Blue when it is.",
    ]);
  });

  it("with nothing finished yet, says so instead of claiming finished games", () => {
    const html = render({ request: move, state: { phase: "ready", preview: preview({ finishedGames: 0 }) }, onCancel: noop, onConfirm: noop });
    expect(textOf(html, "roster-change-no-points")).toBe("No points move. Nothing has finished yet.");
  });

  it("BLOCKED: names the game, offers no confirm — and a ROUTE to the game", () => {
    const html = render({
      request: move,
      state: { phase: "ready", preview: preview({ blocking: [{ gameId: "m", name: "Hole 7 Match" }] }) },
      onCancel: noop, onConfirm: noop, onOpenGame: noop,
    });
    expect(textOf(html, "roster-change-open-game")).toBe("Open Hole 7 Match");
    expect(textOf(html, "roster-change-title")).toBe("Alice can't be moved yet");
    expect(textOf(html, "roster-change-blocked")).toBe(
      "Alice is still playing in Hole 7 Match, which was set up with their current team. Finish it or take them out of it first."
    );
    expect(html).not.toContain('data-testid="roster-change-confirm"');
  });
});

describe("RosterChangeSheet — a removal is FROM THE TEAM, never just 'removed'", () => {
  const removal = { kind: "remove" as const, userId: "u", personName: "Alice", fromTeamName: "Red" };

  it("every line that names the act names the team, and says they stay on the trip", () => {
    const html = render({
      request: removal,
      state: { phase: "ready", preview: preview({ moving: [{ gameId: "g", name: "Sunday Stroke" }] }) },
      onCancel: noop, onConfirm: noop,
    });
    expect(textOf(html, "roster-change-title")).toBe("Remove Alice from Red?");
    expect(textOf(html, "roster-change-confirm")).toBe("Remove from Red");
    expect(textOf(html, "roster-change-stays")).toBe("Alice stays on the trip — this only takes them off Red.");
    expect(allOf(html, "roster-change-moving")).toEqual([
      "Sunday Stroke isn’t finished — Alice’s result in it will count for no team when it is.",
    ]);
    // The confusable wording, nowhere: 8d's leaving the trip is a different act.
    expect(html).not.toMatch(/Remove Alice\?/);
    expect(html).not.toMatch(/>Remove</);
  });

  it("BLOCKED: the title still names the team", () => {
    const html = render({
      request: removal,
      state: { phase: "ready", preview: preview({ blocking: [{ gameId: "m", name: "Hole 7 Match" }] }) },
      onCancel: noop, onConfirm: noop,
    });
    expect(textOf(html, "roster-change-title")).toBe("Alice can't be removed from Red yet");
  });
});

describe("RosterChangeSheet — while checking, and when the check fails", () => {
  const move = { kind: "move" as const, userId: "u", personName: "Alice", fromTeamName: "Red", toTeamName: "Blue" };

  it("loading: says it is checking, and offers no confirm", () => {
    const html = render({ request: move, state: { phase: "loading" }, onCancel: noop, onConfirm: noop });
    expect(textOf(html, "roster-change-loading")).toBe("Checking what this changes…");
    expect(html).not.toContain('data-testid="roster-change-confirm"');
  });

  it("error: says the check failed, and offers no confirm — never a confirm on an unchecked roster", () => {
    const html = render({ request: move, state: { phase: "error" }, onCancel: noop, onConfirm: noop });
    expect(textOf(html, "roster-change-error")).toContain("Couldn");
    expect(html).not.toContain('data-testid="roster-change-confirm"');
  });
});

describe("RosterChangeSheet — an ADD after results (ruling 20)", () => {
  const add = { kind: "add" as const, userId: "u", personName: "Alice", fromTeamName: "", toTeamName: "Blue" };

  it("asks, says earlier results stay unattached, and names what will count for the new team", () => {
    const html = render({
      request: add,
      state: { phase: "ready", preview: preview({ moving: [{ gameId: "g", name: "Sunday Stroke" }] }) },
      onCancel: noop, onConfirm: noop,
    });
    expect(textOf(html, "roster-change-title")).toBe("Add Alice to Blue?");
    expect(textOf(html, "roster-change-no-points")).toBe("No points move. Games Alice already finished stay counting for no team.");
    expect(allOf(html, "roster-change-moving")).toEqual([
      "Sunday Stroke isn’t finished — Alice’s result in it will count for Blue when it is.",
    ]);
    expect(textOf(html, "roster-change-confirm")).toBe("Add to Blue");
    expect(textOf(html, "roster-change-stays")).toBeNull();
  });

  it("BLOCKED: says they can't join yet, and routes to the game", () => {
    const html = render({
      request: add,
      state: { phase: "ready", preview: preview({ blocking: [{ gameId: "m", name: "Hole 7 Match" }] }) },
      onCancel: noop, onConfirm: noop, onOpenGame: noop,
    });
    expect(textOf(html, "roster-change-title")).toBe("Alice can't join Blue yet");
    expect(textOf(html, "roster-change-open-game")).toBe("Open Hole 7 Match");
  });
});

describe("RosterChangeSheet — the route to a blocking game", () => {
  it("is offered only when the host gives one, and never on an allowed change", () => {
    const move = { kind: "move" as const, userId: "u", personName: "Alice", fromTeamName: "Red", toTeamName: "Blue" };
    const blocked = { phase: "ready" as const, preview: preview({ blocking: [{ gameId: "m", name: "Hole 7 Match" }] }) };
    expect(render({ request: move, state: blocked, onCancel: noop, onConfirm: noop })).not.toContain("roster-change-open-game");
    const allowed = { phase: "ready" as const, preview: preview() };
    expect(render({ request: move, state: allowed, onCancel: noop, onConfirm: noop, onOpenGame: noop })).not.toContain("roster-change-open-game");
  });
});
