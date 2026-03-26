# Feature: Dates Panel — HomeTab

**Branch: `feature/home-tab-dates-panel`**
**Model: Sonnet**

---

## Start here — read the codebase first

Before writing any code, run these to understand current state:

```bash
# What does HomeTab's dates section currently render?
grep -n "date\|Date\|poll\|Poll\|DatesSection\|datesLocked" \
  src/app/trips/\[tripId\]/tabs/HomeTab.tsx

# What does the existing DatePollSection look like?
cat src/app/trips/\[tripId\]/tabs/ScheduleTab.tsx

# What procedures exist?
cat src/server/routers/datePoll.ts

# What does the trip member query return (do we have crew count/ghost flag)?
grep -n "member\|crew\|ghost\|confirmed" \
  src/server/routers/trip.ts | head -40

# Current schema
grep -A 20 "date_windows\|date_poll" supabase/migrations/*.sql | head -80
```

---

## What to build

### 1. Reorder HomeTab planning panels

In `HomeTab.tsx`, the planning panels render in this order:
```
Destination → Dates → Crew → Logistics
```

Change to:
```
Destination → Crew → Dates → Logistics
```

Crew precedes Dates because the date poll grid depends on who's in the trip.

---

### 2. Upgrade `DatesSection` in HomeTab

The current `DatesSection` is a status-only display. Replace it with a
fully interactive component. The visual spec is `dates-panel-v3.html`
in the repo root — open it in a browser to see the exact intended behavior.

#### Member view (role: `member`)

- Subtitle: `"Respond now · N options"` / `"Responded · waiting on others"` if all voted
- Body: "When works for you?" heading
- Each `date_window` renders as a card:
  - Date range + duration
  - Three toggle buttons: **✓ Works** / **~ Maybe** / **✗ Can't**
  - Maps to `datePoll.vote` — `answer: 'yes' | 'no'` (note: schema uses yes/no,
    map "Maybe" to a third value or handle separately — see schema note below)
  - Tapping an active button deselects (re-voting with same answer = toggle off)
  - Card tints: teal border for yes, red for no, amber for maybe
- When all windows have a vote: show teal confirmation strip

**Schema note on "Maybe":** The current `date_poll_votes.answer` column is
`yes | no`. Before implementing, check if there's a migration to add `maybe`.
If not, add one:
```sql
ALTER TABLE date_poll_votes
  DROP CONSTRAINT IF EXISTS date_poll_votes_answer_check;
ALTER TABLE date_poll_votes
  ADD CONSTRAINT date_poll_votes_answer_check
  CHECK (answer IN ('yes', 'no', 'maybe'));
```
Update the `vote` tRPC procedure input schema to accept `'maybe'`.

#### Owner/Planner view

**Low-crew banner (conditional):**

If confirmed trip member count < 4, show a visible amber banner at the
top of the panel body:

> ⚠ Only N crew confirmed. Add more before polling so everyone's voice counts.
> [Go to Crew tab →]

"Go to Crew tab" should navigate to the Crew tab (update the active tab state
using whatever tab navigation pattern the app currently uses).

Banner disappears when confirmed member count ≥ 4.
Panel subtitle changes to `"Add crew first"` in amber when count < 4.

**Add window button:**

`+ Add date option` — opens a bottom sheet / modal with From/To date inputs.
On save, calls `datePoll.addWindow`. New window appears in grid and lock section.

**Response grid:**

Compact table:
- Columns = confirmed trip members (avatar initials as column headers)
- Rows = each `date_window`
- Cells = colored chip per vote: ✓ teal / ~ amber / ✗ red / · unknown (dashed)
- Ghost users (members who haven't accepted invite yet, i.e. `status = 'invited'`
  or however the current member model tracks this) show dashed avatar
- Ghost cells are tappable — opens a sheet to set their availability across
  all windows at once (planner acting on their behalf via `datePoll.vote`
  called with that user's ID — check if the tRPC procedure allows this or
  needs a planner-override variant)
