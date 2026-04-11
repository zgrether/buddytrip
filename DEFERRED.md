# BuddyTrip — Deferred Work

*Only genuinely open items. Organized by when they need to happen.*
*Last updated: 2026-04-05*

---

## Before Launch

Items that must be resolved before onboarding real (non-test) users.

### Apple OAuth

Needs Apple Developer account and domain verification. Low effort
once credentials are available — Supabase supports it natively.

**When:** after domain purchase.

---

### About panel email blast

When owner taps "Notify crew of update" on the About panel, currently
only fires in-app notifications. Should also send an email via Resend
to all crew members with the current about_message content.
Depends on: domain purchase + Resend custom sender setup.

---

### Swap Resend sender domain

Currently using `onboarding@resend.dev` (Resend's default shared
sender). Swap to `noreply@buddytrip.app` (or similar) once a custom
domain is purchased and verified with Resend.

**File:** `src/lib/email.ts` — change `FROM` constant.

---

### Admin email template management UI

Email templates are currently plain HTML strings in `src/lib/email.ts`.
Build an admin UI at `/admin/emails` for editing templates without
code changes.

**When:** after admin interface is built.

---

### Human-friendly trip URL slugs

Current: `/trips/2377695c-bcdc-44f1-a1fd-584dd2d001a4`
Target: `/trips/bbmi-2027`

**Approach:** add `slug text UNIQUE` to `trips`, generate from title at
creation, backfill existing trips, accept both slug and UUID in route
(UUID fallback for old links).

**When:** before first public user onboarding.

---

### Amelia Island catalog photo broken

One of the 20 seeded catalog ideas ("Amelia Island Getaway") has a broken
or missing `image_url`. Fix with a SQL UPDATE before next demo.

---

### Preserve polling data on Nevermind → Set dates

When the owner clicks "Nevermind, Set Dates Manually" and then locks
dates directly, the poll windows and votes silently linger in the DB.
Add a confirmation step asking whether to preserve the polling data
(so the owner can return to it later) or discard it (delete all
windows and votes). Currently the windows are always preserved, which
is safe but may confuse owners who expect a clean slate after
Neverminding.

---

---

### Date polling scope selection

The dates panel currently polls all crew members indiscriminately.
Owners should be able to select a subset of crew for date polling
(e.g. only the key people whose schedules constrain the decision)
rather than sending to everyone. Requires a crew selector UI on
the date poll setup flow and a filtered query for poll responses.

---

## Before BBMI 2026 (September Target)

Scoring features needed for the actual event.

### Carry-over scoring (halved holes)

When enabled on a round, halved holes accumulate a pot that carries to
the next hole. The scorecard must show each hole's current pot value.

**What to build:**
- `rounds.modifiers` JSONB column with `{ carryOver?: boolean }`
- `computeCarryPots()` function: pot starts at 1, increments on halve,
  resets to 1 after a winner
- Pot badge on hole column headers (×2, ×3, etc.)
- Carry indicator in ScoreEntry showing current pot
- Amber `carry` chip on round row in leaderboard

**Schema:** add `modifiers jsonb nullable` to `rounds`. Add `hole_results`
table (`round_id`, `group_id`, `hole_number`, `carry_value`, `winner_team_id`).

**Full spec:** was in SCORING_PLAYBOOK.md Task B.

---

### Moving tee boxes

Each player starts on the same tee box. After each hole, tee box shifts
based on score vs par: eagle → back 2, birdie → back 1, bogey+ → forward 1.
Configurable per round.

**What to build:**
- `movingTees` config in `rounds.modifiers`
- `computeTeeBoxes()` function: track per-player tee box state across
  18 holes with clamping at Black/Red ends
- 8px colored dot in scorecard cells showing current tee box
- Tee box config UI in round builder (start box selector, shift steppers)

**Schema:** add `player_hole_scores` table (`round_id`, `group_id`,
`hole_number`, `player_id`, `strokes`, `tee_box`).

**Full spec:** was in SCORING_PLAYBOOK.md Task C. This is the most
UI-intensive scoring feature — use Opus.

---

### Read-only scorecards (polish)

