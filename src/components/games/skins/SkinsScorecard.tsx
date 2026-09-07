"use client";

import { tallyGrouping, type SkinsOutcomeRow } from "@/lib/skins";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { ScorecardChrome, ScorecardLabelCell, CountPill, scorecardPeople } from "../StandardGrid";
import type { TeeRow } from "@/lib/teeRows";
import type { Participant, ScoreUnit } from "../types";

/**
 * SkinsScorecard — one row per player in a grouping, a chip on every hole they
 * won, and the hole's value where nobody did.
 *
 * Renders the SAME `ScorecardChrome` the stroke and outcome cards use — tee
 * selector, yardage / par / stroke-index rows, sticky name column, Glorious
 * treatment, right-edge fade — so a skins card is recognisably the app's
 * scorecard and only the player rows differ.
 *
 * ── The chip is a COUNT, not a lead ───────────────────────────────────────
 *
 * Match play's cell carries `LeadPill`, which is a number and an arrow: it says
 * somebody is N up on somebody else. `CountPill` is the same chip without the
 * arrow, because a skin has no direction. "3" here means three skins were won on
 * this hole, not that its winner is three ahead — and the arrow would assert
 * both a direction and an opponent that a count does not have.
 *
 * ── A tied hole gets a row of its own ─────────────────────────────────────
 *
 * A hole nobody won is the most consequential thing on a skins card, because it
 * is why the next hole is worth more. It cannot live in a player row — no player
 * won it — so it sits under them as a PUSH row carrying the value that rolled.
 * An unplayed hole is blank there, which is the distinction the whole format
 * turns on: blank means "not yet", `—` means "played, nobody took it".
 *
 * Presentation-only (CLAUDE.md #7).
 */
export function SkinsScorecard({
  units,
  players,
  rows,
  groupingId,
  glorious = NO_GLORIOUS,
  tee,
  teeRows = [],
  gameId,
}: {
  units: ScoreUnit[];
  players: Participant[];
  rows: SkinsOutcomeRow[];
  groupingId: string;
  glorious?: GloriousConfig;
  tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null;
  teeRows?: TeeRow[];
  gameId?: string;
}) {
  const tally = tallyGrouping(groupingId, rows, units.length, glorious);
  const byHole = new Map(tally.lines.map((l) => [l.hole, l]));

  return (
    <div>
      <ScorecardChrome units={units} tee={tee} teeRows={teeRows} glorious={glorious} gameId={gameId}>
        {({ cellBase, nameCell, divider, isGloriousCol, gloriousWash }) => (
          <>
            {players.map((p) => (
              <div key={p.id} className="flex items-center" style={{ height: 38 }} data-testid={`skins-card-row-${p.id}`}>
                <ScorecardLabelCell people={scorecardPeople(p)} nameCell={nameCell} />
                {units.map((u, i) => {
                  const line = byHole.get(i + 1);
                  const won = line?.status === "won" && line.winnerId === p.id;
                  return (
                    <div
                      key={u.label}
                      style={{
                        ...cellBase,
                        ...divider(u.label),
                        ...(isGloriousCol(i) ? gloriousWash : {}),
                      }}
                      data-testid={won ? `skins-card-won-${p.id}-${u.label}` : undefined}
                    >
                      {won && <CountPill value={line!.pot} color={p.color} />}
                    </div>
                  );
                })}
                {/* TOTAL — skins won over the round. Unlike match play's card,
                    which dropped its totals because a front-nine lead is not a
                    quantity the format recognises, this one IS additive: skins
                    are counted, and the sum is the player's score. */}
                <div style={{ ...cellBase, fontWeight: 800, color: "var(--color-bt-text)" }} data-testid={`skins-card-total-${p.id}`}>
                  {tally.skinsBy[p.id] ?? 0}
                </div>
              </div>
            ))}

            {/* The PUSH row. Under the players because it is what happened to
                the holes none of them took. */}
            <div
              className="flex items-center"
              style={{ height: 34, borderTop: "1px solid var(--color-bt-subtle-border)" }}
              data-testid="skins-card-push-row"
            >
              <div style={nameCell}>
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-bt-text-dim)" }}>
                  Pushed
                </span>
              </div>
              {units.map((u, i) => {
                const line = byHole.get(i + 1);
                const pushed = line?.status === "tied";
                return (
                  <div
                    key={u.label}
                    style={{
                      ...cellBase,
                      ...divider(u.label),
                      ...(isGloriousCol(i) ? gloriousWash : {}),
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-bt-text-dim)",
                    }}
                    data-testid={pushed ? `skins-card-push-${u.label}` : undefined}
                  >
                    {/* `—` for a played hole nobody won; BLANK for one not yet
                        played. Same number of characters as no mark at all, and
                        a completely different fact. */}
                    {pushed ? "—" : ""}
                  </div>
                );
              })}
              <div
                style={{ ...cellBase, fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}
                data-testid="skins-card-unpaid"
              >
                {/* Only a DEAD pot belongs in a total column: a live carry is
                    still going to be won by somebody, so printing it here would
                    be a number that is about to be wrong. */}
                {tally.potIsDead ? tally.carried : ""}
              </div>
            </div>
          </>
        )}
      </ScorecardChrome>

      {tally.potIsDead && (
        <p
          className="text-center"
          style={{ padding: "12px 10px 2px", fontSize: 13, fontWeight: 700, color: "var(--color-bt-text-dim)" }}
          data-testid="skins-card-dead-pot"
        >
          The last hole was tied — {tally.carried} skin{tally.carried === 1 ? "" : "s"} went unpaid.
        </p>
      )}
    </div>
  );
}
