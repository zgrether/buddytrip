"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ListTree, Shuffle, Users } from "lucide-react";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { SegmentedToggle } from "@/components/games/SegmentedToggle";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { shufflePool, entrantCap, type BracketConfig } from "@/lib/bracketDraft";
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
  const [open, setOpen] = useState<null | "entrants" | "pool" | "pairing" | "seeding">(null);
  const [confirmSingles, setConfirmSingles] = useState(false);
  const toggle = (k: "entrants" | "pool" | "pairing" | "seeding") => setOpen((o) => (o === k ? null : k));

  const filled = pool.filter((e) => e.length > 0);
  const size = bracketSize(filled.length);
  const byes = size === 0 ? 0 : size - filled.length;

  /** partners → singles drops every second member, so it goes through the same
   *  confirm the format change does. singles → partners loses nothing. */
  function setEntrants(next: BracketConfig["entrants"]) {
    if (next === config.entrants) return;
    if (next === "singles" && filled.some((e) => e.length > 1)) {
      setConfirmSingles(true);
      return;
    }
    onConfigChange({ ...config, entrants: next });
  }

  return (
    <>
      <ChecklistRow
        icon={Users}
        title="Entrants"
        subtitle={config.entrants === "partners" ? "Pairs" : "Individuals"}
        state="resolved"
        expanded={open === "entrants"}
        onToggle={() => toggle("entrants")}
        testId="row-bracket-entrants"
      >
        <SegmentedToggle
          value={config.entrants}
          options={[
            { value: "singles", label: "Individuals" },
            { value: "partners", label: "Pairs" },
          ]}
          onChange={setEntrants}
          disabled={!canEdit}
          testId="bracket-entrants-toggle"
        />
      </ChecklistRow>

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
        <RackGroupBuilder
          groups={pool}
          onChange={onPoolChange}
          teams={teams}
          // The bracket constraint: an entrant belongs to exactly one cup team,
          // because that is where its points land.
          sameTeamOnly
          maxPerGroup={entrantCap(config)}
        />
      </ChecklistRow>

      <ChecklistRow
        icon={ListTree}
        title="Pairing"
        subtitle="Single elimination"
        state="resolved"
        expanded={open === "pairing"}
        onToggle={() => toggle("pairing")}
        testId="row-bracket-pairing"
      >
        {/* Double elimination is deliberately not offered yet — single ships
            complete first. Shown rather than hidden so the direction is legible,
            matching how the competition-format dropdown lists its unbuilt
            options. */}
        <SegmentedToggle
          value={config.elimination}
          options={[
            { value: "single", label: "Single" },
            { value: "double", label: "Double · soon", disabled: true },
          ]}
          onChange={(next) => onConfigChange({ ...config, elimination: next })}
          disabled={!canEdit}
          testId="bracket-elimination-toggle"
        />
      </ChecklistRow>

      <ChecklistRow
        icon={Shuffle}
        title="Seeding"
        subtitle={
          config.seeding === "manual"
            ? "In the order you built them"
            : config.seeding === "random_avoid_teammates"
              ? "Last shuffled, teammates spread apart"
              : "Last shuffled at random"
        }
        state="resolved"
        expanded={open === "seeding"}
        onToggle={() => toggle("seeding")}
        testId="row-bracket-seeding"
      >
        {/* A one-shot ACTION, not a persisted mode. The draw is a pure function of
            pool ORDER, so randomising IS reordering the pool — press it, see the
            new order, press again if you don't like it. A stored mode would leave
            people guessing when it re-runs, and would stop the draw being derivable
            from the pool alone. `seeding` therefore records how the order was last
            produced; it is not a rule the app re-applies. */}
        <div className="flex flex-col" style={{ gap: 10 }}>
          <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
            Seeds are the order of the field above. Shuffling reorders it now — it doesn&rsquo;t re-run later.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              disabled={!canEdit || filled.length < 2}
              onClick={() => {
                onPoolChange(shufflePool(pool, teams, { avoidTeammates: true }));
                onConfigChange({ ...config, seeding: "random_avoid_teammates" });
              }}
              className="rounded-lg px-3 py-2"
              style={{
                fontSize: 13, fontWeight: 600,
                background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)",
                opacity: !canEdit || filled.length < 2 ? 0.5 : 1,
              }}
              data-testid="bracket-shuffle-avoid"
            >
              Shuffle · spread teammates
            </button>
            <button
              type="button"
              disabled={!canEdit || filled.length < 2}
              onClick={() => {
                onPoolChange(shufflePool(pool, teams, { avoidTeammates: false }));
                onConfigChange({ ...config, seeding: "random" });
              }}
              className="rounded-lg px-3 py-2"
              style={{
                fontSize: 13, fontWeight: 600,
                background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)",
                opacity: !canEdit || filled.length < 2 ? 0.5 : 1,
              }}
              data-testid="bracket-shuffle-random"
            >
              Shuffle
            </button>
          </div>
        </div>
      </ChecklistRow>

      {confirmSingles && (
        <ClearPairingsPrompt
          onCancel={() => setConfirmSingles(false)}
          onConfirm={() => {
            setConfirmSingles(false);
            onPoolChange([]);
            onConfigChange({ ...config, entrants: "singles" });
          }}
        />
      )}
    </>
  );
}
