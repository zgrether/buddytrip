"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

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

  return (
    <div
      className="flex h-10 items-center justify-between px-4"
      style={{ borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex-shrink-0 transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Trips
        </button>

        <ChevronRight size={13} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />

        {pageName ? (
          <button
            onClick={() => router.push(`/trips/${tripId}`)}
            className="min-w-0 truncate transition-opacity hover:opacity-70"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {tripTitle}
          </button>
        ) : (
          <span
            className="min-w-0 truncate font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {tripTitle}
          </span>
        )}

        {pageName && (
          <>
            <ChevronRight size={13} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
            <span
              className="flex-shrink-0 font-medium"
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
