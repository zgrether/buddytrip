"use client";

import type { FC } from "react";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, type LucideIcon } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { FeedbackModal } from "./FeedbackModal";
import { useChatUnreadCount } from "./FloatingChatPanel";
import { InstallBanner } from "./pwa/InstallBanner";

/**
 * App title bar — TWO zones at every width:
 *   LEFT   = identity / scope   → flag-home anchor
 *   RIGHT  = global tools + me  → Chat, News, and the account avatar
 *
 * There was a MIDDLE zone (Trip · Cup) absolutely positioned at the content
 * area's left margin. It is now `ViewTabsPill`, floating at the bottom of the
 * content area — see the note at its old render site below for why. The bar
 * therefore means the same thing at every width and every depth, which is what
 * it was reduced to twice before (the DesktopTabStrip row, then the game
 * back/title) and kept growing back out of.
 *
 * The host is a container-query context (`@container`), so the responsive
 * collapse below 600px keys off the bar's OWN width — not the viewport —
 * which keeps it correct inside any future split/columned layout.
 *
 * Notifications were removed entirely; "News" occupies that slot — a
 * trip-scoped owner/organizer broadcast surface (the NewsPanel), not a
 * notification stream.
 */

interface TopNavProps {
  /** Wordmark next to the flag. Always "BuddyTrip" per the design; kept as a
   *  prop only so existing call sites compile unchanged. */
  title?: string;
  /** When present, renders the crew-chat tool with an unread badge driven
   *  by useChatUnreadCount(tripId). */
  tripId?: string;
  /** Opens the FloatingChatPanel. Required alongside tripId to show Chat. */
  onOpenChat?: () => void;
  /** Reflects whether the FloatingChatPanel is currently open — paints the
   *  Chat tool in its active state. */
  chatOpen?: boolean;
  /** Called when a title-bar control opens a competing overlay (the profile
   *  menu, feedback). The page uses it to close the News/Chat rail so those
   *  dropdowns aren't trapped behind the mobile sheet's scrim. */
  onDismissPanels?: () => void;
  /** The current user's TEAM color for the CURRENT TRIP — passed to the account
   *  avatar so it reads in the user's team identity instead of teal. Null when
   *  no trip is current, the trip has no competition, or they're on no team.
   *
   *  It follows the TRIP, not the tab: the colour shows on Home · Trip · Cup ·
   *  Chat alike, because this bar is shared across all four and the user's
   *  identity in a trip doesn't stop applying because they opened Chat. (The
   *  earlier version of this doc said "undefined off competition pages" — that
   *  described the retired design, when the competition face owned its own route
   *  and its own bar. Resolve via `useMyTeamColor`.) */
  avatarTeamColor?: string | null;
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  tripId,
  onOpenChat,
  chatOpen = false,
  onDismissPanels,
  avatarTeamColor,
}) => {
  const router = useRouter();
  // FeedbackModal lives at the TopNav level so it's reachable from the
  // AboutModal "Send feedback" row (via UserMenu → AboutModal →
  // onOpenFeedback).
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Game context (#550): when a game panel is open, a game view publishes its
  // chrome here and the bar SWAPS its left zone to a back affordance + single-
  // line game title (and adds the scorecard/settings actions on the right). Chat,
  // news, feedback, and the team avatar persist in BOTH modes — the whole point
  // is that chat stays reachable from inside a game. Back is history.back(): the
  // game views' own popstate listeners make it correct at every level.

  return (
    <>
    <header
      className="@container sticky top-0 z-40 flex h-14 items-center justify-between"
      // NO `position` here. An inline `position: relative` silently beat the
      // `sticky` class (inline styles win over classes) and unpinned the bar —
      // it scrolled away with the content. It was presumably added to give the
      // absolutely-positioned `lg+` Trip·Cup group below a containing block, but
      // `sticky` already establishes one, so it was never needed.
      style={{
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
        padding: "0 16px",
      }}
    >
      {/* ── The Trip · Cup group MOVED OUT of this bar ────────────────────
          It lived here, absolutely positioned at the content area's left
          margin, and collided with the wordmark whenever the rail collapsed —
          the content area starts at 62 + 24 = 86px there, which is inside
          "BuddyTrip". It is now a floating pill centred at the bottom of the
          content area (`ViewTabsPill`, rendered by `AppShell`), where it has
          no neighbour to collide with at any rail width and reads as the
          desktop counterpart of the mobile tab bar rather than as bar chrome.

          Consequences worth knowing: this bar means ONE thing at every width
          again (identity left, tools right), `--bt-rail-width` lost its only
          consumer and is gone, and so did the ResizeObserver that measured this
          zone purely to floor the tabs against it. */}
      {/* ── LEFT: identity / scope — OR game back + title (#550) ─────────── */}
      {/* Game back/title moved OUT of the bar and into GameActionRow (Phase 6),
          so the top bar means exactly one thing at every depth: brand + avatar. */}
      <div className="flex min-w-0 items-center">
        {/* Home anchor — flag + wordmark navigate to the dashboard. */}
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label="Go to dashboard"
          // Hover already existed (`hover:bg-[...]`) — keep it. Adding: a real
          // PRESS (`active:scale-[0.98]`, STYLE_GUIDE.md §5's documented value,
          // matching AppTabBar's mobile cells rather than picking a different
          // number for the desktop equivalent) and the same uniform
          // `focus-visible` ring this task applies everywhere. `transition-colors`
          // becomes `transition-[background-color,transform]` — see AppTabBar's
          // comment for why two separate `transition-*` classes can't safely
          // combine (they each set the FULL `transition-property` value).
          className="flex items-center gap-[7px] rounded-[9px] px-2 py-1.5 transition-[background-color,transform] hover:bg-[var(--color-bt-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            style={{ flexShrink: 0, color: "var(--color-bt-accent)" }}
          >
            <path
              d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
              fill="currentColor"
            />
          </svg>
          {/* Wordmark shows at every width now — no `@max-[600px]:hidden`. That
              collapse (#279) existed to free room for the TripSwitcher dropdown
              and labeled tool buttons that used to sit beside it below 600px.
              TripSwitcher is gone (#816); the tools that remain in this bar are
              icon-only and `lg+`-gated (ChatToolButton), so nothing left of
              lg competes with the wordmark for space. Below that, the bar was
              just the flag glyph and the avatar with the whole middle empty —
              this is desktop's exact treatment, not a new mobile variant. */}
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "var(--color-bt-text)",
            }}
          >
            {title}
          </span>
        </button>

      </div>

      {/* ── RIGHT: global tools + me ───────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {/* Game-context actions (#550) — scorecard + owner/delegate settings gear,
            ahead of the persistent chat/news/feedback/avatar cluster. */}
        {/* Desktop-only (Phase 6): below `lg`, chat opens from the tab bar's
            Chat action instead — this stays hidden there so there's exactly
            one entry point per viewport, not two competing ones. */}
        {tripId && onOpenChat && (
          <div className="hidden lg:block">
            <ChatToolButton
              tripId={tripId}
              onClick={onOpenChat}
              active={chatOpen}
            />
          </div>
        )}

        {/* Quick Game moved OUT of the app header (trip/competition-scoped chrome)
            to the user's dashboard, where a scratch game belongs — it's a
            user-level action, not trip context. See the dashboard strip. */}

        {/* No divider before the avatar. There used to be a "tools | identity"
            rule here, earned when the left side of it held a cluster —
            chat, news, feedback, Quick Game. Those left one at a time (Quick
            Game to the dashboard, news and feedback elsewhere) until the only
            survivor was ChatToolButton, which is itself `hidden lg:block` and
            trip-scoped. So the rule separated identity from nothing at all on
            the dashboard and on every viewport below `lg` — a divider with one
            side empty reads as a stray mark, not a grouping. */}
        <UserMenu
          onOpen={onDismissPanels}
          onOpenFeedback={() => setFeedbackOpen(true)}
          teamColor={avatarTeamColor}
        />
      </div>

      {/* FeedbackModal calls useSearchParams() to capture the active tab
          (?tab=crew etc). Next.js requires any useSearchParams() caller to
          be wrapped in Suspense during static prerendering — without this,
          the build fails on any statically-generated page that renders this
          bar. fallback={null} keeps the UX unchanged. (The page that first
          forced this was /profile/archived-ideas, now retired into the
          preferences overlay; the requirement is structural, not that page's.) */}
      <Suspense fallback={null}>
        <FeedbackModal
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
        />
      </Suspense>
    </header>
    {/* Transient system message (STYLE_GUIDE) — a SIBLING of the sticky bar,
        in normal flow, so it sits directly below the bar, scrolls away with
        the page, and never covers content or fights the bottom nav. */}
    <InstallBanner />
    </>
  );
};

