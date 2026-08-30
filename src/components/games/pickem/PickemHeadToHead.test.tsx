import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemHeadToHead, swingCell, h2hPill } from "./PickemHeadToHead";
import { h2hNote } from "./PickemMatchCard";
import type { BoardRow, MatchStanding } from "@/lib/pickemBoard";

/**
 * Screen D's decision table.
 *
 * The swing cell is the reason the screen exists, and it has nine states that
 * mostly render two or three characters — which is exactly the shape where a
 * wrong one goes unnoticed.
 */

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  slateGameId: "g1",
  result: null,
  multiplier: 1,
  aPick: "home",
  bPick: "home",
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
  ...over,
});

describe("swingCell — played", () => {
  it("points the arrow at whoever gained", () => {
    // A is the left column, so A gaining points left.
    expect(swingCell(row({ result: "home", swing: 13 }))).toEqual({ dir: "a", text: "◀ 13" });
    expect(swingCell(row({ result: "home", swing: -6 }))).toEqual({ dir: "b", text: "6 ▶" });
  });

  it("gives each of the four zeros its own word, never a dash", () => {
    /**
     * Five different FACTS that all produce nothing, and only one of them is
     * anybody's fault. A dash for all of them would tell the reader a voided
     * game was played, and a shared label would merge a missing sheet with a
     * pair of wrong picks.
     */
    const cases: [BoardRow["zeroKind"], string][] = [
      ["push", "Push"],
      ["cancelled", "Void"],
      ["both", "Both"],
      ["neither", "Neither"],
      // The fifth: somebody did not pick it. Not a kind of WRONG — "Neither"
      // says two people missed a contest one of them never wagered on.
      ["unpicked", "No pick"],
    ];
    const seen = new Set<string>();
    for (const [zeroKind, text] of cases) {
      const cell = swingCell(row({ result: "home", swing: 0, zeroKind }));
      expect(cell, String(zeroKind)).toEqual({ dir: "zero", text });
      seen.add(cell.text);
    }
    // Four distinct strings — a map that collapsed two of them would satisfy
    // every assertion above if they happened to share a value.
    expect(seen.size).toBe(5);
  });
});

describe("swingCell — unplayed", () => {
  it("shows both stakes when the two disagree", () => {
    expect(swingCell(row({ upsideA: 16, upsideB: 9 }))).toEqual({
      dir: "both",
      text: "16↔9",
    });
  });

  it("never renders a symmetric ± on an agreement row", () => {
    /**
     * Both took the same team, one at 16 and one at 3. They both bank or both
     * miss, so only the DIFFERENCE can move the match — `upsideFor` already
     * collapses it to one side, and this must read that rather than restating
     * both ranks.
     *
     * The failing build renders "16↔3", which claims sixteen points are on a
     * game that can move the match by thirteen.
     */
    const cell = swingCell(row({ upsideA: 13, upsideB: 0 }));
    expect(cell).toEqual({ dir: "a", text: "◀ 13" });
    expect(cell.text).not.toContain("↔");

    expect(swingCell(row({ upsideA: 0, upsideB: 4 }))).toEqual({ dir: "b", text: "4 ▶" });
  });

  it("dashes ONLY when nobody can gain — an absence of stake, not a zero", () => {
    /**
     * The one legitimate dash on this screen. Both agreed at the same rank, so
     * the game cannot move the match at all — there is no fact to report and
     * nothing happened to report it about.
     *
     * Distinct from the played zeros above, which are outcomes with reasons.
     */
    expect(swingCell(row({ upsideA: 0, upsideB: 0 }))).toEqual({ dir: "none", text: "—" });
  });

  it("does not confuse a zero-swing PLAYED row with an unplayed one", () => {
    // Same numbers, opposite facts — the empty-versus-unknown split, in a cell
    // three characters wide.
    const played = swingCell(row({ result: "push", swing: 0, zeroKind: "push" }));
    const unplayed = swingCell(row({ upsideA: 0, upsideB: 0 }));
    expect(played.text).toBe("Push");
    expect(unplayed.text).toBe("—");
  });
});

