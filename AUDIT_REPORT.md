# BuddyTrip Audit Report
Generated: 2026-04-26

## Summary

The codebase is in good structural shape, but two components (`ActionCenter`, `TravelPanel`) are orphaned files that were superseded by `PlanningGrid` and `GettingThereSection` respectively and are no longer imported anywhere. Four of the eight specific mutations requested are active; two were renamed (`saveAboutMessage` → `updateAboutMessage`, `saveTravelInfo` → `updateTravel`); two (`cancelPoll`, `openPoll`) do not exist by those names and are implemented as `setPollMode`. One mutation (`updateActionCenterSettings`) exists in the router but has no frontend caller. Several database columns for the RSVP feature (`rsvp_enabled`, `rsvp_status`, `travel_enabled`) are defined in migrations but `rsvp_enabled` and `rsvp_status` are barely used in queries, indicating a partially-implemented feature.

---

## Task A — Dead Components

### Named components from the checklist

| Component | File Exists? | Imported? | Rendered? | Status | Notes |
|-----------|-------------|-----------|-----------|--------|-------|
| ActionCenter | Yes — `tabs/components/ActionCenter.tsx` | No | No | ⚠️ Orphaned | Was the going/planning action surface. Superseded by `PlanningGrid` (planning stage) and `ItineraryView` (going/now stage). Comments in `HomeTab.tsx` (lines 324, 347) and `ItineraryView.tsx` (line 54) explicitly note it was replaced. File still compiles but is dead code. |
| StageContextBar | No file | — | — | ❌ Missing | No file found anywhere in `src/`. Not referenced either — purely absent. |
| RsvpPanel | No file | — | — | ❌ Missing | No file found. The RSVP feature has `rsvp_status` / `rsvp_enabled` columns in the DB (migrations 030, 052) but no UI panel component was ever created. |
| RsvpActionCard | No file | — | — | ❌ Missing | No file found. The `ActionCenter.tsx` has a `// TODO: RsvpCard + TravelCard slot in here in later phases` comment (line 101), but the card was never built. |
| InvitationCard | Yes — `tabs/components/InvitationCard.tsx` | Yes — imported in `ActionCenter.tsx` (line 10) | Yes — rendered at ActionCenter line 57 | ⚠️ Partial | Imported by `ActionCenter.tsx`, but `ActionCenter` itself is orphaned (see above). `InvitationCard` is therefore transitively dead. |
| TripSummaryModal | Yes — `components/TripSummaryModal.tsx` | Yes — `page.tsx` line 26 | Yes — `page.tsx` line 412 | ✅ Active | Owner-facing modal to review trip and fire `advanceToGoing`. |
| WriteSummaryModal | No file | — | — | ❌ Missing | Not a file or import anywhere. The variable `showWriteInvitationModal` in `page.tsx` (line 38) opens `TripInvitationModal`, not a modal by this name. |
| WriteInvitationModal | No file | — | — | ❌ Missing | No file. `page.tsx` uses `TripInvitationModal` for this purpose (line 422). The state variable name is a misnomer vs the actual component. |
| NextStepsPanel | No file | — | — | ❌ Missing | No file or import anywhere in `src/`. |
| StageProgressBar | No file | — | — | ❌ Missing | No file. The `ProgressStepper` component serves this purpose. |
| PlanningRow | Yes — `components/PlanningRow.tsx` | Yes — imported in `DatesPanel.tsx`, `LodgingPanel.tsx`, `TravelPanel.tsx` | Yes — rendered in all three | ✅ Active | Collapsible wrapper used by DatesPanel, LodgingPanel, TravelPanel. |
| PlanningSection | No file | — | — | ❌ Missing | No file. Referenced only in comments in `ActionCenter.tsx` (line 36) and `HomeTab.tsx` (line 324) as something that was replaced. |
| DatesSection | No file | — | — | ❌ Missing | No file. Not referenced anywhere. |
| DatesPlanningRow | No file | — | — | ❌ Missing | No file. Not referenced anywhere. |
| DatePollCard | Yes — `tabs/components/DatePollCard.tsx` | Yes — `ActionCenter.tsx`, `PlanningGrid.tsx`, `DatesPanel.tsx` | Yes — rendered in `PlanningGrid` and `DatesPanel` directly | ✅ Active | Note: the import in `ActionCenter.tsx` is transitively dead since ActionCenter is orphaned; the direct imports in PlanningGrid and DatesPanel are live. |
| AboutCard | No file | — | — | ❌ Missing | No file. Not referenced anywhere. |
| AboutPanel | No file | — | — | ❌ Missing | No file. Not referenced anywhere. |
| TwoColumnLayout | No file | — | — | ❌ Missing | No file, no reference anywhere in `src/`. |
| SidebarForStage | Yes — `components/SidebarForStage.tsx` | Yes — `IdeaZonePanel.tsx` line 29 | Yes — rendered at `IdeaZonePanel.tsx` line 1985 | ✅ Active | The idea-stage right rail with CTA and CoPlannerPanel. |
| CoPlannerPanel | No separate file — exported from `IdeaZonePanel.tsx` line 1639 | Yes — imported in `SidebarForStage.tsx` line 4 | Yes — rendered in `SidebarForStage.tsx` line 62 | ✅ Active | Co-located in IdeaZonePanel.tsx as a named export. |