Closed rounds prevent score entry server-side, but there's no dedicated
read-only scorecard view. Group rows in the round summary should be
tappable to open a hole-by-hole view with non-editable cells.

**What to build:**
- `readOnly` prop on HoleByHoleEntry (display-only cells, no submit)
- Tappable group rows in round summary when hole data exists
- Seed hole-by-hole data for at least one past round for demo

---

### RSVP blast email (Task B — separate spec)

When owner advances to GOING, send RSVP email to all crew members.
Email includes trip details (destination, dates, RSVP message) and
a link to the trip. Currently stubbed with console.log.

**Also includes:**
- In/Maybe/Out RSVP tracking on crew tab
- RSVP panel on Home tab with selectors
- Headcount summary chip in crew tab header (GOING/NOW stage)

**Depends on:** stage model (done), Resend email integration (done).

---

## v2 / Post-Launch

Lower priority items. Build after core planning flows are stable and
the app has real users.

### Individual notification mark-as-read

Currently notifications can only be bulk marked as read via
"Mark all as read". Add per-notification mark-as-read so users
can dismiss individual items without clearing everything.
Requires: `trpc.notifications.markRead({ notificationId })` mutation
and UI dismiss button on each notification row.

---

### Schedule — day-by-day calendar view

Current schedule is a flat drag-and-drop list with optional date fields.
A proper calendar/day view would group items by trip day and show a
timeline. Requires locked start/end dates and day derivation logic.

---

### Logistics — confirmed/tentative toggle

Logistics items currently have no confirmed state. Add is_confirmed
boolean matching schedule items pattern, with READY stage alert for
unconfirmed logistics.

---

### Personal travel — flight lookup

Allow users to enter a flight number and have airline/arrival details
auto-populated via a flight status API. Nice-to-have, not essential.

---

### Notification auto-cleanup

Notifications older than 90 days accumulate indefinitely.
Add a Supabase scheduled function or trigger to delete
`notification_events` older than 90 days per user.

---

### Score submitted notifications

When a round score is submitted, notify trip owner and crew.
Deferred until competition/scoring spec is complete.
`type: 'score_submitted'`
`payload: { scorer_name, round_name, trip_name, trip_id }`

---

### Push notifications for action-driving events

`destination_locked` and `dates_locked` warrant push notifications
(not just in-app) since they signal crew members need to take
action (book travel, confirm attendance).
Depends on: PWA service worker or Capacitor native wrapper.

---

### D-Day countdown nudges

Automated check-ins at key milestones before the trip:
- D-30: RSVP check — notify owner if anyone hasn't responded
- D-14: Reservations check — prompt for booking confirmations
- D-7: Competition check — remind to set up teams/rounds

**When:** after push notifications or scheduled email system.

---

### NOW stage live behavior

What changes when the trip is actively happening:
- Messaging, scorecard, and schedule promoted front and center
- Real-time crew location sharing (optional)
- Trip dashboard optimized for in-the-moment use

**When:** after first real trip uses the app during travel.

---

### Save idea for future trip

Allow users to save/bookmark individual destination ideas for reuse in
future trips. Currently ideas are tied to a single trip and can only be
deleted — no save/archive mechanism exists.

**When:** after core idea zone is stable and has real usage.

---

### Remove ideaComments tRPC router (dead code)

The `ideaComments` router (`src/server/routers/ideaComments.ts`) and `idea_comments`
table are dead code after the idea zone integration removed per-idea chat threads
in favour of the trip-level crew chat. The router, its test file, and the table can
be deleted once confirmed no other feature depends on them.

**When:** next cleanup pass.

---

### Quick Score (no-auth scorecard)

Standalone scorecard for any game, no account required. Homepage CTA:
"or just keep score right now."

**Schema impact:** `events.trip_id NOT NULL` constraint stays for v1.
Quick Score requires making `trip_id` nullable — schema change.

---

### Competition without a trip

Same constraint as Quick Score. Use case: golf tournament organizer wants
scoring without trip planning scaffolding.

**Effort:** medium — `trip_id` nullable on `events`, new entry point,
new permission model.

---

### Push notifications

In-app notification center exists. Push (mobile web / PWA) not built.

