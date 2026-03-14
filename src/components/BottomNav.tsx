"use client";

import type { FC } from "react";
import { Home, Calendar, Users, Trophy, MoreHorizontal, type LucideIcon } from "lucide-react";

export type TabId = "home" | "schedule" | "crew" | "comp" | "more";

interface Tab {
  id: TabId;
  label: string;
  Icon: LucideIcon;
}

const ALL_TABS: Tab[] = [
  { id: "home", label: "Home", Icon: Home },
  { id: "schedule", label: "Schedule", Icon: Calendar },
  { id: "crew", label: "Crew", Icon: Users },
  { id: "comp", label: "Comp", Icon: Trophy },
  { id: "more", label: "More", Icon: MoreHorizontal },
];

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showComp?: boolean;
}

export const BottomNav: FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  showComp = false,
}) => {
  const tabs = showComp ? ALL_TABS : ALL_TABS.filter((t) => t.id !== "comp");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 mx-auto flex max-w-lg items-stretch"
      style={{
        background: "var(--color-bt-card)",
        borderTop: "1px solid var(--color-bt-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => onTabChange(id)}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            style={{ color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
            aria-pressed={active}
          >
            <Icon
              size={22}
              style={{ color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
