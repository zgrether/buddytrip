"use client";

import { X } from "lucide-react";
import type { ExpenseMember } from "./ExpensesSection";

// ── Split computation ─────────────────────────────────────────────────────

export function computeSplitDisplay(
  totalAmount: number,
  includedIds: string[],
  overrides: Record<string, string>
): {
  perPerson: Record<string, number>;
  evenShare: number;
  allOverridden: boolean;
  remaining: number;
} {
  if (includedIds.length === 0) {
    return { perPerson: {}, evenShare: 0, allOverridden: false, remaining: 0 };
  }

  const overriddenTotal = includedIds
    .filter((uid) => (overrides[uid] ?? "") !== "")
    .reduce((sum, uid) => sum + (Number(overrides[uid]) || 0), 0);

  const nonOverriddenIds = includedIds.filter((uid) => (overrides[uid] ?? "") === "");
  const allOverridden = nonOverriddenIds.length === 0;
  const evenShare = !allOverridden
    ? (totalAmount - overriddenTotal) / nonOverriddenIds.length
    : 0;

  const perPerson: Record<string, number> = {};
  for (const uid of includedIds) {
    const ov = overrides[uid];
    perPerson[uid] = ov && ov !== "" ? Number(ov) || 0 : evenShare;
  }

  return {
    perPerson,
    evenShare,
    allOverridden,
    remaining: allOverridden ? totalAmount - overriddenTotal : 0,
  };
}

// ── SplitPanel ────────────────────────────────────────────────────────────

interface SplitPanelProps {
  members: ExpenseMember[];
  totalAmount: number;
  includedIds: string[];
  overrides: Record<string, string>;
  optedOutIds?: string[];
  isOwnerEditing?: boolean;
  onToggle: (userId: string) => void;
  onOverrideChange: (userId: string, value: string) => void;
  onResetOverride: (userId: string) => void;
}

export function SplitPanel({
  members,
  totalAmount,
  includedIds,
  overrides,
  optedOutIds = [],
  isOwnerEditing = false,
  onToggle,
  onOverrideChange,
  onResetOverride,
}: SplitPanelProps) {
  const showAmounts = totalAmount > 0;
  const { perPerson, allOverridden, remaining } = showAmounts
    ? computeSplitDisplay(totalAmount, includedIds, overrides)
    : { perPerson: {} as Record<string, number>, allOverridden: false, remaining: 0 };

  const memberName = (uid: string) => {
    const m = members.find((x) => x.user_id === uid);
    // displayName first — it carries the trip-scoped nickname
    // (trip_members.nickname) so an Owner-renamed member shows their
    // trip name here, not the stale account name. Was reading
    // m.user.name directly, which surfaced the original users.name
    // even after a rename (e.g. "Tak" lingering after editing to "Taj").
    return m?.displayName ?? m?.user?.name ?? m?.user?.email ?? uid.slice(0, 6);
  };

  return (
    <div>
      {/* Header row */}
      <div
        className="mb-1 flex items-center gap-2 pr-3 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <span className="min-w-0 flex-1">Split among</span>
        {showAmounts && (
          <>
            <span className="w-14 flex-shrink-0 text-right">Share</span>
            <span className="w-16 flex-shrink-0 text-right">Override</span>
            <div className="w-6 flex-shrink-0" />
          </>
        )}
      </div>

      {/* Member rows */}
      <div>
        {members.map((m, i) => {
          const uid = m.user_id;
          const checked = includedIds.includes(uid);
          const isOptedOut = optedOutIds.includes(uid);
          const hasOverride = checked && (overrides[uid] ?? "") !== "";
          const displayAmt = showAmounts && checked ? perPerson[uid] ?? 0 : null;
          const isNeg = displayAmt !== null && displayAmt < 0;

          // Alternating row backgrounds
          const rowBg = i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.025)";

          // Opted-out member: shown unchecked with label
          if (isOptedOut && !checked) {
            return (
              <div
                key={uid}
                className="flex items-center gap-2 border-b px-3 py-1.5"
                style={{
                  background: rowBg,
                  borderColor: "var(--color-bt-border)",
                }}
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => onToggle(uid)}
                  disabled={!isOwnerEditing}
                  className="flex-shrink-0 accent-bt-accent"
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {memberName(uid)}{" "}
                  <span className="text-xs italic">(opted out)</span>
                </span>
              </div>
            );
          }

          // Checked member with amounts visible
          if (checked && showAmounts) {
            return (
              <div
                key={uid}
                className="flex items-center gap-2 border-b px-3 py-1.5"
                style={{
                  background: rowBg,
                  borderColor: "var(--color-bt-border)",
                }}
              >
                <input
                  type="checkbox"
                  id={`split-${uid}`}
                  checked
                  onChange={() => onToggle(uid)}
                  className="flex-shrink-0 cursor-pointer accent-bt-accent"
                />
                <label
                  htmlFor={`split-${uid}`}
                  className="min-w-0 flex-1 cursor-pointer truncate text-sm"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {memberName(uid)}
                </label>
                <span
                  className="w-14 flex-shrink-0 text-right text-xs tabular-nums"
                  style={{
                    color: isNeg ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {displayAmt !== null ? `$${displayAmt.toFixed(2)}` : ""}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="—"
                  value={overrides[uid] ?? ""}
                  onChange={(e) => onOverrideChange(uid, e.target.value)}
                  className="w-16 flex-shrink-0 rounded-md border px-2 py-1 text-right text-xs outline-none tabular-nums"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: hasOverride
                      ? "var(--color-bt-accent-border)"
                      : "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                  {hasOverride && (
                    <button
                      type="button"
                      onClick={() => onResetOverride(uid)}
                      className="flex h-6 w-6 items-center justify-center transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // Simple unchecked or checked-without-amounts row
          return (
            <label
              key={uid}
              className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5"
              style={{
                background: rowBg,
                borderColor: "var(--color-bt-border)",
                color: checked ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(uid)}
                className="flex-shrink-0 accent-bt-accent"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {memberName(uid)}
              </span>
            </label>
          );
        })}
      </div>

      {/* Remaining / over-by warning */}
      {showAmounts && allOverridden && Math.abs(remaining) >= 0.01 && (
        <p
          className="mt-1.5 text-right text-xs"
          style={{
            color: remaining > 0 ? "var(--color-bt-warning)" : "var(--color-bt-danger)",
          }}
        >
          {remaining > 0
            ? `Remaining: $${remaining.toFixed(2)} unassigned`
            : `Over by: $${Math.abs(remaining).toFixed(2)}`}
        </p>
      )}
    </div>
  );
}
