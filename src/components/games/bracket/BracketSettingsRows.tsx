"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ListTree, Medal, Shuffle, Users } from "lucide-react";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { SegmentedToggle } from "@/components/games/SegmentedToggle";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { BracketFieldPicker } from "./BracketFieldPicker";
import { BracketPartnerBuilder } from "./BracketPartnerBuilder";
import { BracketSeedList } from "./BracketSeedList";
import { shufflePool, type BracketConfig } from "@/lib/bracketDraft";
import { bracketSize, roundCount } from "@/lib/bracket";

/**
 * The bracket's own settings rows — entrants, pool, pairing, seeding.
 *
 * Ordered as the spec sets them out (format · entrants · pool · pairing ·
 * seeding · scoring). Format and scoring are not here: both already exist as
 * shared non-golf rows, and a bracket uses them unchanged rather than growing
 * private copies.
 *
 * Presentation-only (CLAUDE.md #7): every value arrives as a prop and every edit
 * emits through a callback. The parent owns the draft and `save_game_config`
 * owns the write, so nothing here persists.
 */

/**
 * The ONE "this clears the pairings" confirm, shared by the two changes that
 * cause it — switching the format away from Bracket, and switching partners →
 * singles.
 *
 * Shared deliberately rather than written twice. They are the same event from
 * the user's side ("the pool I built is about to go"), and two prompts phrased
 * differently for one consequence is how the pair drifts. Naming the loss is the
 * point: neither change is REFUSED, because someone who picked the wrong format
 * or the wrong entrant size would otherwise have to empty the pool by hand to
 * correct it.
 */
