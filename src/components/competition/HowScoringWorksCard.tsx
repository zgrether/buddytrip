"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { howScoringWorks, type HowScoringInput } from "@/lib/howScoringWorks";
import { EYEBROW_SEPARATOR, TYPE_SCALE } from "@/lib/typeScale";
import { HOW_SCORING_WORKS_TITLE } from "@/lib/vocabulary";

/**
 * How scoring works (Zach's rulings, 2026-10-22): a collapsed row under the
 * hero, for everyone. Open, it says who is competing, the points in play and
 * awarded so far, and what each game is worth, from the competition's own settings
 * (`howScoringWorks`). Every word comes from a shared module; this component
 * adds none.
 */
export function HowScoringWorksCard(props: HowScoringInput) {
  const [open, setOpen] = useState(false);
  const card = howScoringWorks(props);

  return (
    <section
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="how-scoring-works"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="how-scoring-works-body"
        className="flex w-full items-center justify-between gap-3 px-4 text-left"
        style={{ minHeight: 48, color: "var(--color-bt-text)" }}
        data-testid="how-scoring-works-toggle"
      >
        <span style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}>{HOW_SCORING_WORKS_TITLE}</span>
        {open ? (
          <ChevronUp size={16} aria-hidden="true" style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
        ) : (
          <ChevronDown size={16} aria-hidden="true" style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div id="how-scoring-works-body" className="flex flex-col gap-3 px-4 pb-4" data-testid="how-scoring-works-body">
          <p className="m-0" style={{ fontSize: TYPE_SCALE.body, color: "var(--color-bt-text)" }} data-testid="how-scoring-works-competing">
            <span style={{ fontWeight: 600 }}>{card.competing.label}</span>
            {card.competing.names && (
              <span style={{ color: "var(--color-bt-text-dim)" }}>
                {EYEBROW_SEPARATOR}
                {card.competing.names}
              </span>
            )}
          </p>

          <p className="m-0" style={{ fontSize: TYPE_SCALE.body, color: "var(--color-bt-text-dim)" }} data-testid="how-scoring-works-points">
            {card.points}
          </p>

          {card.games.length > 0 && (
            <ul className="m-0 flex list-none flex-col p-0" data-testid="how-scoring-works-games">
              {card.games.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-col gap-0.5 py-2"
                  style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
                  data-testid={`how-scoring-works-game-${g.id}`}
                >
                  {/* A long name pushes the value onto its own line, right-aligned
                      under it, rather than squeezing either (Zach's look on #1694). */}
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0" style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600, color: "var(--color-bt-text)" }}>{g.name}</span>
                    <span className="ml-auto text-right tabular-nums" style={{ fontSize: TYPE_SCALE.captionPlus, color: "var(--color-bt-text)" }} data-testid={`how-scoring-works-worth-${g.id}`}>
                      {g.worth}
                    </span>
                  </span>
                  {g.line && (
                    <span style={{ fontSize: TYPE_SCALE.captionPlus, lineHeight: 1.4, color: "var(--color-bt-text-dim)" }}>{g.line}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
