# BuddyTrip — Deferred Work

*Only genuinely open items. Organized by when they need to happen.*
*Last updated: 2026-03-31*

---

## Before Launch

Items that must be resolved before onboarding real (non-test) users.

### Invite email flow (stubbed)

The invite flow creates a guest user and `trip_members` row, shows an
"Invited" badge, and copies a link to clipboard — but no email is sent
and the `/invite` route doesn't exist.

**What's already done:** guest `users` row created, `trip_members` row
with `status: 'invited'`, invite link copied to clipboard (stub URL),
`inviteByEmail` handles already-member case.

**What's needed:**
1. Choose email provider (recommend Resend — simple Next.js SDK, free tier)
2. Create `invites` table (`id`, `trip_id`, `email`, `role`, `token`,
   `created_by`, `created_at`, `accepted_at`, `expires_at`)
3. Update `inviteByEmail` mutation to send email with token link
4. Build `/invite?token=xxx` route — validate, check expiry, redirect
   to signup (new user) or auto-add to trip (existing user)
5. Post-signup hook — check pending invites matching email, auto-add

**Depends on:** auth flow stable, email provider chosen.

---

### Guest-to-member account merge

When a user signs up with an email matching an `is_guest: true` row,
their ghost ID needs to be merged with their new auth ID across 10+ tables:
`trip_members`, `expense_splits`, `idea_votes`, `idea_comments`,
`group_result_scores`, `player_hole_scores`, `team_assignments`,
`notification_events`, `quick_info_tiles`, `messages`.

**Approach:** DB function triggered post-signup: find guest row matching
email → update all FK references → set `is_guest = false`. Do NOT
create a second users row.

**Depends on:** invite email flow.

---

### Guest user deletion cascade

`expense_splits.user_id` has `ON DELETE CASCADE`. If a guest user is
ever deleted, their expense splits disappear silently — settlement math
breaks.

**Fix:** change to `RESTRICT` (block deletion if splits exist) or
soft-delete users with `is_deleted` flag (preferred — preserves
historical records).

**When:** before building user account deletion or guest-to-member upgrade.

---

### Expense settlement view

Per-person balances are computed in `ExpensesSection`, but there's no
Venmo-style "who owes who" net summary.

**Approach:** compute net balances from `expenses` + `expense_splits` at
query time. No new schema needed.

**When:** before first real trip using the app for expenses.

---

### Magic link / social auth

Currently email + password only. Magic link (passwordless) and Google
OAuth would reduce signup friction significantly.

**Effort:** low — Supabase supports both natively.

**When:** before first public user onboarding push.

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

## v2 / Post-Launch

Lower priority items. Build after core planning flows are stable and
the app has real users.

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

### Per-person expense split overrides

`expense_splits.amount` column exists and is nullable. When null, split
is even. Per-person override amounts are in the schema but not in the UI.

**Effort:** low — column exists, just needs UI in expense edit flow.

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
