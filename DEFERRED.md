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

## Schema & Migration Audit
 
**When:** Before first non-test user is onboarded — after core features are
stable but before real data exists. Real data makes schema changes expensive.
 
**Why this matters:**
Active feature development accumulates drift between what the schema says
and how the app actually works. The `date_polls` table is already a live
example — it exists in the schema, `locked_window_id` was never written
until the dates panel PR, and `open` is still unused. There are likely
others.
 
**What the audit looks at:**
 
- **Orphaned tables** — tables that exist but are never queried by the app
- **Orphaned columns** — columns that are never read or written
- **Bypassed constraints** — check constraints or foreign keys the code
  routes around rather than through
- **Inconsistent nullability** — columns marked NOT NULL that the code
  treats as nullable, or vice versa
- **RLS policies** — compare every policy against PERMISSIONS.md; flag
  anything that doesn't match the current role model
- **Missing indexes** — columns used in WHERE/JOIN clauses with no index
 
**How to run it (CC task):**
 
```
Audit the schema against the codebase and produce a report:
1. Dump current schema (tables, columns, types, nullability, constraints, indexes)
2. For each table, grep the codebase to confirm it is actively read and written
3. For each column, same check
4. List all RLS policies and compare against PERMISSIONS.md
5. Flag anything orphaned, bypassed, or inconsistent
Output a report only — no changes.
```
 
After reviewing the report, write a single forward migration that cleans
up whatever is confirmed dead or wrong. Do NOT edit existing migration
history — only add a new migration.
 
**Note on migration history:** The project squashed to a single baseline
migration in March 2026 (pre-Phase 3). New migrations since then are clean
and timestamped. The squash is documented in the commit history.
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