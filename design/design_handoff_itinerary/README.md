# Handoff: BuddyTrip — Home itinerary

## Overview
The Home-tab itinerary — additions/changes layered onto the **existing**
left-border accent card style (kept as-is). This bundle is the deliverable for
implementing it.

## About the design files
HTML/React-via-Babel **design references**, not production code — recreate in
the BuddyTrip codebase with its stack and `--color-bt-*` tokens (full values in
`source/colors_and_type.css`). Open `itinerary-home-reference.html` to see it
live (renders desktop, or a mobile frame on a narrow window). Tap the "Setup
guide" link to see the setup ⇄ itinerary transition; tap an "Arrivals" line and
an "Earlier" line to see them expand.

## Fidelity
**High-fidelity** — final layout, behavior, copy, tokens. The existing item-card
style (3px colored left border, icon tile, time-above-title, Map link) is
unchanged; everything here is additive.

> **Scrolling is out of scope** — there is no pinned/sticky/fade behavior; the
> page scrolls normally as one. (A more efficient collapsing-chrome scroll is a
> later, separate effort — don't build it here.)

## What's in scope
1. **Lodging block** under the filters — horizontally-stacked properties
   (wrap on mobile), each with name, "dates · N nights · Sleeps N", and
   Directions (Google Maps). Filterable.
2. **Per-day Arrivals** — an "Arrivals · N" line atop any day with arrivals;
   expands to Flying / Driving / Other (white labels) with `CrewAvatar`s;
   untimed = "TBD". Filterable.
3. **Collapsed empty-day runs** — neighboring empty days fold into one
   expandable "Days 4–8 · open" band.
4. **Past days** — once underway, days before today collapse into an
   "Earlier … done" line; expand = dimmed + shrunk; the current day gets a
   TODAY pill.
5. **Setup guide ⇄ itinerary** — new trips open to the setup checklist; a
   commit bar ("You've got enough to go · Switch to itinerary") makes the
   itinerary the default Home; Setup guide stays a recoverable link pulled left
   of ITINERARY (distinct from the teal eyebrow; amber "N left" nudge). Owner
   only.
6. **Mobile** — filter chips become a "Filter ▾" dropdown; Setup guide link is
   icon-only.

See **`SPEC-itinerary-home.md`** for the authoritative spec (layout order,
per-item detail, filter rules, acceptance checklist).

## Files
- `itinerary-home-reference.html` — self-contained live mock.
- `SPEC-itinerary-home.md` — authoritative written spec.
- `source/explorations-timeconcepts.jsx` — `SetupHome`, `SetupGuide`,
  `HomeReal`, `ReArrivals`/`HyArrivals`, `ReEmptyRun`, `PastRun`,
  `FilterDropdown`, `RE_DAYS`, `RE_LODGING`, plus the `.hf-*` chrome,
  `.hy-prop` lodging, `.re-*` card styles.
- `source/explorations-screens.jsx` — `CrewAvatar` (use for arrival avatars).
- `source/explorations-atoms.jsx` — inline icon set.
- `source/colors_and_type.css` — token source of truth.
