# BuddyTrip — Session Context

## Last Updated
2026-03-10 — Tasks 7.6 product decisions resolved (P6–P8)

## Current State
- buddytrip.html: ~5,390 lines — all Phase 0–4 tasks complete
- types.ts: ~300 lines — complete TypeScript interfaces for all entities
- README.md: fully updated screen inventory, navigation graph, data architecture, permission model
- SCHEMA.md: complete database schema — 26 tables (added group_result_scores for multi-team), all FKs, indexes, creation annotations, migration order
- MIGRATION_PLAN.md: complete migration playbook — pre-migration product decisions, 5 phases (infra, database, auth, data layer, realtime), permission gaps, launch checklist
- REALTIME.md: Supabase Realtime channels (4), TanStack Query feature mapping, RLS requirements, channel lifecycle
- All known icon references verified against ICONS dict
- Team scores are now computed from data, not hardcoded
- Expense splits now keyed by userId, not first names
- DESTINATION_LOCK and DATE_POLL globals eliminated — data now lives on trip objects as `lockedDestination` and `datePoll`
- All user IDs unified — single format (plain IDs, no prefixes)
- All votes, comments, and date polls reference stable IDs instead of array indexes
- Trip status is now derived dynamically via getTripStatus(trip) — no status field on trip objects
- In-app notification system live — bell icon in TopNav with unread count, dropdown panel, 4 triggers wired
- PERMISSIONS.md created — complete permission matrix for all actions × roles, with RLS migration notes

## Completed Tasks
- [x] 0.1 — Send icon added to ICONS dict (line 197)
- [x] 0.2 — Competition Explainer icon rendering fix (line 1679)
- [x] 0.3 — computeTeamScores(event) function added (~line 462); replaces hardcoded scores in Dashboard, HomeTab (TripDetail), and LiveLeaderboard
- [x] 0.4 — EXPENSES splitAmong changed from { name } to { userId }; ExpenseRow now uses userId as Set key and resolves display names via nameById lookup
- [x] 0.5 — Dashboard greeting now uses ROLE_USERS[viewerRole].name, updates with dev role switcher
- [x] 1.1 — Unified user identity: removed `p-` prefix from all 16 BBMI_EVENT player `_id` values, updated group `playerIds` arrays, fixed attendee role mapping comparisons, removed `p-` prefix from BBMI_HISTORY userIds, removed `user-` prefix from KNOWN_ACCOUNTS userIds, fixed TripSettingsPanel transfer filter (`'user-brad'` → `'brad'`)

## Notes from 0.3
- Old hardcoded values (6.5/8.5) did NOT match mock data — they were arbitrary placeholders
- Computed values from ROUND_RESULTS + sides[].result: team-a: 10, team-b: 13

## Notes from 1.1
- Three identity patterns existed: CURRENT_USER._id='zach', players._id='p-zach', attendees.userId='zach'
- Standardized on plain IDs without prefixes: 'brad', 'zach', 'jd', etc.
- The `ghost-` prefix for manually-added no-account users was left as-is (different concept — runtime-generated placeholder IDs)
- SERIES_HISTORY was already keyed by unprefixed IDs — no change needed
- computeTeamScores only uses team IDs (team-a, team-b) — no impact
- Expense splitAmong uses BBMI_EVENT.players.map(p => ({ userId: p._id })) — now generates unprefixed IDs, matching attendees and nameById lookups

## Completed Tasks (continued)
- [x] 1.2 — Replaced array indexes with stable IDs for votes: added `_id` to ideas, proposedDates, and DATE_POLL windows; replaced `ideaIndex` with `ideaId` in IDEA_VOTES, IDEA_COMMENTS, and all component logic (TripDetail HomeTab, IdeaComparison); replaced `proposedDateIndex` with `dateId` in DATE_VOTES; replaced `windowIdx` with `windowId` in DATE_POLL votes; replaced `lockedIdx` with `lockedId`; ensured all new idea/window creation generates `_id`

## Notes from 1.4
- TEAM_ASSIGNMENTS lives at module level, after BBMI_EVENT closes and before MOCK_TRIPS
- getTeamId(eventId, userId) returns null if not assigned — safe for future trips where a player has no team yet
- The `t.members?.includes()` pattern in TripMessages was dead code (no `members` array on team objects) — replaced with the correct getTeamId lookup
- computeTeamScores is unaffected — it never read teamId from players, it only reads team-keyed point totals from ROUND_RESULTS and sides[].result
- Next task (1.5) is the symmetric cleanup: remove groupId from player objects and rely solely on groups[].playerIds

