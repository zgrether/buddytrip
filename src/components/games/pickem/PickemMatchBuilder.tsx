"use client";

import { Shuffle } from "lucide-react";
import { MatchSetup, PlayerSelector } from "@/components/games/matchSetup/MatchSetup";
import { PickemMismatchNote } from "./PickemMismatchNote";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { liveMatchPointsPerMatch } from "@/lib/pointsDistribution";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

/**
 * Pick'em's pairing, in settings — the SHARED match-play builder plus the two
 * controls pick'em adds.
 *
 * ── It is the golf builder, not one that looks like it ─────────────────────
 *
 * A bespoke grid was written for pick'em because Phase 0 concluded "no
 * cross-team pairing exists anywhere in the app". That was false when written,
 * and `PlayerSelector`'s own comment is the evidence: the pool is bound to one
 * team per side, so "a cross-team pair can't be built" — which is precisely
 * pick'em's shape, two rosters with one person from each.
 *
 * The requirement that settled it was parity: if the two must be
 * indistinguishable, duplication stops paying. Being private to a 3,332-line
 * component was a reason to EXTRACT, not a reason to duplicate.
 *
 * ── What is pick'em's, and stays here ──────────────────────────────────────
 *
 * Randomize and Clear have no golf equivalent — match play pairs by hand
 * because the pairing IS the negotiation. Pick'em zips two rosters, so a
 * one-tap shuffle is worth having. They live in this wrapper rather than as two
 * more flags on the shared component: they are additions, not suppressions, and
 * the shared component should not grow options for one caller's convenience.
 *
 * The divisor line is here for the same reason — what each match is worth is a
 * pick'em framing, and match play states it elsewhere.
 */

export interface BuilderTeam {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
}

/** An empty pairing, one row per person on the SMALLER side. */
function emptyRows(a: string[], b: string[]): DraftMatchConfig[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({
    matchNumber: i + 1,
    playersPerSide: 1 as const,
    a: [],
    b: [],
    handicap: 0,
    pointValue: null,
  }));
}

/** Zip the two rosters in a shuffled order — a pairing, not a suggestion. */
function randomize(a: string[], b: string[]): DraftMatchConfig[] {
  const shuffle = (xs: string[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sa = shuffle(a);
  const sb = shuffle(b);
  const n = Math.max(sa.length, sb.length);
  return Array.from({ length: n }, (_, i) => ({
    matchNumber: i + 1,
    playersPerSide: 1 as const,
    // A ragged pair of rosters leaves the last rows half-filled rather than
    // dropping people: someone with no opponent is a state the runner needs to
    // SEE, and the pairing grid shows it as an empty slot.
    a: sa[i] ? [sa[i]] : [],
    b: sb[i] ? [sb[i]] : [],
    handicap: 0,
    pointValue: null,
  }));
}

export function PickemMatchBuilder({
  draft,
  setDraft,
  teams,
  nameMap,
  colorMap,
  avatarIconMap,
  teamColorOf,
  teamForSlot,
  canEdit,
  pointsTotal,
  selector,
  setSelector,
}: {
  draft: DraftMatchConfig[];
  setDraft: (fn: (prev: DraftMatchConfig[]) => DraftMatchConfig[]) => void;
  teams: BuilderTeam[];
  nameMap: Map<string, string>;
  colorMap: Map<string, string>;
  avatarIconMap: Map<string, string | null>;
  teamColorOf: (userId: string) => string | undefined;
  teamForSlot: (slot: "a" | "b") => { id: string; name: string; color: string } | undefined;
  canEdit: boolean;
  pointsTotal: number | null;
  selector: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null;
  setSelector: (s: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null) => void;
}) {
  const [a, b] = teams;
  if (!a || !b) return null;

  const valid = draft.filter((m) => m.a.length > 0 && m.b.length > 0).length;
  const perMatch = liveMatchPointsPerMatch(
    pointsTotal,
    draft.map((m) => ({
      sideAId: m.a[0] ?? null,
      sideBId: m.b[0] ?? null,
      pointValue: m.pointValue,
    }))
  );

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-match-builder">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <span style={EYEBROW}>Matches</span>
        <span
          data-testid="pickem-matches-divisor"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {valid === 0
            ? "Nobody paired yet"
            : `${valid} match${valid === 1 ? "" : "es"} · ${perMatch.toFixed(2)} pts each`}
        </span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2 px-1">
          <button
            type="button"
            onClick={() => {
              setDraft(() => randomize(a.memberIds, b.memberIds));
              setSelector(null);
            }}
            data-testid="pickem-randomize"
            className="flex items-center gap-1.5 rounded-lg px-3"
            style={{
              minHeight: 36,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 600,
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          >
            <Shuffle size={14} /> Randomize
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(() => emptyRows(a.memberIds, b.memberIds));
              setSelector(null);
            }}
            data-testid="pickem-clear-matches"
            className="rounded-lg px-3"
            style={{
              minHeight: 36,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 600,
              background: "transparent",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/*
        WHERE THE RUNNER CAN ACT. This was absent here for two PRs: moving the
        builder to the shared `MatchSetup` left the note behind on the
        read-only post-lock display, so the warning rendered where nothing could
        be done about it and not where the pairing happens.
      */}
      <PickemMismatchNote
        pairs={draft.map((m) => ({ a: m.a[0] ?? null, b: m.b[0] ?? null }))}
        teams={[a, b]}
        nameOf={(id) => nameMap.get(id) ?? "Unknown"}
        actionable
      />

      <MatchSetup
        draft={draft}
        setDraft={setDraft}
        nameOf={nameMap}
        colorOf={colorMap}
        teamColorOf={teamColorOf}
        avatarIconOf={avatarIconMap}
        teamForSlot={teamForSlot}
        // One row per person on the larger side. Beyond that there is nobody
        // left to pair, so the ceiling is the roster rather than a constant.
        maxMatches={Math.max(a.memberIds.length, b.memberIds.length)}
        openSelector={(matchIdx, slot, memberIdx) =>
          setSelector({ matchIdx, slot, memberIdx })
        }
        // THE one suppression: a pick'em match is one sheet against one sheet,
        // so "Add doubles" would offer a shape the format cannot score.
        singlesOnly
      />

      {selector && (
        <PlayerSelector
          matchIdx={selector.matchIdx}
          slot={selector.slot}
          memberIdx={selector.memberIdx}
          sided
          teamLabel={teamForSlot(selector.slot)?.name}
          teamColor={teamForSlot(selector.slot)?.color}
          draft={draft}
          // The pool is THIS side's roster, which is what makes a cross-team
          // pair unbuildable rather than merely discouraged.
          crew={selector.slot === "a" ? a.memberIds : b.memberIds}
          nameOf={nameMap}
          onPick={(userId) => {
            setDraft((prev) =>
              prev.map((m, i) =>
                i === selector.matchIdx ? { ...m, [selector.slot]: [userId] } : m
              )
            );
            setSelector(null);
          }}
          onClose={() => setSelector(null)}
        />
      )}
    </div>
  );
}
