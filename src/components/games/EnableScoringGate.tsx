"use client";

import { ChevronLeft, PlayCircle } from "lucide-react";

/**
 * Minimal "Enable scoring" gate (Phase 2B.1). Stroke and rack have no explicit
 * enable step today — they score immediately — but §B makes scoring-enabled a
 * universal precondition for score entry (the server gate rejects entries until
 * enabled). This is the stop-gap control that drives `games.enableScoring`; the
 * full setup-shell phase (drill-down rows + this CTA at the bottom) is 2B.2.
 *
 * Vocabulary is locked: "Enable scoring" — never arm/open. Enabling opens the
 * game to the crew; the first score flips it Live (#396). It does not gate on a
 * course (course is optional, never an error).
 */
export function EnableScoringGate({
  title,
  subtitle,
  onEnable,
  onBack,
  pending,
}: {
  title: string;
  subtitle: string;
  onEnable: () => void;
  onBack: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bt-base)" }}>
      <header
        className="flex shrink-0 items-center"
        style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}
      >
        <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        <div className="min-w-0 flex-1 text-center" style={{ marginRight: 36 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <PlayCircle size={44} style={{ color: "var(--color-bt-accent)" }} />
        <p className="mt-4" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>
          Ready to score
        </p>
        <p className="mt-2 max-w-xs" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
          Enable scoring to open this game to the crew. Scores can be entered once
          it&rsquo;s enabled; the round goes live on the first score.
        </p>
        <button
          onClick={onEnable}
          disabled={pending}
          className="mt-6 w-full max-w-xs disabled:opacity-40"
          style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
        >
          {pending ? "Enabling…" : "Enable scoring"}
        </button>
      </div>
    </div>
  );
}
