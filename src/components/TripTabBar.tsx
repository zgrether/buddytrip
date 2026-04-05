"use client";

import { useRef, useState, useEffect, type FC } from "react";
import { House, Users, Calendar, DollarSign, Trophy, type LucideIcon } from "lucide-react";
import type { TabId } from "./BottomNav";

interface TabDef {
  id: TabId;
  label: string;
  Icon: LucideIcon;
}

const ALL_TABS: TabDef[] = [
  { id: "home",     label: "Home",        Icon: House       },
  { id: "crew",     label: "Crew",        Icon: Users       },
  { id: "schedule", label: "Schedule",    Icon: Calendar    },
  { id: "expenses", label: "Expenses",    Icon: DollarSign  },
  { id: "comp",     label: "Competition", Icon: Trophy      },
];

interface TripTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showComp?: boolean;
  canEdit?: boolean;
  /** Trip stage — used to disable Expenses in PLANNING and hide Competition */
  stage?: string;
}

export const TripTabBar: FC<TripTabBarProps> = ({
  activeTab,
  onTabChange,
  showComp = false,
  canEdit = false,
  stage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [iconMode, setIconMode] = useState(false);

  const tabs = ALL_TABS.filter((t) => {
    if (t.id === "comp") {
      if (stage === "planning") return false;
      return canEdit && showComp;
    }
    // Hide Expenses in PLANNING stage
    if (t.id === "expenses" && stage === "planning") return false;
    return true;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setIconMode(width / tabs.length < 90);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabs.length]);

  return (
    <div
      ref={containerRef}
      className="flex border-b"
      style={{ borderColor: "var(--color-bt-border)" }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const active = activeTab === id;
          return (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => onTabChange(id)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              borderBottom: active
                ? "2px solid var(--color-bt-accent)"
                : "2px solid transparent",
            }}
          >
            {iconMode ? (
              <Icon size={18} />
            ) : (
              <>
                <Icon size={14} />
                <span>{label}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
};
