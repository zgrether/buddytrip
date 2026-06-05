"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Info, Megaphone, Shield, X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";
import { APP_BUILD } from "@/lib/version";

// ── AboutModal ───────────────────────────────────────────────────────────
//
// Founder-voice "About BuddyTrip" dialog. Opens from the avatar dropdown
// (UserMenu) — not a standalone button. Carries the version, the origin
// story, a few links, and a mono build line. This is the one place the
// brand is allowed to be plainly sentimental.
//
// Source spec: HANDOFF — About BuddyTrip modal (in chat).
//
// Layout:
//   Desktop → centered dialog, max-width 460px, var(--radius-xl) corners,
//             var(--shadow-floating), 1px solid var(--color-bt-border).
//   Mobile  → bottom sheet, same content; 18px top corners, grab handle.
//
// Token-first: every color flows through a `var(--color-bt-*)` token so
// the dialog tracks the rest of the app's surface treatment automatically.

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the "Send feedback" row opens the shared FeedbackModal
   *  instead of the mailto: fallback. UserMenu wires this through from
   *  TopNav so the same modal serves both entry points. */
  onOpenFeedback?: () => void;
}

export function AboutModal({ open, onClose, onOpenFeedback }: AboutModalProps) {
  // AboutModal is always mounted (UserMenu renders it on every TopNav-
  // bearing page), so pass `open` as the `enabled` flag — otherwise the
  // hook pushes a phantom history entry on mount and silently eats the
  // first back-press on every page. Same bug class PR #288 fixed for
  // DatesSheet; re-introduced here when AboutModal landed.
  useModalBackButton(onClose, open);

  // ESC to close. Click-outside is handled by the scrim's onClick.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // SSR-safe portal target. The modal MUST render outside the TopNav
  // tree — TopNav sets backdrop-filter: blur(14px), which per spec
  // creates a containing block for any descendant position:fixed
  // element. Inline, our `fixed inset-0` was sized to the TopNav's
  // ~56px header instead of the viewport, so the centered dialog
  // ended up clipped above and below the title bar. document.body
  // has no such containing block — inset-0 is viewport-relative
  // again. Same fix we applied to TripSwitcher / UserMenu backdrops.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <ScrollLock>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About BuddyTrip"
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      {/* Chrome mirrors TripSettingsModal exactly: mobile bottom-sheet
          (top corners only, full width) → desktop centered dialog at
          lg+ with all four corners. max-h-[85vh] + overflow-y-auto
          keeps the modal inside the viewport on short screens — the
          earlier version had no scroll containment and would drift off
          the top edge when the content exceeded the viewport. */}
      <div
        className="animate-fade-in w-full max-w-[460px] max-h-[85vh] overflow-y-auto rounded-t-[18px] lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Mobile grab handle ─────────────────────────────────── */}
        <div
          aria-hidden="true"
          className="mx-auto lg:hidden"
          style={{
            width: 36,
            height: 4,
            borderRadius: 9999,
            background: "var(--color-bt-border)",
            marginTop: 10,
            marginBottom: 4,
          }}
        />

        <div>
          {/* ── Header row ─────────────────────────────────────────── */}
          <div
            className="flex items-center"
            style={{ padding: "18px 18px 6px", gap: 11 }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
            >
              <path
                d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
                fill="currentColor"
              />
            </svg>
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "var(--color-bt-text)",
              }}
            >
              BuddyTrip
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-bt-warning)",
                background: "var(--color-bt-warning-faint)",
                border: "1px solid var(--color-bt-warning-border)",
                borderRadius: 9999,
                padding: "2px 8px",
              }}
            >
              Beta
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                marginLeft: "auto",
                background: "var(--color-bt-card-raised)",
                border: "none",
                color: "var(--color-bt-text-dim)",
                cursor: "pointer",
              }}
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>

          {/* ── Origin story ───────────────────────────────────────── */}
          {/* Paragraphs 1 + 4 use the strong text color; 2 + 3 use the
              dim color. Final clause is accent + 600. */}
          <div
            style={{
              padding: "8px 18px 4px",
              fontSize: 14,
              lineHeight: 1.5,
              textWrap: "pretty",
            }}
          >
            <p style={{ color: "var(--color-bt-text)", margin: "0 0 10px" }}>
              It started in 2005. Nine friends, one golf trip, and a
              founding member who spent the whole thing in bed nursing a
              stomach bug that had apparently committed to the full
              itinerary.
            </p>
            <p
              style={{ color: "var(--color-bt-text-dim)", margin: "0 0 10px" }}
            >
              They named the tournament after him anyway. He&rsquo;s been
              showing up every year since &mdash; still competing, still
              occasionally winning, still hearing about it.
            </p>
            <p
              style={{ color: "var(--color-bt-text-dim)", margin: "0 0 10px" }}
            >
              For nearly two decades the whole thing ran on group texts, a
              battered spreadsheet, and a paper scorecard someone always
              left in the cart.
            </p>
            <p style={{ color: "var(--color-bt-text)", margin: 0 }}>
              BuddyTrip is the tool we wished we&rsquo;d had from year one.{" "}
              <span
                style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}
              >
                Built for our trip. Built for yours.
              </span>
            </p>
          </div>

          {/* ── Links ──────────────────────────────────────────────── */}
          <div
            style={{
              marginTop: 14,
              padding: "6px 12px",
              borderTop: "1px solid var(--color-bt-subtle-border)",
            }}
          >
            <AboutLink
              icon={<Megaphone size={15} />}
              label="Send feedback"
              sub={<>Straight to the founder &mdash; it&rsquo;s beta, holler</>}
              {...(onOpenFeedback
                ? { onClick: onOpenFeedback }
                : {
                    href: "mailto:hello@buddytrip.app?subject=BuddyTrip%20feedback",
                  })}
            />
            <AboutLink
              icon={<Shield size={15} />}
              label="Privacy"
              sub="Working on a policy — coming soon."
              disabled
            />
          </div>

          {/* ── Build line ─────────────────────────────────────────── */}
          <div
            className="flex items-center"
            style={{
              gap: 8,
              padding: "12px 18px 16px",
              borderTop: "1px solid var(--color-bt-subtle-border)",
            }}
          >
            <Info
              size={13}
              strokeWidth={1.75}
              style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
              aria-hidden="true"
            />
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "var(--color-bt-text-dim)",
              }}
            >
              build {APP_BUILD}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--color-bt-text-dim)",
              }}
            >
              Made for BuddyTrip
            </span>
          </div>
        </div>
      </div>
    </div>
    </ScrollLock>,
    document.body,
  );
}

