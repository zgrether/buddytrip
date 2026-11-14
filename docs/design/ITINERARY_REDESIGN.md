# Itinerary redesign — lodging + agenda as one interactive itinerary

Status: **deferred, 2026-11-09.** Today's trip planning fits the new design as it is; this is a later
project (after the crews redesign ships). Supersedes the parked "Add to the agenda" comp.
Related: TRACKER.md:240 ("Agenda/Lodging → Bookings", parked behind launch), REDESIGN_PLAN.md Phase 6.

## What exists today (code survey, main @ #1698)

Four surfaces describe the same trip:

| Surface | Who sees it | Editable | Holds |
|---|---|---|---|
| **Agenda** tab (`ScheduleTab.tsx`) | Owner/Organizer only | Yes — drag to days, reorder, link games | `schedule_items`: activities + golf rounds (course, tee times) |
| **Lodging** tab (`LodgingTab` / `LodgingPanel`) | Owner/Organizer only, not in idea phase | Yes — add property, Confirm pill | `logistics_items` type=lodging |
| **Crew** tab travel (`TravelControls`) | Everyone, own row | Own travel only | `trip_members` arrival/departure fields |
| **Home itinerary** (`ItineraryView`) | Everyone | **No** — filters and links only | Built from confirmed schedule + confirmed lodging + travel |

Seams that a redesign has to fix:
1. Members never see Agenda or Lodging; planners author in two tabs and check the result in a third.
2. "Confirmed" means three things: golf needs tee times; an activity is confirmed by having a date (dragging confirms); lodging needs a tap *and* dates. The setup guide and the tab dot disagree on lodging.
3. Ordering disagrees: Agenda orders a day by drag position; the itinerary orders by time except agenda-vs-agenda, so 7pm can sit above 6pm.
4. Lodging shows twice on Home (summary block + check-in/out cards).
5. Overloaded columns: activity venue in `course_name/location`; lodging platform in `transport_type`; transport/general/pickup unused.
6. Lodging ideas → booked lodging is a one-time client copy; price and notes are lost; no link back.
7. Tee times live in three unsynced places: `schedule_items.tee_times`, `games.tee_time`, `play_groups.tee_time`.
8. Quick-info tiles (door code, wifi) aren't tied to the property they describe. Past trips use a separate legacy view.

## Proposal

**One Itinerary tab, for everyone, and it's where planning happens.** Admin and helpers edit in
place; members see the same days and do their own part (their travel, votes) in place. The Agenda
and Lodging tabs go away; the Home itinerary stops being a separate read-only copy.

- **One rule for visibility: Draft or Set.** Anything a planner adds starts as a draft that only
  admin and helpers see (dashed). "Set" shares it with everyone. Same rule for lodging, golf,
  dinners. A golf round can be set before tee times exist ("Tee times TBA" + a nudge for planners).
- **Time decides order.** Timed items sort by time; untimed items sit under "Anytime" in drag order.
- **Where you're staying is a band, not two events.** Each day shows which property you're at; the
  property card holds address, check-in/out, and its door code and wifi (tiles move onto it).
- **Arrivals and departures fold into the day:** "Arriving Thursday: Bill 2:10, Tony 4:30, +6".
  Each member taps *Add your flight* on their own line; it no longer lives on the Crew tab.
- **Open slots live here:** "Dinner Thursday · pick one" is an itinerary item whose place is decided
  by ideas and votes (the parked comp's job, now in context).
- **Golf rounds link to their games**, and the chip opens the game. Tee times get one owner (the
  round), and games read from it — an engineering decision for CC to confirm.
- **Planner tray:** "Not on a day yet" holds ideas and unscheduled items; drag (or pick a day) to place.
- **Lodging ideas carry over intact** when the destination is locked (price, notes, link back).

Trip tabs become roughly: **Home · Itinerary · Games · Crew · Money**. Home is "what's next / today"
(countdown before, live cup and today's slice during); after the trip, the recap replaces it all.

## Zach's answers and corrections (2026-11-09)

The current design is deliberate, and two of the "seams" above are intent, not bugs:
- **Agenda vs itinerary is a workspace vs the official plan.** The agenda is where admin and
  helpers organize ideas; confirming puts an item on the trip's official itinerary. Members
  seeing only the itinerary is by design.
- **Lodging stays off the itinerary until it's booked.** The list holds the many places being
  discussed (and remembered for next time); confirming = booked = official.
- **Times aren't forced.** Times are rarely known except for booked items, which is why ordering
  is drag-and-drop. *Withdrawn:* "time decides order."
- **Trips and competitions are separate on purpose** (things get scheduled and booked at different
  times). The only link is a golf course on an agenda item, whose tee times were booked well ahead.

Answers:
1. Draft / Set as the single rule: yes (when this is done).
2. One tab → call it **Itinerary**.
3. Each person's travel in the itinerary: yes, if it fits.
4. Rooms and beds: later. New idea: **assign people to a lodging** when there's more than one
   place, so everyone knows where to go and how to get to the other place(s).
5. Transport as itinerary items: yes ("do I need a car? how many cars do we have?").

## Small fixes worth doing before then (no redesign)
- Lodging shows twice on Home: the summary block plus inline check-in/out cards
  (`ItineraryView.tsx:128-130` says inline is excluded; `:318-322` includes it).
- Locking a destination drops each lodging idea's price note and notes (`IdeaZonePanel.tsx:1438-1458`).
- The setup guide counts any lodging as done (`useSetupProgress.ts:39`); the Lodging tab dot wants
  confirmed + dated (`page.tsx:498-501`). Pick one.
- TRACKER.md:352 still lists touch drag-and-drop (#517) as open; #517 is closed.
