"use client";

import { Minus, Plus } from "lucide-react";
import {
  modifierDef,
  isModifierEnabled,
  gloriousHolesCount,
  setModifierEnabled,
  setGloriousHoles,
  GLORIOUS_HOLES_MIN,
  GLORIOUS_HOLES_MAX,
  type ModifiersMap,
} from "@/lib/modifiers";

/**
 * ModifierCards — the config-only "special rules" card list (W-GAMEPAGE-01 §6.5).
 *
 * Generic over the modifier registry: one card per APPLICABLE key (`available`
 * comes from the format's `gameTypes.ts` compatibleModifiers — NOT the DB).
 * Presence-model writes via the pure `lib/modifiers` helpers; **no scoring
 * effect** — a toggled modifier is recorded, not computed.
 *
 * Shared by both setup surfaces (the `match/new` setup row + the post-enable
 * `GameConfigurationView`). The caller wraps/labels it; this renders just the
 * cards + the honest "recorded, not auto-scored" caption. Empty `available` →
 * renders nothing (callers also hide their row entirely).
 */
export function ModifierCards({
  available,
  modifiers,
  onChange,
  readOnly = false,
}: {
  available: string[];
  modifiers: ModifiersMap;
  onChange: (next: ModifiersMap) => void;
  readOnly?: boolean;
}) {
  if (available.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="modifier-cards">
      {available.map((key) => {
        const def = modifierDef(key);
        const on = isModifierEnabled(modifiers, key);
        return (
          <div
            key={key}
            className="rounded-lg px-3 py-2.5"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
            data-testid={`modifier-card-${key}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{def.label}</p>
                {def.description && (
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>{def.description}</p>
                )}
              </div>
              <Switch
                on={on}
                disabled={readOnly}
                onClick={() => onChange(setModifierEnabled(modifiers, key, !on))}
                label={def.label}
              />
            </div>
            {/* Stepper only for checkbox+stepper modifiers, and only once enabled. */}
            {def.controlType === "checkbox+stepper" && on && (
              <HoleStepper
                value={gloriousHolesCount(modifiers)}
                disabled={readOnly}
                onChange={(n) => onChange(setGloriousHoles(modifiers, n))}
              />
            )}
          </div>
        );
      })}
      <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Optional. These are recorded as rules of the day — the app doesn’t auto-score them yet.
      </p>
    </div>
  );
}

/** Trailing-hole count for glorious finishing holes (the only stepper modifier). */
function HoleStepper({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div
      className="mt-2.5 flex items-center justify-between rounded-lg px-3 py-2"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="glorious-holes-stepper"
    >
      <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Last <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>{value}</span> hole{value === 1 ? "" : "s"} worth double
      </span>
      <div className="flex items-center gap-2">
        <StepBtn dir="dec" disabled={disabled || value <= GLORIOUS_HOLES_MIN} onClick={() => onChange(value - 1)} />
        <StepBtn dir="inc" disabled={disabled || value >= GLORIOUS_HOLES_MAX} onClick={() => onChange(value + 1)} />
      </div>
    </div>
  );
}

function StepBtn({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "inc" ? "Increase" : "Decrease"}
      className="flex items-center justify-center disabled:opacity-30"
      style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
    >
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

/** The on/off toggle — the existing checked-state pattern (preserved from the
 *  shipped SpecialRules panel so both surfaces read identically). */
function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="relative h-6 w-10 flex-shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? "var(--color-bt-accent)" : "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full transition-all"
        style={{ left: on ? "20px" : "2px", background: on ? "var(--color-bt-base)" : "var(--color-bt-text-dim)" }}
      />
    </button>
  );
}
