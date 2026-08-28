"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { DelegatePicker } from "@/components/games/DelegatePicker";

/**
 * Zone 1 (W-EDITMODAL-01) — the IDENTITY header at the top of the game-setup page:
 * *what is this game, and whose is it?* Display-first, NOT a checklist row — the
 * game is already named, so this is display-with-edit, not resolve-from-empty.
 *
 *  - **Name** as the page title, tap-to-edit inline (commit on blur/Enter). Owner or
 *    delegate.
 *  - **"Assigned to: [owner / delegate]"** — the FRAME for the whole page: empty →
 *    the owner fills the checklist; filled → it's that delegate's assignment. The
 *    delegate grant is owner-only, so non-owners see it read-only. A delegate landing
 *    here reads "… · Assigned to: you".
 *
 * This is the ONE shared settings-page header — the match checklist renders it
 * directly; stroke/rack render it inside `GameConfigurationView` (the ONE settings
 * page). The optional **`children`** below the assigned-to frame is a mode-controls
 * slot, empty by default → no visual change. (As of the A2-ux correction the
 * Setup/Scoring toggle is a standalone `GameManagementPanel` on the settings page,
 * not threaded through this slot.)
 *
 * **Controlled only (#626).** The parent owns both fields (name + assignment) and
 * decides what an edit means; nothing commits here — the page's single Save persists
 * them. This matters beyond tidiness: a live write from this header would move the
 * game's config hash out from under the page's frozen baseHash and make the user's
 * own Save conflict. (The old self-persisting `games.update`/`addOrganizer`/
 * `removeOrganizer` path is gone — every render site is draft-then-save.)
 */
export function GameIdentityHeader({
  tripId, competitionId, canEdit, canDelegate, children,
  nameValue, onNameChange, delegateValue, onDelegateChange,
}: {
  tripId: string;
  /** Resolves team colours in the delegate picker. Optional — a game outside a
   *  competition renders neutral avatars and nothing else changes. */
  competitionId?: string | null;
  /** Can edit the NAME (owner or delegate). */
  canEdit: boolean;
  /**
   * Can change the ASSIGNMENT — trip Owner OR Organizer, delegates excluded.
   *
   * This said "owner-only — matches the server gate", and the server gate is
   * `games.addOrganizer` / `removeOrganizer`, both
   * `requireTripRole("Organizer")`. So the comment asserted a match that did
   * not exist and the client was STRICTER than the policy: an Organizer could
   * not see a control the server would have accepted. Renamed off `isOwner`
   * so the next reader cannot make the same inference from the name.
   */
  canDelegate: boolean;
  /** Mode-controls slot (A2-precursor) — the Game Management panel/toggle mounts
   *  here in A2-ux. Rendered below the assigned-to frame; omitted → nothing renders. */
  children?: React.ReactNode;
  /** The name to show (the parent's draft slice). */
  nameValue: string;
  /** The name was committed (blur/Enter). */
  onNameChange: (next: string) => void;
  /** The assigned delegate's user id (null = the owner). */
  delegateValue: string | null;
  /** The assignment changed. */
  onDelegateChange: (next: string | null) => void;
}) {

  // ── Name (tap-to-edit inline) ──────────────────────────────────────────────
  const name = nameValue;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commitName() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === name) { setDraft(name); return; }
    onNameChange(next); // the parent owns persistence (Save commits it)
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
          /* Opts out of the global 16px mobile input rule (globals.css): this is
             a 22px title field, and the rule's `!important` would otherwise
             shrink it. Legitimate precisely because 22 ≥ 16 and so cannot zoom
             — `inputZoom.test.ts` enforces that bound on every carrier. */
          data-font-size-ok
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

      {/* Assigned to — the page frame. The control itself is the SHARED
          `DelegatePicker` (one picker app-wide): trigger + panel + team-coloured
          avatars. This header used to inline its own copy, which was the better
          of the two that existed; extracting it is what let add-a-game adopt it
          rather than keep the weaker one. */}
      <div className="mt-1.5">
        <DelegatePicker
          tripId={tripId}
          competitionId={competitionId}
          canAssign={canDelegate}
          value={delegateValue}
          onChange={onDelegateChange}
        />
      </div>

      {/* Mode-controls slot (A2-precursor) — the Game Management panel/toggle mounts
          here in A2-ux. Empty today, so this is a no-op render. */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
