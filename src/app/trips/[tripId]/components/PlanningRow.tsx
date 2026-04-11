"use client";

import React from "react";
import { Check, ChevronDown } from "lucide-react";

export type ArcCardState = "done" | "inProgress" | "none";

export interface PlanningRowProps {
  icon: React.ReactNode;
  label: string;
  note: string;
  noteWarn?: boolean;
  /** Use planning (blue) color for icon/title/border when state === "inProgress" */
  warnState?: boolean;
  state: ArcCardState;
  isOpen: boolean;
  onToggle: () => void;
  /** Optional element rendered right-aligned in the header, before the chevron */
  headerAction?: React.ReactNode;
  children?: React.ReactNode;
}

export function PlanningRow({
  icon,
  label,
  note,
  noteWarn,
  warnState,
  state,
  isOpen,
  onToggle,
  headerAction,
  children,
}: PlanningRowProps) {
  const isDone = state === "done";
  const isInProgress = state === "inProgress";
  const inProgressColor = warnState ? "var(--color-bt-planning)" : "var(--color-bt-accent)";
  const inProgressBorder = warnState ? "var(--color-bt-planning-border)" : "var(--color-bt-accent-border)";
  const labelColor = isDone
    ? "var(--color-bt-accent)"
    : isInProgress
    ? inProgressColor
    : "var(--color-bt-text-dim)";
  const borderColor = isDone
    ? "var(--color-bt-accent-border)"
    : isInProgress
    ? inProgressBorder
    : "var(--color-bt-border)";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: isDone ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
      >
        <span
          className="flex-shrink-0"
          style={{ color: noteWarn ? "var(--color-bt-warning)" : labelColor }}
        >
          {isDone ? <Check size={16} /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight" style={{ color: labelColor }}>
            {label}
          </p>
          <p
            className="mt-0.5 text-xs"
            style={{
              color: noteWarn ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
              fontWeight: noteWarn ? 500 : undefined,
            }}
          >
            {note}
          </p>
        </div>
        {headerAction && (
          <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
            {headerAction}
          </div>
        )}
        <ChevronDown
          size={15}
          className="flex-shrink-0 transition-transform duration-200"
          style={{
            color: "var(--color-bt-text-dim)",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </div>

      {isOpen && children && (
        <div className="px-4 pb-4 pt-3" style={{ borderTop: `1px solid ${borderColor}` }}>
          {children}
        </div>
      )}
    </div>
  );
}
