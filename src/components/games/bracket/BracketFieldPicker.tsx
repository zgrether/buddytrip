"use client";

import { Check } from "lucide-react";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { applyField, fieldMembers } from "@/lib/bracketDraft";

/**
 * THE FIELD — who is in. Question 1 of 3.
 *
 * A SELECTION, and nothing else: no ordering, no pairing, no matches, no
 * capacity. Toggle a player on, toggle them off.
 *
 * ── Why this is not `RackGroupBuilder` ──────────────────────────────────────
 * The field used to be built with the rack group builder, and that was the root
 * mistake this rework undoes. A group is a CONTAINER YOU FILL; a field is a
 * SELECTION. Reusing the container asked people to build matches at the moment
 * they should have been picking who was in, and the symptoms followed directly
 * from the mismatch rather than being separate bugs:
 *
 *   - it announced "This group is full (max 4). Remove someone to swap" after a
 *     single pick, because `maxPerGroup` was the entrant cap (1 or 2) and the
 *     builder read that as a container closing;
 *   - the first "group" was short two, because a field of N was being rendered
 *     as containers of 2;
 *   - and Seeding then offered to shuffle MATCHES, which is meaningless — either
 *     you seed randomly or you order manually and the matches follow.
 *
 * None of those are patched here. They are gone because the concept they came
 * from is: there is no group, so there is no "group is full".
 *
 * ── Only players on a cup team are offered ──────────────────────────────────
 * A bracket entrant's team is where its points land, and the server refuses a
 * null-team entrant outright ("a bracket needs a cup to score into"). `teams`
 * arrives already filtered to team members (`pickerTeams`), so this shapes the
 * options rather than refusing the tap — the same posture the old builder's
 * `sameTeamOnly` took.
 *
 * Presentation-only (CLAUDE.md #7): every value arrives as a prop, every edit
 * emits through `onChange`. The parent owns the draft; `save_game_config` owns
 * the write.
 */
export function BracketFieldPicker({
  pool,
  teams,
  canEdit,
  onChange,
}: {
  /** The field, as entrants in seed order. Read only for WHO is in it. */
  pool: string[][];
  teams: GroupBuilderTeam[];
  canEdit: boolean;
  onChange: (next: string[][]) => void;
}) {
  const selected = new Set(fieldMembers(pool));
  /** Everyone selectable, in the roster order the sections are drawn in — the
   *  order additions are appended in, so "Everyone" builds a predictable field. */
  const everyone = teams.flatMap((t) => t.players.map((p) => p.id));
  const allIn = everyone.length > 0 && everyone.every((id) => selected.has(id));

  function toggle(id: string) {
    // Rebuild the selection in ROSTER order rather than tap order, so a field
    // assembled by tapping and one assembled with "Everyone" come out the same.
    const next = selected.has(id)
      ? everyone.filter((x) => x !== id && selected.has(x))
      : everyone.filter((x) => x === id || selected.has(x));
    onChange(applyField(pool, next));
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }} data-testid="bracket-field-picker">
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          {selected.size === 0
            ? "Tap the players who are in."
            : `${selected.size} in the field`}
        </p>
        <button
          type="button"
          disabled={!canEdit || everyone.length === 0}
          onClick={() => onChange(applyField(pool, allIn ? [] : everyone))}
          className="rounded-lg px-2.5 py-1.5"
          style={{
            fontSize: 12,
            fontWeight: 600,
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            opacity: !canEdit || everyone.length === 0 ? 0.5 : 1,
          }}
          data-testid="bracket-field-everyone"
        >
          {allIn ? "Clear" : "Everyone"}
        </button>
      </div>

      {teams.map((team) => {
        const inTeam = team.players.filter((p) => selected.has(p.id)).length;
        return (
          <div key={team.id} className="flex flex-col" style={{ gap: 7 }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <i style={{ width: 7, height: 7, borderRadius: "50%", background: team.color, flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em",
                  fontWeight: 700, color: "var(--color-bt-text-dim)",
                }}
              >
                {team.name}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)", marginLeft: "auto" }}>
                {inTeam}/{team.players.length}
              </span>
            </div>
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {team.players.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggle(p.id)}
                    aria-pressed={on}
                    className="flex items-center rounded-full disabled:cursor-not-allowed"
                    style={{
                      gap: 5,
                      padding: "6px 11px",
                      fontSize: 12.5,
                      fontWeight: on ? 650 : 500,
                      background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                      border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                      color: "var(--color-bt-text)",
                      opacity: canEdit ? 1 : 0.6,
                    }}
                    data-testid={`bracket-field-player-${p.id}`}
                  >
                    {on && <Check size={11} strokeWidth={3} style={{ color: "var(--color-bt-accent)" }} />}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {teams.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          Nobody is on a cup team yet — a bracket entrant needs a team for its points to land in.
        </p>
      )}
    </div>
  );
}
