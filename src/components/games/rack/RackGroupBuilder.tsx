"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { PlayerChip } from "@/components/games/PlayerChip";
import { Avatar } from "@/components/Avatar";
import { addGroup as addGroupOp, removeGroup as removeGroupOp, assignPlayer, removePlayer as removePlayerOp, assignedIds, MAX_PER_GROUP, MAX_GROUPS } from "@/lib/rackGroupDraft";

export interface GroupBuilderPlayer {
  id: string;
  name: string;
  avatarIcon: string | null;
}
export interface GroupBuilderTeam {
  id: string;
  name: string;
  color: string;
  /** Roster in the parent's canonical sort_order (handicap order if the captain
   *  set it) — the picker shows this order top-to-bottom. */
  players: GroupBuilderPlayer[];
}

/**
 * RackGroupBuilder — manual playing-group assignment for Rack-n-Stack, forked from
 * the 2v2 match-builder's add/remove + player-picker interaction. Presentation-only
 * per the persistence-agnostic pattern (CLAUDE.md #7): the draft (`groups` = arrays
 * of user ids, one array per group) arrives via props and every edit emits through
 * `onChange`; the parent owns tRPC persistence.
 *
 * The one departure from the 2v2 builder is the COMBINED-POOL picker — both teams in
 * ONE bottom sheet, two columns (team A left / team B right) — so a group takes any
 * mix (no forced 2+2). A player already in a group leaves the pool (each player in at
 * most one group). Unassigned players simply stay in the pool: no bench warning — the
 * scoring rack's empty/forfeited slots carry that consequence downstream.
 */
export function RackGroupBuilder({
  groups,
  onChange,
  teamA,
  teamB,
}: {
  groups: string[][];
  onChange: (next: string[][]) => void;
  teamA: GroupBuilderTeam;
  teamB: GroupBuilderTeam;
}) {
  // Which group the combined picker is adding to (null = closed).
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const metaOf = new Map<string, { name: string; color: string }>();
  for (const p of teamA.players) metaOf.set(p.id, { name: p.name, color: teamA.color });
  for (const p of teamB.players) metaOf.set(p.id, { name: p.name, color: teamB.color });

  const assigned = assignedIds(groups);

  const addGroup = () => onChange(addGroupOp(groups));
  const removeGroup = (i: number) => onChange(removeGroupOp(groups, i));
  const removePlayer = (gi: number, uid: string) => onChange(removePlayerOp(groups, gi, uid));
  const addPlayer = (gi: number, uid: string) => onChange(assignPlayer(groups, gi, uid));

  return (
    <div className="flex flex-col" data-testid="rack-group-builder">
      {groups.map((g, i) => (
        // Hairline-separated group sections (the 2v2 match-builder pattern) — no
        // nested filled card, so player chips (card-raised) sit cleanly on whatever
        // surface hosts the builder (the settings accordion panel).
        <div
          key={i}
          style={{
            paddingTop: i === 0 ? 0 : 12,
            marginTop: i === 0 ? 0 : 12,
            borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)",
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", color: "var(--color-bt-text-dim)" }}>GROUP {i + 1}</span>
            <button
              type="button"
              onClick={() => removeGroup(i)}
              aria-label={`Remove group ${i + 1}`}
              className="flex items-center justify-center"
              style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          </div>

          {g.length > 0 && (
            <div className="flex flex-col gap-1.5" style={{ marginBottom: 10 }}>
              {g.map((uid) => {
                const meta = metaOf.get(uid);
                return (
                  <div key={uid} className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <PlayerChip name={meta?.name ?? "Player"} teamColor={meta?.color ?? null} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePlayer(i, uid)}
                      aria-label={`Remove ${meta?.name ?? "player"}`}
                      className="flex items-center justify-center"
                      style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)" }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {g.length < MAX_PER_GROUP && (
            <button
              type="button"
              onClick={() => setPickerFor(i)}
              className="flex w-full items-center justify-center gap-1.5"
              style={{ height: 44, borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              <Plus size={15} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>Add player</span>
            </button>
          )}
        </div>
      ))}

      {groups.length < MAX_GROUPS && (
        <button
          type="button"
          onClick={addGroup}
          className="flex w-full items-center justify-center gap-1.5"
          style={{ marginTop: groups.length ? 14 : 0, height: 46, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
        >
          <Plus size={16} /> Add group
        </button>
      )}

      {pickerFor !== null && (
        <CombinedPicker
          teamA={teamA}
          teamB={teamB}
          assigned={assigned}
          groupFull={(groups[pickerFor]?.length ?? 0) >= MAX_PER_GROUP}
          groupNumber={pickerFor + 1}
          onPick={(uid) => addPlayer(pickerFor, uid)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

/**
 * The combined-pool picker — a bottom sheet with BOTH teams as two columns (A left,
 * B right). Available = roster minus everyone already in a group. Tap adds to the
 * open group and the sheet stays up (multi-add up to 4); Done closes.
 *
 * Containing-block gotcha: RackGroupBuilder renders inside the game PANEL, whose
 * host wrapper is `position: fixed; z-index: 30` (CompetitionFace) — a positioned,
 * z-indexed ancestor creates a stacking context that CAPS every descendant
 * z-index, including a `position: fixed` one (fixed escapes LAYOUT, not stacking
 * containment). So this sheet's own z-50 only ever competed against other content
 * INSIDE the z-30 panel — never against the bottom nav (z-40, a sibling outside
 * the panel), which is why it rendered UNDER the nav and covered the bottom row of
 * players. Same fix as AboutModal / FeedbackModal / InfoTileModal: escape via
 * createPortal(..., document.body), which is unaffected by any ancestor's
 * position/z-index/containing-block at all.
 */
function CombinedPicker({
  teamA,
  teamB,
  assigned,
  groupFull,
  groupNumber,
  onPick,
  onClose,
}: {
  teamA: GroupBuilderTeam;
  teamB: GroupBuilderTeam;
  assigned: Set<string>;
  groupFull: boolean;
  groupNumber: number;
  onPick: (uid: string) => void;
  onClose: () => void;
}) {
  const column = (team: GroupBuilderTeam) => {
    const available = team.players.filter((p) => !assigned.has(p.id));
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5" style={{ marginBottom: 8 }}>
          <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: team.color }} />
          <span className="truncate" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text)" }}>{team.name}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {available.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", padding: "6px 2px" }}>All assigned</span>
          ) : (
            available.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={groupFull}
                onClick={() => onPick(p.id)}
                className="flex w-full items-center gap-2 text-left disabled:opacity-40"
                style={{ padding: "8px 10px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <Avatar name={p.name} teamColor={team.color} sizePx={28} />
                <span className="min-w-0 truncate" style={{ fontSize: 14, color: "var(--color-bt-text)" }}>{p.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  };

  // SSR guard (matches AboutModal/FeedbackModal/InfoTileModal) — document is
  // undefined on the server; this component only ever mounts client-side anyway
  // (behind pickerFor !== null, a client interaction), so this never actually
  // renders null in practice.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ background: "var(--color-bt-card-float)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px 24px", maxHeight: "75vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>Add to Group {groupNumber}</span>
          <button type="button" onClick={onClose} style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-accent)" }}>Done</button>
        </div>
        {groupFull && (
          <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 10 }}>
            This group is full (max 4). Remove someone to swap.
          </p>
        )}
        <div className="flex gap-3">
          {column(teamA)}
          {column(teamB)}
        </div>
      </div>
    </div>,
    document.body
  );
}
