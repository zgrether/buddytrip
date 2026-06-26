"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, UserCircle2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
 */
export function GameIdentityHeader({
  tripId, game, canEdit, isOwner,
}: {
  tripId: string;
  game: GameRow;
  /** Can edit the NAME (owner or delegate). */
  canEdit: boolean;
  /** Can change the ASSIGNMENT (owner-only — matches the server gate). */
  isOwner: boolean;
}) {
  const gameId = game.id;
  const me = useCurrentUser();
  const utils = trpc.useUtils();

  // ── Name (tap-to-edit inline) ──────────────────────────────────────────────
  const name = (game.name as string | null) ?? "Untitled game";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateName = trpc.games.update.useMutation();
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commitName() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === name) { setDraft(name); return; }
    updateName.mutate(
      { tripId, gameId, name: next },
      { onSuccess: () => utils.games.getById.invalidate({ tripId, gameId }) }
    );
  }

  // ── Assigned to (delegate, owner-gated) ────────────────────────────────────
  const membersQ = trpc.tripMembers.list.useQuery({ tripId }, { enabled: isOwner });
  const members = (membersQ.data ?? []) as { memberId: string; displayName: string }[];
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId, gameId });
  const delegateId = ((orgQ.data as { user_id: string }[] | undefined)?.[0]?.user_id) ?? null;
  const addOrg = trpc.games.addOrganizer.useMutation();
  const removeOrg = trpc.games.removeOrganizer.useMutation();
  const [picking, setPicking] = useState(false);

  const delegateName = delegateId
    ? (delegateId === me?.id ? "you" : members.find((m) => m.memberId === delegateId)?.displayName ?? "a delegate")
    : null;

  async function assign(next: string | null) {
    setPicking(false);
    if (next === delegateId) return;
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
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Assign to</span>
            <button type="button" onClick={() => void assign(null)} className="rounded-lg px-3 py-2 text-left text-sm" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text)" }}>
              The owner (you)
            </button>
            {members.map((m) => (
              <button key={m.memberId} type="button" onClick={() => void assign(m.memberId)} className="rounded-lg px-3 py-2 text-left text-sm" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text)" }}>
                {m.displayName}
              </button>
            ))}
            {members.length === 0 && <span className="px-3 py-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>No crew to assign yet.</span>}
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
            <UserCircle2 size={14} style={{ color: delegateName ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }} />
            <span>
              Assigned to{" "}
              <span style={{ color: delegateName ? "var(--color-bt-accent)" : "var(--color-bt-text)", fontWeight: 600 }}>
                {delegateName ?? "the owner"}
              </span>
            </span>
            {isOwner && (delegateName
              ? <X size={13} style={{ color: "var(--color-bt-text-dim)" }} onClick={(e) => { e.stopPropagation(); void assign(null); }} />
              : <Check size={13} style={{ color: "var(--color-bt-text-dim)", opacity: 0 }} />)}
          </button>
        )}
      </div>
    </div>
  );
}
