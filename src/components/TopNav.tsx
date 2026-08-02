"use client";

import type { FC } from "react";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Calendar, Trophy, type LucideIcon } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { FeedbackModal } from "./FeedbackModal";
import { useChatUnreadCount } from "./FloatingChatPanel";
import { InstallBanner } from "./pwa/InstallBanner";
import { RAIL_WIDTH_PX } from "./shell/breakpoints";
import type { AppView } from "./shell/useAppView";

/**
 * App title bar — three zones at `lg+` (two below it):
 *   LEFT   = identity / scope     → flag-home anchor
 *   MIDDLE = Trip · Cup           → `lg+` ONLY, x-aligned to the rail's right
 *            edge (`RAIL_WIDTH_PX`) so the column alignment between the rail
 *            and the content below holds. Absolutely positioned rather than a
 *            third flex zone, so its width never competes with the left/right
 *            zones for space — it just sits at a fixed x, like the rail it
 *            lines up under.
 *   RIGHT  = global tools + me    → Chat, News, and the account avatar
 *
 * Trip/Cup moved here from the separate `DesktopTabStrip` row (Task 4, shell
 * polish batch) — that row pushed all content down by its own height while
 * everything else chrome-shaped (mark, chat, profile) lived in this bar. Home
 * isn't here: at `lg+` it's the persistent rail, not a tab.
 *
 * The host is a container-query context (`@container`), so the responsive
 * collapse below 600px keys off the bar's OWN width — not the viewport —
 * which keeps it correct inside any future split/columned layout.
 *
 * Notifications were removed entirely; "News" occupies that slot — a
 * trip-scoped owner/organizer broadcast surface (the NewsPanel), not a
 * notification stream.
 */

const TOP_NAV_VIEW_TABS: { id: Exclude<AppView, "home">; label: string; Icon: LucideIcon }[] = [
  { id: "trip", label: "Trip", Icon: Calendar },
  { id: "cup", label: "Cup", Icon: Trophy },
];

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
  /** Hide the trip-breadcrumb switcher (e.g. on the profile page, which
   *  isn't trip-scoped). */
  hideTripSwitcher?: boolean;
  /** In competition context, the current user's TEAM color — passed to the
   *  account avatar so it reads in the user's team identity instead of teal.
   *  Undefined off competition pages (avatar stays teal). */
  avatarTeamColor?: string | null;
  /** Trip · Cup (Task 4) — `lg+` only, x-aligned to the rail's right edge.
   *  Present only when the host has AppShell's tab state to hand it (the
   *  trip page's `topBar` render prop); absent elsewhere (dashboard,
   *  profile), where TopNav renders exactly as it did before this. */
  activeView?: AppView;
  /** False when no trip is selected — Trip/Cup are ABSENT then (Task 5), not
   *  dimmed; see the render-site comment. */
  hasContext?: boolean;
  onSelectView?: (view: AppView) => void;
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  tripId,
  onOpenChat,
  chatOpen = false,
  onDismissPanels,
  hideTripSwitcher = false,
  avatarTeamColor,
  activeView,
  hasContext = false,
  onSelectView,
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
      style={{
        position: "relative",
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
        padding: "0 16px",
      }}
    >
      {/* ── MIDDLE: Trip · Cup — `lg+` only, x-aligned to the rail's right edge ──
          Absolutely positioned at `left: RAIL_WIDTH_PX` (not a third flex zone)
          so it sits at a fixed x regardless of how wide the left/right zones
          are — the same column alignment the rail itself provides below this
          bar.
          ABSENT (not dimmed/disabled) with no trip context (Task 5) — the rail
          IS the picker at `lg+`, and `ContextIntro` already carries the "pick a
          trip" copy in the body; a third, redundant, dimmed voice would just
          draw attention away from the one thing on screen that should have
          weight. This deliberately differs from `AppTabBar`'s mobile locked-tab
          treatment (dimmed + tappable-to-explain) — that's correct there
          because the bar is the ONLY navigation on mobile, so tapping a locked
          tab is the sole discovery path for what it does; neither reason
          applies here. */}
      {onSelectView && hasContext && (
        <div
          className="absolute inset-y-0 hidden items-center lg:flex"
          style={{ left: RAIL_WIDTH_PX }}
          role="tablist"
        >
          {TOP_NAV_VIEW_TABS.map(({ id, label, Icon }) => {
            const selected = activeView === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`desktop-tab-${id}`}
                onClick={() => onSelectView(id)}
                className="flex h-full items-center gap-1.5 px-4 text-[13.5px] font-semibold transition-colors"
                style={{
                  background: "transparent",
                  border: 0,
                  borderBottom: `2px solid ${selected ? "var(--color-bt-accent)" : "transparent"}`,
                  color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── LEFT: identity / scope — OR game back + title (#550) ─────────── */}
      {/* Game back/title moved OUT of the bar and into GameActionRow (Phase 6),
          so the top bar means exactly one thing at every depth: brand + avatar. */}
      <div className="flex min-w-0 items-center">
        {/* Home anchor — flag + wordmark navigate to the dashboard. */}
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label="Go to dashboard"
          className="flex items-center gap-[7px] rounded-[9px] px-2 py-1.5 transition-colors hover:bg-[var(--color-bt-hover)]"
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
          <span
            className="@max-[600px]:hidden"
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

        {/* Divider between tools and identity. */}
        <span
          aria-hidden="true"
          className="mx-1.5"
          style={{
            width: 1,
            height: 24,
            background: "var(--color-bt-border)",
            flexShrink: 0,
          }}
        />

        <UserMenu
          onOpen={onDismissPanels}
          onOpenFeedback={() => setFeedbackOpen(true)}
          teamColor={avatarTeamColor}
        />
      </div>

      {/* FeedbackModal calls useSearchParams() to capture the active tab
          (?tab=crew etc). Next.js requires any useSearchParams() caller to
          be wrapped in Suspense during static prerendering — without this,
          build fails on pages like /profile/archived-ideas that are
          statically generated. fallback={null} keeps the UX unchanged. */}
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
      className="relative inline-flex h-9 items-center gap-[7px] rounded-[9px] px-2.5 transition-colors @max-[600px]:w-9 @max-[600px]:justify-center @max-[600px]:gap-0 @max-[600px]:px-0"
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
