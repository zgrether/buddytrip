"use client";

import { Users } from "lucide-react";

/**
 * A CHOICE BETWEEN TWO SCREENS, as a pair of cards.
 *
 * A card each rather than a segmented control or a radio list, because the
 * choice is not a value on an axis — the two produce different SCREENS, and the
 * sentence under each is what a runner is actually choosing between. That
 * sentence is also why the group needs no heading.
 *
 * ── Extracted at the second caller, on purpose ──────────────────────────────
 *
 * This was `FormatCards`, private to `PickemScoringRows`. Stroke's individual /
 * team-totals control is the same choice with different words, and the second
 * copy is where you notice a class forming — the third is where it is already
 * expensive. Same call as the duplicated result banner (#1296).
 *
 * The markup is pick'em's, unchanged, so its rendered output is byte-identical
 * and its existing tests keep their anchors: `testIdPrefix` reproduces the
 * `pickem-format-*` ids exactly rather than renaming them to something generic.
 * An extraction that changes what the old caller renders is a redesign wearing
 * a refactor's clothes.
 *
 * The icon is `Users` for every card, as it was — both options are about who is
 * being scored, so neither card earns a distinguishing glyph. Left hardcoded
 * rather than made a prop: no caller wants a different one, and a prop nobody
 * sets is a decision nobody made.
 */
export interface FormatCard<K extends string> {
  key: K;
  title: string;
  body: string;
}

export function FormatCards<K extends string>({
  cards,
  value,
  disabled,
  onChange,
  testIdPrefix,
}: {
  /** Exactly two — the layout is a fixed `1fr 1fr` and the copy is written as a
   *  pair. A third option is a different control, not a wider array. */
  cards: readonly [FormatCard<K>, FormatCard<K>];
  value: K;
  disabled: boolean;
  onChange: (next: K) => void;
  /** e.g. `"pickem-format"` → `pickem-format-cards` + `pickem-format-<key>`. */
  testIdPrefix: string;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }} data-testid={`${testIdPrefix}-cards`}>
      {cards.map((c) => {
        const selected = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.key)}
            data-testid={`${testIdPrefix}-${c.key}`}
            data-selected={selected ? "true" : "false"}
            className="flex flex-col gap-1 text-left disabled:opacity-50"
            style={{
              borderRadius: 12,
              padding: "11px 11px 12px",
              background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
              border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
            }}
          >
            <span className="flex items-center gap-1.5">
              <Users
                size={15}
                style={{
                  color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  flexShrink: 0,
                }}
              />
              {selected && (
                <span
                  className="ml-auto"
                  style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-accent)" }}
                >
                  ✓
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text)",
              }}
            >
              {c.title}
            </span>
            <span
              style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--color-bt-text-dim)" }}
            >
              {c.body}
            </span>
          </button>
        );
      })}
    </div>
  );
}
