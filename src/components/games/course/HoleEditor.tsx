"use client";

import { Plus, Minus } from "lucide-react";

/**
 * HoleEditor — the SHARED per-hole editor (Slice C part 2, §1/§5). One component,
 * two callers: manual entry steps it 1→N, and confirm-edit opens it for a single
 * hole. Presentational only — yds · par · index steppers in, changes out via
 * callbacks. Swap-on-edit lives in the parent (it owns the full index array);
 * this just reports the requested new index and renders the swap hint.
 *
 * Yards are per active tee and OPTIONAL (display only); par 3–6; stroke index
 * 1..holeCount (1 = hardest).
 */
interface HoleEditorProps {
  holeNumber: number;
  holeCount: number;
  par: number;
  /** Current stroke index for this hole, or null when unset. */
  index: number | null;
  /** Active tee name (null = no tees defined → yards row hidden). */
  teeName: string | null;
  /** This hole's yards on the active tee, or null. */
  yards: number | null;
  /** Hint shown when the chosen index currently sits on another hole. */
  swapHint?: string | null;
  onPar: (value: number) => void;
  onIndex: (value: number) => void;
  onYards: (value: number | null) => void;
}

const MIN_PAR = 3;
const MAX_PAR = 6;

export function HoleEditor({
  holeNumber,
  holeCount,
  par,
  index,
  teeName,
  yards,
  swapHint,
  onPar,
  onIndex,
  onYards,
}: HoleEditorProps) {
  const idxCurrent = index ?? 0;
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {/* Par */}
      <StepRow
        label="Par"
        value={String(par)}
        onDec={() => onPar(Math.max(MIN_PAR, par - 1))}
        onInc={() => onPar(Math.min(MAX_PAR, par + 1))}
        decDisabled={par <= MIN_PAR}
        incDisabled={par >= MAX_PAR}
      />

      {/* Stroke index */}
      <div>
        <StepRow
          label="Stroke index"
          value={index == null ? "—" : String(index)}
          hint="1 = hardest"
          onDec={() => onIndex(Math.max(1, (idxCurrent || 1) - 1))}
          onInc={() => onIndex(Math.min(holeCount, (idxCurrent || 0) + 1))}
          decDisabled={idxCurrent <= 1}
          incDisabled={idxCurrent >= holeCount}
        />
        {swapHint && (
          <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 6, paddingLeft: 2 }}>
            {swapHint}
          </p>
        )}
      </div>

      {/* Yards (optional, per active tee) */}
      {teeName && (
        <div>
          <FieldLabel>{`Yards · ${teeName}`}</FieldLabel>
          <input
            inputMode="numeric"
            value={yards == null ? "" : String(yards)}
            placeholder="Optional"
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, "");
              onYards(digits === "" ? null : Math.min(999, parseInt(digits, 10)));
            }}
            className="w-full rounded-xl border px-3 py-2.5 text-sm"
            style={{
              background: "var(--color-bt-card-raised)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", paddingLeft: 2 }}>
        Hole {holeNumber} of {holeCount}
      </p>
    </div>
  );
}

function StepRow({
  label,
  value,
  hint,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  label: string;
  value: string;
  hint?: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5"
        style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}
      >
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)", fontVariantNumeric: "tabular-nums" }}>
          {value}
          {hint && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-bt-text-dim)", marginLeft: 8 }}>{hint}</span>}
        </span>
        <div className="flex items-center gap-2">
          <Step dir="dec" disabled={decDisabled} onClick={onDec} />
          <Step dir="inc" disabled={incDisabled} onClick={onInc} />
        </div>
      </div>
    </div>
  );
}

function Step({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center disabled:opacity-30"
      style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
    >
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
      {children}
    </label>
  );
}