**Approach:** Web Push API + service worker for PWA, or native push
via Capacitor if going native mobile.

---

### Admin interface

No admin tooling. Platform actions require direct Supabase dashboard.

**Minimum scope:** user lookup by email, trip lookup by ID/slug, catalog
idea management (add/edit/archive), basic audit log.

**Approach:** admin-only route `/admin` gated by `users.is_admin`.

---

### Catalog idea management UI

The 20 curated golf ideas were seeded via SQL. Adding non-golf ideas
requires SQL INSERT. Build an admin form at `/admin/catalog`.

**Note:** `catalog_ideas` table already has `categories`, `group_types`,
`region`, `trip_length` filter columns ready for non-golf content.

---

### "Frequently trips with" crew shortcut

Query `trip_members` for users who appear most frequently across the
current user's trips. Show as avatar chips on the Crew tab for quick-add.

**Spec:** was in TRIP_PLANNING_SPECS.md Spec 3. Hook design and UI
layout are fully specified there.

---

### Claude API destination suggestions

TripNew's "Let's put it to a vote" path was designed to call Claude for
3 AI-suggested destinations based on a crew description. Currently manual
entry only.

**Effort:** low — API call spec was fully written. Nice-to-have.

---

### RSVP status indicator on dashboard TripCard

In GOING/NOW stage, show the current user's RSVP status on the TripCard
on the dashboard — a small chip showing "In", "Maybe", "Out", or "Pending"
next to the stage badge. Gives at-a-glance visibility without opening the trip.
Requires joining trip_members.rsvp_status in the dashboard trips query.

---

### Unread message count persistence

The floating chat button unread count currently resets on page reload
(tracked in component state/sessionStorage only). A proper unread count
requires a last_read_at timestamp per user per trip in the database.
Schema: add last_read_at to trip_members or a separate message_reads table.

---

## UX Polish (Logged, Not Urgent)

### Field Mode (outdoor scoring)
Larger tap targets and bumped font sizes for outdoor scoring in bright
sunlight.

### Custom date picker
Replace `<input type="date">` with a custom component for better mobile UX.

### Tab scrollbar
Tab container shows scrollbar on some viewports. `overflow: hidden` fix.

### Messageboard mobile fit
Long messages overflow on narrow viewports in chat panels.

---

## Token Migration Debt

Tracked in `STYLE_GUIDE.md` Section 7. Summary:

- 5 hardcoded `#00d4aa` instances → `var(--color-bt-accent)`
- 5 hardcoded `#f59e0b` instances → `var(--color-bt-warning)`
- 3 light-only warning banner colors → semantic tokens
- 1 `#d1d5db` drag handle → `var(--color-bt-border)`
- 3 `rgba(0,0,0,0.4)` overlays → `var(--color-bt-overlay)`
- 6 `#fff`/`white` on colored buttons → consider `--color-bt-on-accent`
- 2 conditional title colors → `var(--color-bt-text)`

Fix incrementally in follow-up PRs. Full line-by-line locations in
STYLE_GUIDE.md Section 7.


---

### RSVP Message — recipient selection

Currently the RSVP message is sent to all crew members automatically
when the owner advances to GOING. The panel shows green as soon as
there is content.

The intended flow adds an intermediate step: the owner explicitly
selects which crew members to include in the blast. Until both the
message is written AND recipients have been acknowledged, the panel
should show amber (inProgress). Only when both are confirmed should
it show teal/green (done).

**What to build:**
- Recipient selector UI inside RsvpDraftPanel (checklist or chip
  multi-select, defaulting to all crew members)
- `rsvp_recipients` persisted state (could be a JSONB array on the
  trip or a separate table)
- Panel state logic: amber when message exists but recipients not yet
  confirmed, green when both message + recipients are set
- Pass selected recipients through to the email blast in AdvanceToGoingSheet

**Current behavior:** green as soon as message has content; all crew
members receive the blast automatically.

---

### Write Invitation panel move to Crew tab

The invitation message draft panel was planned to move to the Crew tab
so owners can see the full roster before sending. Currently still on
Home tab. Requires updating NextStepsPanel condition check to look for
invitation message on crew tab instead of home tab.
