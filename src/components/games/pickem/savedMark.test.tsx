import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheet, pickIsSaved, type PickemSheetGame } from "./PickemSheet";
import { draftOutboxPut } from "@/lib/draftOutbox";
import { emptySheet, fillAll, reconcileSheet, setPick, type SheetPick } from "@/lib/pickemSheet";

/**
 * WHICH PICKS ARE ACTUALLY STORED — per row, not just in the header count.
 *
 * The count now reads the server, so "Submitted 5/16" is true. It says nothing
 * about WHICH five, and a row picked a moment ago is drawn exactly like one
 * saved yesterday — same teal name, same selected segment. A sheet mid-edit
 * therefore looked entirely submitted, which is the half of the report the
 * counter fix did not reach.
 */

const game = (over: Partial<PickemSheetGame> = {}): PickemSheetGame => ({
  id: `g-${over.awayTeam ?? "x"}`,
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: null,
  kickoff: "Sat Nov 8, 7:30p",
  note: null,
  multiplier: 1,
  ...over,
});

const SLATE: PickemSheetGame[] = [
  game({ awayTeam: "Alabama", homeTeam: "Georgia" }),
  game({ awayTeam: "Ohio St", homeTeam: "Michigan" }),
  game({ awayTeam: "Texas", homeTeam: "Oklahoma" }),
];
const SETTINGS = { useConfidence: true, rollUp: "individual_matches" } as const;
const ME = { userId: "me", name: "Me", isSelf: true, isGuest: false };
const STORED: SheetPick[] = [{ slateGameId: SLATE[0].id, pick: "home", confidence: 3 }];

describe("pickIsSaved — the row's own question", () => {
  const draft = (...picks: [string, "home" | "away" | null][]): SheetPick[] =>
    SLATE.map((g, i) => ({
      slateGameId: g.id,
      pick: picks.find(([id]) => id === g.id)?.[1] ?? null,
      confidence: SLATE.length - i,
    }));

  it("marks a pick that matches what is stored", () => {
    expect(pickIsSaved(SLATE[0].id, draft([SLATE[0].id, "home"]), STORED)).toBe(true);
  });

  it("does NOT mark a pick the server has never seen", () => {
    // The reported case: picked, not saved, and indistinguishable until now.
    expect(pickIsSaved(SLATE[1].id, draft([SLATE[1].id, "away"]), STORED)).toBe(false);
  });

  it("does NOT mark a stored pick that has since been changed", () => {
    // Stored home, drafted away — the row is outstanding, not saved.
    expect(pickIsSaved(SLATE[0].id, draft([SLATE[0].id, "away"]), STORED)).toBe(false);
  });

  it("marks a pick changed away and back again", () => {
    /**
     * EQUALITY, not a touched flag. The stored value and the drafted value
     * agree, so there is nothing outstanding for this game however much tapping
     * happened on the way. A build that tracked "was this row edited" would
     * leave a permanently unsaved-looking row that is in fact saved.
     */
    expect(pickIsSaved(SLATE[0].id, draft([SLATE[0].id, "home"]), STORED)).toBe(true);
  });

  it("never marks an unpicked row, stored or not", () => {
    // A tick on an empty row would claim an absence was saved.
    expect(pickIsSaved(SLATE[2].id, draft(), STORED)).toBe(false);
    expect(pickIsSaved(SLATE[2].id, draft(), [])).toBe(false);
  });
});

