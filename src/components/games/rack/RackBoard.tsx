"use client";

import { TrendingUp } from "lucide-react";
import { fmtToPar, fmtPoints, type RackMode, type RackSlot, type RackSlotPlayer } from "@/lib/rackNStack";

/**
 * Rack-n-Stack display board (Slice C part 3 + addendum). PURE / display-only —
 * data in via props, no tRPC, no entry behind a slot. Slots are rank-derived
 * readouts (A[k] vs B[k]); the score numbers are net-to-par, the gap is the net
 * margin. Reuses the match-board's outer-edge layout but is a readout, not a
 * control — tapping a slot does nothing.
 *
 * Composed onto the rack page below the team header (`RsDayScore`) and the
 * Groups entry; the board itself is just the toggle + rack + sit-out so it can
 * be reused as the competition leaderboard later.
 */

export interface RackTeam {
  name: string;
  color: string;
}

interface RackBoardProps {
  teamA: RackTeam;
  teamB: RackTeam;
  slots: RackSlot[];
  sitOut: RackSlotPlayer[];
  mode: RackMode;
  onMode: (m: RackMode) => void;
  showProjectedToggle?: boolean;
  nameOf: (id: string) => string;
  variant?: "carded" | "stacked";
  final?: boolean;
}

// ── Team-score header (RsDayScore) — pinned above Groups ─────────────────────
export function RsDayScore({
  teamA,
  teamB,
  pointsA,
  pointsB,
  final,
}: {
  teamA: RackTeam;
  teamB: RackTeam;
  pointsA: number;
  pointsB: number;
  final?: boolean;
}) {
  return (
    <div
      className="flex items-stretch"
      style={{ background: "var(--color-bt-card)", borderBottom: "1px solid var(--color-bt-border)", padding: "14px 16px" }}
    >
      <TeamTotal team={teamA} points={pointsA} align="left" />
      <div className="flex flex-col items-center justify-center" style={{ padding: "0 14px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--color-bt-text-dim)" }}>
          {final ? "FINAL" : "RACK"}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>matches won</span>
      </div>
      <TeamTotal team={teamB} points={pointsB} align="right" />
    </div>
  );
}

