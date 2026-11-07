"use client";

import { useEffect, useState } from "react";

/**
 * Is this element laid out right now? False while any ancestor is `hidden`.
 *
 * The shell keeps a visited tab mounted and hides it (`AppShell`), so a surface
 * can be mounted and invisible at once, and nothing re-renders it when the tab
 * comes back. A ResizeObserver does report that: the element's box goes from
 * nothing to something. Used where a surface must not act while unseen, such
 * as opening a sheet that portals to the body over whatever tab is showing.
 *
 * Returns a callback ref and the answer. With no ResizeObserver (a server
 * render) it reads once and stays.
 */
export function useShownOnScreen(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!el) return;
    const check = () => setShown(el.getClientRects().length > 0);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, shown];
}
