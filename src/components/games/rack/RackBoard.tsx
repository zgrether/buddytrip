"use client";

import { TrendingUp } from "lucide-react";
import { fmtToPar, type RackMode, type RackSlot, type RackSlotPlayer } from "@/lib/rackNStack";
import { teamTextColor } from "@/lib/teamTextColor";

/**
 * Rack-n-Stack display board (Slice C part 3 + addendum). PURE / display-only —
 * data in via props, no tRPC, no entry behind a slot. Slots are rank-derived
 * readouts (A[k] vs B[k]); the score numbers are net-to-par, the gap is the net
 * margin. Reuses the match-board's outer-edge layout but is a readout, not a
 * control — tapping a slot does nothing.
 *
 * Composed onto the rack page below the Groups entry; the board itself is the
 * "Standings · the rack" label + toggle + rack + sit-out, so it can be reused
 * as the competition leaderboard later. (The old `RsDayScore` team-totals band
 * was removed — the persistent leaderboard hero is the single source of the
 * team standing; the rack body no longer restates it.)
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

// ── The board (label + toggle + rack + sit-out) ──────────────────────────────
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
      {/* Rack uniquely has two body sub-sections — the Groups entry above and
          this standings ladder — so the ladder keeps its own section label to
          orient it against the groups (the redundant element was the team-totals
          band, now removed, not this label). The Current/Projected toggle sits
          on the same row. ("· the rack" suffix removed — W3-Rack1.) */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Standings
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
            <div key={s.slot} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)", background: "var(--color-bt-card)" }}>
              <div className="flex items-center" style={{ height: 24, padding: "0 12px", background: "var(--color-bt-card-raised)", borderBottom: "1px solid var(--color-bt-border)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>Slot {s.slot}</span>
              </div>
              <RackRow slot={s} nameOf={nameOf} colorOf={colorOf} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-stretch">
          {/* Slot numbers float in a left gutter — OUTSIDE the rack border. */}
          <div className="flex shrink-0 flex-col" style={{ width: 22, marginRight: 6 }}>
            {slots.map((s) => (
              <div key={s.slot} className="flex flex-col" style={{ height: ROW_H, paddingTop: TOP_PAD }}>
                <div className="flex items-center justify-center" style={{ height: PRIMARY }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>{s.slot}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-bt-border)", background: "var(--color-bt-card)" }}>
            {slots.map((s, i) => (
              <div key={s.slot} style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)" }}>
                <RackRow slot={s} nameOf={nameOf} colorOf={colorOf} />
              </div>
            ))}
          </div>
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

// Two fixed-height bands keep the PRIMARY line (net-to-par · name · vs · name ·
// net-to-par) on one row and the SECONDARY line (THRU · gap) beneath — so the
// scores, names, and "vs" all sit on the same vertical line.
const TOP_PAD = 6; // breathing room above the score/name
const PRIMARY = 30;
const SECONDARY = 22;
const ROW_H = TOP_PAD + PRIMARY + SECONDARY;

function RackRow({ slot, nameOf, colorOf }: { slot: RackSlot; nameOf: (id: string) => string; colorOf: (t: "A" | "B") => string }) {
  const aLead = slot.leader === "A";
  const bLead = slot.leader === "B";
  const gap = Math.round(slot.gap);
  return (
    <div className="flex items-stretch" style={{ height: ROW_H }}>
      <ScoreBlock value={slot.a.value} thru={slot.a.thru} lead={aLead} color={colorOf("A")} />
      <NameBlock name={nameOf(slot.a.id)} align="right" lead={aLead} color={colorOf("A")} gapText={aLead ? `Up by ${gap}` : null} />
      <div className="flex shrink-0 flex-col" style={{ width: 28, paddingTop: TOP_PAD, background: "var(--color-bt-card-raised)" }}>
        <div className="flex items-center justify-center" style={{ height: PRIMARY }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>vs</span>
        </div>
        <div style={{ height: SECONDARY }} />
      </div>
      <NameBlock name={nameOf(slot.b.id)} align="left" lead={bLead} color={colorOf("B")} gapText={bLead ? `Up by ${gap}` : null} />
      <ScoreBlock value={slot.b.value} thru={slot.b.thru} lead={bLead} color={colorOf("B")} />
    </div>
  );
}

function ScoreBlock({ value, thru, lead, color }: { value: number; thru: number; lead: boolean; color: string }) {
  return (
    <div className="flex shrink-0 flex-col" style={{ width: 60, paddingTop: TOP_PAD, background: lead ? color : "transparent" }}>
      <div className="flex items-center justify-center" style={{ height: PRIMARY }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: lead ? teamTextColor(color) : "var(--color-bt-text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {fmtToPar(value)}
        </span>
      </div>
      <div className="flex items-center justify-center" style={{ height: SECONDARY }}>
        {/* Secondary label on the leader's team color — same computed contrast
            color, slightly muted so it reads as a sub-label (not full-strength). */}
        <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", color: lead ? teamTextColor(color) : "var(--color-bt-text-dim)", opacity: lead ? 0.85 : undefined }}>
          THRU {thru}
        </span>
      </div>
    </div>
  );
}

function NameBlock({ name, align, lead, color, gapText }: { name: string; align: "left" | "right"; lead: boolean; color: string; gapText: string | null }) {
  const justify = align === "right" ? "flex-end" : "flex-start";
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ padding: `${TOP_PAD}px 10px 0`, background: lead ? `${color}29` : "transparent" }}>
      <div className="flex w-full items-center" style={{ height: PRIMARY, justifyContent: justify }}>
        <span className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{name}</span>
      </div>
      <div className="flex w-full items-center" style={{ height: SECONDARY, justifyContent: justify }}>
        {gapText && <span style={{ fontSize: 11, fontWeight: 600, color }}>{gapText}</span>}
      </div>
    </div>
  );
}

// ── Compact Current/Projected toggle (RsToggle) ──────────────────────────────
export function RsToggle({ mode, onMode }: { mode: RackMode; onMode: (m: RackMode) => void }) {
  const on = mode === "projected";
  return (
    <div className="flex items-center gap-2">
      {/* Status label only in current mode — the redundant "Projected to 18"
          text is gone; the button itself now carries the projection label
          (W3-Rack2). */}
      {!on && <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>Current standings</span>}
      <button
        onClick={() => onMode(on ? "current" : "projected")}
        className="flex items-center gap-1"
        style={{
          padding: "3px 9px",
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: on ? 700 : 600,
          // Toggled-on = a neutral elevated fill (NOT the teal CTA), so "on" reads
          // as a selected control rather than a call to action.
          border: `1px solid ${on ? "var(--color-bt-text-dim)" : "var(--color-bt-border)"}`,
          background: on ? "var(--color-bt-card-raised)" : "transparent",
          color: on ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
        }}
      >
        <TrendingUp size={13} />
        18 Hole Projection
      </button>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}
