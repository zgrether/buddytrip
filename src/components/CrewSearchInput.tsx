"use client";

import { useState } from "react";
import { Check, Ghost, Link, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserAvatar } from "@/components/UserAvatar";

// ── Types ────────────────────────────────────────────────────────────────

export interface CrewSearchInputProps {
  tripId: string;
  defaultRole?: "Planner" | "Member";
  defaultStatus?: "draft" | "in" | "likely" | "maybe" | "out" | "invited";
  /** Show "Add as guest (no account)" path */
  allowGhost?: boolean;
  /** Show "Send invite" path when no account found */
  allowInvite?: boolean;
  placeholder?: string;
  /** Show search icon in the input */
  showSearchIcon?: boolean;
  onAdded?: () => void;
  frequentTripmates?: Array<{
    id: string;
    name: string | null;
    nickname: string | null;
    email: string;
  }>;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "found"; user: { id: string; name: string | null; nickname: string | null; email: string } }
  | { kind: "not-found" };

// ── Component ────────────────────────────────────────────────────────────

export function CrewSearchInput({
  tripId,
  defaultRole = "Member",
  defaultStatus = "draft",
  allowGhost = false,
  allowInvite = true,
  showSearchIcon = false,
  placeholder = "email@example.com",
  onAdded,
  frequentTripmates = [],
}: CrewSearchInputProps) {
  const [email, setEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [showNameOnly, setShowNameOnly] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const createGuest = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      resetAll();
      utils.tripMembers.list.invalidate({ tripId });
      onAdded?.();
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────

  function resetAll() {
    setEmail("");
    setGuestName("");
    setSearch({ kind: "idle" });
    setShowNameOnly(false);
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
        user: results[0] as { id: string; name: string | null; nickname: string | null; email: string },
      });
    } else {
      setSearch({ kind: "not-found" });
    }
  }

  function handleAddFound(userId: string) {
    addMember.mutate({ tripId, userId, role: defaultRole, status: defaultStatus });
  }

  function handleFrequentAdd(userId: string) {
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

  function handleAddAsGuest() {
    const nameVal = guestName.trim() || email.trim().split("@")[0];
    createGuest.mutate({
      tripId,
      name: nameVal,
      email: email.trim() || undefined,
      role: defaultRole,
    });
  }

  function handleAddNameOnlyGuest() {
    if (!guestName.trim()) return;
    createGuest.mutate({
      tripId,
      name: guestName.trim(),
      role: defaultRole,
    });
  }

  async function handleCopyInvite() {
    const inviteUrl = `${window.location.origin}/invite?trip=${tripId}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try { document.execCommand("copy"); } catch { /* best effort */ }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const displayName = (u: { name: string | null; nickname: string | null; email: string }) =>
    u.nickname ?? u.name ?? u.email;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Frequent tripmates chips */}
      {frequentTripmates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {frequentTripmates.map((user) => (
            <button
              key={user.id}
              onClick={() => handleFrequentAdd(user.id)}
              disabled={addMember.isPending}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{
                background: "var(--color-bt-tag-bg)",
                color: "var(--color-bt-accent)",
                border: "1px solid color-mix(in srgb, var(--color-bt-accent) 30%, transparent)",
              }}
            >
              <UserAvatar name={displayName(user)} avatarUrl={null} sizePx={16} />
              {user.nickname ?? user.name?.split(" ")[0]}
              <Plus size={10} />
            </button>
          ))}
        </div>
      )}

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
              setShowNameOnly(false);
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
          <UserAvatar name={displayName(search.user)} avatarUrl={null} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
              {search.user.name ?? search.user.email}
              {search.user.nickname && (
                <span className="ml-1" style={{ color: "var(--color-bt-text-dim)" }}>
                  ({search.user.nickname})
                </span>
              )}
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
              <button
                onClick={handleCopyInvite}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {copied ? (
                  <><Check size={11} /> Link copied!</>
                ) : (
                  <><Link size={11} /> Copy invite link instead</>
                )}
              </button>
            </>
          )}

          {/* Ghost path (with email) */}
          {allowGhost && (
            <div className="space-y-1.5">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Name for guest"
                className="w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
              <button
                onClick={handleAddAsGuest}
                disabled={createGuest.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                  border: "1px solid var(--color-bt-accent-border)",
                }}
              >
                <Ghost size={11} />
                {createGuest.isPending ? "Adding…" : "Add as guest"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Name-only ghost path (no @ in input) */}
      {allowGhost && !email.includes("@") && search.kind === "idle" && !showNameOnly && (
        <button
          onClick={() => setShowNameOnly(true)}
          className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Plus size={11} />
          Add someone without an account
        </button>
      )}

      {showNameOnly && (
        <div
          className="space-y-1.5 rounded-lg px-3 py-2.5"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <input
            autoFocus
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddNameOnlyGuest(); }}
            placeholder="Guest name"
            className="w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          <button
            onClick={handleAddNameOnlyGuest}
            disabled={!guestName.trim() || createGuest.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <Ghost size={11} />
            {createGuest.isPending ? "Adding…" : "Add as guest"}
          </button>
        </div>
      )}
    </div>
  );
}
