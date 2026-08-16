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
const SURFACE_BASE = "mx-auto w-full max-w-[1280px] pt-4 lg:max-w-none lg:pt-0";
export const SURFACE_BOX = `${SURFACE_BASE} px-4 lg:px-0`;

/**
 * The same box for a surface that supplies its OWN horizontal padding further
 * down (the idea-phase `<main>`, whose HomeTab pads itself).
 *
 * A separate export rather than `${SURFACE_BOX} px-0`: two utilities from the
 * SAME variant level don't resolve by their order in the class attribute, they
 * resolve by their order in the generated stylesheet — where Tailwind emits
 * `px-0` before `px-4`, so the `px-4` would have won and the override would have
 * been silently inert. (The `lg:` overrides above are safe for the opposite
 * reason: a variant always sorts after its base.)
 */
export const SURFACE_BOX_FLUSH = SURFACE_BASE;

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

/**
 * The same inset with the TOP dropped — what the content area uses at GAME
 * DEPTH, so the game's header row runs flush under the app bar exactly as it
 * does on mobile (where the panel is `fixed top-14` and always did).
 *
 * ── Why the padding comes off HERE rather than being pulled off below ───────
 * Two shipped attempts moved the panel (or its first child) upward with a
 * negative margin, and both rendered the game title sliced in half:
 *
 *   #938  `-mt-6` on `GameActionRow`, which is the first child of a box that is
 *         `overflow-y-auto`. Content above a scroll container's origin is not
 *         scrolled to — it is clipped.
 *   #939  `-mt-6` on the panel box itself, which escaped the NEXT clipper up:
 *         `shell-body` is `lg:overflow-hidden` in two-pane mode.
 *
 * A negative margin does not remove padding; it moves ONE box out of its
 * parent. This subtree has two `overflow-hidden` ancestors, so there is no box
 * that can be pulled up without leaving one of them. Removing the padding
 * instead moves the whole chain together and leaves nothing to clip.
 *
 * Horizontal and bottom insets are unchanged: the row should line up with the
 * content beneath it and with the rail divider, and mobile's full-bleed has no
 * rail to sit against.
 */
export const CONTENT_INSET_AT_GAME_DEPTH = "lg:px-6 lg:pb-6 lg:pt-0";
