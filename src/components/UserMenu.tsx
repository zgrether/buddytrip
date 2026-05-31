"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSettings, IconLogout } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";

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
export function UserMenu() {
  const { data: me } = trpc.users.getMe.useQuery();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        />
      </button>

      {open && (
        <>
          {/* Mobile dim backdrop — sm:hidden so it disappears once the
              panel switches to absolute positioning on larger screens. */}
          <div
            className="fixed inset-0 z-40 sm:hidden"
            style={{ background: "var(--color-bt-overlay)" }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

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
        </>
      )}
    </div>
  );
}
