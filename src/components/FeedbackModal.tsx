"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useParams } from "next/navigation";
import {
  Bug,
  HelpCircle,
  Heart,
  Lightbulb,
  Megaphone,
  X,
  type LucideIcon,
} from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";
import { trpc } from "@/lib/trpc-client";
import { APP_BUILD } from "@/lib/version";

// ── FeedbackModal ─────────────────────────────────────────────────────────
//
// Beta feedback channel — opened from the title-bar megaphone tool button
// AND from the AboutModal "Send feedback" row. The two entry points share
// this component; do not build a second one.
//
// Layout: bottom sheet on mobile, centered dialog on desktop. Mirrors
// AboutModal / TripSettingsModal chrome (var(--color-bt-card) bg,
// var(--radius-xl) on desktop, top-only corners + grab handle on mobile).
//
// Containing-block gotcha: TopNav sets backdrop-filter, which per CSS
// spec creates a containing block for any descendant position:fixed
// element. This modal MUST render via createPortal(..., document.body)
// to escape that — same fix as AboutModal / UserMenu backdrop.

type Category = "bug" | "idea" | "confusing" | "love";

interface CategoryDef {
  key: Category;
  label: string;
  icon: LucideIcon;
  /** Domain token name — used as `var(--color-bt-<token>)`. */
  token: "danger" | "planning" | "warning" | "accent";
  placeholder: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "bug",
    label: "Bug",
    icon: Bug,
    token: "danger",
    placeholder:
      "What broke? What were you trying to do when it happened?",
  },
  {
    key: "idea",
    label: "Idea",
    icon: Lightbulb,
    token: "planning",
    placeholder: "What would make BuddyTrip better? Don't hold back.",
  },
  {
    key: "confusing",
    label: "Confusing",
    icon: HelpCircle,
    token: "warning",
    placeholder:
      "What threw you? Where'd you expect it to go instead?",
  },
  {
    key: "love",
    label: "Love it",
    icon: Heart,
    token: "accent",
    placeholder:
      "What's working? Always good to know what not to touch.",
  },
];

