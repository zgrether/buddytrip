"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Info, Megaphone, Shield, Tag, X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { APP_BUILD, APP_LAST_SHIPPED } from "@/lib/version";

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
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  useModalBackButton(open ? onClose : () => {});

  // ESC to close. Click-outside is handled by the scrim's onClick.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // "Last shipped N days ago" — computed once on mount via lazy
  // useState init so we don't call Date.now() during render (would
  // trip react-hooks/no-impure-in-render). The exact phrasing changing
  // mid-session would be jarring anyway; lock it to mount time.
  const [lastShippedLabel] = useState(() => {
    const shipped = Date.parse(APP_LAST_SHIPPED);
    if (Number.isNaN(shipped)) return "Recently";
    const days = Math.max(0, Math.round((Date.now() - shipped) / 86400000));
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    return `${days} days ago`;
  });

  if (!open) return null;

  return (
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
        className="animate-fade-in w-full max-w-[460px] max-h-[85vh] overflow-y-auto rounded-t-2xl lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--color-bt-text-dim)",
                cursor: "pointer",
                padding: 4,
                lineHeight: 0,
              }}
            >
              <X size={17} strokeWidth={1.75} />
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
              icon={<Tag size={15} />}
              label={<>What&rsquo;s new</>}
              sub={`Changelog · last shipped ${lastShippedLabel}`}
              href="/changelog"
            />
            <AboutLink
              icon={<Megaphone size={15} />}
              label="Send feedback"
              sub={<>Straight to the founder &mdash; it&rsquo;s beta, holler</>}
              // The handoff says this should open the SAME feedback modal
              // as the title-bar Feedback button. That modal doesn't exist
              // yet (no shared FeedbackModal lives in src/components as of
              // this writing). Falling back to a mailto: keeps the action
              // functional; swap to the modal trigger when it lands.
              href="mailto:hello@buddytrip.app?subject=BuddyTrip%20feedback"
            />
            <AboutLink
              icon={<Shield size={15} />}
              label="Privacy"
              sub={<>What we keep, what we don&rsquo;t</>}
              href="/privacy"
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
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  sub: React.ReactNode;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{
        gap: 11,
        padding: 10,
        borderRadius: 10,
        textDecoration: "none",
      }}
    >
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
      <ExternalLink
        size={14}
        strokeWidth={1.75}
        style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
        aria-hidden="true"
      />
    </a>
  );
}
