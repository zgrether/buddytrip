/**
 * The pure half of reordering — the arithmetic, with no React and no dnd-kit.
 *
 * Split out for the reason CLAUDE.md #8 prescribes generally: the test
 * environment is `node`, so a component can only be asserted through
 * `renderToStaticMarkup` and never clicked. If "what does the up arrow do" lived
 * inside the component, the only available test would be "an up arrow is
 * rendered" — which is a test of the markup, not of the behaviour, and would
 * pass against an arrow wired to the wrong index.
 *
 * So the component renders; this decides. Both are covered, neither is
 * decorative.
 */

/**
 * Move the item at `from` to `to`, returning a NEW array.
 *
 * Equivalent to dnd-kit's `arrayMove` for the in-range cases, reimplemented here
 * so a client-safe pure module does not import a drag library to do arithmetic
 * — and so the out-of-range behaviour is ours to state rather than to inherit:
 * an index outside the array returns the input unchanged rather than splicing
 * `undefined` into it.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Can the item at `index` move by `delta` without falling off either end?
 *
 * The arrows' `disabled` state and the arrows' `onClick` MUST read this same
 * function. Two expressions of one bound is how the first row's up arrow ends
 * up enabled-but-inert, or worse, enabled and wrapping to the bottom.
 */
export function canMoveBy(index: number, delta: number, count: number): boolean {
  const to = index + delta;
  return index >= 0 && index < count && to >= 0 && to < count;
}

/**
 * Nudge the item at `index` by `delta` (-1 up, +1 down). A move that would leave
 * the list is a NO-OP returning the same array reference — never a wrap.
 *
 * Wrapping is the tempting "nice" behaviour and is wrong for a confidence
 * ranking: the top item is the one you are surest about, and an accidental
 * extra tap on its up arrow must not silently make it the one you are least
 * sure about.
 */
export function moveBy<T>(items: T[], index: number, delta: number): T[] {
  if (!canMoveBy(index, delta, items.length)) return items;
  return moveItem(items, index, index + delta);
}
