"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";

/**
 * Top-right user affordance — a plain Avatar link to /profile.
 *
 * Previously this rendered a dropdown with Profile + Sign out, but
 * the redesigned /profile page now hosts both (sign out lives in the
 * sidebar on desktop / in a card on mobile), so the dropdown became
 * a redundant extra tap. Keeping the click target small and quiet.
 */
export function UserMenu() {
  const { data: me } = trpc.users.getMe.useQuery();

  return (
    <Link
      href="/profile"
      aria-label="Open profile"
      data-testid="user-menu-btn"
      className="transition-opacity hover:opacity-80"
    >
      <Avatar
        name={me?.name ?? me?.email ?? "?"}
        avatarIcon={me?.avatar_icon ?? null}
        size="sm"
      />
    </Link>
  );
}
