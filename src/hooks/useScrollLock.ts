import { RemoveScroll } from "react-remove-scroll";

/**
 * Single source of truth for locking body scroll while an overlay is open.
 *
 * Wrap the outermost rendered element of an open overlay (modal, bottom
 * sheet, drawer, dropdown, picker) with this component:
 *
 *   {isOpen && (
 *     <ScrollLock>
 *       <div className="fixed inset-0 ...">...</div>
 *     </ScrollLock>
 *   )}
 *
 * Usage notes:
 *   - Mount it conditionally — render <ScrollLock> only when the overlay is
 *     open, and unmount it when closed. Don't leave it mounted and toggle an
 *     `enabled` prop; unmounting is cleaner and avoids edge cases with
 *     stacked overlays.
 *   - For overlays rendered through createPortal, wrap the content *inside*
 *     the portal, not the createPortal() call itself.
 *   - Stacked overlays are handled automatically — `react-remove-scroll`
 *     coordinates multiple mounted instances so scroll is released only once
 *     the last one unmounts.
 *
 * Everything routes through this re-export so swapping the underlying
 * scroll-lock library only touches this file.
 */
export const ScrollLock = RemoveScroll;
