# Handoff: BuddyTrip — Trip settings modal

## Overview
Replace the current inline-accordion settings modal (rows expand in place,
ballooning the modal height) with a **drill-in (master → detail)** pattern.
Same settings, calmer navigation — one decision per screen.

## About the design files
HTML/React-via-Babel references. Open `trip-settings-reference.html` to see all
five start states side-by-side (fully interactive — click rows, back arrows, the
dates chip). Source component: `source/explorations-tripsettings.jsx`.

## The core pattern
- A **fixed-width card** (`400px`, full-width on mobile), **stable min-height
  (~300px)**. Does not grow/shrink as you navigate.
- A **master menu** lists setting rows. Tapping a row **slides to a detail
  screen** — it does not expand inline.
- **Header adapts:** menu → title ("Trip settings") + close ✕; detail screen →
  back arrow + screen title + ✕. Back returns to the menu.
- **Slide animation:** forward drills in from right (`translateX(28px)`, `.26s`
  ease); back from left. Skip under `prefers-reduced-motion`.
- `.ts` has `overflow: visible`; `.ts-view` has `overflow: hidden` —  so the
  calendar can't escape the pane boundary.
- Tokens only (`--color-bt-*`), no hardcoded hex.

## Master menu — grouped rows
Each row = icon tile + bold title + one-line subtitle + `›`.

**Trip plan**
- **Trip details** → details screen

**Trip management**
- **Transfer ownership** → transfer screen

**Danger zone** (red section label; rows use a red icon tile + red title)
- **Clear crew chat** → confirm screen
- **Clear organizer chat** → confirm screen
- **Delete trip** → confirm screen

## Detail screens

### Trip details
Trip name (text input), Destination (text input), Dates chip ("May 26 – Jun 14 ·
19 nights" → drills into Trip dates screen — see below). Editing any field shows
an amber inline warning: "Changing the destination or dates will reset any
date-poll responses." Footer: **Save changes** (teal primary, disabled until
dirty) + **Cancel** (ghost, back to menu).

### Trip dates
A `BTCalendar` in `range` mode (same component as the date poll and setup
guide). Presets row, month header + nav arrows, day grid with teal range
fill. Footer: **Set dates** + Cancel. This is a **separate drill-in screen**
from Trip details — the dates chip drills here, not inline.

`BTCalendar` props:
- `mode="range"`
- `accent` = `var(--color-bt-accent)` (teal)
- `accentFaint` = `rgba(45,212,191,0.16)`
- `value={{ start: Date, end: Date }}`
- `onChange(range)` callback

### Transfer ownership
"Choose the new owner" label + single-select crew list (`CrewAvatar` + name +
radio). **Transfer ownership** primary (disabled until selection) + Cancel.

### Confirm screens (clear crew / clear org / delete)
Centered red icon tile (`trash` for delete, `message-circle` for chat clears),
bold question ("Delete this trip?"), one-paragraph consequence ending "This
can't be undone.", red solid confirm button + Cancel (ghost). Destructive actions
always require this confirm step — never fire directly from the menu row.

## Acceptance
- [ ] Fixed-width card, stable height, slide animations (forward/back).
- [ ] Back arrow in header on all detail screens; ✕ always closes the modal.
- [ ] Trip details: name + destination inputs + Dates chip drills to calendar.
- [ ] Trip dates: `BTCalendar` in range mode, set dates, cancel.
- [ ] Transfer: crew single-select, Transfer button disabled until pick.
- [ ] Confirm screens for all three destructive actions; no direct-fire.
- [ ] Amber warning on Trip details when editing destination or dates.
- [ ] No hardcoded hex — all `var(--color-bt-*)`.

## Where to look
- `trip-settings-reference.html` — live reference (all 5 states).
- `source/explorations-tripsettings.jsx` — `TripSettings` component +
  injected CSS (`.ts-*`).
- `source/explorations-datepicker.jsx` — `BTCalendar` (range mode).
- `source/explorations-screens.jsx` — `CrewAvatar`.
