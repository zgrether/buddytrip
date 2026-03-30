# BuddyTrip — Deferred Decisions & Future Work

Items intentionally deferred. Each has a note on why it was deferred
and what to consider when revisiting.

---

## User & Account Management

### Guest user deletion cascade
`expense_splits.user_id` has `ON DELETE CASCADE`. If a guest user account
is ever deleted, their expense splits disappear silently. The expense itself
stays but the split record is gone — settlement math will be off.
**When to address:** When building user account deletion or guest-to-member
upgrade flow.
**Fix:** Either change to `RESTRICT` (block deletion if splits exist) or
soft-delete users with an `is_deleted` flag instead of hard deleting.

### Guest-to-member account upgrade
When a guest user (is_guest: true) creates a real BuddyTrip account,
their ghost ID needs to be merged with their new auth ID. All FKs
referencing the old ghost ID (trip_members, expense_splits, idea_votes,
group_result_scores, player_hole_scores, etc.) need to be updated.
**When to address:** When building the invite-link signup flow.
**Approach:** Match on email at signup, run a migration function that
updates all FK references from ghost ID to new auth ID, flip is_guest
to false.

### Invite link → auto-add to trip on signup
The invite link UI is a stub (`/invite?trip=${tripId}` copied to clipboard).
The backend plumbing to auto-add a user to a trip when they sign up via
an invite link doesn't exist yet.
**When to address:** After auth flow is stable.
**Approach:** Store pending invites in an `invites` table
(trip_id, email, role, token, expires_at). On signup, check for pending
invites matching the email, auto-add to trip_members, mark invite consumed.

---

## Admin & Platform Tools

### Admin interface
No admin tooling exists. Platform-level actions (view all users, moderate
content, manage catalog ideas, debug trip issues) require direct Supabase
dashboard access.
**When to address:** When the app has real users beyond the BBMI crew.
**Scope:** At minimum — user lookup, trip lookup, catalog idea management
(add/edit/remove), basic audit log.

### Catalog idea management
The 20 curated golf ideas were seeded via SQL. Adding new ideas (beach trips,
ski trips, city weekends) requires a SQL INSERT. No UI exists for this.
**When to address:** When expanding beyond golf.
**Approach:** Simple admin-only route `/admin/catalog` with a form to
add/edit/archive catalog ideas. Gate with a role check on the users table
(`is_admin: boolean`).

---

## Scoring & Competition

### Sabotage and Skins score entry
Only Scramble and Stableford are fully implemented. Sabotage and Skins
show stubs.
**When to address:** Before BBMI 2026 (September target per CONTEXT.md).
**Spec:** See SCORING_PLAYBOOK.md tasks B–D.

### Multi-team scoring (3+ teams)
Schema supports N teams. UI assumes 2. Lead bar, score entry, and
scorecard headers all hardcode 2-team assumptions.
**When to address:** If/when a non-BBMI event uses 3+ teams.
**Spec:** See SCORING_PLAYBOOK.md task D.

### Moving tee boxes and carry-over modifiers
Designed and specced but not built in production.
**When to address:** Before BBMI 2026.
**Spec:** See SCORING_PLAYBOOK.md tasks B–C.

---

## Trip Planning

### Quick Score (no-auth scorecard)
Standalone scorecard for any game, no account required. Homepage CTA.
**When to address:** v2, after core trip planning is stable.
**Decision:** `events.trip_id NOT NULL` constraint stays for v1 — Quick Score
requires making trip_id nullable on events, which is a schema change.

### Competition without a trip
Same schema constraint as Quick Score. Deferred to v2.

### Date poll → trip dates sync
Trip `start_date` and `end_date` are not automatically updated when a
date poll window is locked. They need to be kept in sync.
**When to address:** Before launch — this affects trip status derivation
and the header display.

### Expense settlement view
Net who-owes-who calculation. Currently expenses are tracked but there's
no settlement summary (e.g. "Brad owes Zach $47, JD owes Brad $120").
**When to address:** Before first real trip using the app.

### Push notifications
In-app notification center exists. Push (mobile web / PWA) is not built.
**When to address:** v2.

---

## UX Polish (logged, not urgent)

### Field Mode
Larger tap targets and bumped font sizes for outdoor scoring in bright
sunlight. Logged after light mode testing.

### Custom date picker
`<input type="date">` used throughout. Replace with a custom component
for better mobile UX.

### Tab scrollbar
Minor CSS fix — tab container shows scrollbar on some viewports.
`overflow: hidden` on tab container should fix it.

### Messageboard mobile fit
Long messages overflow on narrow viewports.
---
 
## Trip Planning & Home Tab
 