- Bottom row: ✓ count per member as teal pill

**Lock a Date section:**

Below the grid, a "LOCK A DATE" label followed by one row per window:
- Date label + ✓ / ~ / ✗ tallies
- **Lock** button on the right — calls `datePoll.lockWindow`

Best option (yes×2 + maybe×1 scoring):
- `★ Best` badge on that row
- Teal-tinted row + teal Lock button
- All other rows have equal functional Lock buttons (outlined style)

Confirm dialog when locking best option:
> "Lock in [date]? This is the top-voted option. The crew will be notified."

Confirm dialog when locking non-best option:
> "Lock in [date]? This isn't the top-voted option, but it's your call.
>  The crew will be notified."

On successful lock: panel subtitle → `"Locked · [date label]"`, icon → checkmark.

---

### 3. Fix `lockWindow` — write `locked_window_id`

**This is a data integrity bug, fix it in the same PR.**

`datePoll.lockWindow` currently writes `trips.start_date` and `trips.end_date`
but never writes `date_polls.locked_window_id`. These two systems are out of sync.

Update `lockWindow` to also write:
```sql
UPDATE date_polls SET locked_window_id = $windowId WHERE trip_id = $tripId
```

If `date_polls` row doesn't exist for the trip yet, upsert it.

Also update `unlock` to null out `locked_window_id`:
```sql
UPDATE date_polls SET locked_window_id = NULL WHERE trip_id = $tripId
```

---

## Data requirements

The `datePoll.get` query already returns `{ windows: [..., votes] }`.
Check what the `trip.get` (or equivalent) query returns for member list —
you need confirmed member count and ghost status for the banner and grid.
If member data isn't already on the HomeTab query, extend it rather than
adding a separate query.

---

## Design tokens

Match the existing app's CSS variables. The approved mock uses:

| Role | Value |
|---|---|
| Teal accent | `#00d4aa` |
| Teal light bg | `#e6faf6` |
| Teal mid | `#b3f0e6` |
| Amber warning | `#f59e0b` |
| Amber bg | `#fffbeb` |
| Amber border | `#fde68a` |
| Red | `#f87171` |
| Red bg | `#fef2f2` |

Use the app's existing Tailwind classes / CSS variables wherever they match
rather than hardcoding hex values.

---

## Acceptance criteria

- [ ] Crew panel renders above Dates panel in HomeTab
- [ ] Member: Works/Maybe/Can't toggle correctly, re-tap deselects
- [ ] Member: Card tints on selection (teal/amber/red)
- [ ] Member: "You're all set" strip appears when all windows have a vote
- [ ] Owner: Low-crew banner visible when < 4 confirmed, gone at 4+
- [ ] Owner: "Go to Crew tab" link works
- [ ] Owner: Response grid renders correct colors per vote value
- [ ] Owner: Ghost user cells tappable, sheet sets all dates at once
- [ ] Owner: Add date option sheet works, new window appears in grid + lock section
- [ ] Owner: All Lock buttons functional (not just best option)
- [ ] Owner: Best option row is visually distinguished
- [ ] Owner: Non-best lock confirm includes "your call" language
- [ ] `lockWindow` writes `date_polls.locked_window_id` (new)
- [ ] `unlock` nulls `date_polls.locked_window_id` (new)
- [ ] `date_poll_votes.answer` accepts `'maybe'` (migration if needed)
- [ ] No regressions on ScheduleTab, Crew tab, or any other tab
- [ ] CLAUDE.md updated with any new patterns introduced

---

## What NOT to do

- Do not touch `ScheduleTab.tsx` — the `DatePollSection` there can stay as-is
- Do not add push notifications — the confirm dialog is sufficient for now
- Do not change the Crew tab — only the Crew panel ordering on HomeTab
- Do not add a separate query for member data if it's already fetchable
  from an existing query with a minor extension
