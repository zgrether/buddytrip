"use client";

import { pairingMismatch, type PickemPair } from "@/lib/pickemPairing";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Where the pairing and the rosters disagree, said out loud.
 *
 * ── Why this is its own file now ───────────────────────────────────────────
 *
 * It lived inside `PickemMatchesPanel` — the read-only post-lock pairing grid,
 * since deleted, whose job the board's match cards now do. Moving the BUILDER
 * to the shared
 * `MatchSetup` left it behind, so it kept rendering on the read-only post-lock
 * display — where it is too late to act on — and vanished from the surface
 * where the runner actually pairs.
 *
 * Two surfaces disagreeing about the same person, one of them the wrong one to
 * be right on. Same shape as the generic-"Player" bug, and both arrived from
 * the same extraction: it moved the control and left its warning behind.
 *
 * ── `actionable` is not a style flag ───────────────────────────────────────
 *
 * The builder can fix these; the post-lock display cannot. "Swap them out for
 * someone on the roster" is a correct instruction beside a pairing grid and a
 * lie beside a locked one — a message naming an action the reader cannot take,
 * which is the class that cost a session in Phase 7.
 *
 * So the same facts get two voices: an instruction where there is a control,
 * and a plain statement where there is not.
 */

export interface MismatchTeam {
  id: string;
  name: string;
  memberIds: string[];
}

/** "Rob", "Rob and Ty", "Rob, Ty and Frank" — reads as a sentence, not a list. */
function names(list: string[]): string {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function PickemMismatchNote({
  pairs,
  teams,
  nameOf,
  actionable,
}: {
  pairs: PickemPair[];
  teams: [MismatchTeam, MismatchTeam];
  nameOf: (id: string) => string;
  /**
   * True where the reader can DO something about it — the pairing grid in
   * settings. False on the read-only display, which states the same facts
   * without instructing.
   */
  actionable: boolean;
}) {
  const [a, b] = teams;
  const { offRoster, unpaired, unevenBy, largerSide } = pairingMismatch(
    pairs,
    a.memberIds,
    b.memberIds
  );
  const lines: string[] = [];

  if (offRoster.length > 0) {
    const who = names(offRoster.map(nameOf).sort());
    const is = offRoster.length === 1 ? "is" : "are";
    lines.push(
      actionable
        ? `${who} ${is} paired but no longer on either team — ` +
          `${offRoster.length === 1 ? "swap them" : "swap them out"} for someone on the roster.`
        : `${who} ${is} paired but no longer on either team.`
    );
  }

  if (unpaired.length > 0) {
    const who = names(unpaired.map(nameOf).sort());
    const is = unpaired.length === 1 ? "is" : "are";
    // Already a statement rather than an instruction, so it reads correctly on
    // both surfaces — "yet" is the only word doing tense work, and it is true
    // in both: a locked game's pairing can still be changed in settings.
    lines.push(`${who} ${is} on a team but not in a match yet.`);
  }

  if (unevenBy > 0 && largerSide != null) {
    const big = teams[largerSide];
    const small = teams[largerSide === 0 ? 1 : 0];
    lines.push(
      `${big.name} has ${big.memberIds.length} and ${small.name} has ${small.memberIds.length}, ` +
        `so ${unevenBy === 1 ? "one player" : `${unevenBy} players`} will have no opponent.`
    );
  }

  if (lines.length === 0) return null;

  return (
    <div
      data-testid="pickem-pairing-mismatch"
      className="flex flex-col gap-1 rounded-xl px-3 py-2.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        lineHeight: 1.5,
        color: "var(--color-bt-text-dim)",
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}
