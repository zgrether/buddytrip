"use client";

import { useState } from "react";
import { ChevronLeft, Table2, Equal } from "lucide-react";
import { buildDecidedFromOutcomes, matchState, type HoleOutcomeResult } from "@/lib/matchPlay";
import { NO_GLORIOUS, isGloriousHole, type GloriousConfig } from "@/lib/gloriousHoles";
import { MatchCard } from "./MatchCard";
import { HoleProgress, NavArrow, BottomCTA } from "./entryChrome";
import { Avatar } from "@/components/Avatar";
import { UnsavedScoresBanner } from "./UnsavedScoresBanner";
import { unconfirmedOnHole, unconfirmedCount, type OutcomeValues, type SaveStatusMap } from "./types";
import type { MatchGroupData } from "./MatchEntryView";

/**
 * MatchOutcomeEntryView — the hole-outcome-entry counterpart to `MatchEntryView`
 * (Refactor B2, built to `hole_outcome_entry_mockup.html`). Reuses the SAME
 * scorecard chrome verbatim — app bar, `MatchCard` state band, hole nav, par,
 * Glorious banner, the unsaved-writes banner, the confirmation-gated bottom CTA
 * (`entryChrome`) — only the ENTRY ZONE differs: three stacked player-row-styled
 * choice buttons (side A won / Halved / side B won), tap-to-select, team-colored,
 * ✓, "Reset hole." No number pad — one tap records the whole hole.
 *
 * `strokesA`/`strokesB` on `MatchGroupData` are ignored here (unused — no
 * handicaps in outcome mode; the recorded outcome IS the decision).
 */
interface MatchOutcomeEntryViewProps {
  gameName: string;
  units: { label: string; par?: number }[];
  match: MatchGroupData;
  values: OutcomeValues;
  onChange: (matchId: string, hole: string, result: HoleOutcomeResult) => void;
  onClear?: (matchId: string, hole: string) => void;
  currentHole?: number;
  onHoleChange?: (hole: number) => void;
  onFinish?: () => void;
  onBack?: () => void;
  onOpenGrid?: () => void;
  subtitle?: string;
  finishLabel?: string;
  finishSubtext?: string;
  meId?: string;
  saveStatus?: SaveStatusMap;
  onRetryCell?: (matchId: string, hole: string) => void;
  hideHeader?: boolean;
  glorious?: GloriousConfig;
}

