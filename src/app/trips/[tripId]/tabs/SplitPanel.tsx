"use client";

import { X } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
  /** "even" → simplified summary + Customize; "custom" → full per-person list. */
  mode?: "even" | "custom";
  /** Fired when the user toggles between even/custom views. */
  onModeChange?: (mode: "even" | "custom") => void;
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
  mode = "custom",
  onModeChange,
  onToggle,
  onOverrideChange,
  onResetOverride,
}: SplitPanelProps) {
  const currentUser = useCurrentUser();
  const showAmounts = totalAmount > 0;
  const { perPerson, evenShare, allOverridden, remaining } = showAmounts
    ? computeSplitDisplay(totalAmount, includedIds, overrides)
    : { perPerson: {} as Record<string, number>, evenShare: 0, allOverridden: false, remaining: 0 };

  const memberName = (uid: string) => {
    const m = members.find((x) => x.user_id === uid);
    // displayName first — it carries the trip-scoped nickname
    // (trip_members.nickname) so an Owner-renamed member shows their
    // trip name here, not the stale account name. Was reading
    // m.user.name directly, which surfaced the original users.name
    // even after a rename (e.g. "Tak" lingering after editing to "Taj").
    const name =
      m?.displayName ?? m?.user?.name ?? m?.user?.email ?? uid.slice(0, 6);
    return uid === currentUser?.id ? `${name} (you)` : name;
  };

  // Toggle ("Customize…" / "Use even split") shown inline with the
  // even/custom description line, matching its font size.
  const modeToggle =
    isOwnerEditing && onModeChange ? (
      <button
        type="button"
        onClick={() => onModeChange(mode === "even" ? "custom" : "even")}
        className="flex-shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80"
        style={{
          background: "var(--color-bt-card-raised)",
          borderColor: "var(--color-bt-accent-border)",
          color: "var(--color-bt-accent)",
        }}
      >
        {mode === "even" ? "Customize…" : "Use even split"}
      </button>
    ) : null;

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {/* Line 1 — "SPLIT" eyebrow */}
      <div
        className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Split
      </div>

      {/* Even-split simplified summary */}
      {mode === "even" ? (
        /* Line 2 — "Even split · $X each · N crew" + Customize button */
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm" style={{ color: "var(--color-bt-text)" }}>
            <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
              Even split
            </span>
            {showAmounts && includedIds.length > 0 && (
              <>
                {" · "}
                <span className="font-mono">${evenShare.toFixed(2)}</span> each
              </>
            )}
            {" · "}
            {includedIds.length} {includedIds.length === 1 ? "person" : "crew"}
          </p>
          {modeToggle}
        </div>
      ) : (
        <>
      {/* Line 2 — "Custom split — N of M selected" + Use even split button */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm" style={{ color: "var(--color-bt-text)" }}>
          <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
            Custom split
          </span>{" "}
          — {includedIds.length} of {members.length} selected
        </p>
        {modeToggle}
      </div>

      {/* Line 3 — SHARE / OVERRIDE column headers (all caps) */}
      {showAmounts && (
        <div
          className="mb-1 mt-2 flex items-center gap-2 pr-3 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <span className="min-w-0 flex-1" />
          <span className="w-14 flex-shrink-0 text-center">Share</span>
          <span className="w-20 flex-shrink-0 text-center">Override</span>
          <div className="w-6 flex-shrink-0" />
        </div>
      )}

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
                className="flex min-h-[44px] items-center gap-2 border-b px-3 py-1.5"
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
                className="flex min-h-[44px] items-center gap-2 border-b px-3 py-1.5"
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
                  className="w-14 flex-shrink-0 text-right font-mono text-xs tabular-nums"
                  style={{
                    color: isNeg ? "var(--color-bt-danger)" : "var(--color-bt-text)",
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
                  className="w-20 flex-shrink-0 rounded-md border px-2 py-1 text-right font-mono text-xs outline-none tabular-nums"
                  style={{
                    background: "var(--color-bt-card-raised)",
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
              className="flex min-h-[44px] cursor-pointer items-center gap-2 border-b px-3 py-1.5"
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
        </>
      )}
    </div>
  );
}