describe("the mark on the sheet", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = globalThis;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  const render = (over: { picks?: SheetPick[]; editable?: boolean } = {}) =>
    renderToStaticMarkup(
      <PickemSheet
        gameId="game-1"
        slate={SLATE}
        settings={SETTINGS}
        picks={over.picks ?? STORED}
        subject={ME}
        editable={over.editable ?? true}
        saving={false}
        saveError={null}
        deadlineMs={4 * 3_600_000}
        closure={null}
        onSave={() => {}}
      />
    );

  /** Seed a draft with all three picked, over a server holding one. */
  const seedFullDraft = () => {
    const server = reconcileSheet(SLATE, STORED, SETTINGS);
    draftOutboxPut(
      "pickem",
      "game-1",
      fillAll(server.picks, "home"),
      JSON.stringify(server.picks),
      Date.now(),
      ME.userId
    );
  };

  const marks = (html: string): string[] =>
    html
      .split('data-testid="pickem-row-saved"')
      .slice(1)
      .map((part) => (part.slice(0, part.indexOf(">")).includes('data-saved="true"') ? "y" : "n"));

  it("ticks the stored row and leaves the drafted ones bare", () => {
    /**
     * THE WHOLE POINT, on a real render: one row stored, three drafted. Exactly
     * one tick.
     *
     * THE MUTATION: mark every picked row (drop the comparison against
     * `server.picks`). All three tick, the sheet says it is entirely saved, and
     * the change has reproduced the bug it was built to fix — in a new place.
     */
    seedFullDraft();
    const html = render();
    // The draft arrived, so this is not passing on a sheet that fell back to
    // the server's one pick.
    expect(html.split('data-selected="true"').length - 1, "three rows picked").toBe(3);
    expect(marks(html)).toEqual(["y", "n", "n"]);
  });

  it("ticks nothing when nothing is stored", () => {
    const server = reconcileSheet(SLATE, [], SETTINGS);
    draftOutboxPut(
      "pickem",
      "game-1",
      fillAll(server.picks, "home"),
      JSON.stringify(server.picks),
      Date.now(),
      ME.userId
    );
    const html = render({ picks: [] });
    expect(html.split('data-selected="true"').length - 1, "three rows picked").toBe(3);
    expect(marks(html)).toEqual(["n", "n", "n"]);
  });

  it("ticks every row on a sheet with no outstanding edit", () => {
    // The other half: a build that never ticked would pass both cases above.
    expect(marks(render({ picks: fillAll(emptySheet(SLATE), "home") }))).toEqual(["y", "y", "y"]);
  });

  it("reserves the gutter on unticked rows, so the cards keep one left edge", () => {
    // A gutter that collapsed when unticked would nudge every row sideways as
    // it saved — movement carrying no meaning.
    const html = render({ picks: setPick(emptySheet(SLATE), SLATE[0].id, "home") });
    expect(marks(html)).toEqual(["y", "n", "n"]);
    expect(html.split('data-testid="pickem-row-saved"').length - 1).toBe(3);
  });

  it("hangs the gutter into the sheet's own padding", () => {
    /**
     * The sheet is `px-4`, so a gutter that did not hang started 32px in and
     * put the tick hard against the card with all that space unused to its
     * left. Measured before and after: the glyph centre moved 39 -> 31 against
     * an available centre of 34, and the card kept its left edge — so nothing
     * shrank twice.
     *
     * THE MUTATION: drop the negative margin. The tick returns to the card's
     * elbow and every assertion about WHICH rows are ticked still passes,
     * because they are about the data and this is about the space.
     *
     * `lg:ml-0` mirrors the container's own `lg:px-0`: with no padding to
     * hang into, hanging would put the tick outside the panel.
     */
    const html = render({ picks: fillAll(emptySheet(SLATE), "home") });
    const at = html.indexOf('data-testid="pickem-row-saved"');
    const wrapper = html.slice(html.lastIndexOf("<div", at), at);
    expect(wrapper).toContain("-ml-4");
    expect(wrapper).toContain("lg:ml-0");
  });

  it("shows no gutter at all once picks are locked", () => {
    /**
     * Nothing can be unsaved then, so a column of ticks would confirm a thing
     * no longer in question — and it would take width from the surface that has
     * the most to say (the score, both lines, the cover box).
     */
    expect(render({ picks: fillAll(emptySheet(SLATE), "home"), editable: false })).not.toContain(
      "pickem-row-saved"
    );
  });
});