// ── ChatToolButton ──────────────────────────────────────────────────────────
// Thin wrapper so useChatUnreadCount only mounts on trip pages (tripId present).
//
// EAGER AT BOTH WIDTHS, and deliberately left ungated in the #763 sweep. The
// button is `hidden lg:block` at its call site, so at mobile widths it mounts
// while invisible — normally the exact "CSS hides it but can't stop it
// fetching" pattern that sweep was gating. It is kept because it costs nothing:
// `useChatUnreadCount` reads `messages.unreadCount`, the SAME query key
// `useChatTabUnread` (AppTabBar, visible at mobile) already fetches, so React
// Query serves both observers from ONE request at every width. Gating it would
// remove no network call and would leave this button's dot stale on the width
// where it IS visible.
function ChatToolButton({
  tripId,
  onClick,
  active,
}: {
  tripId: string;
  onClick: () => void;
  active: boolean;
}) {
  const unread = useChatUnreadCount(tripId);
  return (
    <ToolButton
      icon={MessageCircle}
      label="Chat"
      count={unread}
      dot
      badgeBg="var(--color-bt-owner)"
      active={active}
      onClick={onClick}
      ariaLabel="Open crew chat"
      testId="chat-button"
    />
  );
}

// ── ToolButton ────────────────────────────────────────────────────────────────
// Backgroundless labeled tool — hover wash only, no resting fill or border so
// the bar reads light. Below 600px (container width) it collapses to an icon-
// only square with the count as a ringed corner badge. The badge is the only
// color in the right cluster.
function ToolButton({
  icon: Icon,
  label,
  count = 0,
  badgeBg,
  dot = false,
  active = false,
  onClick,
  ariaLabel,
  testId,
  iconColor,
  restingBg,
  restingBorder,
  labelColor,
  onPrefetch,
}: {
  icon: LucideIcon;
  label: string;
  /** Numeric unread count. Ignored when `dot` is set — see `dot` below. */
  count?: number;
  badgeBg?: string;
  /** Unread as a plain dot on the icon instead of a numeric badge — same
   *  presentation both viewport widths (a dot doesn't need to collapse the
   *  way a number does). Chat uses this (no count badge, per its redesign);
   *  News keeps the numeric badge. */
  dot?: boolean;
  active?: boolean;
  onClick?: () => void;
  ariaLabel: string;
  testId: string;
  /** Fired on hover / focus / press to warm the panel's data before open. */
  onPrefetch?: () => void;
  /** Override the icon stroke color. Defaults to the inherited text color. */
  iconColor?: string;
  /** Resting background. Defaults to none; use for buttons that need a
   *  subtle filled surface (e.g. the Feedback CTA). */
  restingBg?: string;
  /** Border applied in the resting state alongside restingBg. */
  restingBorder?: string;
  /** Override the label text color. Defaults to var(--color-bt-text). */
  labelColor?: string;
}) {
  const showDot = dot && count > 0;
  const showBadge = !dot && count > 0;
  const badgeLabel = count > 99 ? "99+" : String(count);
  // Hover is driven from state, not a Tailwind hover: class — an inline
  // `background` (resting fill / "none") would otherwise win over the class
  // and the hover wash would never show (the bug this fixes). A filled button
  // (Feedback) gets a stronger tint of its own accent; the rest get the
  // neutral wash, matching the home button + avatar.
  const [hovered, setHovered] = useState(false);
  const hoverFill = restingBg
    ? "color-mix(in srgb, var(--color-bt-accent) 18%, transparent)"
    : "var(--color-bt-hover)";
  const background = active
    ? "var(--color-bt-hover)"
    : hovered
      ? hoverFill
      : (restingBg ?? "transparent");
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        setHovered(true);
        onPrefetch?.();
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => onPrefetch?.()}
      onPointerDown={() => onPrefetch?.()}
      aria-label={ariaLabel}
      data-testid={testId}
      // The hover wash above is DELIBERATELY JS-state-driven (see the comment
      // on `hovered`/`background` above) rather than a Tailwind `hover:`
      // class, because the resting `background` is itself inline — so a
      // class-based hover here would lose to it, same trap as the desktop
      // tab strip. Left untouched; it already works and is load-bearing.
      //
      // `active:scale-[0.98]` is added as a plain class and is SAFE alongside
      // that: `transform` is a different CSS property than `background`, so
      // there is nothing inline for it to lose to. This is what gives touch
      // users real press feedback even though the JS hover state above never
      // fires on touch (mouseenter/mouseleave don't fire on tap) — and this
      // button is `hidden lg:block` at its call site anyway, so touch is
      // reachable only via a trackpad-as-mouse or similar, but the press
      // treatment costs nothing and stays consistent with every other
      // element in this task.
      //
      // `transition-colors` → `transition-[background-color,transform]`:
      // the JS-driven background swap was already being smoothed by
      // `transition-colors` (a CSS transition applies to inline style changes
      // too, not only class toggles), so replacing it with a single-property
      // `transition-transform` would have silently DROPPED that existing
      // smoothing rather than added to it.
      //
      // The focus-visible ring is a box-shadow, an entirely different CSS
      // property from `background` — so unlike a hover CLASS, it has nothing
      // to lose to the inline background logic and is added the same as
      // everywhere else in this task, uniformly.
      className="relative inline-flex h-9 items-center gap-[7px] rounded-[9px] px-2.5 transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)] @max-[600px]:w-9 @max-[600px]:justify-center @max-[600px]:gap-0 @max-[600px]:px-0"
      style={{
        background,
        border: restingBorder ?? "none",
        color: "var(--color-bt-text)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <span className="relative inline-flex">
        <Icon
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          style={iconColor ? { color: iconColor } : undefined}
        />
        {showDot && (
          <span
            aria-hidden="true"
            data-testid={`${testId}-dot`}
            className="absolute rounded-full"
            style={{
              top: -2,
              right: -2,
              width: 7,
              height: 7,
              background: badgeBg ?? "var(--color-bt-owner)",
              border: "1.5px solid var(--color-bt-nav-bg)",
            }}
          />
        )}
      </span>
      <span
        className="@max-[600px]:hidden"
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </span>

      {showBadge && (
        <>
          {/* Inline badge — expanded layout. */}
          <span
            data-testid={`${testId}-badge`}
            className="@max-[600px]:hidden"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              borderRadius: 9999,
              padding: "0 5px",
              lineHeight: "15px",
              minWidth: 15,
              textAlign: "center",
              background: badgeBg,
              color: "#0d1f1a",
            }}
          >
            {badgeLabel}
          </span>

          {/* Corner badge — collapsed (icon-only) layout. A ring in the bar
              color separates it from the icon. */}
          <span
            aria-hidden="true"
            className="absolute hidden items-center justify-center @max-[600px]:flex"
            style={{
              top: -3,
              right: -3,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              borderRadius: 9999,
              padding: "0 4px",
              lineHeight: "14px",
              minWidth: 14,
              textAlign: "center",
              background: badgeBg,
              color: "#0d1f1a",
              border: "1.5px solid var(--color-bt-nav-bg)",
            }}
          >
            {badgeLabel}
          </span>
        </>
      )}
    </button>
  );
}