function colorToken(c: CategoryDef): string {
  return `var(--color-bt-${c.token})`;
}
function colorFaintToken(c: CategoryDef): string {
  return `var(--color-bt-${c.token}-faint)`;
}
function colorBorderToken(c: CategoryDef): string {
  return `var(--color-bt-${c.token}-border)`;
}

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  // FeedbackModal is always mounted (TopNav renders it on every page), so
  // pass `open` as the `enabled` flag — otherwise the hook pushes a
  // phantom history entry on mount and silently eats any popstate that
  // fires while the modal is closed. That bites HARD when AboutModal
  // closes and pops its own phantom entry as part of routing through to
  // us (UserMenu → About → onOpenFeedback): the popstate is caught here
  // and immediately closes the feedback modal one tick after opening it.
  // Same pattern as AboutModal.
  useModalBackButton(onClose, open);

  // ── Auto-captured context ──────────────────────────────────────────────
  // Read at render-time off Next's route hooks so the values reflect
  // the page the user was on when they opened the modal.
  const pathname = usePathname();
  const params = useParams<{ tripId?: string }>();
  const currentTripId = params?.tripId ?? null;

  const { data: trips } = trpc.trips.list.useQuery(undefined, {
    enabled: open,
  });
  const { data: me } = trpc.users.getMe.useQuery(undefined, { enabled: open });

  const screenLabel = useMemo(() => labelForPath(pathname ?? ""), [pathname]);
  const tripLabel = useMemo(() => {
    if (!currentTripId || !trips) return null;
    const t = (trips as Array<{ id: string; title: string }>).find(
      (x) => x.id === currentTripId,
    );
    return t?.title ?? null;
  }, [currentTripId, trips]);
  const platform = "web";

  // ── Form state ─────────────────────────────────────────────────────────
  const [category, setCategory] = useState<Category>("bug");
  const [text, setText] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // Reset transient form state on each open transition.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory("bug");
    setText("");
    setToast(null);
  }, [open]);

  // ESC to close. Click-outside is handled by the scrim's onClick.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // SSR-safe portal target. See AboutModal for the containing-block note.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const send = trpc.feedback.send.useMutation({
    onSuccess: () => {
      setToast("Thanks — the developer appreciates it!");
      // Brief delay so the toast is perceptible before the modal closes.
      window.setTimeout(() => onClose(), 900);
    },
    onError: () => {
      setToast("Couldn't send. Try again in a moment.");
    },
  });

  const activeCategory =
    CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];
  const canSend = text.trim().length > 0 && !send.isPending;

  if (!open || !mounted) return null;

  // Pull the user's email from session so the tRPC procedure can include it
  // in the report as a reply-to address — silently, without showing the field.
  const replyTo = me?.email ?? null;

  const handleSubmit = () => {
    if (!canSend) return;
    send.mutate({
      category,
      message: text.trim(),
      replyTo,
      screen: screenLabel,
      tripLabel,
      platform,
      build: APP_BUILD,
    });
  };

  return createPortal(
    <ScrollLock>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-t-[18px] lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Mobile grab handle (hidden on desktop) ────────────────────── */}
        <div
          aria-hidden="true"
          className="mx-auto lg:hidden"
          style={{
            width: 36,
            height: 4,
            borderRadius: 9999,
            background: "var(--color-bt-border)",
            marginTop: 8,
            marginBottom: 2,
          }}
        />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div
          className="flex items-center"
          style={{ padding: "16px 18px 8px", gap: 10 }}
        >
          <Megaphone
            size={20}
            strokeWidth={2}
            style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: "var(--color-bt-text)",
            }}
          >
            Send feedback
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

        {/* ── Category chips ───────────────────────────────────────────── */}
        <div
          style={{
            padding: "6px 18px 4px",
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          {CATEGORIES.map((c) => {
            const selected = c.key === category;
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                aria-pressed={selected}
                data-testid={`feedback-category-${c.key}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  padding: "10px 4px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: selected
                    ? colorFaintToken(c)
                    : "var(--color-bt-card-raised)",
                  border: `1px solid ${selected ? colorBorderToken(c) : "var(--color-bt-border)"}`,
                  color: selected ? colorToken(c) : "var(--color-bt-text-dim)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  transition: "background-color 120ms, border-color 120ms, color 120ms",
                }}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Free text ────────────────────────────────────────────────── */}
        <div style={{ padding: "10px 18px 4px" }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={activeCategory.placeholder}
            rows={4}
            data-testid="feedback-message"
            style={{
              width: "100%",
              minHeight: 96,
              resize: "vertical",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--color-bt-border)",
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              fontSize: 14,
              lineHeight: 1.45,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div
          className="flex items-center"
          style={{
            padding: "14px 18px 16px",
            gap: 10,
            marginTop: 10,
            borderTop: "1px solid var(--color-bt-subtle-border)",
          }}
        >
          <span
            className="hidden sm:inline"
            style={{
              fontSize: 11.5,
              color: "var(--color-bt-text-dim)",
            }}
          >
            The developer appreciates any and all feedback.
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
                padding: "8px 14px",
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSend}
              data-testid="feedback-send"
              style={{
                background: "var(--color-bt-accent)",
                border: "1px solid var(--color-bt-accent)",
                color: "#0d1f1a",
                padding: "8px 14px",
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                cursor: canSend ? "pointer" : "not-allowed",
                opacity: canSend ? 1 : 0.4,
              }}
            >
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>

        {toast && (
          <div
            role="status"
            style={{
              padding: "0 18px 14px",
              fontSize: 12,
              color: "var(--color-bt-text-dim)",
              textAlign: "right",
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
    </ScrollLock>,
    document.body,
  );
}

// ── labelForPath ─────────────────────────────────────────────────────────
//
// Friendly screen label from the pathname. Cheap and intentionally
// shallow — the goal is to give the founder enough context to triage,
// not to reproduce every nested route.
function labelForPath(path: string): string {
  if (!path || path === "/") return "Landing";
  if (path.startsWith("/dashboard")) return "Dashboard";
  if (path.startsWith("/profile")) return "Profile";
  if (path.startsWith("/changelog")) return "Changelog";
  if (path.startsWith("/privacy")) return "Privacy";
  if (path.startsWith("/login")) return "Login";
  if (path.startsWith("/invite")) return "Invite";
  if (path.startsWith("/trips/")) {
    const parts = path.split("/").filter(Boolean);
    // /trips/[tripId]/[tab?]
    const tab = parts[2];
    return tab
      ? `Trip · ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
      : "Trip";
  }
  return path;
}
