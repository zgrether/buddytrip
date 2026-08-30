"use client";

import { Swords } from "lucide-react";
import { ChecklistRow, type ChecklistRowState } from "@/components/games/ChecklistRow";
import { MatchSetup } from "@/components/games/matchSetup/MatchSetup";
import { allMatchesFilled, filledMatches } from "@/lib/matchDraft";
import { matchRosterValid } from "@/lib/teamRoster";
import type { DraftMatchConfig } from "@/lib/configDraft";

/**
 * The Matches accordion — golf's, extracted rather than reimplemented.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * It lived inline inside `MatchGameView`'s render, unexported: a `ChecklistRow`
 * whose title is always "Matches" (a game can mix 1v1 + 2v2, so a single format
 * name would lie) and whose SUBTITLE is a composition readout — "2 singles ·
 * 1 double · 3 of 3 assigned" — computed from the draft, not authored. Non-golf
 * Matches needed the identical thing, and building a second one would have been
 * the fourth-pairing-implementation mistake one level up: not a duplicate grid
 * this time, but a duplicate SUMMARY of the same grid. The summary is the part
 * worth not re-deriving — it's what makes a mixed lineup legible without
 * expanding the row, and a second hand-written version is how the two read
 * different things for the same draft.
 *
 * ── The three-way state ─────────────────────────────────────────────────
 * `empty` — no matches yet (neutral, not red: a brand-new game isn't an error).
 * `invalid` — some slot unfilled, OR (in a 2-team competition) a filled slot
 *   whose player has since lost their team (`matchRosterValid` — the
 *   dropped-after-paired case, a different question from "is the slot full").
 * `resolved` — every match filled and roster-valid.
 *
 * `twoTeams` gates the roster check — a standalone game has no teams to fall
 * out of, so it is vacuously valid there (mirrors `matchRosterValid`'s own
 * "unfilled → true" contract, one level up).
 *
 * ── What stays with the caller ───────────────────────────────────────────
 * The PLAYER SELECTOR (`PlayerSelector` + its `selector` state) is NOT owned
 * here — golf's own JSX renders it as a sibling, not nested inside this row
 * (it's body-portaled, so DOM position never mattered for layout, but its
 * CREW resolution is per-caller: golf resolves a team's roster one way,
 * non-golf another). `openSelector` is the same callback prop `MatchSetup`
 * itself already takes; this component only forwards it.
 */
export function MatchesAccordionRow({
  draft,
  setDraft,
  nameOf,
  colorOf,
  teamColorOf,
  avatarIconOf,
  teamForSlot,
  maxMatches,
  twoTeams,
  teamedUserIds,
  openSelector,
  expanded,
  onToggle,
  canEdit,
  singlesOnly,
  frozen = false,
  onAddLive,
  addBlockedReason,
}: {
  draft: DraftMatchConfig[];
  setDraft: (fn: (prev: DraftMatchConfig[]) => DraftMatchConfig[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  teamColorOf: (userId: string) => string | undefined;
  avatarIconOf: Map<string, string | null>;
  teamForSlot: (slot: "a" | "b") => { name: string; color: string } | undefined;
  maxMatches: number;
  /** Is this a 2-team competition? Gates the roster-validity half of `invalid` —
   *  a standalone game has no teams to fall out of. */
  twoTeams: boolean;
  /** Every user id that currently has a team — `matchRosterValid`'s own input.
   *  Only consulted when `twoTeams`. */
  teamedUserIds: ReadonlySet<string>;
  openSelector: (matchIdx: number, slot: "a" | "b", memberIdx: number) => void;
  expanded: boolean;
  onToggle: (() => void) | undefined;
  canEdit: boolean;
  singlesOnly?: boolean;
  frozen?: boolean;
  onAddLive?: (playersPerSide: 1 | 2) => void;
  addBlockedReason?: string | null;
}) {
  const filledDraft = filledMatches(draft);
  const allFilled = allMatchesFilled(draft);
  const allRosterValid = !twoTeams || draft.every((d) => matchRosterValid(d.a, d.b, d.playersPerSide, teamedUserIds));

  const singlesCount = draft.filter((d) => d.playersPerSide === 1).length;
  const doublesCount = draft.filter((d) => d.playersPerSide === 2).length;
  const compParts: string[] = [];
  if (singlesCount) compParts.push(`${singlesCount} single${singlesCount > 1 ? "s" : ""}`);
  if (doublesCount) compParts.push(`${doublesCount} double${doublesCount > 1 ? "s" : ""}`);
  const subtitle =
    draft.length === 0
      ? "No matches yet — add one to start"
      : [...compParts, `${filledDraft.length} of ${draft.length} assigned`].join(" · ");
  const state: ChecklistRowState = draft.length === 0 ? "empty" : allFilled && allRosterValid ? "resolved" : "invalid";

  return (
    <ChecklistRow
      icon={Swords}
      title="Matches"
      subtitle={subtitle}
      state={state}
      locked={false}
      expanded={expanded && canEdit}
      onToggle={canEdit ? onToggle : undefined}
      testId="row-matches"
    >
      <MatchSetup
        draft={draft}
        setDraft={setDraft}
        nameOf={nameOf}
        colorOf={colorOf}
        teamColorOf={teamColorOf}
        avatarIconOf={avatarIconOf}
        teamForSlot={teamForSlot}
        maxMatches={maxMatches}
        openSelector={openSelector}
        singlesOnly={singlesOnly}
        frozen={frozen}
        onAddLive={onAddLive}
        addBlockedReason={addBlockedReason}
      />
    </ChecklistRow>
  );
}
