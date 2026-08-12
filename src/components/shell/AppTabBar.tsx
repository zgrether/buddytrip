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
 * of content, and `flex: 1` would let any one cell's content skew widths. The
 * grid carries a 5th, 1px column for the hairline divider ahead of Chat
 * (`repeat(3, 1fr) 1px 1fr`) — a non-interactive spacer, not a fifth cell.
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
  /**
   * Cup specifically is unavailable, and WHY — the missing prerequisite named as
   * the user would go and set it ("A destination").
   *
   * Distinct from `hasContext`, which locks every tab because no trip is open at
   * all. This locks Cup ALONE on a trip that is open: during the idea phase
   * there is nothing to compete over yet, but crew, chat and the destination
   * comparison all work. Null when Cup is available.
   */
  cupLockedReason?: string | null;
  /** Whether the chat overlay is currently open — the action cell fills its
   *  glyph and switches to the accent color while open, but never claims
   *  `aria-selected`; it is not one of the three destinations. */
  chatOpen: boolean;
  /** Opens the chat overlay. Never routes through `onSelect` — chat is not a
   *  view, so opening it must not touch `?view=`. */
  onToggleChat: () => void;
  /** Drives the Chat action's unread dot (Crew + Planning + News, combined and
   *  already visibility-filtered server-side). Null on the context-free host. */
  tripId?: string | null;
}> = (props) => {
  const chrome = useGameChrome();
  // The focused score-entry surfaces publish `focusedEntry` (CLAUDE.md #13) —
  // match play's score screen, rack's and stroke's group entry. Their exit is the
  // game action row's back and their CTA anchors to the viewport bottom (#14), so
  // a tab bar would both crowd the CTA and offer an escape that loses the hole
  // being entered. The bar this replaces honoured the flag; so does this one.
  // (The same flag also hides the TOP bar on mobile — see GameChrome.)
  //
  // Gating HERE rather than inside `TabBar` is deliberate: the height-publishing
  // effect lives in the inner component, so hiding by unmounting it runs that
  // effect's cleanup and clears `--bt-bottomnav-height`. An early return after
  // the hook would leave the variable set and every bottom-anchored surface would
  // keep padding for a bar that isn't there.
  if (chrome?.focusedEntry) return null;
  return <TabBar {...props} />;
};

const TabBar: FC<{
  active: AppView;
  hasContext: boolean;
  onSelect: (view: AppView) => void;
  onLockedTap: (view: LockedExplainerView) => void;
  cupLockedReason?: string | null;
  chatOpen: boolean;
  onToggleChat: () => void;
  tripId?: string | null;
}> = ({
  active,
  hasContext,
  onSelect,
  onLockedTap,
  cupLockedReason = null,
  chatOpen,
  onToggleChat,
  tripId,
}) => {
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
      <div
        className="mx-auto grid max-w-2xl"
        style={{ gridTemplateColumns: "repeat(3, 1fr) 1px 1fr" }}
        role="tablist"
      >
        {TABS.map(({ id, label, Icon }) => {
          // Two independent reasons a tab can be locked: no trip at all, or
          // (Cup only) a trip that has no destination yet.
          const locked = (!hasContext && id !== "home") || (id === "cup" && !!cupLockedReason);
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
              // PRESS STATE — none of these cells showed anything on tap before
              // this. `active:scale-[0.98]` reuses STYLE_GUIDE.md §5's own
              // documented "Active/pressed" treatment verbatim (also the value
              // 12 other sites in this app already use), rather than inventing
              // a nav-specific number. It fires from `:active` alone — SELECTED
              // is a separate, `color`-driven state, so pressing the already-
              // active tab still scales down exactly like any other cell (the
              // spec's own constraint).
              //
              // No `hover:` here — this bar is `lg:hidden` (mobile only), and a
              // hover class on a touch-only surface is how you get "sticky
              // hover" (a tapped cell staying visually hovered until something
              // else is tapped) rather than a real affordance.
              //
              // `transition-[color,transform]`, not two separate `transition-*`
              // classes — `transition-colors` (existing, for SELECTED's color
              // swap) and a plain `transition-transform` class each set the
              // FULL `transition-property` value, so combining them as two
              // classes is a coin flip on which one wins. The arbitrary-value
              // list form is the one unambiguous way to animate both, and this
              // repo already proves the syntax works (`Collapse.tsx`'s
              // `transition-[grid-template-rows]`).
              //
              // No stated focus convention exists anywhere on a BUTTON in this
              // app (only text inputs use `focus:ring-*`) — flagged in the
              // survey as a real gap, not assumed away. `focus-visible` (not
              // bare `focus`) so it shows for keyboard users only, never on a
              // tap/click; `ring-inset` keeps the ring inside the cell rather
              // than overflowing past the bar's own edge for the outermost
              // tabs. This exact ring is applied uniformly everywhere in this
              // task, which is what makes it read as a convention rather than
              // four different guesses.
              className="relative flex min-w-0 flex-col items-center justify-center gap-1 py-2 transition-[color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
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
        {/* Hairline divider — separates the Chat action from the three
            destinations. A background tint read fine at 390px but became a
            slab as the bar widens; a divider scales with the bar instead of
            growing into a colored region. */}
        <span
          aria-hidden="true"
          className="self-center justify-self-center"
          style={{ width: 1, height: "60%", background: "var(--color-bt-border)" }}
        />
        {/* The Chat action — an action, not a destination, so it never carries
            a tint or `aria-selected`. Open state reads through the glyph
            alone: filled icon + accent color on both icon and label (the
            unread dot, unchanged, still marks new activity at rest). */}
        <button
          type="button"
          role="button"
          aria-pressed={chatOpen}
          aria-label="Chat"
          data-testid="app-tab-chat"
          data-locked={chatLocked || undefined}
          onClick={() => (chatLocked ? onLockedTap("chat") : onToggleChat())}
          // Same treatment as the three destination tabs above, same
          // reasoning — see their comment. This cell isn't a `role="tab"` and
          // never carries `aria-selected`, but it's identically a chrome
          // button that showed no press before this.
          className="relative flex min-w-0 flex-col items-center justify-center gap-1 py-2 transition-[color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
          style={{
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
