"use client";

import { useState } from "react";
import { AVATAR_CATEGORIES, getAvatarIconLabel } from "@/lib/avatarIcons";
import { AVATAR_ICON_COMPONENTS } from "@/lib/avatarIconComponents";

interface AvatarIconPickerProps {
  /** Currently selected icon id, or null = initials. */
  value: string | null;
  /** Fires immediately on any selection / deselection. Parent debounces + persists. */
  onChange: (iconId: string | null) => void;
  /**
   * Briefly flashes "Saved" in the footer when set to true (parent should
   * flip it back to false after ~1500ms). Optional — picker still works
   * without it.
   */
  showSaved?: boolean;
}

/**
 * Tabbed grid for picking an avatar icon. Tabs across the top
 * (Competition / Nature / Wild cards), grid of 32 icons per tab,
 * footer showing current selection + clear link.
 *
 * Selection state is global across tabs — the footer always reflects
 * the saved value regardless of which tab is open.
 */
export function AvatarIconPicker({ value, onChange, showSaved }: AvatarIconPickerProps) {
  const [activeTabId, setActiveTabId] = useState<string>(AVATAR_CATEGORIES[0].id);
  const activeTab =
    AVATAR_CATEGORIES.find((c) => c.id === activeTabId) ?? AVATAR_CATEGORIES[0];
  const currentLabel = getAvatarIconLabel(value);

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "0.5px solid var(--color-bt-border)",
      }}
    >
      {/* ── Tab bar ───────────────────────────────────────────── */}
      <div
        className="flex w-full"
        style={{
          background: "var(--color-bt-base)",
          borderBottom: "0.5px solid var(--color-bt-border)",
        }}
        role="tablist"
      >
        {AVATAR_CATEGORIES.map((cat) => {
          const isActive = cat.id === activeTab.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(cat.id)}
              className="flex-1 px-1 py-2.5 text-[11px] font-medium transition-colors sm:text-xs"
              style={{
                color: isActive ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                borderBottom: isActive
                  ? "2px solid var(--color-bt-accent)"
                  : "2px solid transparent",
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Icon grid ─────────────────────────────────────────── */}
      <div
        className="grid grid-cols-6 gap-[5px] p-[10px] sm:grid-cols-8 sm:gap-[6px] sm:p-3"
        role="tabpanel"
      >
        {activeTab.icons.map((icon) => {
          const IconComponent = AVATAR_ICON_COMPONENTS[icon.id];
          const isSelected = value === icon.id;
          return (
            <button
              key={icon.id}
              type="button"
              aria-label={icon.label}
              aria-pressed={isSelected}
              onClick={() => onChange(isSelected ? null : icon.id)}
              className="flex aspect-square items-center justify-center rounded-[9px] transition-colors [&_svg]:h-[34px] [&_svg]:w-[34px] sm:[&_svg]:h-[28px] sm:[&_svg]:w-[28px]"
              style={
                isSelected
                  ? {
                      background: "rgba(45, 212, 191, 0.12)",
                      border: "0.5px solid rgba(45, 212, 191, 0.4)",
                      color: "var(--color-bt-accent)",
                    }
                  : {
                      background: "var(--color-bt-card-raised)",
                      border: "0.5px solid var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                    }
              }
            >
              {IconComponent ? <IconComponent size={26} stroke={1.75} /> : null}
            </button>
          );
        })}
      </div>

      {/* ── Footer bar ────────────────────────────────────────────
           Left always shows the current avatar label (no swapping).
           Right side hosts "Clear" (when an icon is selected); a brief
           "Saved ✓" flash temporarily replaces Clear after a successful
           mutation, then Clear returns. */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderTop: "0.5px solid var(--color-bt-border)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {value ? `Avatar: ${currentLabel ?? value}` : "Avatar: Initials"}
        </span>
        <span className="flex items-center gap-2 text-[11px]">
          {showSaved && (
            <span
              className="inline-flex items-center gap-1 font-medium transition-opacity"
              style={{ color: "var(--color-bt-accent)" }}
              aria-live="polite"
            >
              ✓ Saved
            </span>
          )}
          {value && !showSaved ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="font-medium hover:underline"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Clear
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