### All .tsx files under `src/app/trips/[tripId]/` — zero-import scan

Files that are Next.js route pages (`page.tsx`, layout files) legitimately have zero imports because they are resolved by the file-system router, not imported. They are flagged but not true orphans.

| File | Import Count | Status | Notes |
|------|-------------|--------|-------|
| `compare/page.tsx` | 0 | Route page | Next.js file-system route, not imported |
| `compare/CatalogBrowser.tsx` | 1 | ✅ Active | Imported by `compare/page.tsx` |
| `competition/setup/page.tsx` | 0 | Route page | Next.js file-system route |
| `components/AddLogisticsItemSheet.tsx` | 0 | ⚠️ Orphaned | Defined but never imported anywhere in `src/`. No reference found. |
| `components/TravelPanel.tsx` | 0 | ⚠️ Orphaned | Defined but never imported. Only reference is a comment in `GettingThereSection.tsx` (line 244) noting API compatibility. Superseded by `GettingThereSection`. |
| `leaderboard/page.tsx` | 0 | Route page | Next.js file-system route |
| `page.tsx` | 0 | Route page | Root route for `[tripId]`, resolved by Next.js router |
| `tabs/components/ActionCenter.tsx` | 0 | ⚠️ Orphaned | See above — superseded by PlanningGrid + ItineraryView |
| All other files | ≥1 | ✅ Active | — |

---

## Task B — Stage Logic Locations

The DB `stage` column has three values: `idea`, `planning`, `going`. The computed `trip_status()` function derives `now`, `past`, `saved` from the stage + dates + override. Code distinguishes between the raw `stage` and the derived `status`.

