"use client";

import { AlertCircle, ChevronRight } from "lucide-react";

/**
 * PendingActionsCard — a prominent but non-blocking card shown at the top
 * of the Home tab when a member has unanswered action items.
 *
 * Designed to be generic: accepts `title`, `description`, and `children`
 * so future action types (expense RSVP, logistics confirmation, etc.)
 * can reuse the same wrapper without modification.
 */
export function PendingActionsCard({
  title,
  description,
  children,
  onDismiss,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1.5px solid var(--color-bt-accent-border)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-start gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <div
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--color-bt-accent-faint)" }}
        >
          <AlertCircle size={16} style={{ color: "var(--color-bt-accent)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            {description}
          </p>
        </div>
      </div>

      {/* Action-specific content (e.g. inline vote UI) */}
      <div className="px-4 py-3">
        {children}
      </div>

      {/* Dismiss link */}
      <div className="px-4 pb-3">
        <button
          onClick={onDismiss}
          className="flex items-center gap-0.5 text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          I&apos;ll decide later
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
