"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconInfoCircle, IconSettings, IconLogout } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { AboutModal } from "@/components/AboutModal";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * Top-right user affordance — the avatar opens a dropdown menu:
 *
 *   ┌──────────────────────────┐
 *   │  Name                    │   ← account header
 *   │  email@example.com       │
 *   ├──────────────────────────┤
 *   │  ⚙  Account preferences  │   → /profile
 *   ├──────────────────────────┤
 *   │  ⎋  Log out              │   ← separate section
 *   └──────────────────────────┘
 *
 * Dismiss + positioning mirror the notifications bell / trip switcher
 * panels in TopNav (mousedown-outside + Escape; fixed below the nav on
 * mobile, absolute-anchored on desktop).
 */
interface UserMenuProps {
  /** Hands a callback through to AboutModal so the "Send feedback" row
   *  there opens the same FeedbackModal the title-bar megaphone uses. The
   *  modal itself lives in TopNav so both entry points share one mount. */
  onOpenFeedback?: () => void;
}

export function UserMenu({ onOpenFeedback }: UserMenuProps = {}) {
  const { data: me } = trpc.users.getMe.useQuery();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // About modal — opens from the highlighted "About BuddyTrip" row below
  // and renders on top of the standard scrim. Keeping the state up here
  // (vs. inside a sub-component) keeps the close-the-menu-then-open-the-
  // modal sequencing trivially correct.
  const [aboutOpen, setAboutOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // SSR-safe portal target — the mobile dim backdrop has to render
  // outside the TopNav (which sets backdrop-filter, creating a
  // containing block for position:fixed descendants), otherwise the
  // backdrop is sized to the header bounds and only dims the title
  // bar instead of the content below.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Canonical "are we in the browser" flag for the portal target.
    // Synchronizing with an external system (document) is exactly the
    // setState-in-effect use the React docs whitelist.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Warm the /profile route chunk the moment the menu opens. The user
  // has signalled intent (they tapped the avatar); by the time they
  // pick "Account preferences" the JS for /profile is already downloaded
  // so router.push lands the page instantly instead of waiting on the
  // route bundle.
  useEffect(() => {
    if (!open) return;
    router.prefetch("/profile");
  }, [open, router]);

  // Outside-click + Escape to close. Listeners are only attached while
  // open, so they're registered AFTER the click that opened the menu —
  // the opening tap's mousedown has already fired and won't self-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const name = me?.name ?? null;
  const email = me?.email ?? null;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu-btn"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar
          name={me?.name ?? me?.email ?? "?"}
          avatarIcon={me?.avatar_icon ?? null}
          sizePx={32}
          accent
        />
      </button>

      {open && (
        <>
          {/* Mobile dim backdrop — portaled to <body> so it escapes
              TopNav's containing block (the header sets backdrop-filter,
              which per spec creates a containing block for descendant
              position:fixed elements — a backdrop rendered inline would
              be sized to the header and only dim the title bar). */}
          {mounted && createPortal(
            <div
              className="fixed inset-0 z-30 sm:hidden"
              style={{ background: "var(--color-bt-overlay)" }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />,
            document.body,
          )}

          <ScrollLock>
          <div
            role="menu"
            aria-label="Account menu"
            data-testid="user-menu-dropdown"
            className="fixed right-4 top-14 z-50 w-[calc(100vw-32px)] max-w-[260px] overflow-hidden rounded-xl shadow-2xl sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:w-[240px] sm:rounded-[14px] sm:shadow-none"
            style={{
              background: "var(--color-bt-card)",
              border: "0.5px solid var(--color-bt-border)",
              boxShadow: "var(--shadow-floating)",
            }}
          >
            {/* Account header — name + email */}
            <div
              className="px-4 py-3"
              style={{ borderBottom: "0.5px solid var(--color-bt-border)" }}
            >
              <div
                className="truncate text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {name ?? "Your account"}
              </div>
              {email && (
                <div
                  className="truncate text-xs"
                  style={{ color: "var(--color-bt-text-dim)", marginTop: 1 }}
                >
                  {email}
                </div>
              )}
            </div>

            {/* Account preferences → loads the profile page */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push("/profile");
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text)" }}
            >
              <IconSettings
                size={16}
                stroke={1.75}
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                aria-hidden="true"
              />
              Account preferences
            </button>

            {/* About BuddyTrip — styled identically to Account
                preferences so it sits in the same visual rhythm. The
                highlighted teal-tinted treatment was tried first and
                dropped — too loud for what's a static info surface. */}
            <button
              type="button"
              role="menuitem"
              data-testid="user-menu-about"
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text)" }}
            >
              <IconInfoCircle
                size={16}
                stroke={1.75}
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                aria-hidden="true"
              />
              About BuddyTrip
            </button>

            {/* Log out — separate section */}
            <button
              type="button"
              role="menuitem"
              data-testid="user-menu-signout"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                color: "var(--color-bt-text)",
                borderTop: "0.5px solid var(--color-bt-border)",
              }}
            >
              <IconLogout
                size={16}
                stroke={1.75}
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                aria-hidden="true"
              />
              Log out
            </button>
          </div>
          </ScrollLock>
        </>
      )}

      {/* About modal — opens from the highlighted row above. Rendered as
          a sibling of the dropdown so the dropdown's outside-click /
          containing-block logic doesn't entangle with the modal scrim. */}
      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onOpenFeedback={
          onOpenFeedback
            ? () => {
                setAboutOpen(false);
                onOpenFeedback();
              }
            : undefined
        }
      />
    </div>
  );
}
