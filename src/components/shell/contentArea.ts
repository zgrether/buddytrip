/**
 * ONE viewport geometry, shared by every surface the shell hosts.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * Trip and Cup each declared their own container, and both CENTRED it at a
 * different cap:
 *
 *   Trip   mx-auto max-w-[1280px] px-4 pt-4
 *   Cup    mx-auto max-w-[1024px] px-3 pt-4   →  stage  →  lg:mx-auto lg:max-w-[560px]
 *
 * Centring is the cause, not a symptom. A centred box's left edge is
 * `(available − cap) / 2`, so two boxes with different caps can never line up,
 * and the origin MOVES whenever the available width changes — which is why
 * opening chat slid the content sideways instead of accordioning from a fixed
 * edge.
 *
 * This is not a criticism of #754, which built Cup's two-pane layout when
 * Trip's layout was different and there was no rail to align to. Centring was
 * the right answer to "where does this sit on screen" when nothing else was on
 * screen. The rail answered that question differently, and the old answer is
 * what now reads as divergence.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 * At `lg+` the SHELL owns the content area — its padding, its cap and its left
 * alignment — and surfaces render flush inside it. A surface may still cap its
 * own COLUMN for readability (the board's 560), but it no longer decides where
 * the viewport starts or how wide it is. A second column (the game pane) is a
 * behaviour INSIDE that viewport: it appears beside the first column and the
 * origin does not move.
 *
 * Below `lg` there is no rail and each surface is a page, so mobile keeps its
 * own padding and its own centring — hence the `lg:`-gated resets here rather
 * than deleting the mobile rules outright.
 */

/**
 * A top-level surface's own box. Mobile keeps the page padding it always had;
 * at `lg+` it goes flush because the shell has already supplied the margin.
 *
 * `w-full` matters: with `lg:max-w-none` and no width, a flex/grid child can
 * shrink to its content instead of filling the content area.
 */
export const SURFACE_BOX =
  "mx-auto w-full max-w-[1280px] px-4 pt-4 lg:max-w-none lg:px-0 lg:pt-0";

/**
 * The content area's inset at `lg+` — the shell's padding, and therefore the
 * top margin every surface AND the chat column share by construction rather
 * than by three files agreeing on a number.
 *
 * UNCONDITIONAL, and that is the whole of item 2's vertical fix. It used to be
 * `xl:p-4` applied ONLY while the chat column was open, so opening chat added
 * 16px of padding on every side and closing it took them away — the content
 * visibly dropped and rose. Padding that depends on whether a sibling is open
 * is a layout that moves for a reason the user has no model for.
 *
 * 24px rather than 16: the left edge is now a real margin against the rail
 * divider rather than the incidental leftover of a centred box, so it is doing
 * visible work. **Device-pending** — whether this reads as comfortable rather
 * than cramped is a look-at-it judgement, not a derivation.
 */
export const CONTENT_INSET_PX = 24;
export const CONTENT_INSET = "lg:p-6";
