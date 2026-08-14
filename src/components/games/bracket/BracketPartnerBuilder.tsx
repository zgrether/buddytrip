"use client";

import { useState } from "react";
import { Shuffle, X } from "lucide-react";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { entrantLabel, pairMembers, shufflePairs, unpairEntrant } from "@/lib/bracketDraft";

/**
 * PARTNER BUILDER — turning the field into pairs. Question 2 of 3.
 *
 * Only rendered when Match Format is Partners. It takes the field as it stands
 * and decides who partners whom; it never changes WHO is in (question 1) and
 * never changes the ORDER (question 3).
 *
 * ── A partner must be on the same cup team ──────────────────────────────────
 * Enforced by construction: the sections below are per team, and a pair can only
 * be made from two chips inside one section. That is the same constraint the old
 * builder expressed as `sameTeamOnly`, and the reason is unchanged — an
 * entrant's team is where its points land, so a cross-team pair has no answer to
 * "whose points are these?".
 *
 * ── "Shuffle pairs" is NOT the seeding constraint ───────────────────────────
 * This button randomly pairs each team's players AMONG THEMSELVES: 8 Manhattans
 * become 4 pairs, 6 become 3. Seeding's "Randomize" is a different operation on
 * a different question — it reorders whole entrants and can be asked to spread
 * teammates apart. The two must not be merged, and are deliberately in separate
 * components reading separate functions (`shufflePairs` vs `shufflePool`).
 *
 * Presentation-only (CLAUDE.md #7).
 */
export function BracketPartnerBuilder({
  pool,
  teams,
  canEdit,
  onChange,
}: {
  pool: string[][];
  teams: GroupBuilderTeam[];
  canEdit: boolean;
  onChange: (next: string[][]) => void;
}) {
  /** The chip waiting for a partner. Tap one, then tap another in the SAME
   *  section to pair them; tap it again to cancel. */
  const [armed, setArmed] = useState<string | null>(null);

  const nameById = new Map<string, string>();
  const teamById = new Map<string, GroupBuilderTeam>();
  for (const t of teams) {
    teamById.set(t.id, t);
    for (const p of t.players) nameById.set(p.id, p.name);
  }
  /** Which team an entrant belongs to — its FIRST member's, the rule the payload
   *  uses when it writes `team_id`. */
  const teamOf = (entrant: string[]) => teams.find((t) => t.players.some((p) => p.id === entrant[0])) ?? null;

  function tapMember(id: string) {
    if (!canEdit) return;
    if (armed === null) return setArmed(id);
    if (armed === id) return setArmed(null);
    onChange(pairMembers(pool, armed, id));
    setArmed(null);
  }

  const unpaired = pool.filter((e) => e.length === 1).length;

  return (
    <div className="flex flex-col" style={{ gap: 12 }} data-testid="bracket-partner-builder">
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          {armed
            ? `Tap a teammate to partner with ${nameById.get(armed) ?? "them"}.`
            : unpaired > 0
              ? `${unpaired} still unpaired — tap two players to pair them.`
              : "Everyone is paired."}
        </p>
        <button
          type="button"
          disabled={!canEdit || pool.length < 2}
          onClick={() => { setArmed(null); onChange(shufflePairs(pool, teams)); }}
          className="flex items-center rounded-lg"
          style={{
            gap: 5, padding: "6px 10px", fontSize: 12, fontWeight: 600,
            background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            opacity: !canEdit || pool.length < 2 ? 0.5 : 1,
          }}
          data-testid="bracket-shuffle-pairs"
        >
          <Shuffle size={12} />
          Shuffle pairs
        </button>
      </div>

      {teams.map((team) => {
        // Entrants belonging to this team, with their index in the pool so an
        // unpair can address the right row.
        const rows = pool
          .map((entrant, index) => ({ entrant, index }))
          .filter(({ entrant }) => teamOf(entrant)?.id === team.id);
        if (rows.length === 0) return null;
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
            </div>

            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {rows.map(({ entrant, index }) =>
                entrant.length > 1 ? (
                  // A made pair — ONE LINE, "Brad & Zach". The X dissolves it.
                  <span
                    key={entrant.join("+")}
                    className="flex items-center rounded-full"
                    style={{
                      gap: 6, padding: "6px 8px 6px 11px", fontSize: 12.5, fontWeight: 650,
                      background: "var(--color-bt-accent-faint)",
                      border: "1px solid var(--color-bt-accent-border)",
                      color: "var(--color-bt-text)",
                    }}
                    data-testid={`bracket-pair-${entrant.join("+")}`}
                  >
                    {entrantLabel(entrant, nameById)}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => { setArmed(null); onChange(unpairEntrant(pool, index)); }}
                      aria-label={`Unpair ${entrantLabel(entrant, nameById)}`}
                      style={{ color: "var(--color-bt-text-dim)", display: "flex" }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ) : (
                  <button
                    key={entrant[0]}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => tapMember(entrant[0])}
                    aria-pressed={armed === entrant[0]}
                    className="rounded-full disabled:cursor-not-allowed"
                    style={{
                      padding: "6px 11px", fontSize: 12.5,
                      fontWeight: armed === entrant[0] ? 650 : 500,
                      background: armed === entrant[0] ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                      border: `1px ${armed === entrant[0] ? "solid var(--color-bt-accent-border)" : "dashed var(--color-bt-border)"}`,
                      color: "var(--color-bt-text)",
                      opacity: canEdit ? 1 : 0.6,
                    }}
                    data-testid={`bracket-unpaired-${entrant[0]}`}
                  >
                    {nameById.get(entrant[0]) ?? "Player"}
                  </button>
                )
              )}
            </div>
          </div>
        );
      })}

      {pool.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          Pick the field first — there is nobody to pair yet.
        </p>
      )}
    </div>
  );
}