### Home tab Planning panel + date voting
Full spec written — search conversation for `feature/home-tab-planning-panel`.
Covers a unified "Planning" panel with two sections:
- `DestinationSection` — shows locked destination, IdeaZonePreview when exploring,
  or blank state with Set/Vote CTAs
- `DatesSection` — shows locked dates with countdown, interactive Yes/No vote
  buttons when poll is open, or "Not set yet" with Set/Poll CTAs
 
Cancelled before sending to Claude Code — needs home tab destination state
fix to be stable and tested first.
 
**When to address:** After walkthrough bug fixes are merged and verified.
**Depends on:** `fix/walkthrough-bugs` branch stable.
 
---
 
### Date poll → trip dates sync
`lockWindow` in the `datePoll` tRPC router writes directly to
`trips.start_date` and `trips.end_date` when a window is locked.
The `date_polls.locked_window_id` column is never written.
These two systems are out of sync — the schema has `date_polls` as
the authoritative source but the code uses `trips` directly.
 
**When to address:** Before launch — affects trip status derivation
and header display.
**Options:**
1. Write `locked_window_id` in `lockWindow` in addition to trip dates (preferred)
2. Drop `date_polls.locked_window_id` and accept that trips table is authoritative
 
---
 
### `date_polls` table partially bypassed
The `date_polls` table exists in the schema with `trip_id` (PK), `open`,
and `locked_window_id` columns. The tRPC router never reads or writes
`date_polls` — it queries `date_windows` directly and writes to
`trips.start_date`/`trips.end_date`. The `open` and `locked_window_id`
columns are never used.
 
**When to address:** Before launch — either use the table as designed
or drop unused columns to avoid confusion.
**Recommendation:** Write `locked_window_id` when locking (fixes date sync
issue above), write `open = false` when locking. Drop `open` column if
not needed — the locked state is derivable from `locked_window_id IS NOT NULL`.
 
---
 
### READY status on new trip
A brand-new trip with no dates, no crew beyond the owner, and no logistics
shows "READY" status on the dashboard card. This seems premature —
"READY" should mean the trip is ready to happen, not just that it was created.
 
**When to address:** Product decision needed before launch.
**Consider:** What conditions should gate READY?
- Destination locked?
- Dates locked?
- Minimum crew confirmed (e.g. 4+ people in)?
- All of the above?
 
Current `getTripStatus` logic: `ready = lockedDest AND (lockedDates OR knownDates)`.
May need crew count as an additional gate, configurable per trip.
 
---
 
## User & Account Management
 
### Invite email flow (stubbed)
The invite flow creates a guest user and trip_members row, shows the
"Invited" badge, and copies a link to clipboard — but no email is sent
and the `/invite` route doesn't exist.
 
**What's already done:**
- Guest `users` row created on invite (`is_guest: true`)
- Added to `trip_members` as Planner with `status: 'invited'`
- Shows in co-planners list with purple Invited badge
- Invite link copied to clipboard (stub URL)
- `inviteByEmail` mutation handles already-member case gracefully
 
**What's needed to complete it:**
1. Choose and configure email provider (recommend Resend — simple
   Next.js SDK, generous free tier)
2. Create `invites` table:
   ```sql
   CREATE TABLE invites (
     id text PRIMARY KEY DEFAULT gen_random_uuid(),
     trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
     email text NOT NULL,
     role text NOT NULL DEFAULT 'Planner',
     token text NOT NULL UNIQUE DEFAULT gen_random_uuid(),
     created_by text REFERENCES users(id),
     created_at timestamptz NOT NULL DEFAULT now(),
     accepted_at timestamptz,
     expires_at timestamptz DEFAULT now() + interval '7 days'
   );
   ```
3. Update `inviteByEmail` mutation to send actual email via Resend
   with invite link containing token
4. Build `/invite?token=xxx` route — validate token, check expiry,
   redirect to signup (no account) or auto-add to trip (has account)
5. Post-signup hook — check pending invites matching new user's email,
   auto-add to `trip_members`, mark invite `accepted_at`
6. Guest user merge on signup (see below)
 
**When to address:** Before first real user onboarding push.
**Depends on:** Auth flow stable, email provider chosen.
 
---
 
### Guest user merge on signup
When a user signs up with an email that matches an existing `is_guest: true`
users row, their ghost ID needs to be merged with their new auth ID.
 
**Tables requiring FK updates:**
- `trip_members` (user_id)
- `expense_splits` (user_id)
- `idea_votes` (user_id)
- `idea_comments` (user_id)
- `group_result_scores` (player_id)
- `player_hole_scores` (player_id)
- `team_assignments` (user_id)
- `notification_events` (actor_id)
- `quick_info_tiles` (created_by)
- `messages` (user_id)
 
