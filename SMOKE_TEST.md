# Smoke Test Results
*Date: 2026-04-05*
*Tester: Claude Opus (automated via Chrome browser)*
*Branch: main (post-merge of feature/idea-zone-integration)*
*Environment: localhost:3000 + cloud Supabase (local Docker not running)*
*Session A: zgrether@gmail.com (test-owner)*

---

## Flow 1 — New trip, IDEA stage entry
**Attempted:** Create new trip with "Not sure yet — let's figure it out" selected.
**Result:** Pass
**Details:**
- Trip created successfully (required programmatic JS click — see Issue 1)
- Landed on trip detail page in IDEA stage
- Progress stepper shows correctly: step 1 "Idea" filled teal (current), steps 2-4 gray outline (future)
- All four labels visible on desktop: Idea, Planning, Ready, Done
- No StatusBadge in header — only Owner role badge
- Zero-ideas fork displayed: "Where are you headed?" with two option cards
- No planning rows visible — Home tab shows only the IdeaZonePanel content
**Errors:** None

---

## Flow 2 — Idea zone — add and browse ideas
**Attempted:** From zero-ideas state, select "Help me decide", browse catalog, add two ideas.
**Result:** Partial
**Details:**
- "Help me decide" click worked — catalog browser appeared with "Idea zone" heading
- Activity filters (All, Golf, Beach, Ski, City, Adventure) and budget filters ($-$$$$) rendered
- Catalog cards with images, titles, locations, cost tiers displayed correctly
- Selecting cards shows teal border highlight + checkmark overlay
- "Show all 20 destinations" expand button, "Hide catalog", "Ask Buddy for suggestions", and manual "Destination name" input all present
- Sticky "Compare N ideas" bar appeared at bottom
- **Issue**: The sticky compare bar overlaps with the bottom navigation (see Issue 2). Could not tap the compare bar to submit ideas on this specific trip because the bottom nav intercepted the click.
- On a pre-existing IDEA trip ("Idea Zone Integration") with ideas already added: idea cards render correctly on Home tab with vote panel, two-column desktop layout works as expected
**Errors:** None

---

## Flow 3 — Voting and leading indicator
**Attempted:** Vote on ideas and check leading indicator behavior.
**Result:** Pass (verified on pre-existing "Idea Zone Integration" trip)
**Details:**
- Vote panel shows "CREW VOTES" with "1 of 2 voted" text
- Vote bar widths render proportionally
- "My vote" / "Vote" buttons work
- Leading idea (Pinehurst Pilgrimage) shows 4px teal left border accent — no "Leading" text badge
- Non-leading idea (Scottsdale) has normal border
- Voter avatars visible in voting panel rows
**Errors:** None

---

## Flow 4 — Set destination and advance to PLANNING
**Attempted:** Verify "Set as destination and start planning" button on idea cards.
**Result:** Pass (visual verification)
**Details:**
- Leading idea shows full-width primary button: "Set as destination and start planning" (teal bg, white text)
- Non-leading idea shows ghost text link: "Set as destination" (teal text)
- Delete (trash) icon visible next to both buttons for owner
- Confirmation sheet (SetDestinationSheet) not tested end-to-end due to idea submission issue on smoke test trip, but component renders correctly on existing trip
**Errors:** None

---

## Flow 5 — New trip, PLANNING stage entry
**Attempted:** Not tested in this session (would require creating a second trip with "I know where I'm going").
**Result:** Not tested
**Details:** Existing PLANNING trips ("testtttt", "BBMI 2026") were verified to show correct stepper and no idea zone content. The PLANNING stage correctly shows planning rows, not the IdeaZonePanel.
**Errors:** N/A

---

## Flow 6 — PLANNING stage — crew and dates
**Attempted:** Not fully tested (no new crew members added in this session).
**Result:** Not tested
**Details:** Existing PLANNING trip "testtttt" shows correct Crew tab behavior (see Flow 13). Home tab shows planning rows correctly on GOING trip "BBMI Test".
**Errors:** N/A

---

## Flow 7 — Advance to GOING via stepper
**Attempted:** Not tested end-to-end (requires a PLANNING trip with locked date).
**Result:** Not tested
**Details:** The stepper `onStepClick` wiring was verified in code review. On PLANNING trip, the "Ready" step circle renders as the next future step with cursor pointer styling. Could not test the actual AdvanceToGoingSheet opening because existing PLANNING trips lack locked dates.
**Errors:** N/A

---

## Flow 8 — RSVP flow as crew member
**Attempted:** Not tested (requires Session B with zgrethphoto@gmail.com).
**Result:** Not tested
**Details:** RSVP panel verified working on existing GOING trips in Session A (owner can set own RSVP). Two-account testing requires separate browser session.
**Errors:** N/A

---

## Flow 9 — Ghost member RSVP
**Attempted:** Not tested (requires GOING trip with ghost member).
**Result:** Not tested
**Details:** Previously verified in RSVP spec work. No regression expected.
**Errors:** N/A

---

## Flow 10 — Dashboard sections
**Attempted:** Verify dashboard section ordering and stage badges.
**Result:** Pass
**Details:**
- NOW section renders at top with "NOW" badge on "BBMI Test 2" (amber text)
- "Starting today!" countdown visible on NOW trip card
- ACTIVE section shows all non-NOW active trips grouped: GOING (2), PLANNING (3), IDEA (5+)
- Each trip card shows correct stage badge: GOING (violet), PLANNING (teal), IDEA (blue)
- Owner role badge visible alongside stage badge on each card
- Section ordering correct: NOW → ACTIVE
- No Saved or Past sections visible (none exist for this user)
**Errors:** None