| File | Line | Stage Check | What It Does | Status |
|------|------|-------------|--------------|--------|
| `src/app/trips/[tripId]/page.tsx` | 164 | `stage = trip.stage ?? "idea"` | Derives working stage from trip data | Active |
| `src/app/trips/[tripId]/page.tsx` | 194 | `stage === "going"` | Determines if summary button is filled (prereqs met) | Active |
| `src/app/trips/[tripId]/page.tsx` | 195 | `stage === "planning" \|\| stage === "going"` | Shows the Trip Summary/Advance button to owners | Active |
| `src/app/trips/[tripId]/page.tsx` | 229 | `stage === "idea"` | Renders idea-stage layout (no tab bar, full-page IdeaZonePanel) | Active |
| `src/app/trips/[tripId]/page.tsx` | 328 | `stage === "going" \|\| stage === "now" \|\| stage === "past" \|\| stage === "saved"` | Shows `QuickInfoSection` above the tab bar | Potentially stale — `"now"`, `"past"`, `"saved"` are computed **status** values, not raw `stage` values. The raw stage is always `going` when status is `now`. The checks for `stage === "now"` and `stage === "past"` are unreachable because `stage` is read directly from `trip.stage` (a DB column that only holds `idea`/`planning`/`going`). |
| `src/app/trips/[tripId]/page.tsx` | 333 | `stage !== "planning"` | Hides the TripTabBar in the planning stage (only PlanningGrid is shown) | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 306 | `stage = trip.stage ?? "idea"` | Derives stage | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 309 | `stage === "idea"` | Returns `IdeaZonePanel` only (no planning rows) | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 325 | `stage === "planning"` | Renders `PlanningGrid` | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 337 | `stage === "going" && (status === "going" \|\| status === "now")` | Renders `ItineraryView` for active going trips | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 348 | `stage !== "idea" && stage !== "planning" && status !== "going" && status !== "now"` | Renders `ItineraryPanel` (read-only) for past/saved | Active |
| `src/app/trips/[tripId]/tabs/HomeTab.tsx` | 364 | `stage !== "idea" && stage !== "planning"` | Renders `CompetitionPanel` from going stage onward | Active |
| `src/app/trips/[tripId]/tabs/components/ActionCenter.tsx` | 40-41 | `stage !== "idea" && stage !== "planning" && stage !== "going"` → return null | Early-exit guard | ⚠️ Dead — `ActionCenter` is never imported; this code does not run. |
| `src/app/trips/[tripId]/tabs/components/ActionCenter.tsx` | 51 | `stage === "going"` | Shows InvitationCard + TravelCard | ⚠️ Dead — `ActionCenter` is orphaned. |
| `src/app/trips/[tripId]/components/TripSummaryModal.tsx` | 74 | `trip.stage === "going"` | Detects if trip already advanced; hides the advance button | Active |
| `src/app/trips/[tripId]/components/ItineraryPanel.tsx` | 393 | `stage === "idea"` | Hides the panel entirely during idea stage | 🔍 Partial — ItineraryPanel is only rendered when `stage !== "idea" && stage !== "planning"` from HomeTab, so this guard is redundant (defensive coding). |
| `src/app/trips/[tripId]/components/ItineraryPanel.tsx` | 398 | `stage === "planning"` | Shows "work in progress" banner | ⚠️ Dead — ItineraryPanel is never rendered during `planning` stage (HomeTab guards it out). This internal check is unreachable. |
| `src/app/trips/[tripId]/tabs/ScheduleTab.tsx` | 542 | `stage === "planning"` | Shows alternate guidance text ("All confirmed items will appear once the trip is officially kicked off") | Active |
| `src/components/TripTabBar.tsx` | 43 | `stage === "planning"` | Hides the Competition tab in planning stage | Active |
| `src/components/TripTabBar.tsx` | 47 | `stage === "planning"` | Hides the Expenses tab in planning stage | Active |
| `src/components/TripTabBar.tsx` | 51 | `stage === "idea"` | Hides the Lodging tab in idea stage | Active |
| `src/components/TripSettingsModal.tsx` | 66 | `stage = trip?.stage ?? "idea"` | Derives stage | Active |
| `src/components/TripSettingsModal.tsx` | 269 | `stage !== "planning"` | Hides "Trip plan" section in settings during planning (use PlanningGrid instead) | Active |
| `src/components/ProgressStepper.tsx` | 23-24 | `stage === "going"`, `stage === "planning"` | Computes active step index for the 4-step stepper | Active |
| `src/server/routers/trips.ts` | 694 | `trip.stage !== "idea"` | Blocks `advanceToPlanning` if already past idea | Active |
| `src/server/routers/trips.ts` | 751 | `trip.stage !== "planning"` | Blocks `advanceToGoing` if not in planning | Active |
| `src/server/routers/trips.ts` | 882, 890 | `["planning", "going"].includes(trip.stage)` | Blocks `updateAboutMessage` if trip isn't in planning or going | Active |

**Key findings:**
- `page.tsx` line 328 checks `stage === "now"` and `stage === "past"`, but these are computed *status* values — `trip.stage` (from the DB) can only ever be `idea`, `planning`, or `going`. These checks are unreachable.
- `ItineraryPanel.tsx` has a dead `stage === "planning"` branch internally (line 398) because it is never rendered during the planning stage by its callers.
- All stage checks inside `ActionCenter.tsx` are dead because the component is never instantiated.

---

## Task C — Orphaned Mutations

### Specific mutations requested

| Mutation | Router | Frontend Call | Status | Notes |
|----------|--------|---------------|--------|-------|
| `advanceToGoing` | `trips.ts` line 731 | `TripSummaryModal.tsx` line 52 | ✅ Active | Called via `trpc.trips.advanceToGoing.useMutation()` |
| `cancelPoll` | — | — | ❌ Missing | No procedure named `cancelPoll` exists in any router. The conceptual equivalent is `datePoll.setPollMode` (set `pollMode = false`) or `datePoll.resetPoll`. |
| `openPoll` | — | — | ❌ Missing | No procedure named `openPoll` exists. Equivalent is `datePoll.setPollMode` (set `pollMode = true`). |
| `skipPlanningTile` | `trips.ts` line 1023 | `PlanningGrid.tsx` line 1002 | ✅ Active | Called via `trpc.trips.skipPlanningTile.useMutation()` |
| `unskipPlanningTile` | `trips.ts` line 1068 | `PlanningGrid.tsx` line 1008 | ✅ Active | Called via `trpc.trips.unskipPlanningTile.useMutation()` |
| `saveTravelInfo` | — | — | ❌ Missing | No procedure by this name. Implemented as `tripMembers.updateTravel` (router line 424), called from `TravelEntryForm.tsx` line 57 and `GettingThereSection.tsx` line 226 as `trpc.tripMembers.updateTravel.useMutation()`. |
| `sendInvitationBlast` | `tripMembers.ts` line 472 | `CrewEmailPanel.tsx` line 100 | ✅ Active | Called via `trpc.tripMembers.sendInvitationBlast.useMutation()` |
| `saveAboutMessage` | — | — | ❌ Missing | No procedure by this name. Implemented as `trips.updateAboutMessage` (router line 871), called from `TripInvitationModal.tsx` line 45 and `CrewEmailPanel.tsx` line 66. |