const st = (over: Partial<MatchStanding> = {}): MatchStanding => ({
  aTotal: 0,
  bTotal: 0,
  margin: 0,
  remaining: 0,
  trailingUpside: 0,
  clinched: false,
  ...over,
});

const BOTH = { a: true, b: true } as const;
const NAMES = { a: "Zach", b: "Ty" } as const;

describe("h2hNote — the trailer's question, not the leader's", () => {
  it("says what the TRAILER needs, and from how many", () => {
    /**
     * The card names the leader because it is scanned in a list of eight. This
     * screen is opened by somebody who already knows the score and is asking
     * what it would take, so the subject changes with the reader.
     */
    const note = h2hNote(
      st({ margin: 7, remaining: 6, trailingUpside: 21 }),
      2,
      "Zach",
      BOTH,
      NAMES
    );
    expect(note).toBe("Ty needs 8 from 6 games · 21 in play");
  });

  it("counts one game as a game", () => {
    const note = h2hNote(st({ margin: -3, remaining: 1, trailingUpside: 5 }), 7, "Ty", BOTH, NAMES);
    expect(note).toBe("Zach needs 4 from 1 game · 5 in play");
  });

  it("defers to the card's sentence everywhere else", () => {
    /**
     * A clinch is a clinch and a final is a final; two sentences that must
     * always agree are two that eventually will not. The delegation is the
     * assertion — these strings are the CARD's, verbatim.
     */
    expect(h2hNote(st({ remaining: 0, margin: -12 }), 8, "Ty", BOTH, NAMES)).toBe(
      "Ty takes it by 12"
    );
    expect(
      h2hNote(st({ remaining: 4, margin: 30, clinched: true, trailingUpside: 9 }), 4, "Zach", BOTH, NAMES)
    ).toBe("Zach is safe — only 9 in play against a 30 lead");
    expect(h2hNote(st({ remaining: 8 }), 0, "Zach", BOTH, NAMES)).toBe("No games in yet");
    expect(h2hNote(st({ remaining: 3 }), 5, "Zach", BOTH, NAMES)).toBe("Level with 3 to play");
    expect(
      h2hNote(st({ remaining: 9, margin: -17 }), 7, "Ty", { a: false, b: true }, NAMES)
    ).toBe("Zach didn't submit a sheet — it scores nothing, so Ty takes the match");
  });
});

describe("h2hPill", () => {
  it("spends the live pill on the number a reader wants there", () => {
    expect(h2hPill([row({ result: "home", swing: 3 }), row()], 1, BOTH)).toBe("1 left");
  });

  it("reuses the shared verdict for the states that are shared", () => {
    // Derived from `matchPill`, so a clinch cannot be a clinch on one screen
    // and something else on the other.
    const decided = [row({ result: "home", swing: 40 })];
    expect(h2hPill(decided, 1, BOTH)).toBe("Final");
    expect(h2hPill(decided, 1, { a: true, b: false })).toBe("Final");
    const live = [row({ result: "home", swing: 40 }), row({ upsideA: 0, upsideB: 1 })];
    expect(h2hPill(live, 1, { a: true, b: false })).toBe("Nothing submitted");
  });
});

/**
 * ── WHAT THE ROW SURFACE EMPHASISES ────────────────────────────────────────
 *
 * Inverted: the UNPLAYED contests carry the raised fill, because they are the
 * only ones that can still move and they are what somebody opens a live match
 * to scan. Played rows go flat and keep their record.
 *
 * Asserted per ROW — "the page contains a raised background" is true of almost
 * any build, and the whole question is which rows have it.
 */