**Approach:** Run as a DB function triggered post-signup or as a
server action in the signup flow:
1. Find guest row matching new user's email
2. Update all FK references from ghost ID to new auth ID
3. Copy name/nickname from signup form to existing row
4. Set `is_guest = false` on the users row
5. Do NOT create a second users row — update the existing one
 
**When to address:** When building the invite-link signup flow.
 
---
 
### Guest user deletion cascade
`expense_splits.user_id` has `ON DELETE CASCADE`. If a guest user account
is ever deleted, their expense splits disappear silently. The expense itself
stays but the split record is gone — settlement math will be off.
 
**When to address:** When building user account deletion or
guest-to-member upgrade flow.
**Fix options:**
- Change to `RESTRICT` (block deletion if splits exist)
- Soft-delete users with an `is_deleted` flag instead of hard deleting
  (preferred — preserves historical records)
 
---
 
## URLs & Navigation
 
### Human-friendly trip URL slugs
Current: `/trips/2377695c-bcdc-44f1-a1fd-584dd2d001a4`
Target:  `/trips/bbmi-2027`
 
**Approach:**
1. Add `slug text UNIQUE` column to `trips` table with index
2. Generate slug from title at creation:
   ```typescript
   function generateSlug(title: string): string {
     return title
       .toLowerCase()
       .replace(/[^a-z0-9\s-]/g, '')
       .trim()
       .replace(/\s+/g, '-')
       .slice(0, 60)
   }
   // "BBMI 2027" → "bbmi-2027"
   // Collision: append "-2", "-3" etc.
   ```
3. Backfill existing trips:
   ```sql
   UPDATE trips SET slug = LOWER(REGEXP_REPLACE(
     REGEXP_REPLACE(title, '[^a-zA-Z0-9\s]', '', 'g'),
     '\s+', '-', 'g'
   )) || '-' || SUBSTRING(id::text, 1, 6);
   ```
4. Route accepts both slug and UUID (UUID fallback for old links):
   ```typescript
   const trip = await supabase
     .from('trips')
     .select('*')
     .or(`slug.eq.${tripId},id.eq.${tripId}`)
     .single()
   ```
5. Redirect UUID → slug in route handler
6. Update all `href={/trips/${trip.id}}` to `href={/trips/${trip.slug}}`
 
**When to address:** Before first public user onboarding.
**Risk:** Low if UUID redirect is implemented. Medium at scale
due to slug collision handling needing to be atomic server-side.
 
---
 
## Admin & Platform Tools
 
### Admin interface
No admin tooling exists. Platform-level actions (view all users,
moderate content, manage catalog ideas, debug trip issues) require
direct Supabase dashboard access.
 
**When to address:** When the app has real users beyond the BBMI crew.
**Minimum viable scope:**
- User lookup by email
- Trip lookup by ID or slug
- Catalog idea management (add/edit/archive)
- Basic audit log view
 
**Approach:** Simple admin-only route `/admin` gated by
`users.is_admin boolean` column. Separate from the main app.
 
---
 
### Catalog idea management UI
The 20 curated golf ideas were seeded via SQL. Adding new ideas
(beach trips, ski trips, city weekends) requires a SQL INSERT.
No UI exists for this.
 
**When to address:** When expanding catalog beyond golf.
**Approach:** Admin-only `/admin/catalog` with form to add/edit/archive
catalog ideas. Requires admin interface above.
**Note:** The `catalog_ideas` table already has `categories`, `group_types`,
`region`, `trip_length` filter columns ready for non-golf content.
 
---
 
### Amelia Island catalog photo broken
One of the 20 seeded catalog ideas ("Amelia Island Getaway") has a
broken or missing `image_url`. All other 19 cards load correctly.
 
**Fix:** Find the correct Unsplash or stock photo URL for
Amelia Island, FL and run:
```sql
UPDATE catalog_ideas
SET image_url = '[correct-url-here]'
WHERE title = 'Amelia Island Getaway';
```
**When to address:** Before next demo or public-facing walkthrough.
 
---
 
## Code Cleanup (Before Launch)
 
### Remove debug console.log lines
The `inviteByEmail` tRPC mutation has server-side `console.log` statements
added during debugging that start with `[inviteByEmail]`. These should be
removed before launch.
 
```bash
grep -r "\[inviteByEmail\]\|console\.log" src/server --include="*.ts"
```
 
**When to address:** Pre-launch cleanup pass.
 
---
 
## Scoring & Competition
 
### Carry-over (halved holes)
When enabled on a round, halved holes accumulate a pot that carries
to the next hole. Full spec in `PROD_B_THROUGH_F.md` (Task B).
 
