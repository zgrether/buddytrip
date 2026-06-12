"use client";

import { Check, Delete, AlertTriangle } from "lucide-react";
import { teeColor } from "@/lib/courseService";
import { validateStrokeIndex, type IndexEntry } from "@/lib/courseIndex";

/**
 * HoleEditor — the SHARED per-hole editor (Slice C, addendum C-1). One component,
 * two callers: manual entry steps it 1→N, and confirm-edit opens it for a single
 * hole. Controls are tap-first (no ± steppers): par is a 3·4·5·6 segmented, yards
 * is a tappable numeric field driven by the docked Keypad (rendered by the
 * screen), and stroke index is an 18-cell grid where used ranks dim with a ✓ and
 * tapping swaps (the permutation can't be broken). The index block hides entirely
 * when the course has no stroke index (net play unavailable).
 */
interface HoleEditorProps {
  holeNumber: number; // 1-based
  holeCount: number;
  par: number;
  onPar: (value: number) => void;
  hasStrokeIndex: boolean;
  /** Full index array (for grid selection / used-elsewhere ✓ / swap). */
  index: IndexEntry[];
  onIndexPick: (rank: number) => void;
  tees: { name: string }[];
  activeTee: number;
  onTee: (i: number) => void;
  yards: number | null;
  yardsActive: boolean;
  onYardsTap: () => void;
  /** Edit-hole sheet shows the swap warning above the grid. */
  showSwapWarning?: boolean;
}

const PAR_SEGMENTS = [3, 4, 5, 6];

