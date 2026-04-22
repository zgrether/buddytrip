"use client";

import type { ReactNode } from "react";

export interface TwoColumnLayoutProps {
  /** Main column — full width on mobile, left column on desktop. */
  children: ReactNode;
  /** Sidebar column — hidden on mobile, fixed 320px on desktop. */
  sidebar: ReactNode;
  /** Extra classes applied to the outer grid wrapper. */
  className?: string;
  /** When true, the sidebar sticks to the top while the main column scrolls. */
  stickySidebar?: boolean;
  /** When true, the sidebar column is hidden on desktop and the main column
   *  expands to full width (matching mobile). */
  collapseSidebar?: boolean;
}

/**
 * TwoColumnLayout — the canonical desktop "main + sidebar" shell used across
 * the trip detail surfaces. On mobile the sidebar collapses away entirely;
 * on desktop (lg) it becomes a 320px right rail.
 *
 * Kept deliberately thin (no data fetching, no stage awareness) so each caller
 * supplies its own sidebar content — typically via <SidebarForStage />.
 */
export function TwoColumnLayout({
  children,
  sidebar,
  className = "",
  stickySidebar = false,
  collapseSidebar = false,
}: TwoColumnLayoutProps) {
  const gridClasses = collapseSidebar
    ? ""
    : "lg:grid lg:grid-cols-[1fr_320px] lg:gap-6";
  return (
    <div className={`${gridClasses} ${className}`}>
      <div className="min-w-0">{children}</div>
      {!collapseSidebar && (
        <div
          className={`hidden lg:flex lg:flex-col lg:gap-4 ${
            stickySidebar
              ? "lg:sticky lg:top-[4.5rem] lg:self-start lg:h-[calc(100vh-5rem)]"
              : ""
          }`}
        >
          {sidebar}
        </div>
      )}
    </div>
  );
}
