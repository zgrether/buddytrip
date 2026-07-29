"use client";

import { type FC, useEffect, useRef } from "react";
import { Home, Calendar, Trophy, MessageCircle, type LucideIcon } from "lucide-react";
import { useGameChrome } from "@/components/games/GameChrome";
import { useChatTabUnread } from "@/hooks/useChatTabUnread";
import type { AppView } from "./useAppView";
import type { LockedExplainerView } from "./LockedTabExplainer";

/**
 * AppTabBar — Home · Trip · Cup as destinations, Chat as an ACTION (Phase 6).
 *
 * Chat used to be a fourth destination, rendered in place of whichever tab
 * was selected — which meant Chat and Cup could both read "active" at once,
 * tapping Chat abandoned wherever you were, and there was a tablet-width band
 * where Chat was the only reachable thing on screen. It never takes selected
 * state now: tapping it opens an overlay ON TOP of whichever tab is
 * highlighted, and that tab STAYS highlighted, because you never left it.
 *
 * CHROME, per STYLE_GUIDE.md §1: the bottom navigation bar is one of exactly two
 * persistent app-frame elements, so it takes the chrome surface token and is
 * separated by a BORDER, never a shadow. It replaces `TripBottomNav`'s two-item
 * Trip Home / Live bar.
 *
 * Disabled tabs are TAPPABLE on purpose. A dead control teaches nothing; these
 * report what lives behind them and offer the action that unlocks it, which is
 * also the only discovery path for a crew member who has never seen a Cup. The
 * Chat action gets the same treatment when there's no trip context.
 *
 * Height is published to `--bt-bottomnav-height` exactly as the old bar did, so
 * every existing consumer of that variable (chat sheet offset, FAB placement,
 * the game panel's bottom padding) keeps working untouched.
 *
 * GRID, not flex, for the bar: four cells must hold their positions regardless
 * of content, and `flex: 1` would let any one cell's content skew widths.
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
  /** False when no trip is selected — Trip/Cup explain instead of switching;
   *  the Chat action explains instead of opening. */
  hasContext: boolean;
  onSelect: (view: AppView) => void;
  /** A locked tab (or the locked Chat action) was tapped: show its explainer
   *  rather than switching/opening. */
  onLockedTap: (view: LockedExplainerView) => void;
  /** Whether the chat overlay is currently open — the action cell deepens its
   *  tint and fills its glyph while open, but never claims `aria-selected`;
   *  it is not one of the three destinations. */
  chatOpen: boolean;
  /** Opens the chat overlay. Never routes through `onSelect` — chat is not a
   *  view, so opening it must not touch `?view=`. */
  onToggleChat: () => void;
  /** Drives the Chat action's unread dot (Crew + Planning + News, combined and
   *  already visibility-filtered server-side). Null on the context-free host. */
  tripId?: string | null;
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
  onLockedTap: (view: LockedExplainerView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  tripId?: string | null;
}> = ({ active, hasContext, onSelect, onLockedTap, chatOpen, onToggleChat, tripId }) => {
  const navRef = usePublishNavHeight();
  const chatUnread = useChatTabUnread(tripId ?? undefined);
  const chatLocked = !hasContext;
  const showChatDot = !chatLocked && chatUnread > 0;

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
          `disabled`) because they stay focusable and DO respond — with copy.
          The Chat cell is role="button", not role="tab" — it is an action, not
          one of the mutually-exclusive panels this tablist switches between,
          and it never carries aria-selected. It still lives in the SAME grid
          row for the shared four-column layout. */}
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
                color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                // Locked reads as "not yet", not "broken" — dimmed, still legible,
                // still tappable.
                opacity: locked ? 0.45 : 1,
              }}
            >
              <span className="relative">
                <Icon size={21} />
              </span>
              <span className="max-w-full truncate px-1 text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
        {/* The Chat action — tinted region differentiates it from the three
            destinations at rest; opening it deepens the tint and fills the
            glyph, which reads as a distinct signal from "this is an action"
            (a single tint can't carry both). No count badge — a dot instead,
            same as the other tabs used pre-redesign; a floating pill fights
            the bar's flat aesthetic. */}
        <button
          type="button"
          role="button"
          aria-pressed={chatOpen}
          aria-label="Chat"
          data-testid="app-tab-chat"
          data-locked={chatLocked || undefined}
          onClick={() => (chatLocked ? onLockedTap("chat") : onToggleChat())}
          className="relative flex min-w-0 flex-col items-center justify-center gap-1 py-2 transition-colors"
          style={{
            // Deeper mix while open — "tinted" and "open" have to read as two
            // different signals, not one tint doing both jobs.
            background: chatLocked
              ? undefined
              : chatOpen
                ? "color-mix(in srgb, var(--color-bt-accent) 22%, transparent)"
                : "var(--color-bt-accent-faint)",
            color: chatLocked
              ? "var(--color-bt-text-dim)"
              : chatOpen
                ? "var(--color-bt-accent)"
                : "var(--color-bt-text-dim)",
            opacity: chatLocked ? 0.45 : 1,
          }}
        >
          <span className="relative">
            <MessageCircle size={21} fill={chatOpen ? "currentColor" : "none"} />
            {showChatDot && (
              <span
                aria-hidden="true"
                data-testid="app-tab-chat-badge"
                className="absolute rounded-full"
                style={{
                  top: -2,
                  right: -4,
                  width: 8,
                  height: 8,
                  background: "var(--color-bt-owner)",
                  border: "1.5px solid var(--color-bt-card)",
                }}
              />
            )}
          </span>
          <span className="max-w-full truncate px-1 text-[10px] font-medium">Chat</span>
        </button>
      </div>
    </nav>
  );
};