/**
 * THE BACK BUTTON ASKS BEFORE IT LEAVES (#1348) — a SOURCE guard, and it says
 * so.
 *
 * ── Why this is not a behaviour test ─────────────────────────────────────
 *
 * The wiring runs through three files and a click: `GameActionRow`'s back reads
 * `chrome.beforeLeave`, the chrome publisher forwards it through a ref, and
 * `PickemGameView` supplies `leaveSheet`. `environment: "node"` has no DOM, so
 * nothing here can tap a button — and a render assertion cannot see an
 * `onClick` at all, which is exactly why this gap shipped: the guard existed,
 * was wired to every tab change, and was missing from the one control that
 * leaves.
 *
 * So this pins the WIRING and states its limit. It cannot prove the prompt
 * appears; it can prove that no one has quietly gone back to an unconditional
 * `history.back()`, and that BOTH exits are gated — which is the failure this
 * class actually has (#24: two paths that must agree, where one asks).
 */
describe("both exits are gated (source guard)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the panel's back consults the chrome before navigating", () => {
    const src = read("src/components/shell/GameActionRow.tsx");
    expect(src).toContain("chrome.beforeLeave");
    // ...and it is the BACK button's own handler, not merely mentioned.
    const at = src.indexOf('data-testid="game-back"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(src.lastIndexOf("<button", at), at)).toContain("beforeLeave");
  });

  it("the chrome actually publishes it, or the row reads undefined forever", () => {
    const src = read("src/components/games/GameChrome.tsx");
    expect(src).toContain("beforeLeave?: (go: () => void) => void;");
    expect(src).toContain("beforeLeave: ref.current.beforeLeave");
    // In the republish key, or adding the gate to a mounted view never reaches
    // the row.
    expect(src).toContain("${!!data.beforeLeave}");
  });

  it("gates the BROWSER back too, which no chrome handler can see", () => {
    /**
     * `beforeLeave` covers the back CONTROL. A browser back, an OS gesture or a
     * mouse side button pops history directly and reaches no handler of ours —
     * the gap Zach hit immediately after the control was gated.
     *
     * `useModalBackButton` is the app's answer (phantom entry per layer, shared
     * stack, depth-tagged ownership) and this file already registers two. The
     * third must be armed on the DIRTY STATE — not the ref, which an effect
     * cannot see change — and disarmed while the prompt is up so it can re-arm
     * when the reader keeps editing.
     */
    const src = read("src/components/games/PickemGameView.tsx");
    expect(src).toContain("sheetIsDirty && picksOpen(clock, now) && !backPrompt");
    // The mirror exists, or the guard is keyed on a value that never changes.
    expect(src).toContain("setSheetIsDirty(d);");
    /**
     * SCOPED TO THE KEEP-EDITING HANDLER. A whole-file `toContain` passed
     * against a build that had dropped it from exactly this one, because
     * Discard, Save and the save-failure path all clear it too — three other
     * emitters of the same string, which is the substring corollary with the
     * collision inside one file rather than one document.
     *
     * This is the handler that matters: the phantom entry was consumed by the
     * press that raised the prompt, so staying put without re-arming leaves
     * the NEXT back unguarded.
     */
    const keep = src.slice(src.indexOf("onKeepEditing="));
    expect(keep.slice(0, keep.indexOf("}}"))).toContain("setBackPrompt(false)");
  });
  it("pick'em gates BOTH the panel back and the standalone back", () => {
    const src = read("src/components/games/PickemGameView.tsx");
    expect(src, "panel").toContain("beforeLeave: leaveSheet");
    expect(src, "standalone").toContain("onBack={() => leaveSheet(exitToBoard)}");
    // The bare form is what this replaces; its return would silently un-gate
    // the standalone route while the panel kept asking.
    expect(src).not.toContain("onBack={exitToBoard}");
  });
});
