"use client";

/**
 * The match-play SETUP GRID — pairing people into matches.
 *
 * ── Extracted, and why that took a correction ──────────────────────────────
 *
 * This lived inside `MatchGameView` (3,332 lines). Pick'em needed a pairing
 * grid and Phase 0 concluded, in its own words, that "no cross-team pairing
 * exists anywhere in the app" — so a second grid was written from scratch.
 *
 * That premise was FALSE when it was written, and the evidence was in this
 * file's own comment: `PlayerSelector` binds the pool to one team per side —
 * "the pool is just this team, so a cross-team pair can't be built" — and
 * `teamForSlot` maps side A to team[0] and side B to team[1]. That is exactly
 * pick'em's shape: two rosters, one person from each.
 *
 * So the duplicate existed because a private component was hard to see into,
 * not because the problem was different. Being private to a large file is a
 * reason to EXTRACT, not a reason to duplicate — and the requirement that
 * settled it was that the two must look identical, at which point duplication
 * stops paying for itself entirely.
 *
 * ── What pick'em suppresses, and why suppressing beats reimplementing ──────
 *
 * Golf carries four things pick'em has none of. Only ONE of them is rendered
 * here, which is the part the original estimate got wrong:
 *
 *   doubles          `singlesOnly` hides the 1v1/2v2 choice — the real one
 *   handicaps        NOT here at all; `HandicapsSection` was already its own
 *                    component, so there is nothing to suppress
 *   live-add         `onAddLive` is already optional; pick'em omits it
 *   point overrides  `pointValue` is only ever initialised to null here
 *
 * One conditional, not four.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "@/components/Avatar";
import { MatchNumberBadge } from "@/components/games/MatchNumberBadge";
import { PlayerChip } from "@/components/games/PlayerChip";
import type { Participant } from "@/components/games/types";
import { removeMatchRow } from "@/lib/matchDraft";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import type { DraftMatchConfig } from "@/lib/configDraft";

/** The one unified match-play draft row — shared with the settings draft. */
type DraftMatch = DraftMatchConfig;

const MATCH_GRID = "24px 22px minmax(0,1fr) auto minmax(0,1fr) 24px";

