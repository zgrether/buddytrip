"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { IconInfoCircle, IconSettings, IconLogout } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { AboutModal } from "@/components/AboutModal";
import { ScrollLock } from "@/hooks/useScrollLock";

/** Lazy — the panel pulls the avatar icon picker (96 Tabler icons) and the
 *  archive's own query. Keeping it out of the shell bundle is why the route
 *  code-split it; the split survives the move. Warmed on menu-open below. */
const PreferencesPanel = dynamic(
  () => import("@/components/profile/PreferencesPanel").then((m) => ({ default: m.PreferencesPanel })),
  { ssr: false },
);

/**
 * Top-right user affordance — the avatar opens a dropdown menu:
 *
 *   ┌──────────────────────────┐
 *   │  Name                    │   ← account header
 *   │  email@example.com       │
 *   ├──────────────────────────┤
 *   │  ⚙  Settings             │   → PreferencesPanel (overlay)
 *   │  ⓘ  About BuddyTrip      │   → AboutModal
 *   ├──────────────────────────┤
 *   │  ⎋  Log out              │   ← separate section
 *   └──────────────────────────┘
 *
 * DROPDOWN FOR QUICK ACTIONS, PANEL FOR ANYTHING WITH STRUCTURE. Log out is one
 * tap and lives here and ONLY here — it used to be here AND on the preferences
 * route AND in that route's desktop sidebar. Delete account is the inverse: it
 * lives only in the panel's danger zone, because it should not be one tap from
 * an avatar.
 *
 * Dismiss + positioning: mousedown-outside + Escape, fixed below the nav on
 * mobile, absolute-anchored on desktop. Implemented in this file (see the
 * effect below) — it is a pattern several dropdown/popover components each
 * carry their own copy of, not something inherited from a shared primitive.
 *
 * This used to say the behaviour "mirrors the notifications bell / trip
 * switcher panels in TopNav". Both of those are gone from TopNav, so the
 * comment pointed a reader at a reference implementation that no longer
 * exists. Naming a specific sibling to copy is what rotted; describing the
 * behaviour does not.
 */
interface UserMenuProps {
  /** Hands a callback through to AboutModal so the "Send feedback" row
   *  there opens the same FeedbackModal the title-bar megaphone uses. The
   *  modal itself lives in TopNav so both entry points share one mount. */
  onOpenFeedback?: () => void;
  /** Fired when the account menu opens. The page uses it to close the
   *  News/Chat rail so the dropdown isn't trapped behind the mobile sheet. */
  onOpen?: () => void;
  /** In competition context, the current user's TEAM color — paints the
   *  avatar in their team identity (green = Manhattans, etc.) instead of the
   *  default teal. Null/undefined (no team, or off a competition page) falls
   *  back to the teal accent avatar. */
  teamColor?: string | null;
}

