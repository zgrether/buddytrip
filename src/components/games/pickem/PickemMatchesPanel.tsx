"use client";

import { useMemo, useState } from "react";
import { Shuffle, X } from "lucide-react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import {
  assignToSlot,
  emptyPairs,
  isValidPair,
  pairedMembers,
  randomizePairs,
  validPairCount,
  type PickemPair,
} from "@/lib/pickemPairing";
import { liveMatchPointsPerMatch } from "@/lib/pointsDistribution";

/**
 * Who plays whom — pick'em's matches.
 *
 * ── A field is a SELECTION; this is the pairing that follows ───────────────
 *
 * `BracketFieldPicker` draws the distinction and it is the right one, but
 * pick'em collapses the two steps rather than splitting them: the field IS the
 * set of people in a slot, because pairing across two fixed rosters means
 * "who's in" and "who's against whom" are answered by the same tap. Someone in
 * no slot is out; the dashed row is what makes that visible before committing.
 *
 * Phase 0 found no cross-team pairing anywhere in the app, so the grid is new —
 * match play pairs within one roster, brackets seed one pool. What is reused is
 * everything underneath: the sides land in `game_matches` in the shape
 * `matches.setPairings` writes, and the divisor is the shared one.
 *
 * ── Presentational (CLAUDE.md #7) ─────────────────────────────────────────
 *
 * No tRPC. Values in, edits out through `onSave`. The parent owns persistence.
 */

export interface PickemTeam {
  id: string;
  name: string;
  shortName: string;
  color: string;
  memberIds: string[];
}

export function PickemMatchesPanel({
  teams,
  nameOf,
  pairs: serverPairs,
  pointsTotal,
  canEdit,
  saving,
  onSave,
}: {
  /** The cup's sides. Pick'em pairs the FIRST against the SECOND. */
  teams: PickemTeam[];
  nameOf: (userId: string) => string;
  /** The saved pairing. */
  pairs: PickemPair[];
  pointsTotal: number | null;
  canEdit: boolean;
  saving: boolean;
  onSave: (pairs: PickemPair[]) => void;
}) {
  const [a, b] = teams;
  const serverKey = useMemo(() => JSON.stringify(serverPairs), [serverPairs]);

  /**
   * The draft, stamped with the server state it diverged from — the same shape
   * the sheet uses, and for the same reason: a landed save moves the key and
   * the draft falls away on the next render, with no effect to get wrong.
   */
  const [edit, setEdit] = useState<{ base: string; pairs: PickemPair[] } | null>(null);
  const working = edit && edit.base === serverKey ? edit.pairs : null;

  const pairs = working ?? (serverPairs.length > 0
    ? serverPairs
    : emptyPairs(a?.memberIds.length ?? 0, b?.memberIds.length ?? 0));

  const setPairs = (next: PickemPair[]) => setEdit({ base: serverKey, pairs: next });

  /** Which slot is waiting for a name. Tap a slot, tap a person. */
  const [target, setTarget] = useState<{ index: number; side: "a" | "b" } | null>(null);

  const placed = pairedMembers(pairs);
  const valid = validPairCount(pairs);
  const perMatch = liveMatchPointsPerMatch(
    pointsTotal,
    pairs.map((p) => ({ sideAId: p.a, sideBId: p.b, pointValue: null }))
  );
  const dirty = working != null && JSON.stringify(working) !== serverKey;

  if (teams.length < 2) {
    return (
      <Note>
        Matches need two teams. Add them in the cup&rsquo;s settings and the pairing grid
        appears here.
      </Note>
    );
  }

  const choose = (userId: string) => {
    if (!target) return;
    setPairs(assignToSlot(pairs, target.index, target.side, userId));
    setTarget(null);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="pickem-matches-panel">
      {/* The divisor, stated where the pairing happens. §11's look asks whether
          it visibly moves as people are paired and unpaired — so it is here
          rather than only in settings, and it counts VALID matches. */}
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
              setPairs(randomizePairs(a.memberIds, b.memberIds));
              setTarget(null);
            }}
            disabled={saving}
            data-testid="pickem-randomize"
            className="flex items-center gap-1.5 rounded-lg px-3 disabled:opacity-40"
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
              setPairs(emptyPairs(a.memberIds.length, b.memberIds.length));
              setTarget(null);
            }}
            disabled={saving}
            data-testid="pickem-clear-matches"
            className="rounded-lg px-3 disabled:opacity-40"
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

      <div className="flex gap-2 px-1">
        <TeamHeading team={a} />
        <span style={{ width: 24 }} />
        <TeamHeading team={b} />
      </div>

      <div className="flex flex-col gap-1.5">
        {pairs.map((p, i) => (
          <MatchRow
            key={i}
            pair={p}
            nameOf={nameOf}
            canEdit={canEdit}
            target={target?.index === i ? target.side : null}
            onTapSlot={(side) => setTarget(target?.index === i && target.side === side ? null : { index: i, side })}
            onClear={(side) => setPairs(assignToSlot(pairs, i, side, null))}
          />
        ))}
      </div>

      {/* The picker appears only when a slot is waiting — a permanent roster
          list beside the grid would double its height on a phone for a control
          that is used in bursts. */}
      {canEdit && target && (
        <NamePicker
          team={target.side === "a" ? a : b}
          nameOf={nameOf}
          placed={placed}
          onPick={choose}
          onCancel={() => setTarget(null)}
        />
      )}

      {canEdit && (
        <div className="flex items-center gap-3 px-1">
          <span
            className="flex-1"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button
            type="button"
            onClick={() => onSave(pairs)}
            disabled={saving || !dirty}
            data-testid="pickem-save-matches"
            className="rounded-xl px-4 disabled:opacity-40"
            style={{
              minHeight: 40,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {saving ? "Saving…" : "Save matches"}
          </button>
        </div>
      )}
    </div>
  );
}

