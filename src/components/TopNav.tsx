"use client";

import type { FC } from "react";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Megaphone, MessageCircle, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { TripSwitcher } from "./TripSwitcher";
import { trpc } from "@/lib/trpc-client";
import { useChatUnreadCount } from "./FloatingChatPanel";

/**
 * App title bar — two zones:
 *   LEFT  = identity / scope  → flag-home anchor + trip-breadcrumb switcher
 *   RIGHT = global tools + me → Board, Chat, and the account avatar
 *
 * The host is a container-query context (`@container`), so the responsive
 * collapse below 600px keys off the bar's OWN width — not the viewport —
 * which keeps it correct inside any future split/columned layout.
 *
 * Notifications were removed entirely; "Board" occupies that slot
 * conceptually but is a persistent broadcast surface, not a notification
 * stream.
 */

// Board has no backing feature yet (no board/broadcast surface exists). The
// button is rendered to spec but inert, and its unread badge is driven by this
// placeholder count — 0 keeps the badge hidden until the feature ships. Flip
// this to a real selector once Board exists.
const BOARD_PLACEHOLDER_COUNT = 0;

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
  /** Hide the trip-breadcrumb switcher (e.g. on the profile page, which
   *  isn't trip-scoped). */
  hideTripSwitcher?: boolean;
}

// Minimal shape we read off trips.list for the breadcrumb.
interface SwitcherTripRow {
  id: string;
  title: string;
  myRole?: string | null;
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  tripId,
  onOpenChat,
  chatOpen = false,
  hideTripSwitcher = false,
}) => {
  const router = useRouter();
  const params = useParams<{ tripId?: string }>();
  const currentTripId = params?.tripId ?? null;
  const [switcherOpen, setSwitcherOpen] = useState(false);

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
      (t) => t.id === currentTripId
    ) ?? null;
  const showSwitcher = !hideTripSwitcher && currentTrip != null;
  const isOwner = currentTrip?.myRole === "Owner";

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
          onClick={() => router.push("/")}
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
              onClick={() => setSwitcherOpen((p) => !p)}
              className="flex min-w-0 items-center gap-1.5 transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                borderRadius: 9,
                padding: "5px 9px 5px 7px",
              }}
            >
              {isOwner && (
                <span
                  className="flex-shrink-0"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    lineHeight: 1,
                    color: "var(--color-bt-owner)",
                    border: "1px solid var(--color-bt-owner)",
                    borderRadius: 4,
                    padding: "2px 4px",
                  }}
                >
                  Owner
                </span>
              )}
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
        {/* Board — inert placeholder; persistent broadcast surface (TBD). */}
        <ToolButton
          icon={Megaphone}
          label="Board"
          count={BOARD_PLACEHOLDER_COUNT}
          badgeBg="var(--color-bt-accent)"
          ariaLabel="Board"
          testId="board-button"
        />

        {tripId && onOpenChat && (
          <ChatToolButton
            tripId={tripId}
            onClick={onOpenChat}
            active={chatOpen}
          />
        )}

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

        <UserMenu />
      </div>
    </header>
  );
};

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
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  badgeBg: string;
  active?: boolean;
  onClick?: () => void;
  ariaLabel: string;
  testId: string;
}) {
  const showBadge = count > 0;
  const badgeLabel = count > 99 ? "99+" : String(count);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className="relative inline-flex h-9 items-center gap-[7px] rounded-[9px] px-2.5 transition-colors hover:bg-[var(--color-bt-hover)] @max-[600px]:w-9 @max-[600px]:justify-center @max-[600px]:gap-0 @max-[600px]:px-0"
      style={{
        background: active ? "var(--color-bt-hover)" : "none",
        border: "none",
        color: "var(--color-bt-text)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      <span className="@max-[600px]:hidden">{label}</span>

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
