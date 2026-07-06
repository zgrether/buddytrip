"use client";

import type { FC } from "react";
import { Suspense, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Pin, MessageCircle, Megaphone, ChevronDown, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { TripSwitcher } from "./TripSwitcher";
import { FeedbackModal } from "./FeedbackModal";
import { trpc } from "@/lib/trpc-client";
import { useChatUnreadCount } from "./FloatingChatPanel";
import { useNewsUnreadCount } from "./NewsPanel";

/**
 * App title bar — two zones:
 *   LEFT  = identity / scope  → flag-home anchor + trip-breadcrumb switcher
 *   RIGHT = global tools + me → Board, Chat, and the account avatar
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
  /** Opens the NewsPanel. Required alongside tripId to show the News tool. */
  onOpenNews?: () => void;
  /** Reflects whether the NewsPanel is currently open — paints the News tool
   *  in its active state. */
  newsOpen?: boolean;
  /** Called when a title-bar control opens a competing overlay (trip switcher,
   *  profile menu, feedback). The page uses it to close the News/Chat rail so
   *  those dropdowns aren't trapped behind the mobile sheet's scrim. */
  onDismissPanels?: () => void;
  /** Hide the trip-breadcrumb switcher (e.g. on the profile page, which
   *  isn't trip-scoped). */
  hideTripSwitcher?: boolean;
  /** Hide the News tool (e.g. on the profile page, where the global
   *  broadcast surface isn't relevant). */
  hideNews?: boolean;
  /** In competition context, the current user's TEAM color — passed to the
   *  account avatar so it reads in the user's team identity instead of teal.
   *  Undefined off competition pages (avatar stays teal). */
  avatarTeamColor?: string | null;
}