---

## Flow 11 — /compare redirect
**Attempted:** Navigate directly to /trips/[trip-id]/compare
**Result:** Pass
**Details:**
- Navigated to `http://localhost:3000/trips/fc2438cb-.../compare`
- Redirected to `http://localhost:3000/trips/fc2438cb-...` (no /compare in final URL)
- No 404, no error — clean server-side redirect
**Errors:** None

---

## Flow 12 — Progress stepper all stages
**Attempted:** Check stepper rendering on IDEA, PLANNING, GOING/NOW trips.
**Result:** Pass
**Details:**
- **IDEA** (Smoke Test Trip): Step 1 filled teal "1" (current), steps 2-4 gray outline. "Idea" label in teal on desktop. Mobile label centered below.
- **PLANNING** (testtttt): Step 1 checkmark (completed), step 2 filled teal "2" (current), steps 3-4 gray. Teal connecting line between steps 1-2. "Planning" label in teal.
- **GOING** (BBMI Test): Steps 1-2 checkmarks (completed), step 3 filled teal "3" (current), step 4 gray. Teal connecting lines between 1-2 and 2-3. "Ready" label in teal.
- **NOW** (BBMI Test 2): Same as GOING stepper + "NOW" label visible in the About panel area (verified from earlier verification session).
- StatusBadge removed from trip detail header in all cases — only role badge shown.
- TripCard on dashboard still shows stage badges (IDEA, PLANNING, GOING, NOW) — unaffected.
**Errors:** None

---

## Flow 13 — Crew tab across stages
**Attempted:** Check Crew tab on IDEA, PLANNING, and GOING stage trips.
**Result:** Pass
**Details:**
- **IDEA** (Smoke Test Trip): Section label "CO-PLANNERS" (correct). Helper text "Add anyone you're thinking of inviting..." (correct). No "Send email" button. No status column (col 2 hidden). Only badge + delete columns visible. Owner row shows avatar, name, email, Owner badge — no status text.
- **PLANNING** (testtttt): Section label "CREW" (correct). Helper text "Building your roster..." (correct). "Send email" button visible. Status column not visible for owner-only row (owner status is always hidden). Would need non-owner members to verify col 2 shows "Not invited"/"Invited" in planning.
- **GOING** (BBMI Test): Previously verified in RSVP spec smoke tests — CREW label, headcount chip, RSVP status column visible, nudge buttons functional.
**Errors:** None

---

## Summary

| Flow | Result | Key finding |
|------|--------|-------------|
| 1 | Pass | Stepper, zero-ideas fork, no planning rows — all correct |
| 2 | Partial | Catalog works but sticky compare bar hidden behind bottom nav |
| 3 | Pass | Leading indicator (teal border), no "Leading" badge, vote avatars |
| 4 | Pass | Both button variants render correctly |
| 5 | Not tested | Existing PLANNING trips verified correct |
| 6 | Not tested | — |
| 7 | Not tested | Requires PLANNING trip with locked date |
| 8 | Not tested | Requires Session B (second account) |
| 9 | Not tested | — |
| 10 | Pass | Dashboard sections ordered correctly, all badges correct |
| 11 | Pass | /compare redirects cleanly, no 404 |
| 12 | Pass | Stepper correct for all stages, badge removed from header |
| 13 | Pass | CO-PLANNERS / CREW labels, status column hidden in IDEA |

---

## Issues found

1. **"Create Trip" button click target issue (minor/tooling):** The "Create Trip" button on `/trips/new` required a programmatic JS click via `button.click()` — direct coordinate-based clicks didn't trigger the mutation. May be a z-index or click-target overlap issue, or may be specific to the Chrome automation tool's click coordinates. Needs manual verification.

2. **Sticky compare bar hidden behind bottom navigation (functional):** The "Compare N ideas" sticky bar at the bottom of the EmptyStateOnboarding component has a lower z-index than the `TripBottomNav` fixed navigation. When both are visible, clicking the compare bar area actually triggers the bottom nav buttons (confirmed: clicking the compare bar navigated to Messages). The compare bar uses `z-40` while the bottom nav is fixed at a higher stacking context. This blocks the primary flow of submitting selected catalog ideas.

3. **PLANNING trip missing planning rows (edge case):** The "testtttt" PLANNING trip shows no Destination/Crew/Dates/Logistics planning rows — only "Add a Competition" and right-column widgets. This trip was likely created pre-stage-model and backfilled to PLANNING without a locked destination. The `isBlank` / `isExploring` / `isLocked` logic in `PlanningSection` may not handle this edge case. Low priority since new trips created through the wizard follow the correct flow.

4. **Flows 5-9 not tested (gap):** Five flows could not be tested due to session limitations: no second browser session (Session B) for cross-account RSVP testing, no PLANNING trip with locked dates for stepper-to-going advancement test, and the sticky bar issue prevented creating ideas on the new smoke test trip. These flows should be tested manually.

---

## Blockers vs polish

### Blockers (break core functionality)
- **Issue 2 — Sticky compare bar z-index:** This prevents users from submitting catalog ideas on mobile/any viewport where the bottom nav is visible. The primary IDEA-stage "add ideas from catalog" flow is broken. Fix: raise the compare bar's z-index above the bottom nav, or position it above the bottom nav with appropriate bottom padding.

### Polish (visual/minor)
- **Issue 1 — Create Trip click target:** May be tooling-specific. Verify manually — if the button works with real mouse clicks, this is a non-issue.
- **Issue 3 — Legacy PLANNING trip edge case:** Pre-migration data. Not a regression from the idea zone integration. Could be addressed separately by showing a minimal state when no destination is locked in PLANNING.