export function UserMenu({ onOpenFeedback, onOpen, teamColor }: UserMenuProps = {}) {
  const { data: me } = trpc.users.getMe.useQuery();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // About modal — opens from the highlighted "About BuddyTrip" row below
  // and renders on top of the standard scrim. Keeping the state up here
  // (vs. inside a sub-component) keeps the close-the-menu-then-open-the-
  // modal sequencing trivially correct.
  const [aboutOpen, setAboutOpen] = useState(false);
  // Preferences overlay — same close-the-menu-then-open sequencing as About.
  const [prefsOpen, setPrefsOpen] = useState(false);
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
    setMounted(true);
  }, []);

  // Warm the preferences chunk the moment the menu opens. The user has
  // signalled intent (they tapped the avatar); by the time they pick
  // "Settings" the JS is already downloaded, so the panel paints instantly.
  //
  // This used to be `router.prefetch("/profile")` — a ROUTE prefetch, which is
  // what it needed while preferences was a page. It is a lazy component now, so
  // the equivalent warm-up is importing the chunk directly.
  useEffect(() => {
    if (!open) return;
    void import("@/components/profile/PreferencesPanel");
  }, [open]);

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
        onClick={() =>
          setOpen((p) => {
            if (!p) onOpen?.();
            return !p;
          })
        }
        // Hover already existed (`hover:opacity-80`) — kept. Added: press
        // (STYLE_GUIDE.md §5's `active:scale-[0.98]`) and the same uniform
        // focus-visible ring this task applies everywhere. `rounded-full`
        // stays on the button itself so the ring — a box-shadow — clips to a
        // circle rather than a square around a circular avatar.
        // `transition-opacity` → `transition-[opacity,transform]`, same
        // reasoning as every other multi-property change in this task.
        className="flex items-center rounded-full transition-[opacity,transform] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bt-accent)]"
      >
        <Avatar
          name={me?.name ?? me?.email ?? "?"}
          avatarIcon={me?.avatar_icon ?? null}
          sizePx={32}
          // teamColor wins over accent inside Avatar (competition mode); when
          // absent, the avatar stays the default teal accent.
          teamColor={teamColor ?? undefined}
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
          {/* LOAD-BEARING: this panel's mobile `fixed` placement is anchored to
              the HEADER, not the viewport.
              TopNav sets `backdrop-filter`, which per spec makes it a containing
              block for `position: fixed` descendants — measured: this element's
              `offsetParent` IS the <header>. The backdrop above is portaled to
              <body> for exactly that reason; this panel is not, so `top-14`
              (56px) means "56px below the header's top", and only lands right
              because the header sits at y=0.
              #827 is what guarantees that: the bar is pinned by a sticky wrapper
              below `lg` and by the bounded flex column at `lg`. Before it, the
              bar scrolled away and took this panel with it — which is the
              reported "only the bottom line shows" (panel partly above the
              viewport) and "just the greyed-out scrim" (panel fully above it,
              while the portaled backdrop still covers the screen). Not
              reproducible since #827; recorded because the coupling is invisible.
              If the bar ever stops being pinned at 0, this breaks again — and the
              fix then is to portal this panel too and anchor it off the trigger's
              measured rect, NOT to raise z-index. */}
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

            {/* Settings → opens the preferences OVERLAY. It used to
                `router.push("/profile")`; preferences was the last surface in
                the app that navigated. */}
            <button
              type="button"
              role="menuitem"
              data-testid="user-menu-settings"
              onClick={() => {
                setOpen(false);
                setPrefsOpen(true);
              }}
              // All three `role="menuitem"` rows share this exact className,
              // so the same fix applies identically to all three (Account
              // preferences / About BuddyTrip / Sign out) — one `replace_all`,
              // not three near-duplicate edits that could drift.
              //
              // `active:scale-[0.99]`, not `0.98` — reuses the GENTLER value
              // this codebase already keeps for wide `w-full` rows
              // (`MatchCard.tsx`'s `active:scale-[0.99]` on its own
              // `block w-full text-left` row), distinct from the more
              // aggressive `0.98` used on compact icon-sized nav cells
              // elsewhere in this task. Reusing an existing DISTINCTION, not
              // inventing a third number.
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-[background-color,transform] hover:bg-[var(--color-bt-hover)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
              style={{ color: "var(--color-bt-text)" }}
            >
              <IconSettings
                size={16}
                stroke={1.75}
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                aria-hidden="true"
              />
              Settings
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
              // All three `role="menuitem"` rows share this exact className,
              // so the same fix applies identically to all three (Account
              // preferences / About BuddyTrip / Sign out) — one `replace_all`,
              // not three near-duplicate edits that could drift.
              //
              // `active:scale-[0.99]`, not `0.98` — reuses the GENTLER value
              // this codebase already keeps for wide `w-full` rows
              // (`MatchCard.tsx`'s `active:scale-[0.99]` on its own
              // `block w-full text-left` row), distinct from the more
              // aggressive `0.98` used on compact icon-sized nav cells
              // elsewhere in this task. Reusing an existing DISTINCTION, not
              // inventing a third number.
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-[background-color,transform] hover:bg-[var(--color-bt-hover)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
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
              // All three `role="menuitem"` rows share this exact className,
              // so the same fix applies identically to all three (Account
              // preferences / About BuddyTrip / Sign out) — one `replace_all`,
              // not three near-duplicate edits that could drift.
              //
              // `active:scale-[0.99]`, not `0.98` — reuses the GENTLER value
              // this codebase already keeps for wide `w-full` rows
              // (`MatchCard.tsx`'s `active:scale-[0.99]` on its own
              // `block w-full text-left` row), distinct from the more
              // aggressive `0.98` used on compact icon-sized nav cells
              // elsewhere in this task. Reusing an existing DISTINCTION, not
              // inventing a third number.
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-[background-color,transform] hover:bg-[var(--color-bt-hover)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
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

      {/* Preferences overlay — a sibling of the dropdown for the same reason
          AboutModal is: the panel portals to body, and rendering it inside the
          dropdown would entangle its scrim with the dropdown's outside-click
          logic and containing block. */}
      {prefsOpen && <PreferencesPanel onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}
