"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { UserAvatar } from "@/components/UserAvatar";

export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: me } = trpc.users.getMe.useQuery();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="User menu"
        data-testid="user-menu-btn"
        onClick={() => setOpen((prev) => !prev)}
        className="transition-opacity hover:opacity-80"
      >
        <UserAvatar
          name={me?.name ?? me?.email ?? null}
          avatarUrl={me?.avatar_url ?? null}
          sizePx={36}
        />
      </button>

      {open && (
        <div
          data-testid="user-menu-dropdown"
          className="absolute right-0 top-11 w-48 overflow-hidden rounded-xl shadow-2xl"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          {me && (
            <div
              className="px-4 py-3"
              style={{ borderBottom: "1px solid var(--color-bt-border)" }}
            >
              <p className="truncate text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {me.name ?? me.email}
              </p>
              {me.name && (
                <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {me.email}
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => { setOpen(false); router.push("/profile"); }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
          >
            <User size={15} strokeWidth={1.5} />
            Profile &amp; Settings
          </button>

          <div style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-50"
              style={{ color: "var(--color-bt-danger)" }}
            >
              <LogOut size={15} strokeWidth={1.5} />
              {signingOut ? "Signing out…" : "Sign Out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
