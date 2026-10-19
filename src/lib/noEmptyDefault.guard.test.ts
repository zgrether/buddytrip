import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";

/**
 * SOURCE GUARD for #1616: no NEW query result destructured with `data` defaulted
 * to `[]`.
 *
 *   const { data: trips = [] } = trpc.trips.list.useQuery();
 *
 * That default turns a FAILED read into an empty list before anything can tell
 * the difference, which is how #764 told a person with trips that they had none.
 * A list screen hands the query to `listStateOf` (`src/lib/listState.ts`)
 * instead, which only reaches "empty" once data has arrived.
 *
 * The existing sites are a RATCHET, not a ruling that they are fine: many feed
 * counts or lookups rather than a rendered list, and converting them all was out
 * of scope for #1616. The map below must match EXACTLY, so:
 *  - a new site fails here, and should use `listStateOf`;
 *  - a fixed site fails here too, until its number is lowered, so the list stays
 *    true rather than quietly larger than reality.
 *
 * The scanner carries its own CONTROL: planted snippets it must count, and one
 * it must not, so a pattern that silently stopped matching would fail here.
 */

const DEFAULT_TO_EMPTY = /data:\s*\w+\s*=\s*\[\]/g;

function count(src: string): number {
  return (src.match(DEFAULT_TO_EMPTY) ?? []).length;
}

const ALLOWED: Record<string, number> = {
  "app/trips/[tripId]/components/ArchivedIdeasBrowser.tsx": 1,
  "app/trips/[tripId]/components/CatalogBrowser.tsx": 1,
  "app/trips/[tripId]/components/IdeaZonePanel.tsx": 5,
  "app/trips/[tripId]/components/LodgingPanel.tsx": 1,
  "app/trips/[tripId]/components/setup-guide/FreshTripGuide.tsx": 3,
  "app/trips/[tripId]/components/setup-guide/SetDatesFlipCard.tsx": 1,
  "app/trips/[tripId]/components/setup-guide/useSetupProgress.ts": 3,
  "app/trips/[tripId]/page.tsx": 3,
  "app/trips/[tripId]/tabs/CrewTab.tsx": 1,
  "app/trips/[tripId]/tabs/ExpensesSection.tsx": 1,
  "app/trips/[tripId]/tabs/ExpensesTab.tsx": 2,
  "app/trips/[tripId]/tabs/LodgingTab.tsx": 1,
  "app/trips/[tripId]/tabs/ScheduleTab.tsx": 2,
  "app/trips/[tripId]/tabs/components/CrewEmailPanel.tsx": 1,
  "app/trips/[tripId]/tabs/components/DatePollCard.tsx": 1,
  "app/trips/[tripId]/tabs/components/ItineraryView.tsx": 3,
  "components/FloatingChatPanel.tsx": 1,
  "components/TripHeaderDock.tsx": 1,
  "components/TripSettingsModal.tsx": 1,
  "components/competition/CompetitionLeaderboard.tsx": 4,
  "components/competition/CompetitionSettingsModal.tsx": 2,
  "components/competition/TeamsPanel.tsx": 5,
  "components/news/NewsComposer.tsx": 1,
  "components/news/RichTextEditor.tsx": 1,
  "components/profile/ArchivedIdeasPanel.tsx": 1,
  "components/shell/ChatView.tsx": 1,
  "components/shell/ContextRail.tsx": 1,
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("the scanner (CONTROL: it can fail)", () => {
  it("counts the defaulted destructure, however it is spaced", () => {
    expect(count("const { data: trips = [] } = trpc.trips.list.useQuery();")).toBe(1);
    expect(count("const {\n  data:members=[],\n  isError,\n} = q;")).toBe(1);
    expect(count("const { data: a = [] } = x; const { data: b = [] } = y;")).toBe(2);
  });

  it("does not count a query kept whole, or a default applied after the error check", () => {
    expect(count("const tripsQuery = trpc.trips.list.useQuery();\nconst trips = tripsQuery.data ?? [];")).toBe(0);
  });
});

describe("src", () => {
  it("adds no new `data: x = []` default, and the ratchet matches what is there", () => {
    const root = join(__dirname, "..");
    const found: Record<string, number> = {};
    for (const f of sourceFiles(root)) {
      const n = count(readFileSync(f, "utf8"));
      if (n > 0) found[relative(root, f).split(sep).join("/")] = n;
    }
    expect(
      found,
      "A query result destructured with `data` defaulted to `[]` hides a failed read as an empty list. " +
        "Hand the query to `listStateOf` (src/lib/listState.ts). If you FIXED one, lower its number here."
    ).toEqual(ALLOWED);
  });
});
