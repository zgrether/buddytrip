"use client";

import type { FC } from "react";
import type { TabId } from "./BottomNav";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "schedule", label: "Schedule" },
  { id: "crew", label: "Crew" },
  { id: "comp", label: "Competition" },
];

interface TripTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export const TripTabBar: FC<TripTabBarProps> = ({ activeTab, onTabChange }) => {
  return (
    <div
      className="flex border-b"
      style={{ borderColor: "var(--color-bt-border)" }}
    >
      {TABS.map(({ id, label }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => onTabChange(id)}
            className="relative flex-1 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {label}
            {active && (
              <span
                className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full"
                style={{ background: "var(--color-bt-accent)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