describe("row emphasis", () => {
  const slateGame = (id: string, awayTeam: string, homeTeam: string) => ({
    id,
    awayTeam,
    homeTeam,
    spread: null,
    kickoff: "Sat 3:30p",
    note: null,
    multiplier: 1,
  });

  const render = (slate: Parameters<typeof PickemHeadToHead>[0]["slate"], rows: BoardRow[]) =>
    renderToStaticMarkup(
      <PickemHeadToHead
        slate={slate}
        rows={rows}
        aName="Ada"
        bName="Bo"
        aUserId="u1"
        bUserId="u2"
        avatarFor={() => ({ avatarIcon: null, teamColor: null })}
        matchIndex={1}
        matchCount={1}
        resolved={rows.filter((r) => r.result != null).length}
        picked={{ a: true, b: true }}
        useConfidence
        note="Live"
        onBack={() => {}}
      />
    );

  /** One row's markup, found by a team name. */
  const rowFor = (html: string, team: string) =>
    html.split('data-testid="pickem-board-row"').slice(1).find((p) => p.includes(team)) ?? "";

  const RAISED = "background:var(--color-bt-card)";
  const FLAT = "background:transparent";

  const PLAYED = row({ slateGameId: "g1", result: "home", aPick: "home", bPick: "away", swing: 4 });
  const UNPLAYED = row({ slateGameId: "g2", aPick: "home", bPick: "away", upsideA: 3, upsideB: 2 });
  const SLATE = [slateGame("g1", "Alabama", "Georgia"), slateGame("g2", "Texas", "Oklahoma")];

  it("PLAYED rows go flat and UNPLAYED rows are raised", () => {
    const html = render(SLATE, [PLAYED, UNPLAYED]);
    expect(rowFor(html, "Alabama")).toContain(FLAT);
    expect(rowFor(html, "Alabama")).not.toContain(RAISED);
    expect(rowFor(html, "Texas")).toContain(RAISED);
  });

  it("keeps the SWING legible on a flattened row — the row recedes, the number does not", () => {
    /**
     * The caution this change had to respect. The swing column is why the
     * screen exists, so it must not fade with the surface underneath: it
     * carries its own accent colour and accent-faint fill.
     */
    const html = render([SLATE[0]], [PLAYED]);
    const only = rowFor(html, "Alabama");
    expect(only).toContain(FLAT);
    expect(only).toContain("var(--color-bt-accent)");
    expect(only).toContain("var(--color-bt-accent-faint)");
  });

  it("a match with NOTHING left is all flat, and that is a settled match", () => {
    // Not a broken board — every row a record, nothing highlighted, because
    // there is nothing left to look at.
    const html = render(SLATE, [
      PLAYED,
      row({ slateGameId: "g2", result: "away", aPick: "home", bPick: "away", swing: -2 }),
    ]);
    const rowMarkup = html.split('data-testid="pickem-board-row"').slice(1);
    expect(rowMarkup).toHaveLength(2);
    // Scoped to the ROWS. A page-wide assertion fails on the header and the
    // note block, which legitimately sit on the card surface — measuring the
    // page where the claim is about rows.
    for (const m of rowMarkup) {
      expect(m).toContain(FLAT);
      expect(m.slice(0, m.indexOf(">"))).not.toContain(RAISED);
    }
  });

  it("renders NO PICK rather than a team name for an absent pick — §2 on screen", () => {
    // The pure half is in pickemBoard.test.ts; this is the assertion that it
    // reaches the column somebody reads.
    const html = render([SLATE[0]], [row({ slateGameId: "g1", result: "home", aPick: null, bPick: "away" })]);
    expect(html).toContain('data-testid="pickem-h2h-no-pick"');
    expect(html).toContain("No pick");
  });
});

