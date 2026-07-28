"use client";

import { type FC, useEffect, useRef } from "react";
import { Home, Calendar, Trophy, MessageCircle, type LucideIcon } from "lucide-react";
import { useGameChrome } from "@/components/games/GameChrome";
import type { AppView } from "./useAppView";

/**
 * AppTabBar — the persistent four-tab bar (Home · Trip · Cup · Chat), Phase 3.
 *
 * CHROME, per STYLE_GUIDE.md §1: the bottom navigation bar is one of exactly two
 * persistent app-frame elements, so it takes the chrome surface token and is
 * separated by a BORDER, never a shadow. It replaces `TripBottomNav`'s two-item
 * Trip Home / Live bar.
 *
 * Disabled tabs are TAPPABLE on purpose. A dead control teaches nothing; these
 * report what lives behind them and offer the action that unlocks it, which is
 * also the only discovery path for a crew member who has never seen a Cup.
 *
 * Height is published to `--bt-bottomnav-height` exactly as the old bar did, so
 * every existing consumer of that variable (chat panel offset, FAB placement,
 * the game panel's bottom padding) keeps working untouched.
 */

interface TabDef {
  id: AppView;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: "home", label: "Home", Icon: Home },
  { id: "trip", label: "Trip", Icon: Calendar },
  { id: "cup", label: "Cup", Icon: Trophy },
  { id: "chat", label: "Chat", Icon: MessageCircle },
];

/** Publish the rendered height so bottom-anchored surfaces can clear the bar.
 *  Lifted verbatim from BottomNav so the contract doesn't change. */
function usePublishNavHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--bt-bottomnav-height", `${el.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--bt-bottomnav-height");
    };
  }, []);
  return ref;
}

export const AppTabBar: FC<{
  active: AppView;
  /** False when no trip is selected — Trip/Cup/Chat explain instead of switching. */
  hasContext: boolean;
  onSelect: (view: AppView) => void;
  /** A locked tab was tapped: show its explainer rather than switching. */
  onLockedTap: (view: AppView) => void;
  /** Combined unread total across the Chat tab's VISIBLE segments only
   *  (see useChatTabUnread) — 0 renders no badge. */
  chatUnread?: number;
}> = (props) => {
  const chrome = useGameChrome();
  // The focused score-entry surfaces publish `hideBottomNav` (CLAUDE.md #13) —
  // match play's score screen, rack's and stroke's group entry. Their exit is the
  // app-bar back and their CTA anchors to the viewport bottom (#14), so a tab bar
  // would both crowd the CTA and offer an escape that loses the hole being
  // entered. The bar this replaces honoured the flag; so does this one.
  //
  // Gating HERE rather than inside `TabBar` is deliberate: the height-publishing
  // effect lives in the inner component, so hiding by unmounting it runs that
  // effect's cleanup and clears `--bt-bottomnav-height`. An early return after
  // the hook would leave the variable set and every bottom-anchored surface would
  // keep padding for a bar that isn't there.
  if (chrome?.hideBottomNav) return null;
  return <TabBar {...props} />;
};

const TabBar: FC<{
  active: AppView;
  hasContext: boolean;
  onSelect: (view: AppView) => void;
  onLockedTap: (view: AppView) => void;
  chatUnread?: number;
}> = ({ active, hasContext, onSelect, onLockedTap, chatUnread = 0 }) => {
  const navRef = usePublishNavHeight();

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden"
      style={{
        background: "var(--color-bt-card)",
        borderTop: "1px solid var(--color-bt-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      data-testid="app-tab-bar"
    >
      {/* tablist/tab, not bare buttons: `aria-selected` is only meaningful on the
          tab role, and a screen reader should hear "Cup, tab 3 of 4, selected"
          rather than four unrelated buttons. Locked tabs use aria-disabled (not
          `disabled`) because they stay focusable and DO respond — with copy. */}
      <div className="mx-auto grid max-w-2xl grid-cols-4" role="tablist">
        {TABS.map(({ id, label, Icon }) => {
          const locked = !hasContext && id !== "home";
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`app-tab-${id}`}
              data-locked={locked || undefined}
              aria-selected={selected}
              aria-disabled={locked || undefined}
              onClick={() => (locked ? onLockedTap(id) : onSelect(id))}
              className="relative flex min-w-0 flex-col items-center justify-center gap-1 py-2 transition-colors"
              style={{
                color: selected
                  ? "var(--color-bt-accent)"
                  : locked
                    ? "var(--color-bt-text-dim)"
                    : "var(--color-bt-text-dim)",
                // Locked reads as "not yet", not "broken" — dimmed, still legible,
                // still tappable.
                opacity: locked ? 0.45 : 1,
              }}
            >
              <span className="relative inline-flex">
                <Icon size={21} />
                {id === "chat" && chatUnread > 0 && (
                  <span
                    data-testid="app-tab-chat-unread"
                    className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full"
                    style={{ background: "var(--color-bt-accent)" }}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="max-w-full truncate px-1 text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