function TeamHeading({ team }: { team: PickemTeam }) {
  return (
    <span
      className="min-w-0 flex-1 truncate"
      style={{ ...EYEBROW, color: team.color }}
      title={team.name}
    >
      {team.name}
    </span>
  );
}

/**
 * One match. An UNPAIRED row is DASHED, not red (§4): sitting someone out is
 * legitimate and the runner should see it before committing — red would read as
 * an error to fix rather than a decision to confirm.
 */
function MatchRow({
  pair,
  nameOf,
  canEdit,
  target,
  onTapSlot,
  onClear,
}: {
  pair: PickemPair;
  nameOf: (id: string) => string;
  canEdit: boolean;
  target: "a" | "b" | null;
  onTapSlot: (side: "a" | "b") => void;
  onClear: (side: "a" | "b") => void;
}) {
  const complete = isValidPair(pair);
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-2.5 py-2"
      data-testid="pickem-match-row"
      data-complete={complete ? "true" : "false"}
      style={{
        background: complete ? "var(--color-bt-card)" : "transparent",
        border: complete
          ? "1px solid var(--color-bt-border)"
          : "1px dashed var(--color-bt-border)",
      }}
    >
      <Slot
        userId={pair.a}
        nameOf={nameOf}
        canEdit={canEdit}
        selected={target === "a"}
        onTap={() => onTapSlot("a")}
        onClear={() => onClear("a")}
        testId="pickem-slot-a"
      />
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-bt-text-dim)", flex: "none" }}>
        VS
      </span>
      <Slot
        userId={pair.b}
        nameOf={nameOf}
        canEdit={canEdit}
        selected={target === "b"}
        onTap={() => onTapSlot("b")}
        onClear={() => onClear("b")}
        align="right"
        testId="pickem-slot-b"
      />
    </div>
  );
}

function Slot({
  userId,
  nameOf,
  canEdit,
  selected,
  onTap,
  onClear,
  align = "left",
  testId,
}: {
  userId: string | null;
  nameOf: (id: string) => string;
  canEdit: boolean;
  selected: boolean;
  onTap: () => void;
  onClear: () => void;
  align?: "left" | "right";
  testId: string;
}) {
  const filled = userId != null;
  return (
    <span
      className={`flex min-w-0 flex-1 items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
    >
      <button
        type="button"
        onClick={onTap}
        disabled={!canEdit}
        data-testid={testId}
        data-filled={filled ? "true" : "false"}
        className="min-w-0 truncate rounded-lg px-2 py-1.5 text-left"
        style={{
          minHeight: 36,
          fontSize: TYPE_SCALE.bodyDense,
          fontWeight: filled ? 600 : 500,
          fontStyle: filled ? undefined : "italic",
          color: filled ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
          background: selected ? "var(--color-bt-accent-faint)" : "transparent",
          border: selected ? "1px solid var(--color-bt-accent-border)" : "1px solid transparent",
        }}
      >
        {filled ? nameOf(userId as string) : canEdit ? "tap to assign" : "—"}
      </button>
      {filled && canEdit && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear slot"
          className="flex-none rounded p-1"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}

/** The roster for one side. Someone already in a slot is shown struck through
 *  rather than hidden — a runner scanning for a name should find it and see
 *  that it is taken, not wonder whether they misremembered the roster. */
function NamePicker({
  team,
  nameOf,
  placed,
  onPick,
  onCancel,
}: {
  team: PickemTeam;
  nameOf: (id: string) => string;
  placed: Set<string>;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      data-testid="pickem-name-picker"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-accent-border)" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span style={{ ...EYEBROW, color: team.color }}>{team.name}</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded p-1"
          aria-label="Cancel"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {team.memberIds.map((id) => {
          const taken = placed.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              data-testid="pickem-name-option"
              data-taken={taken ? "true" : "false"}
              className="rounded-lg px-2.5"
              style={{
                minHeight: 34,
                fontSize: TYPE_SCALE.bodyDense,
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: taken ? "var(--color-bt-text-dim)" : "var(--color-bt-text)",
                textDecoration: taken ? "line-through" : undefined,
                opacity: taken ? 0.55 : 1,
              }}
            >
              {nameOf(id)}
            </button>
          );
        })}
        {team.memberIds.length === 0 && (
          <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
            Nobody is on this team yet.
          </span>
        )}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-xl px-3 py-2.5"
      data-testid="pickem-matches-note"
      style={{
        fontSize: TYPE_SCALE.caption,
        color: "var(--color-bt-text-dim)",
        lineHeight: 1.5,
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      {children}
    </p>
  );
}