### Additional orphaned mutations found

| Mutation | Router | Frontend Call | Status | Notes |
|----------|--------|---------------|--------|-------|
| `trips.updateActionCenterSettings` | `trips.ts` line 842 | None found | ⚠️ Orphaned | Toggles `travel_enabled` on trips. Defined in router, never called from any `.tsx` file. The `rsvp_enabled` toggle is also referenced in the migration (052) but has no corresponding setter in the router at all. |
| `trips.advanceToPlanning` | `trips.ts` line 679 | `IdeaZonePanel.tsx` line 1379 | ✅ Active | — |
| `datePoll.setPollMode` | `datePoll.ts` line 672 | `DatesPanel.tsx` line 125, `DatePollCard.tsx` lines 391/411, `PlanningGrid.tsx` line 436 | ✅ Active | Serves as both `openPoll` and `cancelPoll`. |
| `datePoll.resetPoll` | `datePoll.ts` line 895 | `DatePollCard.tsx` line 362 | ✅ Active | — |
| `datePoll.returnToPoll` | `datePoll.ts` line 611 | `TripSettingsModal.tsx` line 117 | ✅ Active | — |
| `datePoll.notifyCrewPollOpen` | `datePoll.ts` line 758 | `DatePollCard.tsx` line 338 | ✅ Active | — |
| `datePoll.notifyNewMembers` | `datePoll.ts` line 816 | `DatePollCard.tsx` line 429 | ✅ Active | — |

---

## Task D — Database Columns

### Stage / status columns

| Column | Table | Migration | Used in queries (src/) | Notes |
|--------|-------|-----------|----------------------|-------|
| `stage` | `trips` | `029_trip_stages.sql` — `ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'idea' CHECK (stage IN ('idea', 'planning', 'going'))` | Yes — `trips.ts` router reads/writes `stage` extensively; frontend reads it from `getById` response | Active. Only three valid values. Computed `trip_status()` derives `now`/`past`/`saved` from this. |
| `trip_status_override` | `trips` | `029_trip_stages.sql` (referenced in `trip_status()` function) | Yes — `DashboardClient.tsx`, `TripCard.tsx`, `types.ts`, `tripStatus.ts`, `trips.ts` (line 485 sets `'saved'`) | Active. Used to mark a trip as `saved`. |

### RSVP columns

| Column | Table | Migration | Used in queries (src/) | Notes |
|--------|-------|-----------|----------------------|-------|
| `rsvp_message` | `trips` | `029_trip_stages.sql` (added); `031_about_message.sql` renamed to `about_message` | N/A — renamed before any use | Historical only. Renamed to `about_message` in migration 031. |
| `about_message` | `trips` | `031_about_message.sql` | Yes — `trips.ts` router reads/writes it; `TripInvitationModal.tsx`, `CrewEmailPanel.tsx`, `TripSummaryModal.tsx` read it from query result | Active |
| `rsvp_status` | `trip_members` | `030_rsvp_status.sql` — `ADD COLUMN IF NOT EXISTS rsvp_status text CHECK (rsvp_status IN ('in', 'maybe', 'out'))` | Minimal — only `notificationText.ts` reads from payload; no router `SELECT` includes it | ⚠️ Partially dormant. Column exists and migration backfilled it, but no tRPC router selects it and no UI displays it. The RSVP feature is schema-ready but UI was never built. |
| `rsvp_enabled` | `trips` | `052_action_center_toggles.sql` — `ADD COLUMN IF NOT EXISTS rsvp_enabled boolean NOT NULL DEFAULT false` | None found in src/ | ⚠️ Dormant. No router reads or writes this column. The `updateActionCenterSettings` mutation only updates `travel_enabled`, not `rsvp_enabled`. |

### Travel / planning columns

| Column | Table | Migration | Used in queries (src/) | Notes |
|--------|-------|-----------|----------------------|-------|
| `travel_enabled` | `trips` | `052_action_center_toggles.sql` — `ADD COLUMN IF NOT EXISTS travel_enabled boolean NOT NULL DEFAULT false` | Yes — `trips.ts` `updateActionCenterSettings` writes it; `types.ts` declares it | ⚠️ Partial. Router writes it, but `updateActionCenterSettings` is never called from the frontend. Type declaration exists but toggle UI is absent. |
| `planning_skipped` | `trips` | `055_planning_skipped.sql` — `ADD COLUMN IF NOT EXISTS planning_skipped jsonb NOT NULL DEFAULT '[]'::jsonb` | Yes — `trips.ts` reads/writes it in `skipPlanningTile`/`unskipPlanningTile`; `PlanningGrid.tsx` reads it | Active |

