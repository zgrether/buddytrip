"use client";

import { Check } from "lucide-react";
import { Stepper } from "@/components/games/Stepper";
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
            <div className="flex items-start gap-3">
              {/* Checkbox LEADING (§10): teal fill + dark check on, bordered off. */}
              <Checkbox
                on={on}
                disabled={readOnly}
                onClick={() => onChange(setModifierEnabled(modifiers, key, !on))}
                label={def.label}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{def.label}</p>
                {def.description && (
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>{def.description}</p>
                )}
              </div>
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
    </div>
  );
}

/** Trailing-hole count for glorious finishing holes (the only stepper modifier).
 *  The count lives in the canonical compact <Stepper> (P-B). De-framed (§10): no
 *  border/surface of its own — it's part of the modifier card, not a box-in-a-box.
 *  `pl-8` aligns its label under the title (past the leading checkbox + gap). */
function HoleStepper({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 flex items-center justify-between pl-8" data-testid="glorious-holes-stepper">
      <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>Final holes worth double</span>
      <Stepper
        size="compact"
        value={value}
        min={GLORIOUS_HOLES_MIN}
        max={GLORIOUS_HOLES_MAX}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

/** The on/off CHECKBOX (§10): teal fill + dark check glyph when on, transparent +
 *  bordered when off. Toggles the modifier's presence in the jsonb exactly as the
 *  old Switch did — appearance change only. */
function Checkbox({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40"
      style={{
        background: on ? "var(--color-bt-accent)" : "transparent",
        border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
      }}
    >
      {on && <Check size={13} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />}
    </button>
  );
}
