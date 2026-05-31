"use client";

import { useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";

// ── Types ────────────────────────────────────────────────────────────────

export interface CrewSearchInputProps {
  tripId: string;
  defaultRole?: "Planner" | "Member";
  defaultStatus?: "draft" | "in" | "likely" | "maybe" | "out" | "invited";
  /** Show "Send invite" path when no account found */
  allowInvite?: boolean;
  placeholder?: string;
  /** Show search icon in the input */
  showSearchIcon?: boolean;
  onAdded?: () => void;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "found"; user: { id: string; name: string | null; email: string; avatar_icon?: string | null } }
  | { kind: "not-found" };

// ── Component ────────────────────────────────────────────────────────────

export function CrewSearchInput({
  tripId,
  defaultRole = "Member",
  defaultStatus = "draft",
  allowInvite = true,
  showSearchIcon = false,
  placeholder = "email@example.com",
  onAdded,
}: CrewSearchInputProps) {
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [alreadyMemberName, setAlreadyMemberName] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // ── Mutations ──────────────────────────────────────────────────────────

  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onSuccess() {
      resetAll();
      utils.tripMembers.list.invalidate({ tripId });
      onAdded?.();
    },
  });

  const addMember = trpc.tripMembers.add.useMutation({
    onSuccess() {
      resetAll();
      utils.tripMembers.list.invalidate({ tripId });
      onAdded?.();
    },
    onError(err) {
      // Already on trip — promote to the desired role instead
      if (err.data?.code === "CONFLICT" && search.kind === "found") {
        updateRole.mutate({ tripId, userId: search.user.id, role: defaultRole });
      }
    },
  });

  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation();

  // ── Handlers ───────────────────────────────────────────────────────────

  function resetAll() {
    setEmail("");
    setSearch({ kind: "idle" });
    setInviteError(null);
    setAlreadyMemberName(null);
  }

  async function handleLookup() {
    const q = email.trim().toLowerCase();
    if (!q.includes("@")) return;
    const results = await utils.users.search.fetch({ query: q });
    if (results && results.length > 0) {
      setSearch({
        kind: "found",
        user: results[0] as { id: string; name: string | null; email: string; avatar_icon?: string | null },
      });
    } else {
      setSearch({ kind: "not-found" });
    }
  }

  function handleAddFound(userId: string) {
    addMember.mutate({ tripId, userId, role: defaultRole, status: defaultStatus });
  }

  async function handleInvite() {
    setInviteError(null);
    setAlreadyMemberName(null);
    try {
      const result = await inviteByEmail.mutateAsync({ tripId, email: email.trim(), role: defaultRole });
      if (result.status === "already_member" && "displayName" in result) {
        setAlreadyMemberName(result.displayName);
        return;
      }
      resetAll();
      utils.tripMembers.list.invalidate({ tripId });
      onAdded?.();
    } catch {
      setInviteError("Failed to create invite. Please try again.");
    }
  }

  const displayName = (u: { name: string | null; email: string }) =>
    u.name ?? u.email;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Email input + Find button */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          {showSearchIcon && (
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--color-bt-text-dim)" }}
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSearch({ kind: "idle" });
              setInviteError(null);
              setAlreadyMemberName(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") handleLookup(); }}
            placeholder={placeholder}
            className={`w-full rounded-lg border py-1.5 text-xs outline-none ${showSearchIcon ? "pl-7 pr-2.5" : "px-2.5"}`}
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
        <button
          onClick={handleLookup}
          disabled={!email.includes("@")}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Find
        </button>
      </div>

      {/* Found state */}
      {search.kind === "found" && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <Avatar name={displayName(search.user)} avatarIcon={search.user.avatar_icon ?? null} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
              {search.user.name ?? search.user.email}
            </p>
            <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
              BuddyTrip member
            </p>
          </div>
          <button
            onClick={() => handleAddFound(search.user.id)}
            disabled={addMember.isPending}
            className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {addMember.isPending ? "Adding…" : "+ Add"}
          </button>
        </div>
      )}

      {/* Not found state */}
      {search.kind === "not-found" && (
        <div
          className="space-y-2 rounded-lg px-3 py-2.5"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            No BuddyTrip account found for that email.
          </p>
          {alreadyMemberName && (
            <p className="text-xs font-medium" style={{ color: "var(--color-bt-warning)" }}>
              Already on this trip as &ldquo;{alreadyMemberName}&rdquo;
            </p>
          )}
          {inviteError && (
            <p className="text-xs" style={{ color: "var(--color-bt-warning)" }}>
              {inviteError}
            </p>
          )}

          {/* Invite path */}
          {allowInvite && (
            <>
              <button
                onClick={handleInvite}
                disabled={inviteByEmail.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {inviteByEmail.isPending ? (
                  <><Loader2 size={11} className="animate-spin" /> Sending invite…</>
                ) : (
                  <><UserPlus size={11} /> Invite to BuddyTrip</>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
