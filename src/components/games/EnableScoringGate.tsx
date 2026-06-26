"use client";

import { ChevronLeft, PlayCircle } from "lucide-react";

/**
 * The §B pre-Enable setup surface (Phase 2B.1 → 2B.2). Stroke and rack have no
 * explicit enable step natively — they score immediately — but §B makes
 * scoring-enabled a universal precondition (the server gate rejects entries until
 * enabled). This screen is that gate, and in 2B.2 it became the shared **setup
 * hull** for stroke/rack: the standardized drill-down rows (`setupRows` —
 * course pre-step + Name·Format·Points, via GameSetupRows) above a "ready to
 * score" hint and the bottom **Enable scoring** CTA.
 *
 * Vocabulary is locked: "Enable scoring" — never arm/open. Enabling opens the
 * game to the crew; the first score flips it Live (#396). It never gates on a
 * course (course is optional, never an error).
 */
export function EnableScoringGate({
  title,
  subtitle,
  onEnable,
  onBack,
  pending,
  setupRows,
  identityHeader,
  rulesNote,
  onSaveExit,
}: {
  title: string;
  subtitle: string;
  onEnable: () => void;
  onBack: () => void;
  pending: boolean;
  /** The standardized setup drill-down rows (GameSetupRows). Omitted for a
   *  standalone game with nothing competition-scoped to configure. */
  setupRows?: React.ReactNode;
  /** Zone-1 identity header (name + assigned-to), above the rows (W-EDITMODAL-01). */
  identityHeader?: React.ReactNode;
  /** Zone-3 rules note, below the rows (W-EDITMODAL-01). */
  rulesNote?: React.ReactNode;
  /** "Save & exit" (secondary, always-enabled) — flushes rules + navigates back.
   *  Omitted → only "Enable scoring" + the back arrow (e.g. standalone games). */
  onSaveExit?: () => void;
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {identityHeader}
        {setupRows}
        {rulesNote}

        <div
          className="mt-4 flex items-center gap-3 rounded-xl px-4 py-3.5"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <PlayCircle size={24} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
            <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>Ready to score.</span>{" "}
            Enabling opens this game to the crew; the round goes live on the first score.
          </p>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-6 pt-2">
        <button
          onClick={onEnable}
          disabled={pending}
          className="w-full disabled:opacity-40"
          style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
        >
          {pending ? "Enabling…" : "Enable scoring"}
        </button>
        {onSaveExit && (
          <button
            onClick={onSaveExit}
            className="mt-2 w-full"
            style={{ height: 48, borderRadius: 12, background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", fontSize: 15, fontWeight: 600 }}
          >
            Save &amp; exit
          </button>
        )}
      </div>
    </div>
  );
}