### Invitation / blast columns

| Column | Table | Migration | Used in queries (src/) | Notes |
|--------|-------|-----------|----------------------|-------|
| `invited_at` | `guest_crew` | `012_ghost_crew.sql` | None found (ghost crew uses its own email flow) | ⚠️ Potentially dormant. `guest_crew.invited_at` is defined but no src/ code reads or writes it. Different from `trip_members.last_invited_at`. |
| `last_invited_at` | `trip_members` | `054_invitation_blast_tracking.sql` — `ADD COLUMN IF NOT EXISTS last_invited_at timestamptz` | Yes — `tripMembers.ts` selects it (line 19), updates it (line 545); `CrewEmailPanel.tsx` displays it | Active |
| `last_blast_sent_at` | `trips` | `054_invitation_blast_tracking.sql` — `ADD COLUMN IF NOT EXISTS last_blast_sent_at timestamptz` | Yes — `tripMembers.ts` updates it (line 553); `CrewEmailPanel.tsx` and `InvitationCard.tsx` read it | Active |

### Date poll column

| Column | Table | Migration | Used in queries (src/) | Notes |
|--------|-------|-----------|----------------------|-------|
| `poll_mode` | `trips` | `045_action_center_poll_mode.sql` | Yes — datePoll router reads/writes; frontend checks `trip.poll_mode` | Active |

---

## Recommended Cleanup (priority order)

1. **Delete `ActionCenter.tsx`** — The file is completely orphaned. `PlanningGrid` handles the planning stage and `ItineraryView` handles the going/now stage. Remove `src/app/trips/[tripId]/tabs/components/ActionCenter.tsx`. Since `InvitationCard` is only imported from ActionCenter, also evaluate whether `InvitationCard.tsx` should be deleted or whether its content should be folded into `ItineraryView` or `CrewEmailPanel` (it renders an invitation nudge for the going stage).

2. **Delete `TravelPanel.tsx`** — `src/app/trips/[tripId]/components/TravelPanel.tsx` is fully superseded by `GettingThereSection`. Zero imports found. Safe to delete.

3. **Delete `AddLogisticsItemSheet.tsx`** — `src/app/trips/[tripId]/components/AddLogisticsItemSheet.tsx` has zero imports. Likely superseded by another sheet or the logistics flow changed. Confirm with git log before deleting.

4. **Fix dead stage checks in `page.tsx` line 328** — The condition `stage === "now" || stage === "past" || stage === "saved"` is unreachable because `trip.stage` (from the DB) can only be `idea`, `planning`, or `going`. These extra checks are from a period before the stage/status distinction was firm. Replace with the correct derived status check: use `getTripStatus(trip)` and compare against the status values `going`, `now`, `past`, `saved`.

5. **Remove dead `stage === "planning"` branch in `ItineraryPanel.tsx` line 398** — The `planning` variable is computed but `ItineraryPanel` is never rendered during the planning stage (HomeTab guards it). Delete the `planning` variable and its associated banner JSX, or add a comment confirming the branch is intentionally unreachable as a defensive fallback.

6. **Implement or remove the RSVP feature** — `rsvp_status` (on `trip_members`) and `rsvp_enabled` (on `trips`) exist in the DB with RLS policies but have no router queries and no UI. Either build the missing RSVP panel or mark the columns as deferred in `DEFERRED.md` and document why they exist.

7. **Wire up or remove `updateActionCenterSettings`** — `trips.updateActionCenterSettings` sets `travel_enabled` on the trip but is never called from the frontend. The `travel_enabled` flag is declared in `TripData` types but no toggle renders. Either add the toggle UI or remove the mutation and column.

8. **Rename mutation naming inconsistencies** — The audit found several cases where specs/comments use names that don't match the implementation (`saveAboutMessage` vs `updateAboutMessage`, `saveTravelInfo` vs `updateTravel`, `cancelPoll`/`openPoll` vs `setPollMode`). Update `DEFERRED.md` or inline comments to use the actual procedure names to prevent future confusion.

9. **Audit `guest_crew.invited_at`** — This column is defined in migration 012 but no src/ code reads or writes it. If ghost crew email invitations should be tracked, this field needs a router query; otherwise it should be noted as dormant.