/**
 * ── THE CONFIDENCE CHIP: THREE STATES, NO STRIKE-THROUGH ───────────────────
 *
 * A missed rank was struck through, which fights the digits for the same pixels
 * at 11px — and the number is the thing worth reading, since what somebody SPENT
 * is the interesting part of a wrong pick.
 *
 * The trap in "just dim it": missed and UNPLAYED were identical but for the
 * line, so removing it without replacing it merges a rank that lost with a rank
 * still in play. Both are "not accent" and only one is over. These cases exist
 * to keep all three apart.
 */
describe("the confidence chip", () => {
  const slateGame = (id: string, awayTeam: string, homeTeam: string) => ({
    id,
    awayTeam,
    homeTeam,
    spread: null,
    kickoff: "Sat 3:30p",
    note: null,
    multiplier: 1,
  });

  const render1 = (r: BoardRow) =>
    renderToStaticMarkup(
      <PickemHeadToHead
        slate={[slateGame("g1", "Alabama", "Georgia")]}
        rows={[r]}
        aName="Ada"
        bName="Bo"
        aUserId="u1"
        bUserId="u2"
        avatarFor={() => ({ avatarIcon: null, teamColor: null })}
        matchIndex={1}
        matchCount={1}
        resolved={r.result != null ? 1 : 0}
        picked={{ a: true, b: true }}
        useConfidence
        note="Live"
        onBack={() => {}}
      />
    );

  /**
   * `bConfidence` is set on all three so the OTHER side renders an ordinary
   * chip. Left null it is a picked-but-unranked pick, which now draws the dash
   * — correctly — and a page-wide assertion about the A chip would then be
   * reading B's. The claim here is about one chip; the fixture has to make that
   * the only one in play.
   */
  const BANKED = row({
    slateGameId: "g1", result: "home", aPick: "home", aConfidence: 5, bConfidence: 2, aPoints: 5, swing: 5,
  });
  const MISSED = row({
    slateGameId: "g1", result: "home", aPick: "away", aConfidence: 5, bConfidence: 2, aPoints: 0, swing: -1,
  });
  const OPEN = row({ slateGameId: "g1", aPick: "away", aConfidence: 5, bConfidence: 2, upsideA: 5 });

  it("does NOT strike a missed rank — the number has to stay readable", () => {
    const html = render1(MISSED);
    expect(html).toContain('data-testid="pickem-conf-missed"');
    expect(html).not.toContain("line-through");
    // The rank itself survives. Dimming must not become hiding.
    expect(html).toContain(">5<");
  });

  it("keeps MISSED distinct from still-IN-PLAY — the state the line was carrying", () => {
    /**
     * THE CASE THAT SEPARATES THIS FROM DELETING A LINE. Both are "not accent",
     * so a build that only removed the strike-through renders them identically
     * and passes every other assertion in this block.
     */
    const missed = render1(MISSED);
    const open = render1(OPEN);
    expect(missed).toContain('data-testid="pickem-conf-missed"');
    expect(open).toContain('data-testid="pickem-conf-open"');
    expect(chip(missed, "missed")).toContain("opacity:0.45");
    expect(chip(open, "open")).not.toContain("opacity:0.45");
  });

  /** One chip's opening tag, by state. Both sides render a chip, so a page-wide
   *  assertion about one of them reads the other — which is how this case first
   *  failed against correct code. */
  const chip = (html: string, state: "banked" | "missed" | "open" | "unranked") => {
    const at = html.indexOf('data-testid="pickem-conf-' + state + '"');
    return at < 0 ? "" : html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  };

  it("keeps BANKED unmistakable — accent is what 'points were awarded' means", () => {
    const html = render1(BANKED);
    expect(chip(html, "banked")).toContain("var(--color-bt-accent)");
    expect(chip(html, "banked")).not.toContain("opacity:0.45");
  });

  it("gives the three states three different treatments", () => {
    // Asserted as a SET, because two of them agreeing is the whole failure mode
    // and a per-state assertion cannot see it.
    const chips = [BANKED, MISSED, OPEN].map((r) => {
      const html = render1(r);
      const at = html.indexOf("pickem-conf-");
      return html.slice(at, html.indexOf(">", at));
    });
    expect(new Set(chips).size).toBe(3);
  });
});

