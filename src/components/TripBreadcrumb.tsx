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
      className="flex items-center justify-between px-4"
      style={{
        height: "44px",
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      <button
        onClick={() => router.push(backHref)}
        className="flex min-w-0 items-center gap-1 text-sm font-medium transition-opacity hover:opacity-70"
        style={{
          color: "var(--color-bt-text-dim)",
          minHeight: "44px",
        }}
      >
        <ChevronLeft className="-ml-1 h-4 w-4 flex-shrink-0" />
        <span className="max-w-[200px] truncate">{backLabel}</span>
      </button>

      {rightSlot && (
        <div className="ml-2 flex flex-shrink-0 items-center">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
