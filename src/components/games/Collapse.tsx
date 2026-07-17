"use client";

import { useEffect, useState } from "react";

/**
 * Collapse — smooth open/close for an accordion body. Uses the CSS grid-rows
 * `0fr ↔ 1fr` technique so it animates to the content's natural height with NO
 * measuring / rAF / hardcoded max-height (which is what made the panels read jerky —
 * the body just mounted and unmounted instantly).
 *
 * Children mount only while OPEN or during the close animation (a short unmount lag),
 * so a collapsed row still does no work — no premature queries from a body that isn't
 * shown yet (Course search / name lookups), matching the previous mount-on-open
 * behavior. The lag just keeps the body in the DOM long enough for the collapse to
 * animate before it unmounts. Honors `prefers-reduced-motion`.
 */

// Keep the body mounted a hair longer than the transition so the close animates fully.
const DURATION_MS = 200;
const UNMOUNT_MS = 240;

export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);

  // Open → mount immediately, via React's render-phase "adjust state on change"
  // pattern (not an effect — that would be a synchronous-setState-in-effect cascade).
  if (open && !mounted) setMounted(true);

  // Close → keep the body mounted through the collapse animation, then unmount. The
  // timer is a real external system, so the effect is the right home for it.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setMounted(false), UNMOUNT_MS);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div
      className="grid transition-[grid-template-rows] ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", transitionDuration: `${DURATION_MS}ms` }}
    >
      {/* min-h-0 lets the 0fr row actually collapse; overflow-hidden clips the body
          while it's mid-animation (at rest/open the row is content-height, so nothing
          visible is clipped). */}
      <div className="overflow-hidden" style={{ minHeight: 0 }}>
        {mounted && children}
      </div>
    </div>
  );
}