/**
 * ── A PICK WITH NO RANK IS NOT A PICK WITH NO CHIP ─────────────────────────
 *
 * `pickPoints` reads `confidence ?? 0` with confidence on, so a sheet whose
 * ranks were cleared by a reopen scores zero for every correct pick until they
 * are re-entered. The chip vanished, so the row showed two team names and a zero
 * — indistinguishable at a glance from a push, which is how it was read.
 */
describe("a pick with no rank", () => {
  const slateGame = {
    id: "g1", awayTeam: "Alabama", homeTeam: "Georgia",
    spread: null, kickoff: "Sat 3:30p", note: null, multiplier: 1,
  };
  const render2 = (r: BoardRow, useConfidence = true) =>
    renderToStaticMarkup(
      <PickemHeadToHead
        slate={[slateGame]} rows={[r]}
        aName="Ada" bName="Bo" aUserId="u1" bUserId="u2"
        avatarFor={() => ({ avatarIcon: null, teamColor: null })}
        matchIndex={1} matchCount={1} resolved={r.result != null ? 1 : 0}
        picked={{ a: true, b: true }} useConfidence={useConfidence}
        note="Live" onBack={() => {}}
      />
    );

  const CLEARED = row({
    slateGameId: "g1", result: "home",
    aPick: "home", aConfidence: null, aPoints: 0,
    bPick: "home", bConfidence: null, bPoints: 0,
    swing: 0, zeroKind: "both",
  });

  it("MARKS the missing rank rather than rendering nothing", () => {
    const html = render2(CLEARED);
    expect(html).toContain('data-testid="pickem-conf-unranked"');
    // Both correct, both unranked — the row that read as a push.
    expect(html.split('data-testid="pickem-conf-unranked"').length - 1).toBe(2);
  });

  it("is NOT a zero — a rank nobody spent is absent, not spent-as-zero", () => {
    /**
     * The same conflation pointing the other way: the POINTS are zero, the RANK
     * is missing, and this chip shows ranks.
     *
     * Scoped to the CHIP's own content. A page-wide `not.toContain(">0<")` fails
     * on the standing in the header, which is a real zero and none of this
     * assertion's business — measuring the page where the claim is about one
     * element, for the third time in this file.
     */
    const html = render2(CLEARED);
    const at = html.indexOf('data-testid="pickem-conf-unranked"');
    const content = html.slice(at, html.indexOf("</span>", at));
    // The dash by CODE POINT, not as a literal: an en dash does not survive
    // every editor and shell it has passed through to get here, and an
    // assertion that silently compares the wrong character is worse than none.
    const EN_DASH = String.fromCharCode(0x2013);
    // The slice stops AT `</span>`, so the chip's text is the tail rather than
    // something wrapped in angle brackets — asserting `">x<"` here can never
    // match, whatever is rendered.
    expect(content.endsWith(">" + EN_DASH)).toBe(true);
    expect(content).not.toMatch(/>[0-9]+$/);
  });

  it("says nothing when ranks do not apply — confidence OFF", () => {
    /**
     * Every rank is null there and that is normal, so a dash on all sixteen rows
     * would be noise about a mechanic that is not in play.
     */
    expect(render2(CLEARED, false)).not.toContain("pickem-conf-unranked");
  });

  it("says nothing where there is no PICK — that is already labelled", () => {
    // `SidePick` renders "No pick" there; a second mark for the same absence is
    // two things saying one thing.
    const noPick = row({ slateGameId: "g1", result: "home", aPick: null, aConfidence: null, bPick: "home", bConfidence: 3 });
    const html = render2(noPick);
    expect(html).toContain('data-testid="pickem-h2h-no-pick"');
    expect(html).not.toContain("pickem-conf-unranked");
  });
});