## Notes from 1.3
- DESTINATION_LOCK pre-populated for 'trip-bbmi-live' with `{ title: 'Bandon Dunes', location: 'Bandon Dunes, OR', createdAt: new Date('2024-08-20') }` — this represents the trip that was already booked
- ROUND_RESULTS now has `submittedBy` and `createdAt`; `computeTeamScores` was already safe (uses `if (teamId in totals)` guard — non-team keys skipped without any code change)
- Dates tell a story: BBMI 2025 lodging booked Nov 2024, greens fees Nov 2024, expenses logged during the March 2025 trip; BBMI 2026 idea votes in Jan 2026, date poll votes in Feb 2026; BBMI 2027 attendees joined Feb 2026
- `updatedAt` added to EXPENSES and RESERVATIONS only (immutable records like votes don't warrant it)
- All runtime vote/lock creation handlers now stamp `createdAt: new Date()` at the moment of interaction

## Notes from 1.2
- Ideas now have `_id` fields: 'idea-scottsdale', 'idea-bandon', 'idea-scottsdale-2027'
- Proposed dates have `_id` fields: 'pd-mar-2026', 'pd-oct-2026'
- DATE_POLL windows have `_id` fields: 'dw-mar-2026', 'dw-oct-2026'
- New ideas/windows created at runtime generate IDs via `Date.now()` suffix
- IdeaComparison `IdeaCard` still receives `idx` (array position) for internal pro/con/description editing — this is fine since those operations are position-based within the local state array
- `lockedIn` state in IdeaComparison now stores idea `_id` instead of index
- `showLockConfirm` state now stores idea `_id` instead of index
- `mobileIdx` in IdeaComparison remains an index (for carousel navigation) — this is UI state, not data identity

## Completed Tasks (continued)
- [x] 1.3 — Added createdAt/updatedAt/joinedAt/submittedBy timestamps to all mock data objects: IDEA_VOTES, DATE_VOTES, DATE_POLL votes, DESTINATION_LOCK, EXPENSES, RESERVATIONS, ROUND_RESULTS, and trip attendees across all 3 MOCK_TRIPS entries; also updated all runtime vote/lock creation handlers to stamp new Date()
- [x] 1.4 — Normalized team membership: created TEAM_ASSIGNMENTS array `[{ eventId, teamId, userId }]`, added getTeamId(eventId, userId) helper, removed teamId from all 16 BBMI_EVENT.players objects, updated 4 component call sites (TripDetail teams accordion, LiveLeaderboard team roster, LiveLeaderboard group player chips, TripMessages myTeam lookup)
- [x] 1.5 — Normalized group assignments: removed groupId from all 16 BBMI_EVENT.players objects; groups[].playerIds was already the sole source of truth and no component read p.groupId, so no component changes needed
- [x] 1.6 — Created USERS lookup object (19 entries: all 16 BBMI players + mike/paul/lance from invite flow); removed userName from IDEA_VOTES, DATE_VOTES, IDEA_COMMENTS, TRIP_MESSAGES; removed name from DATE_POLL votes; changed paidByName → paidByUserId on EXPENSES; updated 7 render sites and 4 runtime creation handlers to resolve names via USERS[userId]

## Notes from 1.6
- USERS keyed by plain userId (same format as all other IDs since task 1.1)
- Render pattern: `USERS[id]?.nickname || id` for display names; `USERS[id]?.name || id` for Avatar (needs full name for initials)
- paidByName 'Grether' mapped to paidByUserId 'zach' — nickname resolved at render time
- KNOWN_ACCOUNTS inline in TripSettingsPanel left as-is (it's a component-local lookup for the invite flow; 1.6 notes it's now redundant and can be replaced with USERS in a future cleanup)
- Phase 1 data model tasks are now complete (1.1–1.6)
- [x] 2.1 — Lifted MOCK_TRIPS to App-level useState; TripNew.handleFinish now builds a real trip object and pushes it onto state; all 5 consuming components (Dashboard, TripDetail, CompetitionSetup, IdeaComparison, TripMessages) updated to accept trips prop; no component reads MOCK_TRIPS directly any more
- [x] 2.2 — Added getTripStatus(trip) function; removed status field from all 3 MOCK_TRIPS entries and TripNew.handleFinish template; replaced all trip.status / t.status reads (Dashboard filters ×4, TripCard ×3, TripDetail isLive, TripDetail header badge) with getTripStatus() calls

## Notes from 2.1
- MOCK_TRIPS remains as the module-level initializer — `useState(MOCK_TRIPS)` in App
- setTrips passed to TripNew only; all other screens are read-only consumers of trips
- New trip shape mirrors existing trips: comparisonMode=true when 2+ ideas, comparisonMode=false when known destination or 1 idea
- 1-idea vote path creates the trip with comparisonMode=false and no ideas[] — user will see the normal planning view (destination can be set from there)
- Attendees array seeded with CURRENT_USER as Owner (joinedAt: new Date())
- DESTINATION_LOCK, DATE_POLL are still module-level mutable objects — task 3.2 will move them onto trip objects once trips are stateful (which they now are)

## Notes from 2.2
- getTripStatus(trip) placed immediately before computeTeamScores (after all mock data is defined so DESTINATION_LOCK and DATE_POLL are in scope)
- Status derivation order: completed (end date in past) → active (start date today or earlier) → ready (dest + dates locked) → planning
- DESTINATION_LOCK[trip._id] checked for locked destination; also handles non-comparisonMode trips that have trip.location directly
- DATE_POLL[trip._id]?.lockedId checked for locked date window; also handles trips with trip.startDate directly
- No status field exists anywhere in the data layer — fully derived at render time

## Completed Tasks (continued)
- [x] 2.3 — Built notification event layer: NOTIFICATION_EVENTS array with 5 seed entries, pushNotification() helper, formatNotification() + notificationIcon() + notificationColor() display helpers, bell icon in TopNav with unread count badge, dropdown panel with time-ago formatting and click-to-navigate, mark-as-read on open; wired 4 triggers (destination locked, dates locked, crew added, chat message); score_submitted trigger ready for task 2.4

## Notes from 2.3
- NOTIFICATION_EVENTS is a module-level array (same pattern as DESTINATION_LOCK, DATE_POLL) — will move to trip-level or server state in migration
- pushNotification() generates unique IDs via `Date.now()` + random suffix
- App-level state uses a `notifNonce` counter to force re-renders when new notifications are pushed (since the array itself is module-level)
- `notifyAndRefresh` callback passed as `notify` prop to TripDetail, IdeaComparison, TripMessages — the 3 screens with mutation handlers
- `notifications` and `onMarkAllRead` props passed through all 7 screen components → TopNav via `navProps` spread
- TopNav now accepts `notifications` and `onMarkAllRead` props; renders bell icon (accent-colored when unread), unread count badge (red, caps at 9+), and a dropdown panel with click-outside-to-close
- TripChat component gained `onSend` callback prop — called after message is added to state, used by TripMessages to fire chat_message notifications
- TripSettingsPanel gained `notify` prop — used by handleAddToRoster and quickAdd for crew_added notifications
- 5 seed notifications: 2 historical (read), 3 recent (2 unread) — bell shows "2" on first load
- Notification event schema: `{ _id, type, tripId, actorId, payload, createdAt, readAt }`
- Supported types: destination_locked, dates_locked, crew_added, chat_message, score_submitted
- Score submitted trigger: no score entry UI exists yet (task 2.4), but the type is fully supported in seed data and display helpers — wire-up will be a single `notify()` call when score entry is built
- Dropdown shows up to 20 most recent events, sorted newest first, with type-specific icons and accent colors
- Clicking a notification navigates to that trip's detail view

## Completed Tasks (continued)
- [x] 2.4 — Built ScoreEntry component and GROUP_RESULTS data layer; wired group card tap handler in LiveLeaderboard Groups tab; score submission updates GROUP_RESULTS → aggregates into ROUND_RESULTS → recomputes via computeTeamScores; fires score_submitted notification; scramble and stableford fully functional; sabotage and skins show "not yet implemented" stub

## Notes from 2.4
- GROUP_RESULTS is a new module-level object: `{ [roundId]: { [groupId]: { 'team-a': pts, 'team-b': pts, submittedBy, createdAt } } }`
- Each group is worth 1 point total. Result is win (1-0), halve (0.5-0.5), or loss (0-1). Ryder Cup format.
- `aggregateGroupResults(roundId)` sums all group results for a round into ROUND_RESULTS, preserving the latest submitter as submittedBy
- Seed data: GROUP_RESULTS pre-populated for rounds r1 and r2 with per-group breakdowns that sum to match existing ROUND_RESULTS values (2.5-1.5 and 1.5-2.5)
- ScoreEntry component: bottom-sheet overlay with group roster (split by team), 3-way result selector (Team A wins / Halved / Team B wins), points preview, submit button
- Existing results shown with green "Scored" indicator and score on group cards; unscored groups show "Enter score" with edit icon
- Groups tab header now uses active round data dynamically instead of hardcoded "Round 3 · Sabotage · Pacific Dunes"
- `scoreNonce` state forces re-render of LiveLeaderboard when scores change (since GROUP_RESULTS is module-level)
- LiveLeaderboard now accepts `notify` prop; App passes `notifyAndRefresh` to it
- Score_submitted notification now fully wired (was stubbed in 2.3)
- Sabotage and skins formats show a stub with format-specific message: "Sabotage elimination tracking coming soon" / "Skins payouts coming soon"
- Round 3 (active) is Sabotage format — tapping a group opens the stub. To test full score entry, change round r3's format to 'scramble' or r3's status to test with a scramble round.

## Completed Tasks (continued)
- [x] 2.5 — Implemented team chat privacy: restructured TRIP_MESSAGES[tripId].team from a flat array to an object keyed by teamId; TripMessages and TripDetail now use getTeamId() to load only the current user's team channel; added "You're not on a team yet" placeholder for unassigned users; added team-b seed messages; corrected rob's message (he's team-b per TEAM_ASSIGNMENTS)

## Notes from 2.5
- TRIP_MESSAGES[tripId].team shape changed: was `[...msgs]`, now `{ 'team-a': [...], 'team-b': [...] }`
- TripMessages: myTeamId = getTeamId(BBMI_EVENT._id, CURRENT_USER._id); myTeamMsgs = TRIP_MESSAGES[tripId]?.team?.[myTeamId] || []
- TripDetail inline teamMessages uses same pattern via myTripDetailTeamId variable
- Dev role switcher does NOT affect team visibility — team is fixed by TEAM_ASSIGNMENTS regardless of viewerRole
- 'trip-new-deciding' team changed from [] to {} to match new shape

## Completed Tasks (continued)
- [x] 2.6 — Added expense creation: AddExpenseForm in MoreTab with title, amount, paid-by dropdown, split-among checkboxes; pushes to EXPENSES array and updates local expenseList state; gated on canEdit; Trip Total and Your Share update after add

## Notes from 2.6
- AddExpenseForm is a nested function inside MoreTab (same scope as ExpenseRow)
- MoreTab now owns `expenseList` state (initialized from EXPENSES.filter) and `addExpenseOpen` state
- On submit: push to EXPENSES module-level array + setExpenseList(EXPENSES.filter(...)) to trigger re-render
- Add button hidden while form is open; Cancel/submit both call onClose() which sets addExpenseOpen=false
- "Just me" shortcut in split-among resets to Set([paidBy]) — sensible default when someone pays solo
- Per-person preview only shows when parsedAmount > 0
- Phase 2 (Missing Features) is now complete (2.1–2.6)

## Completed Tasks (continued)
- [x] 3.1 — Extracted scoring engine into pure function computeScores(event, roundResults): parameter instead of ROUND_RESULTS global, returns { ...teamTotals, remaining }; removed manual remaining calc from LiveLeaderboard; all 3 call sites updated; old computeTeamScores removed

## Notes from 3.1
- computeScores(event, roundResults) — both arguments required at every call site
- remaining = totalPossible - awarded, where totalPossible = sum(r.pointsAvailable) + sum(s.pointsAvailable)
- awarded = Object.values(totals).reduce(...) — sums all team point totals
- The `remaining` key in the return object doesn't collide with any team ID since team IDs are 'team-a'/'team-b'
- LiveLeaderboard previously computed totalPossible + remaining inline — those 2 lines removed, replaced with scores.remaining
- scoreNonce still needed to force LiveLeaderboard re-render when GROUP_RESULTS mutates (computeScores is pure but LiveLeaderboard is a plain function call, not a hook)

## Completed Tasks (continued)
- [x] 3.2 — Replaced DESTINATION_LOCK / DATE_POLL globals with trip-level state: added `lockedDestination` and `datePoll` fields to all 3 MOCK_TRIPS entries and TripNew template; updated getTripStatus() to read from trip object; TripDetail lockedDest/setLockedDest now derived from trip state via setTrips; syncDatePoll now writes via setTrips; IdeaComparison lock/unlock/override all write via setTrips; removed both module-level globals; passed setTrips prop to TripDetail and IdeaComparison from App

## Notes from 3.2
- `lockedDestination` shape: `{ title, location, createdAt }` or `null` — same shape as old DESTINATION_LOCK values
- `datePoll` shape: `{ open, lockedId, windows: [], votes: [] }` or `null` — same shape as old DATE_POLL values
- TripDetail's `lockedDest` is now a derived value (`trip.lockedDestination || null`), not useState — avoids stale state divergence
- TripDetail's `setLockedDest` is a convenience function that calls `setTrips(ts => ts.map(...))`
- TripDetail's `syncDatePoll` now calls `setTrips` instead of mutating the module-level DATE_POLL object
- IdeaComparison writes destination lock directly via `setTrips` (3 write sites: lock confirm, reopen vote, manual override)
- TripNew sets `lockedDestination` on new trips with known destination (title + location from form input)
- getTripStatus() now reads `trip.lockedDestination` and `trip.datePoll` instead of globals — no functional change
- No `scoreNonce` equivalent needed — destination lock and date poll changes now trigger React re-renders naturally via `setTrips`
## Completed Tasks (continued)
- [x] 3.3 — Created PERMISSIONS.md: audited every isOwner (25), canEdit (43), viewerRole (3), and member.role (2) check in the prototype; documented all actions across 10 categories (Trip Management, Destination, Ideas, Dates, Quick Info Tiles, Crew, Competition, Logistics, Expenses, Messages); included RLS migration notes and 5 open questions for production

## Notes from 3.3
- Three-tier model: Owner (full control), Planner (planning authority), Member (vote/chat/view)
- `isOwner` gates: destination lock/unlock, crew role management, trip settings, quick info tiles, expense editing, idea removal
- `canEdit` (Owner+Planner) gates: description editing, idea/destination addition, date management, competition setup, crew addition, expense creation
- No role check: destination voting, date voting, idea commenting, chat messaging, score entry
- Team chat privacy is enforced by TEAM_ASSIGNMENTS lookup, not by role — all 3 roles see only their own team's chat
- Score entry (LiveLeaderboard) has NO role gating at all — flagged as open question for production
- TripSettingsPanel (series, transfer, archive, delete) is fully owner-gated at the render level (line 2991)
- `isMe` pattern prevents self-promotion/demotion/removal — uses hardcoded userId mapping per role (Owner→brad, Planner→zach, Member→rob)
## Completed Tasks (continued)
- [x] 3.4 — Created types.ts with complete TypeScript interfaces for all 25+ entities: User, Series, Trip (with LockedDestination, DatePoll, DateWindow, DatePollVote, ProposedDate), TripMember, Idea, IdeaVote, IdeaComment, DateVote, Event, Team, Player, TeamAssignment, PlayGroup, Round, SideEvent, RoundResult, GroupResult, Reservation, Expense, ExpenseSplit, Message, NotificationEvent (with typed payloads), SeriesHistory, PastParticipant, QuickInfoTile, TripStatus, ScoreSummary

## Notes from 3.4
- `types.ts` is a reference document, not imported by the prototype — it defines the migration target schema
- Each top-level interface maps to a database table; embedded interfaces (DatePoll, LockedDestination) annotated as column-or-table decisions
- Union types defined for enums: TripRole, RsvpStatus, RoundFormat, RoundStatus, EventStatus, MessageChannel, NotificationType, ReservationType, TripStatus
- NotificationPayloads uses a mapped type so payload shape is type-safe per notification type
- DATE_VOTES and DatePollVote coexist in the prototype (different field names: dateId/availability vs windowId/answer) — noted for consolidation during migration
- RoundResult and GroupResult use index signatures for team scores plus fixed metadata fields (submittedBy, createdAt) — in production, normalize into separate columns
- QuickInfoTile is component-local state in the prototype (not persisted to module-level data) — needs tripId and createdBy in production
- Message in prototype lacks tripId/channel/teamId (inferred from TRIP_MESSAGES nesting) — production table needs explicit columns
- ExpenseSplit.amount is commented as not-yet-implemented (currently even split)
- SeriesHistory and PastParticipant are component-local display data; in production, derive from trip_members + events tables
- lockedDestination stored as Trip field per PLAYBOOK decision point 3.4 (not separate entity)
## Completed Tasks (continued)
- [x] 4.1 — Audited all list/section areas for empty states; added 3 fixes: (1) Dashboard Past Trips section was declared but never rendered — now shows collapsible toggle with count below Upcoming; (2) Dashboard shows an icon + message + New Trip CTA when live/ready/upcoming are all empty; (3) Schedule tab "No bookings yet" enriched with ClipboardList icon and canEdit CTA hint

## Notes from 4.1
- `past` array and `pastExpanded` state were already declared at Dashboard top (lines 924, 928) — the section was just never in the JSX
- Empty state for no trips only fires when all three sections (live/ready/upcoming) are empty — past trips section renders separately below
- Schedule tab Add button was already visible for canEdit; the empty state message now points to it explicitly
- All other sections already had appropriate empty states (expenses, messages, description, ideas, date panel, competition)
## Completed Tasks (continued)
- [x] 4.2 — Audited all 7 screen navigation paths; fixed 4 bugs: (1) LiveLeaderboard "← TRIP HOME" hardcoded 'trip-bbmi-live' — now accepts tripId prop with fallback; (2) all 3 navigate('live-leaderboard') call sites now pass tripId; (3) TripNew breadcrumb root changed 'Dashboard' → 'Trips' for consistency; (4) CompetitionSetup mode picker had no Cancel button — added "← Cancel" back to trip-detail

## Notes from 4.2
- Navigation audit: 7 screens × multiple entry/exit points checked
- All breadcrumbs now consistent: root always "Trips" (screen: 'trips')
- LiveLeaderboard is tightly coupled to BBMI mock data but tripId is now wired through; 'trip-bbmi-live' fallback handles direct URL access
- CompetitionSetup already had breadcrumb "Trips > {trip} > Competition Setup" and correct post-submit navigation; the only gap was the mode picker had no explicit Cancel
- All other paths (TripDetail tabs, IdeaComparison, TripMessages, TripNew) had correct round-trip navigation already
- Next task: 4.4 — Add a "completed" trip to mock data (Sonnet recommended)

## Completed Tasks (continued)
- [x] 4.3 — Complete user journey audit per role (Owner, Planner, Member): tested all navigation paths, permissions, and data mutations across full lifecycle; fixed 4 bugs; documented 5 permission gaps and 2 dead ends

## Notes from 4.3

### Bugs Fixed
1. **CRITICAL — Line 5100:** `totalPossible` referenced in LiveLeaderboard Overview tab but not defined in scope — caused ReferenceError crash. Fixed: replaced with `ptsA + ptsB + remaining` (derived from `computeScores` return value).
2. **Dashboard TripCard role badge (line 962):** Hardcoded `<RoleBadge role="Planner" />` for every trip card regardless of viewer's actual role. Fixed: resolves viewer's role from trip attendees using `roleUserIds[viewerRole]`.
3. **TripNew co-planners discarded (line 1157):** Invites added during Step 1 were collected in state but never included in `newTrip.attendees` in `handleFinish()`. Fixed: invites are now mapped to attendees with role 'Planner' and USERS lookup for known accounts.
4. **ROLE_USERS member name mismatch (line 5319):** Member role labeled as 'Buddy' but `roleUserIds` maps member to 'rob'. Fixed: changed to 'Rob'.

### Audit Results by Role

**Owner (brad):** 11/13 steps PASS, 2 PARTIAL
- PARTIAL: Trip goes live — no explicit "Go Live" action; `hasComp` local state resets on re-render
- PARTIAL: Enter scores — active round (Sabotage) format not supported; only scramble/stableford work
- All Owner-gated actions (lock destination, manage crew roles, trip settings, archive/delete) work correctly

**Planner (zach):** 8/8 steps PASS
- All canEdit-gated actions work correctly (add ideas, manage dates, set up competition, add crew, add expenses)
- Correctly blocked from Owner-only actions (lock destination, manage roles, trip settings)
- Quick Info Tiles gated by `isOwner` instead of `canEdit` — flagged as design decision, not changed

**Member (rob):** 5/8 steps PASS, 3 PARTIAL/FAIL
- PASS: Open trip, view destination vote, view leaderboard, notification bell
- PARTIAL: Cast vote — works but recorded under CURRENT_USER (zach), not rob
- PARTIAL: Send message — works but attributed to zach; team chat shows wrong team (team-a instead of team-b)
- FAIL: Score entry — no role gating at all; LiveLeaderboard doesn't receive viewerRole prop

### Permission Gaps Documented (not fixed — product decisions)
1. Score entry has zero role gating — any user can submit scores (LiveLeaderboard missing viewerRole prop)
2. Members cannot comment on ideas — commenting only in IdeaComparison view which requires canEdit to access
3. Quick Info Tiles gated by isOwner — Planners cannot manage them
4. CURRENT_USER never switches with role switcher — all mutations use zach's identity regardless of role
5. No self-service RSVP for Members — cannot update own attendance status
6. Dashboard doesn't filter trips by membership — Rob sees trips he's not on (trip-new-deciding)

### Dead Ends
- `hasComp` state in TripDetail is local — toggling competition on, navigating away, and coming back resets it unless `trip.eventId` is set
- Sabotage and Skins score entry formats are stubbed — active round (r3) can't be scored

## Completed Tasks (continued)
- [x] 4.4 — Added 'trip-bbmi-2024' (BBMI 2024) to MOCK_TRIPS: past dates (Mar 12–15 2024), lockedDestination (Bandon Dunes), 8 attendees, description with final scores (Team Hammer 14–12); auto-derives as 'completed' via getTripStatus(); added matching TRIP_MESSAGES entry with 3 post-trip messages; Past Trips toggle on Dashboard now shows (1)

## Notes from 4.4
- BBMI 2024 shape mirrors existing trips: comparisonMode=false, ideas=[], proposedDates=[], eventId=null
- endDate '2024-03-15' is 23 months before today — getTripStatus() returns 'completed' without any status field
- lockedDestination set so getTripStatus() status derivation hits the 'completed' branch (past endDate) rather than falling through to 'planning'
- TRIP_MESSAGES entry added so TripDetail Messages tab renders without errors; team={} since no competition event for this trip
- TripCard renders cleanly for completed trips: no accent bar, no scoreboard strip, "Done" StatusBadge in muted color
- Past Trips section was already wired (task 4.1) — toggle now shows (1) on first load

## Completed Tasks (continued)
- [x] 5.1 — Rewrote README.md: full screen inventory with route keys and props for all 7 screens; TripDetail tab breakdown; navigation graph (BottomNav context-awareness, breadcrumb patterns, visual flow diagram); data architecture (14 module-level objects, 5 helper functions, trip-level state, messages shape, notification types); design system CSS vars; permission model summary; reference document index; corrected stale info (DESTINATION_LOCK/DATE_POLL globals → trip-level state, team messages shape, member role user name, mock trips table with BBMI 2024, 4-status model including completed)
- [x] 5.2 — Created SCHEMA.md: 25 tables derived from types.ts, annotated with required-at-creation fields (`*`), server-computed fields (`auto`), FK relationships, indexes, constraints, RLS notes, payload shapes for notification types, circular FK resolution for trips↔events, updated_at trigger SQL, and ordered table creation list
- [x] 5.3 — Created REALTIME.md: decision matrix (5 realtime, 2 polling, 8 TanStack Query); 5 Supabase Realtime channel specs with code examples (trip chat, team chat, group_results, side_events, notifications); TanStack Query config, query key mapping, polling for vote counts; Realtime publication SQL; RLS requirements per table; channel lifecycle table; reconnect pattern; prototype→production mapping; implementation order
- [x] 5.4 — Created MIGRATION_PLAN.md: 3 blocking pre-migration product decisions (#11 co-planner validation, #13 series ownership, #16 competition without trip); 5 non-blocking UX decisions; 5 permission gaps with recommended fixes; 5-phase migration plan (infra → database → auth → data layer → realtime); launch checklist; v2 backlog

## Notes from 5.1
- README now serves as the definitive handoff document — a migration dev can read it and understand every screen, route, data object, and interaction pattern
- Corrected multiple stale references: DESTINATION_LOCK/DATE_POLL globals (eliminated in 3.2), messages team shape (changed in 2.5), member user 'Buddy' → 'Rob' (fixed in 4.3), missing 'completed' status (added in 2.2/4.4)
- Added note about mock trip dates vs real-time derivation: BBMI 2025 shows as 'completed' after March 2025 because getTripStatus uses new Date()
- Navigation graph section is new — documents BottomNav context switching (3 items outside trip, 4 inside), which screens show/hide BottomNav, and a visual flow diagram
- Data architecture section replaces scattered mentions — consolidated all 14 module-level objects, helper functions, and the trip-level state pattern into one reference
- Added Key Engineering Rules #3 (state via setTrips) and #4 (module-level arrays need nonces) — these patterns caused bugs before and the migration dev needs to know

## Notes from 5.2
- trips↔events is the only circular FK in the schema — resolved with deferrable constraints (documented in creation order section)
- `round_results` from the prototype should be a Postgres VIEW, not a table — it's always derived from `group_results`; documented as such
- `notification_reads` doesn't exist in the prototype (mark-all-read only); added as a separate join table for per-user read state in production
- `side_events.result` kept as JSONB for now; normalizing into `side_event_results(side_event_id, team_id, points)` is noted as an option
- `play_groups.player_ids` kept as text[] (matches prototype shape); noted that a join table would be needed if per-player group queries are required
- `expense_splits.amount` stays nullable even though it's not implemented — avoids a migration later when per-person overrides are added
- `date_polls` has trip_id as PK (enforces one-poll-per-trip constraint); `locked_window_id` FK is a forward reference — handle with deferrable constraint
- `players` table denormalizes name/nickname intentionally — historical competition records should reflect the player at event time, not current user profile
- Phase 5 is complete (5.1–5.4 done)

## Notes from 5.3
- 4 Realtime channels: trip chat, team chat, live scores (group_results), notifications
- Side events piggyback on the leaderboard channel (same eventId, same lifecycle)
- Idea votes and date poll votes use polling (refetchInterval: 30s), not Realtime — group is small, lag is acceptable
- group_results needs `event_id` denormalized column for Supabase filter (documented in schema addition section)
- Notifications use IN filter on trip IDs — fine for BuddyTrip scale; documented server-side fan-out alternative for larger scale
- Reconnect: invalidate TanStack Query on `system` channel event to catch missed updates during disconnect
- Implementation order: leaderboard first, then notifications, then chat — highest stakes first

## Completed Tasks (continued)
- [x] 6.1 — Bug/UX/hidden-requirements pass on buddytrip.html: 8 fixes + 3 new features; see Notes from 6.1

## Notes from 6.1
Bugs fixed:
- B2: `hasComp` local state diverged from `trip.eventId` on back-navigation — replaced `useState(!!trip.eventId)` with derived value `!!trip.eventId || !!trip.hasComp` and a `setHasComp` that persists to trip via `setTrips`
- B3: `KNOWN_ACCOUNTS` array in CrewTab was redundant — replaced with `Object.values(USERS).find(u => u.email?.toLowerCase() === ...)` using the existing `USERS` global (which already has email fields for mike/paul/lance); changed `account.userId` → `account._id` to match USERS shape

UX improvements:
- U1+U2: Crew removal and demotion now show an inline confirmation prompt (danger-colored bar with Confirm/Cancel) instead of acting immediately; `confirmAction` state tracks pending action
- U3: Expense split "Done" button now calls `showToast('Split updated')` when transitioning from editing to done
- U4: TripNew trip name field now shows inline "Trip name is required" error when field is blurred empty; clicking Next while empty also triggers the error; `tripNameTouched` state tracks first-touch

Hidden requirements implemented (v1):
- H1: Full Add Booking form in ScheduleTab — type selector (6 types with icons), title+date (required), time/confirmation/cost/notes (optional); pushes to RESERVATIONS array, updates local `resList` state; `addBookingOpen` toggle hides the + Add button while form is open
- H2: Sabotage and Skins score entry now fully implemented in ScoreEntry component:
  - Sabotage: uses same 3-way result selector (team-a wins / halved / team-b wins) with a descriptive subtitle about net result after sabotage plays
  - Skins: dedicated numeric input per team for total skins won this round; team-colored input boxes; `skinsA`/`skinsB` state; validation requires non-negative integers
- H6: Score entry now role-gated — `viewerRole` prop added to LiveLeaderboard signature and passed from App; `const canScore = viewerRole === 'owner' || viewerRole === 'planner'`; group cards non-clickable for members (cursor:default); "Enter score" label replaced with "🔒 Pending" for non-scorers

## Completed Tasks (continued)
- [x] 7.1 — Light/dark theme toggle: added Moon icon to ICONS; `[data-theme="light"]` CSS block with full accessible WCAG-AA palette; `--bt-purple`, `--bt-purple-bg`, `--bt-blue` tokens added to both modes; body transition (.2s); App-level theme state with localStorage persistence and `prefers-color-scheme` OS default; `toggleTheme` passed to TopNav via navProps; sun/moon toggle button in TopNav with hover effects; fixed hardcoded colors throughout: notification dropdown shadow, dev role switcher, StatusBadge ready state, TripCard ready/countdown, TripDetail "Ready to Go" label, TripMessages team chat header, all BuddyTrip account indicator dots

## Notes from 7.1
- Light mode palette designed for WCAG 2.1 AA compliance: `#007d67` (teal, 4.6:1 on white), `#6d3ec9` (purple, 6.6:1), `#1a58bd` (blue, 6.7:1), `#a05e08` (owner amber, 4.7:1), `#d1242f` (danger, 5.1:1)
- Dark mode vibrant `#00d4aa` teal NOT changed — it's decorative on dark backgrounds and passes AA there
- `prefers-color-scheme: light` sets light mode as default on light OS; dark OS defaults to dark mode
- localStorage key: `bt-theme` — persists across sessions
- Pie chart `SEGMENT_COLORS` in IdeaComparison left hardcoded intentionally (decorative visualization)
- `teamColorDim` values on team JS objects (`#0d2a22`, `#2a1200`) intentionally not tokenized — these are team identity colors
- Field Mode (Option B — bumped font sizes + larger tap targets for outdoor scoring) logged for future work after user testing of light mode outdoors

## Completed Tasks (continued)
- [x] 7.2 — Dashboard membership filter: added `viewerUserId` derivation from `roleUserIds[viewerRole]`; filter `myTrips = trips.filter(t => t.attendees.some(a => a.userId === viewerUserId))` before splitting into live/ready/upcoming/past; removed duplicate `viewerUserId` inside TripCard (now closes over outer scope)
- [x] 7.3 — Self-service RSVP: added RSVP status widget in expanded MemberRow panel (only shown when `isMe`); 4 status buttons (✅ I'm in / 🤙 Likely / 🤷 Maybe / ❌ Can't go) with active-state styling; calls `setRoster` (consistent with all other crew mutations in CrewTab); shows toast confirmation
- [x] 7.4 — Members can comment on ideas: removed `canEdit` gate from "Full view" button in the HomeTab destination vote panel — all members can now navigate to IdeaComparison; IdeaComparison comment/vote UI was already ungated; `canEdit` gates on pros/cons editing and lock/unlock actions remain
- [x] 7.5 — Quick Info Tiles: changed all 5 `isOwner` references in the tiles section to `canEdit` — Planners can now add, edit, and delete tiles

## Notes from 7.2–7.5
- P2: Rob (member role) no longer sees 'trip-new-deciding' on Dashboard since he's not in that trip's attendees
- P3: RSVP widget appears in crew panel when viewing your own row (isMe check) — works for all 3 roles
- P4: IdeaComparison already had ungated comment input; the only blocker was canEdit-gated navigation access
- P5: Tiles section visibility condition changed from `tiles.length === 0 && isOwner` to `tiles.length === 0 && canEdit` and `tiles.length > 0 || isOwner` to `tiles.length > 0 || canEdit`

## Completed Tasks (continued)
- [x] 7.6 — Product decisions resolved (P6–P8):
  - P6 (#11 co-planner validation): **Require account** — TripNew invite now validates against USERS (name/nickname/email match); unrecognized names get inline error; ghost fallback removed from `handleFinish`; `invites` state changed from `string[]` to `User[]`
  - P7 (#13 series ownership): **Explicit `owner_id` column** — added `ownerId` field to MOCK_SERIES; SCHEMA.md `series` table updated with `owner_id FK → users.id`; MIGRATION_PLAN.md updated
  - P8 (#16 competition without trip): **Skip for v1** — no code change needed; `events.trip_id NOT NULL` remains; recorded in MIGRATION_PLAN.md

## Notes from 7.6
- All three blocking pre-migration product decisions are now resolved — MIGRATION_PLAN.md §Pre-Migration Product Decisions and §Must-fix before launch are both fully checked off
- TripNew invite input placeholder changed to "Name, nickname, or email" to hint at account requirement
- Helper text updated to "Must have a BuddyTrip account"
- Error shown inline (danger color) in place of helper text when no match found
- Self-referential check: error if user tries to add themselves
- Duplicate check: error if already added
- `inviteError` cleared on any keystroke so it doesn't persist stale

## In Progress
- (none)

## Known Issues / Notes
- raw.githubusercontent.com blocked in Claude chat container
- ICONS dict: any missing icon fails silently (empty SVG, no error)
- CURRENT_USER is hardcoded to 'zach' — role switcher only changes viewerRole UI gating, not data identity

## Next Session Start Instructions
Read PLAYBOOK.md and CONTEXT.md before touching any code.
Work one task at a time. Update CONTEXT.md before ending session.
All PLAYBOOK tasks, pre-migration UX pass, and theme toggle complete.
All Tier 1 functional gaps and product decisions are complete (P2–P8).
Next: Tier 2 UX polish (any order):
- Dates TBD badge on Dashboard TripCard (#7)
- Tab scrollbar fix (#9)
- Messageboard mobile fit (#5)
- Co-planner step friction removal (#12) — remove "you must assign someone" requirement
- Message panel toggle on Trip Home (#15) — show/hide inline team chat
After that: Phase 0 infra setup (Supabase project, env, client, TanStack Query)
Tier 2 UX polish: Dates TBD badge, tab scrollbar, messageboard mobile fit
Field Mode: logged as future improvement after user testing of light mode outdoors

## CONTEXT.md instructions
Update CONTEXT.md with what we completed, what's in progress, and any notes the next session needs.
Upon completion of task, review suggested model for next task and tell me when I should switch to a different model for the next task when you write your summary.
Upon completion of task, commit all changes to a separate feature branch, push to remote, and create a PR.
