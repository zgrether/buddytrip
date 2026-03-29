"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

interface TripBreadcrumbProps {
  tripId: string;
  tripTitle: string;
  /** Current page name — omit if this IS the trip home */
  pageName?: string;
  /** Optional action button shown on the right (e.g. settings, share) */
  rightSlot?: ReactNode;
}

export function TripBreadcrumb({
  tripId,
  tripTitle,
  pageName,
  rightSlot,
}: TripBreadcrumbProps) {
  const router = useRouter();

  const backHref = pageName ? `/trips/${tripId}` : "/dashboard";
  const backLabel = pageName ? tripTitle : "Trips";

  return (
    <div
      className="flex h-10 items-center justify-between px-4"
      style={{ background: "var(--color-bt-card)", borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <button
          onClick={() => router.push(backHref)}
          className="flex flex-shrink-0 items-center gap-0.5 transition-opacity hover:opacity-70"
          style={{ color: pageName ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
        >
          <ChevronLeft size={16} className="-ml-1" />
          <span className={`max-w-[160px] truncate${pageName ? " font-semibold" : ""}`}>{backLabel}</span>
        </button>

        {pageName && (
          <>
            <span style={{ color: "var(--color-bt-border)" }}>·</span>
            <span
              className="truncate font-medium"
              style={{ color: "var(--color-bt-text)" }}
            >
              {pageName}
            </span>
          </>
        )}
      </div>

      {rightSlot && (
        <div className="ml-2 flex flex-shrink-0 items-center">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