function TeamTotal({ team, points, align }: { team: RackTeam; points: number; align: "left" | "right" }) {
  return (
    <div className="flex flex-1 flex-col" style={{ alignItems: align === "left" ? "flex-start" : "flex-end" }}>
      <span className="flex items-center gap-1.5">
        {align === "left" && <Dot color={team.color} />}
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
          {team.name}
        </span>
        {align === "right" && <Dot color={team.color} />}
      </span>
      <span style={{ fontSize: 34, fontWeight: 800, color: "var(--color-bt-text)", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
        {fmtPoints(points)}
      </span>
    </div>
  );
}

// ── The board (toggle + rack + sit-out) ──────────────────────────────────────
export function RackBoard({
  teamA,
  teamB,
  slots,
  sitOut,
  mode,
  onMode,
  showProjectedToggle = true,
  nameOf,
  variant = "stacked",
  final,
}: RackBoardProps) {
  const colorOf = (t: "A" | "B") => (t === "A" ? teamA.color : teamB.color);
  return (
    <div style={{ padding: "12px 12px 20px" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Standings · the rack
        </span>
        {showProjectedToggle && !final && <RsToggle mode={mode} onMode={onMode} />}
      </div>

      {final && (
        <div className="mb-2 flex items-center justify-center rounded-lg" style={{ height: 30, background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-bt-accent)" }}>All in · result locked</span>
        </div>
      )}

      {slots.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", padding: "8px 2px" }}>
          The rack fills in as groups post scores.
        </p>
      ) : variant === "carded" ? (
        <div className="flex flex-col gap-2.5">
          {slots.map((s) => (
            <div key={s.slot} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)" }}>
              <div className="flex items-center" style={{ height: 24, padding: "0 12px", background: "var(--color-bt-card-raised)", borderBottom: "1px solid var(--color-bt-border)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>Slot {s.slot}</span>
              </div>
              <RackRow slot={s} nameOf={nameOf} colorOf={colorOf} />
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)" }}>
          {slots.map((s, i) => (
            <div key={s.slot} className="flex items-stretch" style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)" }}>
              <span className="flex shrink-0 items-center justify-center" style={{ width: 26, fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {s.slot}
              </span>
              <div className="min-w-0 flex-1">
                <RackRow slot={s} nameOf={nameOf} colorOf={colorOf} />
              </div>
            </div>
          ))}
        </div>
      )}

      {sitOut.length > 0 && (
        <div className="mt-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Not part of scoring
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {sitOut.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl px-3"
                style={{ height: 40, border: "1.5px dashed var(--color-bt-border)", opacity: 0.6 }}
              >
                <span className="flex items-center gap-2">
                  <Dot color={colorOf(p.team)} />
                  <span style={{ fontSize: 14, color: "var(--color-bt-text)" }}>{nameOf(p.id)}</span>
                </span>
                <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {fmtToPar(p.value)} · thru {p.thru}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── One slot — inert readout (match-board outer-edge layout) ──────────────────
function RackRow({ slot, nameOf, colorOf }: { slot: RackSlot; nameOf: (id: string) => string; colorOf: (t: "A" | "B") => string }) {
  const aLead = slot.leader === "A";
  const bLead = slot.leader === "B";
  const gap = Math.round(slot.gap);
  return (
    <div className="flex items-stretch" style={{ minHeight: 56 }}>
      <ScoreBlock value={slot.a.value} thru={slot.a.thru} lead={aLead} color={colorOf("A")} />
      <NameBlock name={nameOf(slot.a.id)} align="right" lead={aLead} color={colorOf("A")} gapText={aLead ? `Up by ${gap}` : null} />
      <div className="flex shrink-0 items-center justify-center" style={{ width: 30, background: "var(--color-bt-card-raised)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>vs</span>
      </div>
      <NameBlock name={nameOf(slot.b.id)} align="left" lead={bLead} color={colorOf("B")} gapText={bLead ? `Up by ${gap}` : null} />
      <ScoreBlock value={slot.b.value} thru={slot.b.thru} lead={bLead} color={colorOf("B")} />
    </div>
  );
}

function ScoreBlock({ value, thru, lead, color }: { value: number; thru: number; lead: boolean; color: string }) {
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center"
      style={{ width: 64, background: lead ? color : "transparent" }}
    >
      <span style={{ fontSize: 24, fontWeight: 800, color: lead ? "#fff" : "var(--color-bt-text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {fmtToPar(value)}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: lead ? "rgba(255,255,255,0.85)" : "var(--color-bt-text-dim)", marginTop: 3 }}>
        THRU {thru}
      </span>
    </div>
  );
}

function NameBlock({ name, align, lead, color, gapText }: { name: string; align: "left" | "right"; lead: boolean; color: string; gapText: string | null }) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col justify-center"
      style={{ padding: "0 10px", alignItems: align === "right" ? "flex-end" : "flex-start", background: lead ? `${color}29` : "transparent" }}
    >
      <span className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{name}</span>
      {gapText && <span style={{ fontSize: 11.5, fontWeight: 600, color, marginTop: 1 }}>{gapText}</span>}
    </div>
  );
}

// ── Compact Current/Projected toggle (RsToggle) ──────────────────────────────
export function RsToggle({ mode, onMode }: { mode: RackMode; onMode: (m: RackMode) => void }) {
  const on = mode === "projected";
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>{on ? "Projected to 18" : "Current standings"}</span>
      <button
        onClick={() => onMode(on ? "current" : "projected")}
        className="flex items-center gap-1"
        style={{
          padding: "3px 9px",
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: 600,
          border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
          background: on ? "var(--color-bt-accent)" : "transparent",
          color: on ? "#0d1f1a" : "var(--color-bt-text-dim)",
        }}
      >
        <TrendingUp size={13} />
        Projected
      </button>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}