// Minimal shape we read off trips.list for the breadcrumb.
interface SwitcherTripRow {
  id: string;
  slug?: string;
  title: string;
  myRole?: string | null;
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  tripId,
  onOpenChat,
  chatOpen = false,
  onOpenNews,
  newsOpen = false,
  onDismissPanels,
  hideTripSwitcher = false,
  hideNews = false,
  avatarTeamColor,
}) => {
  const router = useRouter();
  const params = useParams<{ tripId?: string }>();
  const currentTripId = params?.tripId ?? null;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherHovered, setSwitcherHovered] = useState(false);
  // FeedbackModal lives at the TopNav level so the same modal is reachable
  // from the title-bar megaphone AND from the AboutModal "Send feedback"
  // row (which opens via UserMenu → AboutModal → onOpenFeedback). One
  // form, two entry points.
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Drives the breadcrumb label + Owner pill. TanStack dedupes against the
  // same query the page may already be running.
  const { data: tripsForSwitcher } = trpc.trips.list.useQuery(undefined, {
    enabled: !hideTripSwitcher,
  });

  // The breadcrumb switcher only makes sense when a specific trip is in
  // scope. On the dashboard / profile the LEFT zone is just the flag +
  // wordmark (global scope).
  const currentTrip =
    (tripsForSwitcher as SwitcherTripRow[] | undefined)?.find(
      // The URL param can be a slug or the raw id — match either.
      (t) => t.id === currentTripId || t.slug === currentTripId
    ) ?? null;
  const showSwitcher = !hideTripSwitcher && currentTrip != null;

  return (
    <header
      className="@container sticky top-0 z-40 flex h-14 items-center justify-between"
      style={{
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
        padding: "0 16px",
      }}
    >
      {/* ── LEFT: identity / scope ─────────────────────────────────────── */}
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

        {showSwitcher && currentTrip && (
          <div className="relative flex min-w-0 items-center">
            {/* Hairline divider — hidden on collapse along with the wordmark. */}
            <span
              aria-hidden="true"
              className="@max-[600px]:hidden"
              style={{
                width: 1,
                height: 22,
                background: "var(--color-bt-border)",
                margin: "0 10px",
                flexShrink: 0,
              }}
            />

            {/* Breadcrumb switcher — keeps a resting surface (it's a dropdown
                control, not a plain action). */}
            <button
              type="button"
              aria-label="Switch trip"
              aria-haspopup="dialog"
              aria-expanded={switcherOpen}
              data-testid="trip-switcher-trigger"
              data-trip-switcher-trigger="true"
              onClick={() =>
                setSwitcherOpen((p) => {
                  // Opening the switcher dismisses the rail so its dropdown
                  // isn't stuck behind the mobile sheet scrim.
                  if (!p) onDismissPanels?.();
                  return !p;
                })
              }
              onMouseEnter={() => setSwitcherHovered(true)}
              onMouseLeave={() => setSwitcherHovered(false)}
              className="flex min-w-0 items-center gap-1.5 transition-colors"
              style={{
                // Resting fill is transparent (the border is the affordance);
                // the hover wash is driven from state so the inline background
                // can't suppress it, matching the rest of the bar.
                background:
                  switcherOpen || switcherHovered ? "var(--color-bt-hover)" : "transparent",
                border: "1px solid var(--color-bt-border)",
                borderRadius: 9,
                padding: "5px 9px 5px 7px",
              }}
            >
              <span
                className="truncate max-w-[240px] @max-[600px]:max-w-[140px]"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-bt-text)",
                }}
              >
                {currentTrip.title}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2}
                style={{ flexShrink: 0, color: "var(--color-bt-text-dim)" }}
                aria-hidden="true"
              />
            </button>

            <TripSwitcher
              open={switcherOpen}
              onClose={() => setSwitcherOpen(false)}
            />
          </div>
        )}
      </div>

      {/* ── RIGHT: global tools + me ───────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {/* News — owner/organizer announcements. Trip-scoped, same as Chat:
            only renders when a trip is in scope and the page wires onOpenNews. */}
        {!hideNews && tripId && onOpenNews && (
          <NewsToolButton tripId={tripId} onClick={onOpenNews} active={newsOpen} />
        )}

        {tripId && onOpenChat && (
          <ChatToolButton
            tripId={tripId}
            onClick={onOpenChat}
            active={chatOpen}
          />
        )}

        {/* Quick Game ⚡ — context-free stroke-play, fire from anywhere.
            Global (no trip needed); local-storage backed (Slice A2). */}
        <ToolButton
          icon={Zap}
          label="Quick Game"
          count={0}
          badgeBg="var(--color-bt-accent)"
          onClick={() => {
            onDismissPanels?.();
            router.push("/quick-game");
          }}
          ariaLabel="Quick game"
          testId="quick-game-button"
        />

        {/* Feedback — beta-only outbound channel. Slight teal resting bg
            so it reads as a distinct CTA in the tool cluster without
            overwhelming the bar. White icon + text against the teal fill.
            No badge: feedback is outbound, an unread dot reads as the
            wrong signal. */}
        <ToolButton
          icon={Megaphone}
          label="Feedback"
          count={0}
          badgeBg="var(--color-bt-accent)"
          iconColor="white"
          restingBg="var(--color-bt-accent-faint)"
          restingBorder="1px solid var(--color-bt-accent-border)"
          labelColor="white"
          onClick={() => {
            onDismissPanels?.();
            setFeedbackOpen(true);
          }}
          ariaLabel="Send feedback"
          testId="feedback-button"
        />

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
  );
};

// ── NewsToolButton ──────────────────────────────────────────────────────────
// Thin wrapper so useNewsUnreadCount only mounts on trip pages (tripId present).
function NewsToolButton({
  tripId,
  onClick,
  active,
}: {
  tripId: string;
  onClick: () => void;
  active: boolean;
}) {
  const unread = useNewsUnreadCount(tripId);
  const utils = trpc.useUtils();
  return (
    <ToolButton
      icon={Pin}
      label="News"
      count={unread}
      badgeBg="var(--color-bt-accent)"
      active={active}
      onClick={onClick}
      // Warm the feed the moment the user shows intent (hover / focus / press)
      // so it's already in flight before the panel mounts — the open then
      // resolves from cache instead of starting a cold round-trip.
      onPrefetch={() => utils.news.list.prefetch({ tripId })}
      ariaLabel="News"
      testId="news-button"
    />
  );
}

// ── ChatToolButton ──────────────────────────────────────────────────────────
// Thin wrapper so useChatUnreadCount only mounts on trip pages (tripId present).
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
  count,
  badgeBg,
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
  count: number;
  badgeBg: string;
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
  const showBadge = count > 0;
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
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        style={iconColor ? { color: iconColor } : undefined}
      />
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