// ── AboutLink ─────────────────────────────────────────────────────────────
//
// One row in the links section. Tile + label/sub + external-link affordance.
// Always opens in a new tab per spec.

function AboutLink({
  icon,
  label,
  sub,
  href,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  sub: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** When true: renders as a non-interactive div, fully dimmed, no
   *  external-link affordance. Use for rows that aren't ready yet. */
  disabled?: boolean;
}) {
  const sharedStyle: React.CSSProperties = {
    gap: 11,
    padding: 10,
    borderRadius: 10,
    textDecoration: "none",
    textAlign: "left",
    background: "transparent",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    color: "inherit",
    font: "inherit",
    opacity: disabled ? 0.45 : 1,
  };

  const inner = (
    <>
      <span
        aria-hidden="true"
        className="flex flex-shrink-0 items-center justify-center"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text-dim)",
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block"
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--color-bt-text)",
          }}
        >
          {label}
        </span>
        <span
          className="block"
          style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)" }}
        >
          {sub}
        </span>
      </span>
      {!onClick && !disabled && (
        <ExternalLink
          size={14}
          strokeWidth={1.75}
          style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
          aria-hidden="true"
        />
      )}
    </>
  );

  if (disabled) {
    return (
      <div className="flex w-full items-center" style={sharedStyle}>
        {inner}
      </div>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center transition-colors hover:bg-[var(--color-bt-hover)]"
        style={sharedStyle}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full items-center transition-colors hover:bg-[var(--color-bt-hover)]"
      style={sharedStyle}
    >
      {inner}
    </a>
  );
}
