# Handoff — Home itinerary

> Additions/changes to the **existing** Home-tab itinerary (the left-border
> accent card style — kept as-is). Working reference: `itinerary-home-reference.html`
> and `HomeReal` / `SetupHome` in `source/explorations-timeconcepts.jsx`.
> Token-first; no hardcoded hex (`--color-bt-*`).
>
> **Scrolling:** out of scope. The page scrolls normally as one — do not build
> any pinned/fade/sticky behavior here.

---

## Layout — Home tab, top → bottom
1. Trip header card
2. Tab bar
3. **ITINERARY** eyebrow + **Setup guide** link (left) + **filters** (right) — one row
4. **Lodging block** (under the filters)
5. The day-by-day list (past run → today → upcoming → empty runs)

## 1. Lodging block (under the filters, filterable)
- No "WHERE WE'RE STAYING" label — sits right under the ITINERARY/filters row.
- **Horizontally stacked**: `flex-wrap` row, each property `flex: 1 1 ~240px`
  — multiple houses side-by-side when they fit, wrap to stacked on mobile.
- Each property: home-icon tile (planning-blue tint), **name**, meta line
  **"Jun 17 – 19 · 2 nights · Sleeps 8"** (append `· Sleeps N` only when known),
  and a **Directions** button (Google Maps; collapses to the map-pin icon on
  mobile). Order by check-in date. Handles multi-property / mid-trip moves.
- **Filterable**: shown only under **All** or **Lodging**.

## 2. Per-day Arrivals
- On **each day that has arrivals**, an **"Arrivals · N"** line at the **top of
  that day** (above the day's items). Travel category (teal dot).
- **Expands on tap** to up to three groups — **Flying / Driving / Other**
  (only modes with people). Group labels are **white (`--color-bt-text`)**, not
  teal. Each person = a `CrewAvatar` + first name + arrival time.
- **Untimed arrivals show "TBD"** (dashed chip); timed people sort first.
- Arrivals can appear on **any** day (early birds, on-time, mid-trip stragglers).
- **Filterable**: shown only under **All** or **Travel**.

## 3. Compress neighboring empty days
- A run of 2+ empty days → one dashed band **"Days 4–8 · Jun 20 – Jun 24 ·
  open"** + calendar icon + **"Show"**; expands to the individual "Nothing
  scheduled" days + a **"Collapse open days"** control. A lone empty day stays a
  single "Nothing scheduled" line. Emptiness is computed **after** the filter.

## 4. Past days (once the trip is underway)
- Days before **today** collapse into one minimized line: a check icon +
  **"Earlier · Days 1–2 · Jun 17 – Jun 18 · done"** + **"Show"**.
- Expanding shows those days **dimmed (~50% opacity) and shrunk** (tighter
  cards) so they read as history, with a **"Hide past days"** control.
- **Today** is the anchor: its day header carries a teal **TODAY** pill and its
  items render at full weight; upcoming days follow normally.

## 5. Setup guide ⇄ itinerary
The Home view moves from onboarding to steady state:
- A **new trip** opens to the **setup guide** ("Get set up / Add what you've
  got" + the checklist cards). "**View itinerary →**" (top-right) peeks at the
  itinerary without committing.
- Once the trip has enough — **dates + at least one of lodging/agenda** — a
  commit bar appears: **"You've got enough to go · Switch to itinerary."**
  Committing makes the itinerary the default Home.
- After committing, **Setup guide** is a small link pulled **left, next to the
  ITINERARY eyebrow** (out of the filters' way). It is **visually distinct from
  the teal eyebrow** — an outlined neutral pill — and carries an amber **"· N
  left"** nudge while setup items remain. It stays recoverable for owners.
- **Owner/organizers only** ever see the setup guide; members always get the
  itinerary.

## 6. Mobile
- The ITINERARY row is tight, so on mobile the **filter chips become a single
  "Filter ▾" dropdown** (All/Lodging/Travel/Events), and the **Setup guide link
  is icon-only** (still shows the "N left" nudge).

---

## Acceptance
- [ ] ITINERARY + Setup-guide link (left, distinct from teal, "N left" nudge) +
      filters (right) on one row.
- [ ] Lodging under filters: horizontal-stack + wrap, `· Sleeps N`, Directions →
      Maps; hidden under Travel/Events.
- [ ] Per-day "Arrivals · N"; expands to Flying/Driving/Other (white labels)
      with `CrewAvatar`s; untimed = "TBD"; hidden unless All/Travel.
- [ ] Neighboring empty days collapse into one expandable band.
- [ ] Past days collapse to an "Earlier … done" line; expand = dimmed + shrunk;
      TODAY pill on the current day.
- [ ] New trips open to the setup guide; commit bar switches Home to the
      itinerary; Setup guide remains a recoverable left link (owner only).
- [ ] Mobile: filters → dropdown, Setup guide icon-only.
- [ ] Existing left-border item-card style unchanged otherwise; no hardcoded hex.

## Where to look
`itinerary-home-reference.html` (self-contained mock) and
`source/explorations-timeconcepts.jsx` → `SetupHome`, `SetupGuide`, `HomeReal`,
`ReArrivals`/`HyArrivals`, `ReEmptyRun`, `PastRun`, `FilterDropdown`, `RE_DAYS`,
`RE_LODGING`. Avatar: `CrewAvatar` in `source/explorations-screens.jsx`.