export function ClearPairingsPrompt({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
      data-testid="clear-pairings-prompt"
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>This will clear the pairings</p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--color-bt-text-dim)" }}>
          The entrants you&rsquo;ve built will be removed. Nothing is saved until you press Save, so you can still
          cancel out of it.
        </p>
        <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg px-3 py-2"
            style={{ fontSize: 13, fontWeight: 700, background: "var(--color-bt-danger)", color: "var(--color-bt-base)" }}
            data-testid="clear-pairings-confirm"
          >
            Clear pairings
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BracketSettingsRows({
  config,
  pool,
  teams,
  canEdit,
  onConfigChange,
  onPoolChange,
}: {
  config: BracketConfig;
  /** Entrants in seed order — index 0 is seed 1. */
  pool: string[][];
  /** Team rosters feeding the picker, in display order. */
  teams: GroupBuilderTeam[];
  canEdit: boolean;
  onConfigChange: (next: BracketConfig) => void;
  onPoolChange: (next: string[][]) => void;
}) {
  // Bracket Type and Match Format are inline controls now, so only the three
  // rows with real editors take part in the single-open accordion.
  const [open, setOpen] = useState<null | "pool" | "partners" | "seeding">(null);
  const toggle = (k: "pool" | "partners" | "seeding") => setOpen((o) => (o === k ? null : k));

  const filled = pool.filter((e) => e.length > 0);
  const size = bracketSize(filled.length);
  const byes = size === 0 ? 0 : size - filled.length;
  /** Entrants still standing alone in Partners — the Partners row's own readiness.
   *  A solo entrant is legal (an odd field has one), so this reports rather than
   *  blocks: `bracketFieldReady` is the go-live gate, not this. */
  const unpairedCount = filled.filter((e) => e.length === 1).length;
  /** A 3rd-place match needs semi-finals to lose. `buildDraw` emits one only at
   *  two rounds or more, so below three entrants there is nothing to play off. */
  const consolationPossible = roundCount(filled.length) >= 2;

  /**
   * Switching Match Format costs NOTHING now, in either direction.
   *
   * partners → singles SPLITS every pair into two solo entrants; the field is
   * untouched and only the pairing goes. It used to empty the whole pool behind a
   * confirm, which was the old model showing through: when one builder answered
   * "who's in" and "who partners whom" at once, there was no way to drop the
   * second answer without dropping the first. Separating the questions is exactly
   * what makes this cheap — the field is question 1 and survives a change to
   * question 2.
   *
   * singles → partners leaves everyone solo for the Partner Builder to pair, and
   * never lost anything to begin with.
   */
  function setEntrants(next: BracketConfig["entrants"]) {
    if (next === config.entrants) return;
    if (next === "singles" && filled.some((e) => e.length > 1)) {
      onPoolChange(filled.flatMap((e) => e.map((id) => [id])));
    }
    onConfigChange({ ...config, entrants: next });
  }

  return (
    <>
      {/* BRACKET TYPE — first, and directly beneath Competition Format.
          It is the first question after choosing Bracket, and it used to be
          called "Pairing", which was about to collide head-on with partner
          pairing below. One concept, one word (CLAUDE.md glossary): "pairing"
          now means putting two people together, and the elimination shape is
          the bracket's TYPE.

          Inline like Game State rather than an accordion: it is a two-value
          choice whose whole content is the control, and an accordion that opens
          to reveal one toggle is a tap that buys nothing.

          Double elimination is deliberately shown-but-disabled — single ships
          complete first, and a control that names the direction beats a silent
          absence. */}
      <ChecklistRow
        icon={ListTree}
        title="Bracket Type"
        subtitle={config.elimination === "double" ? "Double elimination" : "Single elimination"}
        state="resolved"
        testId="row-bracket-type"
        control={
          <SegmentedToggle
            value={config.elimination}
            options={[
              { value: "single", label: "Single" },
              { value: "double", label: "Double", disabled: true },
            ]}
            onChange={(next) => onConfigChange({ ...config, elimination: next })}
            disabled={!canEdit}
            testId="bracket-elimination-toggle"
          />
        }
      />

      {/* 3RD-PLACE MATCH — the bracket's other shape question, so it sits with
          Bracket Type rather than down by the payout it affects.

          What it changes is what the bracket can TELL APART, not what it pays:
          the two semi-final losers stop being a tie group and become a real 3rd
          and 4th. With it OFF they tie at 3rd spanning places 3–4 and
          `placementPoints` averages those two values between them — which is
          correct, and is why the 3rd and 4th distribution rows stay present
          either way. Removing them when this is off would zero the two values
          that average, quietly changing what every existing bracket pays its
          semi-finalists.

          Needs semis to lose: `buildDraw` only emits the match at two rounds or
          more. Below that it is shown-but-disabled with the reason, rather than
          vanishing (ChecklistRow's own posture — a setting isn't missing, its
          prerequisite is). */}
      <ChecklistRow
        icon={Medal}
        title="3rd-place match"
        subtitle={
          !consolationPossible
            ? "Needs at least 3 entrants"
            : config.consolation
              ? "The losing semi-finalists play off"
              : "Semi-finalists tie for 3rd"
        }
        state={config.consolation ? "resolved" : "empty"}
        testId="row-bracket-consolation"
        control={
          <SegmentedToggle
            value={config.consolation ? "on" : "off"}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
            ]}
            onChange={(next) => onConfigChange({ ...config, consolation: next === "on" })}
            disabled={!canEdit || !consolationPossible}
            testId="bracket-consolation-toggle"
          />
        }
      />

      {/* MATCH FORMAT — was "Entrants", which collided with "The Field": both
          sound like "who is in", and only one of them is. This row is about the
          SHAPE of a competitor (one person, or two), so it is a format. */}
      <ChecklistRow
        icon={Users}
        title="Match Format"
        subtitle={config.entrants === "partners" ? "Partners" : "Singles"}
        state="resolved"
        testId="row-bracket-entrants"
        control={
          <SegmentedToggle
            value={config.entrants}
            options={[
              { value: "singles", label: "Singles" },
              { value: "partners", label: "Partners" },
            ]}
            onChange={setEntrants}
            disabled={!canEdit}
            testId="bracket-entrants-toggle"
          />
        }
      />

      {/* 1 · THE FIELD — who's in. A selection, and nothing else. */}
      <ChecklistRow
        icon={ListTree}
        title="The Field"
        subtitle={
          filled.length === 0
            ? "Nobody in the draw yet"
            : filled.length < 2
              ? "1 entrant — a draw needs at least 2"
              : `${filled.length} entrants · ${roundCount(filled.length)} rounds${byes > 0 ? ` · ${byes} ${byes === 1 ? "bye" : "byes"}` : ""}`
        }
        state={filled.length >= 2 ? "resolved" : "empty"}
        expanded={open === "pool"}
        onToggle={() => toggle("pool")}
        testId="row-bracket-pool"
      >
        <BracketFieldPicker pool={pool} teams={teams} canEdit={canEdit} onChange={onPoolChange} />
      </ChecklistRow>

      {/* 2 · PARTNERS — only when there are pairs to build. Absent in Singles
          rather than scrimmed: `ChecklistRow`'s own guidance is that a row the
          format simply doesn't have stays away, because a permanently-dead row
          is worse than a hidden one. */}
      {config.entrants === "partners" && (
        <ChecklistRow
          icon={Users}
          title="Partners"
          subtitle={
            filled.length === 0
              ? "Pick the field first"
              : unpairedCount === 0
                ? `${filled.length} pairs`
                : `${unpairedCount} still unpaired`
          }
          state={filled.length > 0 && unpairedCount === 0 ? "resolved" : "empty"}
          expanded={open === "partners"}
          onToggle={() => toggle("partners")}
          testId="row-bracket-partners"
        >
          <BracketPartnerBuilder pool={pool} teams={teams} canEdit={canEdit} onChange={onPoolChange} />
        </ChecklistRow>
      )}

      {/* 3 · SEEDING — the order. Randomize records HOW the order was last
          produced (`config.seeding`); it is not a rule the app re-applies, which
          is why the teammate question is asked on the button rather than stored. */}
      <ChecklistRow
        icon={Shuffle}
        title="Seeding"
        subtitle={
          config.seeding === "manual"
            ? "In the order you set"
            : config.seeding === "random_avoid_teammates"
              ? "Last randomized, teammates spread"
              : "Last randomized"
        }
        state="resolved"
        expanded={open === "seeding"}
        onToggle={() => toggle("seeding")}
        testId="row-bracket-seeding"
      >
        <BracketSeedList
          pool={pool}
          teams={teams}
          canEdit={canEdit}
          onChange={(next) => {
            onPoolChange(next);
            // A hand-dragged order is a manual one, whatever produced it before.
            onConfigChange({ ...config, seeding: "manual" });
          }}
          onRandomize={(spread) => {
            onPoolChange(shufflePool(pool, teams, { avoidTeammates: spread }));
            onConfigChange({ ...config, seeding: spread ? "random_avoid_teammates" : "random" });
          }}
        />
      </ChecklistRow>

    </>
  );
}
