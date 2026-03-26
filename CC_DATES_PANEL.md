# Task: Implement Dates Panel in buddytrip.html

**Model: Sonnet**
**Branch: `feature/dates-panel`**
**File: `buddytrip.html` only — single-file prototype, no other files touched**

---

## Context

The prototype currently shows the Dates panel on the TripDetail HomeTab with a
stub subtitle ("Poll active · 1 option") and no interactivity. We have a fully
designed and approved interactive mock (see reference HTML below) that needs to
be ported into the prototype.

This is a **UI implementation task** — the design is decided. Do not redesign.
Match the approved mock as closely as possible.

---

## What to Build

### 1. Panel ordering change

In `TripDetail > HomeTab`, the planning panels currently render in this order:
1. Destination
2. Dates
3. Crew
4. Logistics

**Change to:**
1. Destination
2. **Crew** ← move up
3. **Dates** ← move down
4. Logistics

Crew must visually precede Dates because crew size affects the date poll.

---

### 2. Dates panel — Member view

When `viewerRole === 'member'` (or any non-owner/planner role):

- Panel subtitle: `"Respond now · N options"` or `"Responded · waiting on others"` if all voted
- Panel body shows: **"When works for you?"** heading with subtext `"Select your availability for each option"`
- Each proposed date window renders as a card with:
  - Date range label (e.g. `"Jun 12–15"`) + duration badge (e.g. `"4 nights"`)
  - Three toggle buttons: **✓ Works** / **~ Maybe** / **✗ Can't**
  - Tapping a button that's already active deselects it (toggle behavior)
  - Card border + background tints to match selection: teal for yes, red for no, amber for maybe
- When all date options have a response: show a teal confirmation strip —
  `"You're all set! X of Y crew have responded so far."`
- Member sees **no grid**, no other people's responses, no lock button

---

### 3. Dates panel — Owner/Planner view

When `viewerRole === 'owner'` or `'planner'`:

#### 3a. Low-crew banner (conditional)

If confirmed crew count < 4, show a **visible amber banner** at the top of the
panel body, above everything else:

```
⚠ Only N crew added. Add at least X more before polling so everyone's
  voice counts.
  [Go to Crew tab →]
```

- "Go to Crew tab →" navigates to the Crew tab (same as tapping the tab)
- Banner disappears entirely when confirmed crew ≥ 4
- Panel subtitle also changes to `"Add crew first"` in amber when crew < 4
- Panel icon changes to a warning/info circle when crew < 4

#### 3b. Add date option button

Dashed teal button: **`+ Add date option`**

Tapping opens a bottom sheet with two date inputs (From / To). On save, the new
date range is added to the poll and all crew members get a `null` response for
it.

#### 3c. Response grid

A compact table:
- **Columns** = confirmed crew members (avatar initials as column headers)
- **Rows** = each proposed date window
- **Cells** = colored chip: ✓ (teal) / ~ (amber) / ✗ (red) / · (unknown, dashed)
- Ghost users (not yet on app) show a dashed avatar and their cells are **tappable**
- Tapping a ghost's cell opens a bottom sheet to set their availability across
  all dates at once (owner acting on their behalf)
- Bottom summary row shows ✓ count per crew member as a teal pill

#### 3d. Lock a Date section

Below the grid, a **"LOCK A DATE"** section label followed by one row per date
option. Each row shows:
- Date label + ✓ / ~ / ✗ tallies
- A **Lock** button on the right

The app-recommended best option (highest score: yes×2 + maybe×1) gets:
- A subtle `★ Best` badge next to the date label
- Teal-tinted row background + teal border
- Lock button styled teal (filled) instead of outlined

**All other Lock buttons are equally functional.** There is no disabled state.
The owner can lock any date regardless of vote counts.

When owner taps Lock on the **best** option, confirm dialog says:
> `"Lock in [date]? This is the top-voted option. The crew will be notified."`

When owner taps Lock on a **non-best** option, confirm dialog says:
> `"Lock in [date]? This isn't the top-voted option, but it's your call. The crew will be notified."`

On confirm: panel subtitle updates to `"Locked · [date label]"`, icon updates
to a checkmark. In the prototype this is UI-only (no backend call needed).

---

## Mock Data Requirements

The existing `DATE_POLL` / `DATE_VOTES` structures in the prototype should be
used or extended to support this. At minimum the mock data needs:

- 3 proposed date windows with labels and durations
- At least 5–6 crew members with responses seeded (mix of yes/no/maybe/null)
- At least 1 ghost user with all-null responses (so the owner can demonstrate
  setting their availability)

If the current mock data doesn't support this shape, extend it — do not
replace it. Existing mock data that other screens depend on must not break.

---

## Styles

Match the approved design's color tokens exactly. These are already in the
prototype's CSS:

| Token | Value |
|---|---|
| Teal | `#00d4aa` |
| Teal dark | `#00a888` |
| Teal light | `#e6faf6` |
| Teal mid | `#b3f0e6` |
| Amber warning | `#f59e0b` |
| Amber bg | `#fffbeb` |
| Amber border | `#fde68a` |
| Red | `#f87171` |
| Red bg | `#fef2f2` |

---

## Acceptance Criteria

- [ ] Crew panel appears above Dates panel in HomeTab planning section
- [ ] Member view: can tap Works/Maybe/Can't on each date, toggles correctly,
      confirmation strip appears when all answered
- [ ] Owner view: low-crew banner appears when confirmed crew < 4, disappears
      at 4+, "Go to Crew tab" link works
- [ ] Owner view: response grid renders with correct colors per response value
- [ ] Owner view: ghost user cells are tappable, bottom sheet lets owner set
      all dates for that person at once, saving updates the grid
- [ ] Owner view: "Add date option" sheet works, new option appears in both
      grid and lock section
- [ ] Owner view: all three Lock buttons are functional regardless of vote
      counts
- [ ] Best option row is visually distinguished (★ Best badge, teal tint)
- [ ] Non-best lock confirm dialog includes the "your call" language
- [ ] Locking updates panel subtitle and icon to locked/checkmark state
- [ ] Role switcher (existing dev tool in prototype) correctly toggles between
      member and owner views
- [ ] No regressions on other tabs (Crew, Schedule, Competition, etc.)

---

## What NOT to Do

- Do not redesign the layout — the mock is approved
- Do not add backend calls — this is a prototype, all state is in-memory
- Do not touch any file except `buddytrip.html`
- Do not change the Crew tab content — only the Crew **panel** on HomeTab
- Do not add push notification logic — locking shows a confirm dialog only

---

## Reference

The approved interactive mock is at `dates-panel-v3.html` in the repo root
(or will be provided alongside this prompt). Use it as the visual and
behavioral spec. The HTML/CSS/JS in that file is self-contained and can be
read directly to understand the intended implementation.