export function HoleEditor({
  holeNumber,
  holeCount,
  par,
  onPar,
  hasStrokeIndex,
  index,
  onIndexPick,
  tees,
  activeTee,
  onTee,
  yards,
  yardsActive,
  onYardsTap,
  showSwapWarning,
}: HoleEditorProps) {
  const teeName = tees[activeTee]?.name?.trim() || `Tee ${activeTee + 1}`;
  const idxValidation = validateStrokeIndex(index, holeCount);
  const idxStarted = index.some((v) => v != null);
  const idxSetCount = index.filter((v) => v != null).length;
  // Collapse the "still needs an index" list (same rule as the handicap hint):
  // a count once more than a handful are outstanding, names only when naming
  // them actually helps someone finish.
  const unset = idxValidation.unsetHoles;
  const idxRemainingLabel =
    unset.length > 6 ? `${unset.length} of ${holeCount} holes still need a rank` : `holes ${unset.join(", ")} still need a rank`;
  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Tee tabs — which tee's yardage you're filling. */}
      {tees.length > 0 && (
        <div>
          <FieldLabel>Tee · yardage for</FieldLabel>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {tees.map((t, i) => {
              const name = t.name?.trim() || `Tee ${i + 1}`;
              const on = i === activeTee;
              return (
                <button
                  key={i}
                  onClick={() => onTee(i)}
                  className="flex shrink-0 items-center gap-1.5"
                  style={{
                    padding: "5px 11px",
                    borderRadius: 9999,
                    fontSize: 13,
                    fontWeight: 600,
                    border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                    background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: teeColor(name), flexShrink: 0 }} />
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Par — segmented. */}
      <div>
        <FieldLabel>Par</FieldLabel>
        <div className="flex gap-2">
          {PAR_SEGMENTS.map((p) => {
            const on = p === par;
            return (
              <button
                key={p}
                onClick={() => onPar(p)}
                className="flex-1"
                style={{
                  height: 44,
                  borderRadius: 10,
                  fontSize: 17,
                  fontWeight: 700,
                  border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                  background: on ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                  color: on ? "#0d1f1a" : "var(--color-bt-text)",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Yards — tappable numeric field; the keypad (screen) fills it. */}
      <div>
        <FieldLabel>{`Yards · ${teeName}`}</FieldLabel>
        <button
          onClick={onYardsTap}
          className="flex w-full items-center justify-between rounded-xl border px-3"
          style={{
            height: 48,
            background: "var(--color-bt-card-raised)",
            borderColor: yardsActive ? "var(--color-bt-accent)" : "var(--color-bt-border)",
            boxShadow: yardsActive ? "0 0 0 3px rgba(45,212,191,0.12)" : undefined,
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {yards == null ? (
              <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.4 }}>000</span>
            ) : (
              <span style={{ color: "var(--color-bt-text)" }}>{yards}</span>
            )}
            {yardsActive && <span style={{ color: "var(--color-bt-accent)", fontWeight: 400 }}>|</span>}
          </span>
          <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>yds · optional</span>
        </button>
      </div>

      {/* Stroke index — OPTIONAL 18-cell grid (three states), or the fallback line. */}
      {hasStrokeIndex ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <FieldLabel>{idxStarted ? "Stroke index · 1 = hardest" : "Stroke index · optional"}</FieldLabel>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: idxValidation.valid ? "var(--color-bt-accent)" : idxStarted ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
              }}
            >
              {idxValidation.valid ? "✓ COMPLETE" : idxStarted ? `${idxSetCount} OF ${holeCount} SET` : "NOT SET"}
            </span>
          </div>
          {showSwapWarning && (
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginBottom: 8 }}>
              Reassigning an index swaps it with the hole that currently holds it.
            </p>
          )}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
            {Array.from({ length: holeCount }, (_, i) => i + 1).map((rank) => {
              const owner = index.findIndex((v) => v === rank);
              const selected = owner === holeNumber - 1;
              const usedElsewhere = owner >= 0 && owner !== holeNumber - 1;
              return (
                <button
                  key={rank}
                  onClick={() => onIndexPick(rank)}
                  className="relative flex items-center justify-center"
                  style={{
                    height: 40,
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    border: `1px solid ${selected ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                    background: selected ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                    color: selected ? "#0d1f1a" : "var(--color-bt-text)",
                    opacity: usedElsewhere ? 0.4 : 1,
                  }}
                >
                  {rank}
                  {usedElsewhere && (
                    <Check size={10} style={{ position: "absolute", top: 3, right: 3, color: "var(--color-bt-text-dim)" }} />
                  )}
                </button>
              );
            })}
          </div>
          {idxStarted && !idxValidation.valid ? (
            <>
              <div className="mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning-border)" }}>
                <AlertTriangle size={14} style={{ color: "var(--color-bt-warning)", flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: "var(--color-bt-warning)", lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>Finish the index to use it.</span> {idxRemainingLabel}.
                </span>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)", marginTop: 6, lineHeight: 1.45 }}>
                Each rank 1–{holeCount} is used once — setting one already in use swaps with the hole that holds it.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 8 }}>
              Optional — read it off the course&apos;s scorecard, or leave it unset and strokes fall on holes 1–{holeCount}. Each rank 1–{holeCount} is used once.
            </p>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", lineHeight: 1.5 }}>
          No hole difficulty set — strokes fall on holes 1–{holeCount}. Turn on stroke indices for handicaps to land on the hardest holes instead.
        </p>
      )}

      <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
        Hole {holeNumber} of {holeCount}
      </p>
    </div>
  );
}

/** Docked 3-column numeric keypad that fills the active yards field.
 *  `1–9`, then `⌫ · 0 · Next ›` (accent Next commits + advances). */
export function Keypad({
  onDigit,
  onBackspace,
  onNext,
  nextLabel,
}: {
  onDigit: (d: number) => void;
  onBackspace: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  // Matches StrokeKeypad (the normal hole keypad) exactly — light card-float
  // panel, darker card buttons, bold numbers — differing only in the bottom row
  // (0 instead of 10+, the accent Next instead of the ✓ confirm).
  return (
    <div style={{ background: "var(--color-bt-card-float)", borderTop: "1px solid var(--color-bt-border)", padding: "12px 16px 22px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <Key key={d} onClick={() => onDigit(d)}>
            {d}
          </Key>
        ))}
        <Key onClick={onBackspace} aria-label="Backspace" dim>
          <Delete size={20} strokeWidth={1.9} />
        </Key>
        <Key onClick={() => onDigit(0)}>0</Key>
        <Key onClick={onNext} accent>
          {nextLabel}
        </Key>
      </div>
    </div>
  );
}

const KEY_H = 54;
function Key({ children, onClick, accent, dim, ...rest }: { children: React.ReactNode; onClick: () => void; accent?: boolean; dim?: boolean } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      {...rest}
      className="flex items-center justify-center font-semibold transition-transform active:scale-[0.97]"
      style={{
        height: KEY_H,
        borderRadius: 10,
        fontSize: accent ? 15 : 24,
        background: accent ? "var(--color-bt-accent)" : "var(--color-bt-card)",
        color: accent ? "#0d1f1a" : dim ? "var(--color-bt-text-dim)" : "var(--color-bt-text)",
        border: accent ? "none" : "1px solid var(--color-bt-border)",
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
      {children}
    </label>
  );
}
