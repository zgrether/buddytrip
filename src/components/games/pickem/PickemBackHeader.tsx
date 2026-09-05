"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * The title-with-a-way-back that sits above a pick'em SUB-SCREEN.
 *
 * Two surfaces open something from a list and need to get back out of it:
 * reading one person's sheet (Other picks → a name) and opening one pairing
 * (Matches → a match). Both had their own copy of this row, character-identical
 * in every style value — same `gap-1 px-1`, same 32×32 accent chevron with the
 * same `-ml-1`, same `min-w-0 flex-1 truncate` title at the same size and
 * weight. They differed only in the words, one testid, and whether anything sat
 * on the right.
 *
 * ── A THIRD FILE, not one importing the other ─────────────────────────────
 *
 * `PickemHeadToHead` is rendered BY `PickemBoard`, and `PickemOtherPicks` is a
 * sibling of neither. Either direction of import would make one sub-screen
 * depend on an unrelated one for its chrome. This is the shape CLAUDE.md's
 * `PickemUnassignedNote` note prescribes for exactly this reason: when two
 * shapes need the same piece and neither contains the other, the piece gets its
 * own file that both import.
 *
 * ── Both consumers are ANCHORED, and that is half the point ───────────────
 *
 * Only one of the two copies carried a `data-testid`. An unanchored duplicate
 * is invisible to any test of the other, which is the mechanism that lets
 * copies drift in the first place — so `testId` is REQUIRED rather than
 * optional, and each consumer passes its own. A shared testid would let one
 * consumer's test pass against the other's markup, which is the failure
 * `PickemSegments`' `testIdPrefix` note already describes.
 *
 * ── NOT `PickemProxyPanel`'s chevron ──────────────────────────────────────
 *
 * That one is `size={18}` inside a warning band and is deliberately not this
 * header — it is a WARNING about the only way proxy entry goes badly, not a
 * title. Its own file says so. It stays where it is.
 */
export function PickemBackHeader({
  title,
  onBack,
  backLabel,
  trailing,
  testId,
  backTestId,
}: {
  /** The subject of the sub-screen — a person's sheet, a pairing. */
  title: ReactNode;
  onBack: () => void;
  /** Where back GOES, named for a screen reader. The two surfaces return to
   *  different lists, so this is not derivable here. */
  backLabel: string;
  /** The right-hand slot — the head-to-head's "Match 3 of 8". A slot rather
   *  than a prop this file interprets: the two surfaces count different things
   *  and neither should have to explain itself here. */
  trailing?: ReactNode;
  testId: string;
  backTestId: string;
}) {
  return (
    <div
      className="flex items-center gap-1 px-1"
      data-testid={testId}
      /**
       * The MECHANISM anchor, and the reason it is not just the testid.
       *
       * The plausible wrong build is a half-conversion — one consumer moved
       * here, the other left on its inline copy. Both copies were
       * character-identical, so nothing about the rendered markup, the styles
       * or a diff would show it. `pickem-reading-header` in particular existed
       * BEFORE this component did, so asserting that testid proves the header
       * rendered and says nothing about where it came from.
       *
       * This attribute only this file emits. A consumer that did not move
       * cannot produce it however closely its markup matches.
       */
      data-pickem-back-header=""
    >
      <button
        type="button"
        onClick={onBack}
        data-testid={backTestId}
        aria-label={backLabel}
        className="-ml-1 flex shrink-0 items-center justify-center"
        style={{ width: 32, height: 32, color: "var(--color-bt-accent)" }}
      >
        <ChevronLeft size={20} />
      </button>
      <span
        className="min-w-0 flex-1 truncate"
        data-testid="pickem-back-header-title"
        style={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}
      >
        {title}
      </span>
      {trailing}
    </div>
  );
}
