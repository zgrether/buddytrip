import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheet, type PickemSheetGame } from "./PickemSheet";
import { draftOutboxPut, draftOutboxPeek } from "@/lib/draftOutbox";
import { emptySheet, fillAll, reconcileSheet, setPick, type SheetPick } from "@/lib/pickemSheet";

/**
 * "SUBMITTED N/16" IS A CLAIM ABOUT THE SERVER, AND IT WAS COUNTING THE DRAFT.
 *
 * ── The report ───────────────────────────────────────────────────────────
 *
 * Save five of sixteen and the line correctly reads "Submitted 5/16". Carry on
 * picking WITHOUT saving and it counts up with every tap, to "Submitted 16/16",
 * while the server still holds five. Leave then — the back button asks nothing —
 * and eleven picks the screen had just called submitted are gone.
 *
 * The staged-state lie (CLAUDE.md #18) in its purest form: a value repointed at
 * the draft while the WORD around it still promises the server. There is no
 * reading of "Submitted" that means "typed", so the reader is not wrong to
 * believe it.
 *
 * ── Getting a dirty draft into a static render ───────────────────────────
 *
 * `environment: "node"` — nothing clicks, so a divergent draft cannot be made
 * by picking. It can be RECOVERED: the sheet reads the draft outbox on its
 * first render, so seeding the outbox mounts the component with a working sheet
 * that already differs from the server. That is the real code path, not a
 * simulation of one — it is how a returning reader's draft comes back.
 *
 * ── The trap this file had to be written around ──────────────────────────
 *
 * Seeding the outbox is only half a test. If the draft never LOADS, `picks`
 * falls back to the server sheet, the count is the server's, and the assertion
 * passes — against the broken build, for the wrong reason. That is not
 * hypothetical: the recover was reading an unscoped key while the write was
 * scoped by user, so it had never restored anything.
 *
 * So every case below asserts the draft ARRIVED before asserting what the count
 * says about it.
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

/** ONE game stored — the "saved a partial sheet" state the report starts from. */
const STORED: SheetPick[] = [{ slateGameId: SLATE[0].id, pick: "home", confidence: 3 }];

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

const render = (picks: SheetPick[] = STORED) =>
  renderToStaticMarkup(
    <PickemSheet
      gameId="game-1"
      slate={SLATE}
      settings={SETTINGS}
      picks={picks}
      subject={ME}
      editable
      saving={false}
      saveError={null}
      deadlineMs={4 * 3_600_000}
      closure={null}
      onSave={() => {}}
    />
  );

/**
 * Seed the outbox with a draft that has MORE picked than the server does.
 *
 * The base fingerprint is built with the app's OWN `reconcileSheet`, because
 * that is what the component compares against — a hand-rolled string would be
 * rejected as stale and would leave this measuring a path that does not exist.
 */
function seedFullDraft() {
  const server = reconcileSheet(SLATE, STORED, SETTINGS);
  const full = fillAll(server.picks, "home");
  draftOutboxPut("pickem", "game-1", full, JSON.stringify(server.picks), Date.now(), ME.userId);
  return full;
}

/** The status line's own element, not the page. */
const progress = (html: string): string => {
  const at = html.indexOf('data-testid="pickem-sheet-progress"');
  if (at === -1) return "";
  const open = html.lastIndexOf("<", at);
  return html.slice(open, html.indexOf("</span>", at));
};

describe("the count says what was SUBMITTED", () => {
  it("holds at the stored number while a fuller draft is unsaved", () => {
    /**
     * THE BUG, EXACTLY. One game is stored; the draft has all three. The line
     * must say 1, because 1 is what a person would get back if they left now.
     *
     * THE MUTATION: count `picks` instead of `server.picks`, which is the build
     * this replaces. It says "Done" here — the draft is complete — which is the
     * strongest possible version of the false claim.
     */
    seedFullDraft();
    const html = render();

    // THE DRAFT ARRIVED. Without this the assertion below passes on a build
    // where recovery is broken and `picks` has quietly fallen back to the
    // server sheet — which is exactly how this shipped.
    expect(html, "the recovered draft must be on screen").toContain(
      'data-testid="pickem-pick-home" data-selected="true"'
    );
    expect(countSelected(html), "all three rows show a pick").toBe(3);

    // ...and the count still reports only what is stored.
    expect(progress(html)).toContain("Submitted 1/3");
    expect(progress(html)).not.toContain("Submitted 3/3");
    expect(progress(html)).not.toContain("Done");
  });

  it("says Done only when the SERVER holds a complete sheet", () => {
    // The other half: a build that hard-coded the stored count, or that never
    // updated, would pass the case above and never reach "Done" at all.
    const full = fillAll(emptySheet(SLATE), "home");
    expect(progress(render(full))).toContain("Done");
  });

  it("moves with the server between renders, not with the draft", () => {
    // Two stored, no draft — the count follows what was saved.
    const two = setPick(
      setPick(emptySheet(SLATE), SLATE[0].id, "home"),
      SLATE[1].id,
      "away"
    );
    expect(progress(render(two))).toContain("Submitted 2/3");
  });
});

describe("the draft outbox reads the key it writes", () => {
  it("recovers a draft stored under the subject's scope", () => {
    /**
     * THE MUTATION: drop the scope from the recover, which is the build this
     * replaces. `storeKey` appends `:<user>` when a scope is given, so the read
     * looked under a key nothing had ever written and returned null — and a
     * miss is indistinguishable from "no draft", so it failed silently.
     *
     * Pick'em is the only view that calls `draftOutboxRecover` directly rather
     * than through `useDraftOutbox`'s own scoped recover, which is how the two
     * halves of one key drifted apart.
     */
    const full = seedFullDraft();
    // The entry really is under the scoped key, so this is not passing because
    // the write happened to be unscoped too.
    expect(draftOutboxPeek("pickem", "game-1", ME.userId)?.draft).toEqual(full);
    expect(draftOutboxPeek("pickem", "game-1")).toBeNull();

    expect(countSelected(render()), "the draft came back").toBe(3);
  });

  it("still refuses a draft whose server has moved on", () => {
    // The no-clobber guard, which the scope must not have quietly disabled: a
    // draft is restored ONLY while the sheet it diverged from is unchanged.
    draftOutboxPut(
      "pickem",
      "game-1",
      fillAll(emptySheet(SLATE), "home"),
      "A-FINGERPRINT-FROM-SOME-OTHER-SHEET",
      Date.now(),
      ME.userId
    );
    // One stored pick, and no draft restored over it.
    expect(countSelected(render())).toBe(1);
  });
});

/** How many rows show a selected pick — the draft's footprint on screen. */
function countSelected(html: string): number {
  return html.split('data-selected="true"').length - 1;
}
