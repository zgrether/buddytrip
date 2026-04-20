"use client";

import { Check, Pencil } from "lucide-react";
import type { ReactNode } from "react";

export interface ActionCardProps {
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  isResolved: boolean;
  resolvedSummary?: string;
  showEditButton?: boolean;
  onEditClick?: () => void;
  children?: ReactNode;
}

/**
 * ActionCard — the shared shell used by every card inside ActionCenter.
 *
 * Two visual states:
 *   • unresolved → raised card with header + body slot
 *   • resolved   → compact teal chip with summary + optional Edit button
 *
 * RsvpCard and TravelCard will reuse this shell in a future spec.
 */
export function ActionCard({
  icon,
  title,
  subtitle,
  isResolved,
  resolvedSummary,
  showEditButton = false,
  onEditClick,
  children,
}: ActionCardProps) {
  if (isResolved) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-4 py-3"
        style={{
          background: "var(--color-bt-tag-bg)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        <span
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          <Check size={14} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {title}
          </p>
          {resolvedSummary && (
            <p
              className="truncate text-[12px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {resolvedSummary}
            </p>
          )}
        </div>
        {showEditButton && onEditClick && (
          <button
            type="button"
            onClick={onEditClick}
            className="flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--color-bt-accent)" }}
            aria-label={`Edit ${title}`}
          >
            <span className="inline-flex items-center gap-1">
              <Pencil size={12} />
              Edit
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      {title && (
        <div
          className="flex items-center gap-2.5 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          {icon && (
            <span
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-accent)",
              }}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p
              className="text-[14px] font-semibold leading-tight"
              style={{ color: "var(--color-bt-text)" }}
            >
              {title}
            </p>
            {subtitle && (
              <p
                className="truncate text-[12px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="px-4 pb-4 pt-4">{children}</div>
    </div>
  );
}
