"use client";

import { useRef, useState, useEffect, type FC } from "react";
import { House, Users, Hotel, Calendar, DollarSign, Trophy, type LucideIcon } from "lucide-react";
import type { TabId } from "./BottomNav";
import { DOMAIN_COLORS, TAB_DOMAIN } from "@/lib/domainColors";

interface TabDef {
  id: TabId;
  label: string;
  Icon: LucideIcon;
}

const ALL_TABS: TabDef[] = [
  { id: "home",     label: "Home",        Icon: House       },
  { id: "crew",     label: "Crew",        Icon: Users       },
  { id: "lodging",  label: "Lodging",     Icon: Hotel       },
  { id: "schedule", label: "Agenda",      Icon: Calendar    },
  { id: "expenses", label: "Receipts",    Icon: DollarSign  },
  { id: "comp",     label: "Competition", Icon: Trophy      },
];

interface TripTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  canEdit?: boolean;
  /** Trip stage — used to disable Expenses in PLANNING and hide Competition */
  stage?: string;
  /**
   * Tabs that have a notification dot. Dot stays visible even on the
   * active tab so the user keeps seeing there's an issue with the
   * surface they're on (not just on tabs they haven't visited).
   * "info"    → teal  (normal action item, e.g. unconfirmed items)
   * "warning" → yellow (needs attention, e.g. dates out of range,
   *                     Pending crew members waiting on you)
   */
  badges?: Partial<Record<TabId, "info" | "warning">>;
}

export const TripTabBar: FC<TripTabBarProps> = ({
  activeTab,
  onTabChange,
  canEdit = false,
  stage,
  badges,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [iconMode, setIconMode] = useState(false);

  const tabs = ALL_TABS.filter((t) => {
    if (t.id === "comp") {
      // Competition is an owner/organizer-only authoring surface. Members
      // never see the tab — they follow a *live* competition through the
      // bottom nav's "Live" entry (the leaderboard route) instead.
      return canEdit;
    }
    // Lodging and Expenses are only meaningful once a destination is locked in —
    // keep them out of the IDEA stage. PLANNING and GOING both show all five
    // primary tabs (Home, Crew, Lodging, Agenda, Receipts) — they share the
    // same full tabbed interface.
    if ((t.id === "lodging" || t.id === "expenses") && stage === "idea") return false;
    // Lodging and Schedule are owner/planner authoring surfaces; the
    // confirmed content surfaces for members on the Home itinerary
    // anyway, so showing dedicated tabs would just duplicate the view.
    if ((t.id === "lodging" || t.id === "schedule") && !canEdit) return false;
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
        const badgeTier = badges?.[id];
        // Each area owns one hue — the active tab paints its icon, label,
        // and 2px underline in that domain color. Inactive tabs stay
        // neutral gray (color marks, never floods).
        const domainColor = DOMAIN_COLORS[TAB_DOMAIN[id]].color;
        return (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => onTabChange(id)}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors"
            style={{
              color: active ? domainColor : "var(--color-bt-text-dim)",
              borderBottom: active
                ? `2px solid ${domainColor}`
                : "2px solid transparent",
            }}
          >
            {/* Icon wrapped in relative container so the dot can be positioned.
                strokeWidth=1.75 matches the planning-grid mobile tab style for
                visual consistency between basic and advanced modes. */}
            <span className="relative inline-flex items-center justify-center">
              <Icon size={iconMode ? 20 : 16} strokeWidth={1.75} />
              {badgeTier && (
                <span
                  className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full"
                  style={{
                    background: badgeTier === "warning"
                      ? "var(--color-bt-warning)"
                      : "var(--color-bt-accent)",
                  }}
                />
              )}
            </span>
            {!iconMode && (
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