export function MatchOutcomeEntryView({
  gameName,
  units,
  match: m,
  values,
  onChange,
  onClear,
  currentHole,
  onHoleChange,
  onFinish,
  onBack,
  onOpenGrid,
  subtitle,
  finishLabel = "Finish",
  finishSubtext = "Saves results · shows final standings",
  meId,
  saveStatus = {},
  onRetryCell,
  hideHeader = false,
  glorious = NO_GLORIOUS,
}: MatchOutcomeEntryViewProps) {
  const [holeInternal, setHoleInternal] = useState(currentHole ?? 1);
  const hole = currentHole ?? holeInternal;
  const setHole = (h: number) => {
    if (onHoleChange) onHoleChange(h);
    else setHoleInternal(h);
  };
  const goHole = (h: number) => {
    if (h >= 1 && h <= units.length) setHole(h);
  };

  const unit = units[hole - 1];
  const label = unit?.label ?? String(hole);
  const par = unit?.par;
  const holeIsGlorious = isGloriousHole(hole, glorious);

  const outcomeRows = Object.entries(values[m.matchId] ?? {}).map(([h, result]) => ({ hole: Number(h), result }));
  const decided = buildDecidedFromOutcomes(outcomeRows);
  const st = matchState(decided, units.length, glorious);
  const winner = st.leader === "A" ? m.a : st.leader === "B" ? m.b : null;
  const loser = st.leader === "A" ? m.b : st.leader === "B" ? m.a : null;

  const selected = values[m.matchId]?.[label] as HoleOutcomeResult | undefined;

  // ── Save status (Connectivity Layer 1 — same discipline as score entry) ────
  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;
  const retryAll = () => {
    for (const [k, s] of Object.entries(saveStatus)) {
      if (s !== "error") continue;
      const { matchId, holeNumber } = parseKey(k);
      onRetryCell?.(matchId, String(holeNumber));
    }
  };
  const holeGate = unconfirmedOnHole(saveStatus, [m.matchId], label);
  const gameGate = unconfirmedCount(saveStatus);
  const advanceReason = holeGate.errored > 0
    ? "Didn’t save — retry above"
    : holeGate.saving > 0
      ? "Saving…"
      : undefined;
  const finishReason = gameGate.errored > 0
    ? "Some outcomes didn’t save — retry before finishing"
    : gameGate.saving > 0
      ? "Saving…"
      : undefined;

  // Progress + completion — a hole is complete once it HAS a recorded outcome
  // (unlike stroke entry, which needs both players; one tap decides the whole
  // hole here).
  const completedHoleNumbers = units
    .map((u, i) => (values[m.matchId]?.[u.label] != null ? i + 1 : 0))
    .filter((n) => n > 0);
  const currentComplete = selected != null;
  const allHolesComplete = completedHoleNumbers.length === units.length && units.length > 0;
  const canFinish = st.over || allHolesComplete;

  const pick = (result: HoleOutcomeResult) => {
    onChange(m.matchId, label, result);
  };
  const reset = () => {
    onClear?.(m.matchId, label);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      {!hideHeader && (
        <header
          className="flex shrink-0 items-center justify-between"
          style={{
            height: 52,
            padding: "0 12px",
            background: "var(--color-bt-nav-bg)",
            backdropFilter: "blur(14px)",
            borderBottom: "1px solid var(--color-bt-subtle-border)",
          }}
        >
          <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
            <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
          </button>
          <div className="text-center">
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{gameName}</div>
            <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
              {subtitle ?? `Hole ${hole} of ${units.length}`}
            </div>
          </div>
          <button onClick={onOpenGrid} aria-label="Scorecard grid" className="flex h-9 w-9 items-center justify-center">
            <Table2 size={20} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </header>
      )}

      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} />

      {/* Match board — the SAME MatchCard score entry uses, fed from outcome-
          derived DecidedHole[] instead of gross-derived. */}
      <div className="shrink-0" style={{ padding: "12px 12px 0" }}>
        <MatchCard
          a={m.a}
          b={m.b}
          results={decided}
          glorious={glorious}
          label={m.label}
          holeCount={units.length}
          youId={meId}
          leftColor={m.leftColor}
          rightColor={m.rightColor}
          hideFormat
          onScorecard={onOpenGrid}
        />
        {st.over && (
          <div
            className="flex items-center justify-between"
            style={{
              marginTop: 6,
              padding: "7px 12px",
              borderRadius: 10,
              background: "var(--color-bt-place-1-bg)",
              border: "1px solid rgba(34,197,94,0.25)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>
              {winner && loser ? `${winner.name} def. ${loser.name} · ${st.margin}` : `Match halved · ${st.margin}`}
            </span>
          </div>
        )}
      </div>

      {/* Hole navigation — verbatim reuse of entryChrome. */}
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "8px 16px 12px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          {par != null && (
            <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
              Par {par}
            </div>
          )}
          <HoleProgress count={units.length} currentHole={hole} completed={completedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

      {holeIsGlorious && (
        <div
          data-testid="glorious-entry-banner"
          style={{
            margin: "0 16px 10px",
            padding: "8px 12px",
            borderRadius: 10,
            textAlign: "center",
            background: "var(--color-bt-glorious-faint)",
            border: "1px solid var(--color-bt-glorious-border)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-bt-glorious)" }}>
            Glorious Finishing Hole · Worth Double
          </span>
        </div>
      )}

      {/* Entry zone — three stacked player-row-styled choices. No number pad;
          one tap records the whole hole. */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 16px 8px" }}>
        <p
          className="text-center"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)", letterSpacing: "0.02em", margin: "2px 0 10px" }}
        >
          Who won this hole?
        </p>
        <div className="flex flex-col" style={{ gap: 9 }}>
          <Choice
            selected={selected === "side_a"}
            dim={selected != null && selected !== "side_a"}
            color={m.leftColor}
            avatarName={m.a.name}
            avatarIcon={m.a.avatarIcon}
            label={m.a.name}
            sub={selected === "side_a" ? "Won the hole" : undefined}
            onClick={() => pick("side_a")}
            testId="outcome-choice-a"
          />
          <Choice
            selected={selected === "halved"}
            dim={selected != null && selected !== "halved"}
            neutral
            label="Halved"
            sub={selected === "halved" ? "Hole halved" : undefined}
            onClick={() => pick("halved")}
            testId="outcome-choice-halved"
          />
          <Choice
            selected={selected === "side_b"}
            dim={selected != null && selected !== "side_b"}
            color={m.rightColor}
            avatarName={m.b.name}
            avatarIcon={m.b.avatarIcon}
            label={m.b.name}
            sub={selected === "side_b" ? "Won the hole" : undefined}
            onClick={() => pick("side_b")}
            testId="outcome-choice-b"
          />
        </div>
        {selected != null && (
          <button
            type="button"
            onClick={reset}
            className="w-full text-center"
            style={{ padding: 10, fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
            data-testid="outcome-reset-hole"
          >
            Reset hole
          </button>
        )}
      </div>

      {/* Bottom: Next Hole | Finish — confirmation-gated, same idiom as score entry. */}
      {canFinish ? (
        <BottomCTA
          label={finishLabel}
          icon
          onClick={() => onFinish?.()}
          disabled={gameGate.total > 0}
          subtext={finishReason ?? finishSubtext}
        />
      ) : currentComplete && hole < units.length ? (
        <BottomCTA
          label={`Hole ${units[hole]?.label ?? hole + 1} ›`}
          onClick={() => goHole(hole + 1)}
          disabled={holeGate.blocked}
          subtext={advanceReason}
        />
      ) : null}
    </div>
  );
}

function parseKey(key: string): { matchId: string; holeNumber: number } {
  const i = key.indexOf(":");
  return { matchId: key.slice(0, i), holeNumber: Number(key.slice(i + 1)) };
}

/** One outcome choice — a player-row-styled button (avatar-left OR a neutral
 *  glyph for "Halved") + label + a trailing check-circle. Selected = team-colored
 *  wash + border + filled check (or teal for Halved); the other rows dim once
 *  something is picked. */
function Choice({
  selected,
  dim,
  color,
  neutral,
  avatarName,
  avatarIcon,
  label,
  sub,
  onClick,
  testId,
}: {
  selected: boolean;
  dim: boolean;
  color?: string;
  neutral?: boolean;
  avatarName?: string;
  avatarIcon?: string | null;
  label: string;
  sub?: string;
  onClick: () => void;
  testId: string;
}) {
  const tint = neutral ? "var(--color-bt-accent)" : color ?? "var(--color-bt-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 text-left transition-opacity"
      data-testid={testId}
      style={{
        padding: 14,
        borderRadius: 12,
        background: selected ? `color-mix(in srgb, ${tint} 14%, transparent)` : "var(--color-bt-card)",
        border: `1.5px solid ${selected ? tint : "var(--color-bt-border)"}`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {neutral ? (
        <span
          className="flex flex-shrink-0 items-center justify-center"
          style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
        >
          <Equal size={14} />
        </span>
      ) : (
        <Avatar name={avatarName ?? label} avatarIcon={avatarIcon} teamColor={color} sizePx={30} />
      )}
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)", fontWeight: 600 }}>{sub}</div>}
      </div>
      <span
        className="flex flex-shrink-0 items-center justify-center"
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `2px solid ${selected ? tint : "var(--color-bt-border)"}`,
          background: selected ? tint : "transparent",
          color: selected ? "var(--color-bt-on-accent)" : "transparent",
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        ✓
      </span>
    </button>
  );
}
