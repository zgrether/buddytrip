"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, UserCircle2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Avatar } from "@/components/Avatar";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * Zone 1 (W-EDITMODAL-01) — the IDENTITY header at the top of the game-setup page:
 * *what is this game, and whose is it?* Display-first, NOT a checklist row — the
 * game is already named, so this is display-with-edit, not resolve-from-empty.
 *
 *  - **Name** as the page title, tap-to-edit inline (commit on blur/Enter →
 *    `games.update{name}`). Owner or delegate.
 *  - **"Assigned to: [owner / delegate]"** — the FRAME for the whole page: empty →
 *    the owner fills the checklist; filled → it's that delegate's assignment. The
 *    delegate grant is owner-only (`addOrganizer`/`removeOrganizer`), so non-owners
 *    see it read-only. A delegate landing here reads "… · Assigned to: you".
 *
 * This is the ONE shared settings-page header — the match checklist renders it
 * directly; stroke/rack render it inside `GameConfigurationView` (the ONE settings
 * page). The optional **`children`** below the assigned-to frame is a mode-controls
 * slot, empty by default → no visual change. (As of the A2-ux correction the
 * Setup/Scoring toggle is a standalone `GameManagementPanel` on the settings page,
 * not threaded through this slot.)
 *
 * TWO MODES (mirrors `GameRulesNote` / `CourseRowContent`):
 *  - **Uncontrolled** (default — stroke/rack via `GameConfigurationView`):
 *    self-persisting. The name commits on blur/Enter via `games.update`; the
 *    assignment commits on pick via `addOrganizer`/`removeOrganizer`.
 *  - **Controlled** (pass `nameValue` — the draft-then-save match settings page):
 *    the parent owns both fields and decides what an edit means. Nothing commits
 *    here; the page's single Save persists them. This matters beyond tidiness — a
 *    live write from this header would move the game's config hash out from under
 *    the page's frozen baseHash and make the user's own Save conflict.
 */