function MatchDragHandle({
  index,
  attributes,
  listeners,
}: {
  index: number;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
}) {
  return (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Reorder match ${index + 1}`}
      className="flex cursor-grab items-center justify-center active:cursor-grabbing"
      style={{ width: 44, height: 44, justifySelf: "center", touchAction: "none", color: "var(--color-bt-text-dim)" }}
    >
      <GripVertical size={16} />
    </button>
  );
}

function StaticMatchDragHandle() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center"
      style={{ width: 44, height: 44, justifySelf: "center", color: "var(--color-bt-text-dim)" }}
    >
      <GripVertical size={16} />
    </div>
  );
}

function SortableMatchRow({
  id,
  index,
  children,
}: {
  id: string;
  index: number;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  // animateLayoutChanges: false — dnd-kit's `defaultAnimateLayoutChanges` fires a
  // FRESH css transition on every sortable row whose index changed once a drag ends
  // (gated on `wasDragging`), independent of the live drag-transform below. That
  // second transition lands on a still-settling transform, which is what reads on
  // device as the row next to the dropped one visibly re-seating. The live reflow
  // during the drag already shows the destination, so nothing needs to animate
  // post-drop. Same one-line fix PR #716 applied to the roster rows
  // (`SortableMemberRow`, TeamsPanel) — this is the matches half of it.
  //
  // Worth pinning, because the ids here differ from the roster list's: matches use
  // POSITIONAL sortable ids (`String(i)`, re-minted every render), so `index`
  // (`items.indexOf(id)`) is constant and dnd-kit's FLIP path (`useDerivedTransform`,
  // which triggers on a CHANGED index) never engages at all. The re-seat reaches
  // these rows through the other consumer of the same flag: post-drop `isSorting` is
  // false, so `getTransition()` hands out a live 200ms `transform` transition on
  // `shouldAnimateLayoutChanges` alone — while `finalTransform` has already dropped
  // to null. A transition on a transform snapping to `none` IS the animated re-seat.
  // Returning false closes that branch and the row snaps. The live drag is untouched
  // either way: `getTransition()` short-circuits on `isSorting` first.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });
  const style: React.CSSProperties = {
    gridTemplateColumns: MATCH_GRID,
    gap: 8,
    padding: "10px 0",
    borderTop: index > 0 ? "1px solid var(--color-bt-border)" : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
    // Hidden (not dimmed) while dragging — the DragOverlay below is now the
    // dragged row's visual; showing a translucent duplicate in place reads as
    // two items. The row still occupies its grid slot (opacity, not display:
    // none), so neighbours animate around a stable gap, not a reflow.
    opacity: isDragging ? 0 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="grid items-center">
      {children(<MatchDragHandle index={index} attributes={attributes} listeners={listeners} />)}
    </div>
  );
}

export function MatchSetup({
  draft,
  setDraft,
  nameOf,
  colorOf,
  teamColorOf,
  avatarIconOf,
  teamForSlot,
  maxMatches,
  openSelector,
  frozen = false,
  singlesOnly = false,
  onAddLive,
  addBlockedReason,
}: {
  tripId: string;
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  /** A player's TEAM color from their ROSTER assignment (`teamOfUser`) — team
   *  identity is the person, never the slot. A player dropped from their team
   *  resolves to undefined → the neutral per-player palette (the honest "no team"
   *  state), exactly like the handicap selector. Undefined for standalone games. */
  teamColorOf: (userId: string) => string | undefined;
  avatarIconOf: Map<string, string | null>;
  /** The team bound to a setup slot (side A → team[0], side B → team[1]) — drives
   *  the shared branded column header. Undefined in a standalone (non-2-team) game,
   *  where the header falls back to a neutral "Side A / Side B". */
  teamForSlot: (slot: "a" | "b") => { name: string; color: string } | undefined;
  /** Ceiling on the number of matches — "add match" hides once reached. For 1v1
   *  this is the players-per-team cap (Task 3a); for 2v2 it's the generous 24
   *  ceiling (no team cap — see the call site's reasoning). */
  maxMatches: number;
  openSelector: (matchIdx: number, slot: "a" | "b", memberIdx: number) => void;
  /**
   * Scores exist, so the EXISTING matches are frozen — their pairings can't change
   * without orphaning entered scores (`save_game_config` clean-replaces matches and
   * mints fresh UUIDs, which `score_entries.participant_id` and
   * `match_hole_outcomes.match_id` point at). Adding is unaffected and stays live:
   * see `onAddLive`.
   */
  frozen?: boolean;
  /**
   * Add a match RIGHT NOW, server-side, instead of staging it in the draft. Passed
   * only when `frozen` — `matches.addMatch` is a pure additive INSERT (fresh id,
   * no DELETE, `status: 'active'` on a live game so it is immediately scoreable),
   * so it appends without touching the matches already underway. That is the whole
   * reason "someone turned up late" is servable while rearranging is not.
   */
  onAddLive?: (playersPerSide: 1 | 2) => void;
  /** Live-add is refused while the draft is dirty — see the call site. */
  addBlockedReason?: string | null;
  /**
   * ONE MATCH SHAPE — 1v1, and no choice offered.
   *
   * The only thing pick'em suppresses here. Doubles is a golf idea: a pick'em
   * match is one sheet against one sheet, so "Add doubles" would offer a shape
   * the format cannot score and the pairing grid cannot fill.
   *
   * Offering a control that does nothing is the state this project has rejected
   * repeatedly — it reads as configured and is not. So the choice is ABSENT,
   * and "Add match" adds a single directly rather than opening a menu of one.
   */
  singlesOnly?: boolean;
}) {
  // F: reorder via up/down ARROWS (touch-reliable), not drag-and-drop — the ends are
  // disabled (up on the first row, down on the last). Matches only; agenda/roster DnD is
  // untouched (a future refactor unifies reorder responsively — #517).
  // "＋ Add match" reveals the "Add singles / Add doubles" choice (A2a) so each
  // match's shape is picked when it's added — a game can mix both.
  const [addOpen, setAddOpen] = useState(false);
  const addMatch = (pps: 1 | 2) => {
    // Two paths, one control. Before scoring, adding is a draft edit like everything
    // else on the page and commits with Save. Once scores exist the draft path is
    // closed (its save clean-replaces every match), so the add goes straight to the
    // server via the additive insert — which is the only reason it can still work.
    if (onAddLive) onAddLive(pps);
    else setDraft((prev) => [...prev, { matchNumber: prev.length + 1, playersPerSide: pps, a: [], b: [], handicap: 0, pointValue: null }]);
    setAddOpen(false);
  };

  // G: dnd-kit sensors — PointerSensor covers mouse + touch + pen (one API, no
  // separate touch handling needed); a 4px activation distance avoids arming a
  // drag on a simple tap. KeyboardSensor is the non-pointer path — verified
  // working (keyboard pick-up/move/drop + screen-reader announcements), so the
  // arrows they replace are gone (audit-before-delete confirmed no other caller).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // Sortable ids are positional (`"0"`, `"1"`, …) — valid because nothing else
  // mutates `draft` mid-drag (the ~20s config-sync poll is the only other
  // writer, and it doesn't fire between dragstart/dragend of a single gesture).
  const matchIds = draft.map((_, i) => String(i));
  // H: which row is airborne, for the DragOverlay below. Cleared on both drop
  // and cancel (e.g. Escape) — a stuck activeId would leave the source hidden
  // forever with no overlay to show for it.
  const [activeId, setActiveId] = useState<string | null>(null);
  const handleMatchDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleMatchDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setDraft((prev) => arrayMove(prev, Number(active.id), Number(over.id)));
    }
    setActiveId(null);
  };
  const handleMatchDragCancel = () => setActiveId(null);

  // One member (a single user) as a Participant — for an individual setup slot.
  function memberPart(userId: string | undefined): Participant | null {
    if (!userId) return null;
    const name = nameOf.get(userId) ?? "Player";
    return {
      id: userId,
      name,
      // Roster team color (neutral if the player is teamless) — NOT the slot's.
      color: teamColorOf(userId) ?? colorOf.get(userId) ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(userId) ?? null,
    };
  }
  // One TEAM COLUMN of the match grid — it holds the same column in both formats,
  // just 1 chip tall (1v1) or 2 chips tall (2v2). NOT a separate team-row, NOT a
  // per-row team label: a 2v2 match is the SAME six columns as 1v1, only two chips
  // stacked per side. The within-side gap (6px) is deliberately tighter than the
  // between-match separator (P2c) so the two chips read as ONE side; the grid's
  // items-center then centers the structural cells (grab/#/vs/×) against the stack
  // (the "span both rows, centered" effect). Each sub-slot picks a single player.
  // Team identity rides on the player avatar's ROSTER color (memberPart →
  // teamColorOf), never the slot — a dropped-from-team player reads neutral, honestly.
  const sideSlots = (members: string[], matchIdx: number, slot: "a" | "b", pps: 1 | 2) => {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: pps }).map((_, k) => (
          // Frozen: the pairing is fixed by entered scores. The slot renders but
          // does not open the picker — changing who is in a scored match is what
          // the clean-replace would orphan.
          <Slot key={k} player={memberPart(members[k])} onTap={frozen ? undefined : () => openSelector(matchIdx, slot, k)} />
        ))}
      </div>
    );
  };

  // H: one match row's content (handle │ # │ side A │ vs │ side B │ ×) — shared
  // between the live sortable row and the DragOverlay's floating copy, so the
  // two can't visually drift apart. `handle` is a render-prop: the live row
  // passes the REAL interactive handle (attributes/listeners attached); the
  // overlay passes a plain visual copy (nothing to attach listeners to — the
  // overlay isn't independently draggable, dnd-kit just positions it).
  const matchRowContent = (d: DraftMatch, i: number, handle: React.ReactNode) => (
    <>
      {/* handle — drag-to-reorder (G), far left, away from the × (reorder
          isn't next to remove). Pointer + keyboard both go through it. */}
      {handle}
      {/* # — the table index column (separate from the handle), with a
          1V1/2V2 shape tag beneath (the shared MatchNumberBadge, also used
          by Point Distribution + Handicaps so the leading column reads the
          same). */}
      <MatchNumberBadge number={i + 1} playersPerSide={d.playersPerSide} />
      {sideSlots(d.a, i, "a", d.playersPerSide)}
      <span className="text-center" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
      {sideSlots(d.b, i, "b", d.playersPerSide)}
      {/* Remove = the itinerary-builder "×" dismiss (NOT a trash can), DIM not
          red — draft removal is free (no persisted scores) and the open panel
          must never read as an error. Far right. Always REMOVES the row —
          0 matches is now a valid empty state (the table hides, leaving just
          "Add match"), so the last match is deletable, not floor-clamped. */}
      <button
        type="button"
        // Removing a match deletes its entered scores server-side; frozen means the
        // game has scores, so this is not offered. `matches.removeMatch` exists and
        // is per-match, but it is deliberately NOT wired here — see the PR note.
        onClick={frozen ? undefined : () => setDraft((prev) => removeMatchRow(prev, i))}
        disabled={frozen}
        title="Remove match"
        aria-label={`Remove match ${i + 1}`}
        className="flex items-center justify-center"
        style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)" }}
      >
        <X size={16} />
      </button>
    </>
  );

  // The shared branded header team for a slot: the bound team's name + color in a
  // 2-team competition, else a neutral "Side A/B" (a standalone game has no teams).
  const headerTeam = (slot: "a" | "b") => {
    const t = teamForSlot(slot);
    return t ?? { name: slot === "a" ? "Side A" : "Side B", color: "var(--color-bt-text-dim)" };
  };
  const a = headerTeam("a");
  const b = headerTeam("b");

  return (
    <div data-testid="match-pairings">
      {/* The table (team-name header + match rows) appears only once there's at
          least one match — a brand-new game shows just "Add match". 0 matches is a
          valid empty state, not an error. */}
      {draft.length > 0 && (
        <>
      {/* Shared branded column header (BOTH formats): team names centered +
          team-colored in their columns, "vs" centered in its; grab/#/× columns
          empty. Same MATCH_GRID template as the rows below → the columns line up. */}
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: MATCH_GRID, gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <span />
        <span />
        <span className="truncate text-center" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", color: a.color }}>{a.name}</span>
        <span className="text-center" style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
        <span className="truncate text-center" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", color: b.color }}>{b.name}</span>
        <span />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleMatchDragStart}
        onDragEnd={handleMatchDragEnd}
        onDragCancel={handleMatchDragCancel}
      >
        <SortableContext items={matchIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {draft.map((d, i) => (
              // The match is one flat grid ROW (no frame, no "MATCH N" band). The
              // four structural columns (handle │ # │ vs │ ×) center against the team
              // columns, which hold one chip (1v1) or two stacked chips (2v2). A
              // hairline separator above every match but the first delimits them —
              // quiet in 1v1, load-bearing in 2v2 (it makes the 2-row match read as
              // one unit).
              <SortableMatchRow key={i} id={String(i)} index={i}>
                {(handle) => matchRowContent(d, i, handle)}
              </SortableMatchRow>
            ))}
          </div>
        </SortableContext>
        {/* H: the floating copy — without it, dnd-kit only animates the source
            row via CSS transform, which resets to origin on drop THEN
            transitions into place (the reported snap-back). The overlay is a
            portal (renders to body), so it needs its own MATCH_GRID + width —
            sized to the source row's measured width so the columns still line
            up. dropAnimation is explicitly null (not defaultDropAnimation):
            our sortable ids are positional ("0", "1", …), re-minted every
            render, so by drop time "the same id" no longer names the same
            logical row — defaultDropAnimation's "animate to the final rect
            of this id" then targets the wrong slot, which is what read on
            device as the overlay flying back toward the source position.
            The live reflow during the drag already shows the correct
            destination, so the overlay can just vanish on release — nothing
            needs to animate. */}
        <DragOverlay dropAnimation={null}>
          {activeId !== null && draft[Number(activeId)] ? (
            <div
              className="grid items-center"
              style={{
                gridTemplateColumns: MATCH_GRID,
                gap: 8,
                padding: "10px 8px",
                borderRadius: 10,
                background: "var(--color-bt-card-float)",
                boxShadow: "var(--shadow-floating)",
              }}
            >
              {matchRowContent(draft[Number(activeId)], Number(activeId), <StaticMatchDragHandle />)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
        </>
      )}

      {/* Add another match (A2a) — "＋ Add match" reveals a singles/doubles choice
          so a game can mix shapes; each new card carries the chosen playersPerSide.
          Hidden at the generous MAX ceiling. */}
      {draft.length < maxMatches && (
        <div className="mt-3">
          <button
            type="button"
            // With one shape there is nothing to choose between, so the button
            // does the thing instead of revealing a menu with a single item.
            onClick={() => (singlesOnly ? addMatch(1) : setAddOpen((o) => !o))}
            aria-expanded={singlesOnly ? undefined : addOpen}
            disabled={!!addBlockedReason}
            className="flex w-full items-center justify-center gap-1.5 disabled:opacity-40"
            style={{ height: 46, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
            data-testid="add-match"
          >
            <Plus size={16} />
            Add match
          </button>
          {/* Live-add needs a clean draft, and says so rather than failing later.
              Mixing the two would be the staged-state lie in a new costume: the
              match lands immediately while the rest of your edits don't. */}
          {addBlockedReason && (
            <p className="mt-1.5 text-center" style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)" }} data-testid="add-match-blocked">
              {addBlockedReason}
            </p>
          )}
          {addOpen && !singlesOnly && !addBlockedReason && (
            <div className="mt-2.5 flex gap-2.5" data-testid="add-match-choice">
              <AddShapeButton kind="1V1" label="Add singles" onClick={() => addMatch(1)} />
              <AddShapeButton kind="2V2" label="Add doubles" onClick={() => addMatch(2)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddShapeButton({ kind, label, onClick }: { kind: "1V1" | "2V2"; label: string; onClick: () => void }) {
  const doubles = kind === "2V2";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-0.5"
      style={{ padding: 11, borderRadius: 11, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: doubles ? "#c4b5fd" : "#93c5fd" }}>{kind}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>{label}</span>
    </button>
  );
}

export function PlayerSelector({
  matchIdx,
  slot,
  memberIdx,
  sided,
  teamLabel,
  teamColor,
  draft,
  crew,
  nameOf,
  onPick,
  onClose,
}: {
  matchIdx: number;
  slot: "a" | "b";
  memberIdx: number;
  sided: boolean;
  /** The team this side is bound to (2-team competition) — the pool is just this
   *  team, so a cross-team pair can't be built. Undefined for standalone. */
  teamLabel?: string;
  teamColor?: string;
  draft: DraftMatch[];
  crew: string[];
  nameOf: Map<string, string>;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  // Map user → the match they currently occupy (if any) — across all members of
  // both sides, so a player already placed shows as "taken" / moves when chosen.
  const inMatch = new Map<string, number>();
  draft.forEach((d, i) => {
    for (const u of d.a) inMatch.set(u, i);
    for (const u of d.b) inMatch.set(u, i);
  });
  const available = crew.filter((id) => !inMatch.has(id));
  const taken = crew.filter((id) => inMatch.has(id));
  // Title: when the side is team-bound, name the team (the constraint is visible
  // — you're picking a Blue player into Blue's side). Else fall back to A/B.
  const title = teamLabel
    ? sided
      ? `${teamLabel} · Player ${memberIdx + 1}`
      : `Match ${matchIdx + 1} · ${teamLabel}`
    : sided
      ? `Match ${matchIdx + 1} · Side ${slot === "a" ? "A" : "B"} · Player ${memberIdx + 1}`
      : `Match ${matchIdx + 1} · Player ${slot === "a" ? 1 : 2}`;

  // Portaled to body: this picker is opened from within the settings slide-over,
  // which is itself body-portaled at z-50. Rendered in-tree it would live inside the
  // z-30 game-panel host, so its own z-50 is scoped there and it paints UNDERNEATH
  // the shell (the scrim covers the viewport but the drawer sits on top and the sheet
  // only shows in the left gap). z-[60] at the body level beats the shell — same fix
  // DiscardChangesPrompt uses.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} data-testid="player-selector">
      <div onClick={(e) => e.stopPropagation()} className="w-full" style={{ background: "var(--color-bt-card-float)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px 28px", maxHeight: "75vh", overflowY: "auto" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {teamColor && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: teamColor }} />}
          {title}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 14 }}>Available</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {available.length === 0 && <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Everyone&apos;s assigned.</span>}
          {available.map((id) => (
            <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} teamColor={teamColor} onClick={() => onPick(id)} />
          ))}
        </div>
        {taken.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 16 }}>Already in a match</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {taken.map((id) => (
                <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} teamColor={teamColor} sub={`Match ${(inMatch.get(id) ?? 0) + 1}`} dim onClick={() => onPick(id)} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
              Choosing someone already in a match moves them here and clears that match&apos;s handicap.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function Slot({ player, onTap }: { player: Participant | null; onTap?: () => void }) {
  if (!player) {
    // The plus + label live together inside one dashed pill (card-raised so it
    // reads as a fillable block). Always "+ Add player".
    return (
      <button
        onClick={onTap}
        className="flex items-center justify-center gap-1.5"
        style={{ width: "100%", minWidth: 0, height: 44, borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
      >
        <Plus size={15} />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Add player</span>
      </button>
    );
  }
  // Filled — the shared PlayerChip (avatar 30, left-aligned, §11 team initial, no
  // avatarIcon; player.color is roster-resolved upstream). The button is just the
  // tap target (reset surface); the chip owns the visual, so the Matches slot and
  // the handicap segment render an identical chip.
  return (
    <button onClick={onTap} className="block w-full text-left" style={{ minWidth: 0, padding: 0, border: "none", background: "none" }}>
      <PlayerChip name={player.name} teamColor={player.color} />
    </button>
  );
}

function SelectorRow({ name, teamColor, sub, dim, onClick }: { name: string; teamColor?: string | null; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="@container flex w-full items-center justify-between gap-2 text-left" style={{ padding: "9px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: dim ? 0.55 : 1 }}>
      <span className="flex min-w-0 items-center gap-2.5">
        {/* §11 team initial, no avatarIcon (closes #477). teamColor is the slot's
            team — correct here: the picker list is constrained to that team. */}
        <Avatar name={name} teamColor={teamColor} sizePx={30} collapse />
        <span style={{ fontSize: 15, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </span>
      {sub && <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>{sub}</span>}
    </button>
  );
}
