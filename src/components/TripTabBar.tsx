"use client";

import type { FC } from "react";
import type { TabId } from "./BottomNav";

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "crew", label: "Crew" },
  { id: "schedule", label: "Schedule" },
  { id: "comp", label: "Competition" },
];

interface TripTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showComp?: boolean;
}

export const TripTabBar: FC<TripTabBarProps> = ({ activeTab, onTabChange, showComp = false }) => {
  const tabs = showComp ? ALL_TABS : ALL_TABS.filter((t) => t.id !== "comp");
  return (
    <div
      className="flex border-b"
      style={{ borderColor: "var(--color-bt-border)" }}
    >
      {tabs.map(({ id, label }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => onTabChange(id)}
            className="flex-1 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              borderBottom: active
                ? "2px solid var(--color-bt-accent)"
                : "2px solid transparent",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