export function GameIdentityHeader({
  tripId, game, canEdit, isOwner, children,
  nameValue, onNameChange, delegateValue, onDelegateChange,
}: {
  tripId: string;
  game: GameRow;
  /** Can edit the NAME (owner or delegate). */
  canEdit: boolean;
  /** Can change the ASSIGNMENT (owner-only — matches the server gate). */
  isOwner: boolean;
  /** Mode-controls slot (A2-precursor) — the Game Management panel/toggle mounts
   *  here in A2-ux. Rendered below the assigned-to frame; omitted → nothing renders. */
  children?: React.ReactNode;
  /** Controlled mode: the name to show. Omit for the self-persisting default. */
  nameValue?: string;
  /** Controlled mode: the name was committed (blur/Enter). */
  onNameChange?: (next: string) => void;
  /** Controlled mode: the assigned delegate's user id (null = the owner). */
  delegateValue?: string | null;
  /** Controlled mode: the assignment changed. */
  onDelegateChange?: (next: string | null) => void;
}) {
  const gameId = game.id;
  const me = useCurrentUser();
  const utils = trpc.useUtils();
  // Controlled when the parent supplies the name — the one field every state of
  // this header can reach (mirrors CourseRowContent's `onApplyFront` gate).
  const controlled = nameValue !== undefined;

  // ── Name (tap-to-edit inline) ──────────────────────────────────────────────
  const name = controlled ? nameValue : ((game.name as string | null) ?? "Untitled game");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateName = trpc.games.update.useMutation();
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commitName() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === name) { setDraft(name); return; }
    if (controlled) { onNameChange?.(next); return; } // the parent owns persistence
    updateName.mutate(
      { tripId, gameId, name: next },
      { onSuccess: () => utils.games.getById.invalidate({ tripId, gameId }) }
    );
  }

  // ── Assigned to (delegate, owner-gated) ────────────────────────────────────
  // Enabled for ALL viewers, not just the owner: the picker is owner-only, but the
  // no-delegate DISPLAY needs the OWNER's name for a non-owner viewer ("Assigned to
  // [owner]"). tripMembers.list is any-member-allowed and cached on most surfaces.
  const membersQ = trpc.tripMembers.list.useQuery({ tripId });
  const members = (membersQ.data ?? []) as {
    memberId: string;
    displayName: string;
    role: string;
    user?: { avatar_icon?: string | null } | null;
  }[];
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId, gameId });
  const delegateId = controlled
    ? (delegateValue ?? null)
    : (((orgQ.data as { user_id: string }[] | undefined)?.[0]?.user_id) ?? null);
  const addOrg = trpc.games.addOrganizer.useMutation();
  const removeOrg = trpc.games.removeOrganizer.useMutation();
  const [picking, setPicking] = useState(false);

  // The trip Owner — the implicit assignee when no delegate is set. Their NAME frames
  // the no-delegate display for a non-owner viewer; the OWNER is removed from the
  // picker list entirely (assigning is "hand it to someone ELSE", and absence = owner).
  const ownerMember = members.find((m) => m.role === "Owner");
  const ownerName = ownerMember?.displayName ?? "the owner";
  const avatarIconFor = (id: string) => members.find((m) => m.memberId === id)?.user?.avatar_icon ?? null;
  // Everyone assignable — the crew MINUS the owner (no self-assign; absence = owner).
  const assignable = members.filter((m) => m.memberId !== ownerMember?.memberId);

  const delegateName = delegateId
    ? (delegateId === me?.id ? "you" : members.find((m) => m.memberId === delegateId)?.displayName ?? "a delegate")
    : null;
  // The no-delegate frame: say the PERSON, not the role — "you" to the owner, the
  // owner's name to anyone else.
  const assignedLabel = delegateName ?? (isOwner ? "you" : ownerName);

  async function assign(next: string | null) {
    setPicking(false);
    if (next === delegateId) return;
    if (controlled) { onDelegateChange?.(next); return; } // the parent owns persistence
    try {
      if (delegateId) await removeOrg.mutateAsync({ tripId, gameId, userId: delegateId });
      if (next) await addOrg.mutateAsync({ tripId, gameId, userId: next });
      utils.games.listOrganizers.setData(
        { tripId, gameId },
        next ? ([{ user_id: next, granted_by: null, created_at: null }] as never) : []
      );
      utils.games.listOrganizers.invalidate({ tripId, gameId });
    } catch {
      utils.games.listOrganizers.invalidate({ tripId, gameId });
    }
  }

  return (
    <div className="mb-4">
      {/* Name — title + tap-to-edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setDraft(name); setEditing(false); } }}
          maxLength={200}
          className="w-full rounded-lg px-2 py-1 outline-none"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-accent-border)", fontSize: 22, fontWeight: 800 }}
          data-testid="game-name-input"
        />
      ) : (
        <button
          type="button"
          onClick={() => { if (canEdit) { setDraft(name); setEditing(true); } }}
          disabled={!canEdit}
          className="flex max-w-full items-center gap-2 text-left"
          data-testid="game-name-title"
        >
          <span className="truncate" style={{ fontSize: 22, fontWeight: 800, color: "var(--color-bt-text)" }}>{name}</span>
          {canEdit && <Pencil size={14} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />}
        </button>
      )}

      {/* Assigned to — the page frame */}
      <div className="mt-1.5">
        {picking ? (
          <div className="flex flex-col gap-1.5 rounded-xl p-2" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
            {/* Header + close: with the owner gone from the list there's no "pick me"
                row to back out with, so the panel needs its own × (STYLE_GUIDE §5). */}
            <div className="flex items-center justify-between">
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Assign to</span>
              <button
                type="button"
                onClick={() => setPicking(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ color: "var(--color-bt-text-dim)" }}
                data-testid="assign-close"
              >
                <X size={16} />
              </button>
            </div>
            {/* Only OTHER people — the owner is never in the list (absence = owner). */}
            {assignable.map((m) => (
              <button key={m.memberId} type="button" onClick={() => void assign(m.memberId)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text)" }}>
                <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} sizePx={28} />
                <span className="truncate">{m.displayName}</span>
              </button>
            ))}
            {assignable.length === 0 && <span className="px-3 py-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>No crew to assign yet.</span>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { if (isOwner) setPicking(true); }}
            disabled={!isOwner}
            className="flex items-center gap-1.5 text-sm"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="game-assigned-to"
          >
            {delegateId
              ? <Avatar name={assignedLabel} avatarIcon={avatarIconFor(delegateId)} sizePx={22} />
              : <UserCircle2 size={14} style={{ color: "var(--color-bt-text-dim)" }} />}
            <span>
              Assigned to{" "}
              <span style={{ color: delegateName ? "var(--color-bt-accent)" : "var(--color-bt-text)", fontWeight: 600 }}>
                {assignedLabel}
              </span>
            </span>
            {/* The × clears a real delegate (→ back to the owner). Absent when already
                the owner default — there's nothing to clear. */}
            {isOwner && delegateName && (
              <X size={13} style={{ color: "var(--color-bt-text-dim)" }} onClick={(e) => { e.stopPropagation(); void assign(null); }} />
            )}
          </button>
        )}
      </div>

      {/* Mode-controls slot (A2-precursor) — the Game Management panel/toggle mounts
          here in A2-ux. Empty today, so this is a no-op render. */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