**When to address:** Before BBMI 2026 (September target).
**Depends on:** PROD-A (round lifecycle) merged and stable.
 
---
 
### Moving tee boxes
Each player starts on the same tee box. After each hole, tee box
shifts based on score vs par. Full spec in `PROD_B_THROUGH_F.md` (Task C).
 
**When to address:** Before BBMI 2026.
**Depends on:** PROD-B (carry-over) merged.
 
---
 
### Multi-team scoring (3+ teams)
Schema already supports N teams via `group_result_scores`.
UI assumes 2 teams — lead bar, score entry, scorecard headers all
hardcode 2-team assumptions. Full spec in `PROD_B_THROUGH_F.md` (Task D).
 
**When to address:** If/when a non-BBMI event uses 3+ teams.
**Depends on:** PROD-C (moving tees) merged.
 
---
 
### Completed trip read-only mode
When a trip's derived status is `'completed'` (past end date), all edit
controls should be gated. Expenses and Messages remain functional
for post-trip settlement and recap. Full spec in `PROD_B_THROUGH_F.md` (Task E).
 
**When to address:** Before BBMI 2025 archival.
**Independent of** B/C/D — can run any time after PROD-A.
 
---
 
### Read-only scorecards for past rounds
Group rows in the round summary panel should be tappable when hole
data exists, opening a read-only hole-by-hole scorecard.
Full spec in `PROD_B_THROUGH_F.md` (Task F).
 
**When to address:** Before BBMI 2026.
**Independent of** B/C/D — can run any time after PROD-A.
 
---
 
### Sabotage and Skins score entry
Only Scramble and Stableford are fully implemented in score entry.
Sabotage and Skins show stubs with "coming soon" messaging.
 
**When to address:** Before BBMI 2026.
**Spec:** Sabotage uses same 3-way result selector with sabotage
play notes. Skins uses integer skin count per team. Both are in
the existing `ScoreEntry` component stub.
 
---
 
## Trip Planning Features
 
### Quick Score (no-auth scorecard)
Standalone scorecard for any game, no account required.
Homepage CTA — "or just keep score right now."
Currently links to `/quick-score` which doesn't exist.
 
**When to address:** v2, after core trip planning is stable.
**Schema note:** `events.trip_id NOT NULL` constraint stays for v1.
Quick Score requires making `trip_id` nullable — schema change needed.
 
---
 
### Competition without a trip
Same schema constraint as Quick Score (`events.trip_id NOT NULL`).
Use case: a golf tournament organizer wants to run a competition
without the trip planning scaffolding.
 
**When to address:** v2.
**Effort:** Medium — `trip_id` nullable on `events`, new entry
point in UI, new permission model for non-trip competitions.
 
---
 
### Expense settlement view
Net who-owes-who calculation. Expenses are tracked but there's no
settlement summary (e.g. "Brad owes Zach $47, JD owes Brad $120").
Venmo/Splitwise-style net balance per person.
 
**When to address:** Before first real trip using the app for expenses.
**Approach:** Compute net balances from `expenses` + `expense_splits`
at query time. No new schema needed.
 
---
 
### Per-person expense split overrides
`expense_splits.amount` column exists and is nullable. When null,
the split is assumed even. Per-person override amounts are in the
schema but not implemented in the UI.
 
**When to address:** When uneven splits become a real user need.
**Effort:** Low — column exists, just needs UI in the expense edit flow.
 
---
 
### Push notifications
In-app notification center exists. Push (mobile web / PWA) not built.
 
**When to address:** v2, after core experience is stable.
**Approach:** Web Push API + service worker for PWA, or native
push via Capacitor if going native mobile.
 
---
 
## UX Polish (Logged, Not Urgent)
 
### Field Mode (outdoor scoring)
Larger tap targets and bumped font sizes for outdoor scoring in
bright sunlight. Logged after light mode was added.
**When to address:** After user testing of light mode outdoors.
 
### Custom date picker
`<input type="date">` used throughout. Inconsistent styling across
browsers, poor mobile UX on some devices.
**When to address:** v2 polish pass.
 
### Tab scrollbar
Tab container shows a scrollbar on the right side of the page
on some viewport sizes. `overflow: hidden` on the tab container
should fix it.
**When to address:** Next CSS polish pass.
 
### Messageboard mobile fit
Long messages overflow on narrow viewports in the chat panels.
**When to address:** Next CSS polish pass.
 
### Magic link / social auth
Currently email + password only. Magic link (passwordless) and
Google OAuth would reduce signup friction significantly.
**When to address:** Before first public user onboarding push.
**Effort:** Low — Supabase supports both natively, minimal code change.