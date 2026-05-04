"use client";

import type { TabProps } from "./types";

/**
 * CompTab — placeholder shell.
 *
 * The full implementation lands in Task 4 of CC_COMPETITION_SETUP. This
 * placeholder keeps the import in src/app/trips/[tripId]/page.tsx valid
 * while the schema rebuild commit (Task 1) and router rewrites (Task 2)
 * land independently — so npx tsc --noEmit stays clean between commits.
 */
export function CompTab(_: TabProps) {
  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2"
        style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
      />
    </div>
  );
}
