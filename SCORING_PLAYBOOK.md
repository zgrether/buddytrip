# BuddyTrip — Scoring Architecture Playbook

*Pre-migration prototype work. All tasks build on the current `buddytrip.html` (~5,390 lines).*
*Read `CONTEXT.md` and `SCHEMA.md` before starting any task.*

---

## How to Use This Document

One task at a time, in order. Each task has:
- **Branch** — create this branch from `main` before starting
- **Model** — which Claude Code model to use
- **What** — exactly what to build
- **Why** — skip the task if the why doesn't apply, but read it first
- **How** — implementation spec precise enough to execute without ambiguity
- **Done when** — the acceptance criteria
- **Schema impact** — what changes in `SCHEMA.md` (update the file as part of the task)

After each task: commit all changes, push the branch, open a PR against `main`.

---

## Task A — Four-State Round Lifecycle

**Branch:** `feature/round-lifecycle`
**Model: Sonnet**

### What
Change round status from 3 states (`upcoming | active | complete`) to 4 states (`upcoming | active | submitted | closed`). Add a "Close Round" button in the Competition tab that moves a round from `submitted` → `closed`. Add a round-level edit path so submitted-but-not-closed rounds can have scores corrected.

### Why
"Complete" currently means both "all scores entered" and "nobody can touch it." Those are two different things. After a round, the scorer might discover a misentry at the clubhouse. The current model forces you to choose between losing the final state or losing the ability to correct. The 4-state model lets you keep both.

### How

**1. Update mock data**
In `BBMI_EVENT.rounds`, change the two complete rounds:
- `r1` (Scramble, Day 1): `status: 'closed'`
- `r2` (Stableford, Day 2): `status: 'submitted'` — intentionally left unclosed so you can demo the correction flow
- `r3` (Sabotage, Day 3): stays `status: 'active'`
- `r4` (Skins, Day 4): stays `status: 'upcoming'`

**2. Update the TypeScript `RoundStatus` union in `types.ts`**
```typescript
type RoundStatus = 'upcoming' | 'active' | 'submitted' | 'closed'
```

**3. Update `ScoreEntry` component**
- Scoring is available when round status is `active` OR `submitted` AND `canScore` (owner/planner)
- Add a note below the submit button when round is `submitted`: *"This round is submitted but not yet closed. Corrections are still allowed."*
- When round is `closed`, group cards in the Groups tab show scores as read-only — no "Enter score" affordance, no tap handler

**4. Add "Close Round" button to the Competition tab**
In the rounds accordion section of `CompetitionTab`, for each round with `status === 'submitted'`:
- Show a teal "Close Round ✓" button at the bottom of that round's expanded section
- Tapping it sets `round.status = 'closed'` on the round object (write via `setTrips` pattern — update `BBMI_EVENT.rounds` in the event object that lives on the trip)
- Show a confirmation toast: `"Day 2: Stableford officially closed"`
- For `closed` rounds, show a gray "Closed" badge instead of the button — no re-open path in v1

**5. Update the leaderboard Overview tab round breakdown rows**
- `upcoming`: dimmed, no score
- `active`: green left border, teal text, "On course →" (existing behavior)
- `submitted`: normal weight, amber left border, scores visible, small "⚠ Pending close" label in amber
- `closed`: gray, checkmark, scores visible, no indicator needed

**6. Update the round summary modal (tapped from completed round row)**
- If round is `submitted` and `canScore`: show an amber "Edit Scores" button at the bottom that opens `ScoreEntry` for that group
- If round is `closed`: no edit button, all group rows are display-only

### Done when
- r2 (Stableford) shows amber "⚠ Pending close" in the leaderboard and a "Close Round" button in the Competition tab
- r1 (Scramble) shows as fully closed — no edit affordance anywhere
- Tapping a group on r2 from the round summary opens ScoreEntry in correction mode
- Closing r2 shows the "Closed" badge and removes the edit paths
- r3 (active) behavior is unchanged

### Schema impact — update `SCHEMA.md`
In the `rounds` table, change the `status` column notes:
```
'upcoming' | 'active' | 'submitted' | 'closed'
```
Add two new nullable columns:
```
closed_at    timestamptz   nullable   Set when owner/planner closes the round
closed_by    text          FK → users.id, nullable
```

---

## Task B — Scorecard: Carry-Over (Halved Holes)

**Branch:** `feature/carry-over`
**Model: Sonnet**

### What
Add a `carryOver` modifier to rounds. When enabled, halved holes accumulate — the "pot" carries to the next hole. A hole worth 2 means 1 prior halve is in play. The scorecard must show each hole's current pot value.

### Why
This is a common format variant that meaningfully changes strategy. Without it, halved holes are dead. With it, a string of halves builds to a dramatic payoff hole. The UI needs to reflect this because players at the course need to know "this hole is worth 3" while scoring.

### How

**1. Add modifier to round mock data**
Add to `r3` (the active Sabotage round, so you can see it live):
```javascript
modifiers: { carryOver: true }
```
Leave `r1`, `r2`, `r4` without modifiers (or `modifiers: null`).

**2. Update `types.ts` `Round` interface**
```typescript
interface RoundModifiers {
  carryOver?: boolean
  movingTees?: MovingTeesConfig  // defined in Task C
}
interface Round {
  // ... existing fields
  modifiers?: RoundModifiers | null
}
```

**3. Add carry-over state to `HoleByHoleEntry`**
```javascript
// Derived from hole results — recompute on every stroke entry
function computeCarryPots(holes, scoringType) {
  // Returns array of pot values, one per hole
  // pot starts at 1, increments when hole is halved, resets to 1 after a winner
  const pots = []
  let carry = 1
  holes.forEach(hole => {
    pots.push(carry)
    const { complete, winner } = holeOutcome(hole, scoringType)
    if (complete) {
      carry = winner === 'halved' ? carry + 1 : 1
    }
  })
  return pots
}
```

**4. Display the pot on each hole column header**
In the scorecard grid, each hole column currently shows the hole number. When `carryOver` is enabled:
- Show hole number on top
- Show pot value below as a small amber badge: `×2` or `×3`
- When pot is 1 (normal), show nothing extra — no visual noise on standard holes
- The current "live" hole (first incomplete hole) gets a slightly brighter treatment

**5. Update `ScoreEntry` (the quick result picker)**
For rounds with `carryOver`, show below the team buttons:
> *"Halved holes carry over. Current pot: ×2"*
Recalculate and display the pot for the group's current hole based on existing `GROUP_RESULTS` for that group in that round.

**6. Add a carry-over indicator to the round row in the Leaderboard**
Next to the round format label (e.g., "Sabotage"), show a small amber `⊕` or `carry` chip when the round has carry-over enabled — just so players know the format at a glance.

### Done when
- r3 (active) shows pot values on hole columns where prior holes were halved
- ScoreEntry for r3 shows the current pot for the group
- r1/r2 show no pot indicators (modifiers disabled)
- Carrying across 3 consecutive halved holes shows ×4 on the 4th hole correctly

### Schema impact — update `SCHEMA.md`
In the `rounds` table, add:
```
modifiers    jsonb    nullable    { carryOver?: bool, movingTees?: {...} }
```
Add new table `hole_results`:
```
round_id      text   FK → rounds.id, NN
group_id      text   FK → play_groups.id, NN
hole_number   int    NN
carry_value   int    NN, default 1    -- pot value for this hole (1 = normal)
winner_team_id text  FK → teams.id, nullable  -- null = dead/halved hole
PK: (round_id, group_id, hole_number)
```

---

## Task C — Scorecard: Moving Tee Boxes

**Branch:** `feature/moving-tees`
**Model: Opus**

### What
Add a `movingTees` modifier. Each player starts on the same tee box. After each hole, their tee box shifts based on score vs par: eagle → back 2, birdie → back 1, bogey+ → forward 1, par → no change. The shift amounts are configurable per round. The scorecard shows each player's current tee box as a colored dot that updates hole by hole.

### Why
This is a meaningful format change — it's a skill equalizer that rewards consistency over single-hole heroics. The UI complexity is real: you need to track per-player tee box state across 18 holes and display it clearly on a small mobile screen. This is the most UI-intensive of the four tasks which is why it gets Opus.

### How

**1. Define tee box color order (standard golf convention)**
```javascript
const TEE_BOXES = [
  { id: 'black',  label: 'Black',  color: '#1a1a1a' },
  { id: 'blue',   label: 'Blue',   color: '#3b82f6' },
  { id: 'white',  label: 'White',  color: '#e5e7eb' },
  { id: 'gold',   label: 'Gold',   color: '#f59e0b' },
  { id: 'red',    label: 'Red',    color: '#ef4444' },
]
// Index 0 = hardest (black), index 4 = easiest (red)
// Moving back = lower index (harder). Moving forward = higher index (easier).
// Clamp at both ends — can't go harder than black or easier than red.
```

**2. Add modifier config to a round**
Add to `r4` (Skins, upcoming — gives something to show in setup):
```javascript
modifiers: {
  movingTees: {
    enabled: true,
    startBox: 'white',       // everyone begins here
    eagleShift: -2,          // back 2 boxes (toward black)
    birdieShift: -1,
    parShift: 0,
    bogeyShift: +1,          // forward 1 box (toward red)
    doublePlusShift: +1      // bogey+ all treated the same for simplicity
  }
}
```

**3. Add tee box state to `HoleByHoleEntry`**
```javascript
// Compute tee box state for every player at every hole
function computeTeeBoxes(holes, players, modifiers) {
  // Returns { [playerId]: TeeBoxId[] } — index = hole 0..17
  // Start: all players at modifiers.movingTees.startBox
  // After each completed hole: shift based on score vs par
  const TEE_BOX_IDS = ['black','blue','white','gold','red']
  const startIdx = TEE_BOX_IDS.indexOf(modifiers.movingTees.startBox)
  const state = {}
  players.forEach(p => { state[p._id] = Array(18).fill(null) })
  
  players.forEach(p => {
    let currentIdx = startIdx
    holes.forEach((hole, hi) => {
      state[p._id][hi] = TEE_BOX_IDS[currentIdx]
      const strokes = Number(hole.strokes[p._id])
      if (!strokes) return  // not yet entered
      const diff = strokes - hole.par
      let shift = 0
      if (diff <= -2) shift = modifiers.movingTees.eagleShift
      else if (diff === -1) shift = modifiers.movingTees.birdieShift
      else if (diff === 0) shift = modifiers.movingTees.parShift
      else shift = modifiers.movingTees.bogeyShift
      currentIdx = Math.max(0, Math.min(4, currentIdx + shift))
    })
  })
  return state
}
```

**4. Display tee box on the scorecard grid**
In `HoleByHoleEntry`, for each player-row × hole-column cell:
- Show the stroke input as normal
- Below the input (or as a small colored dot in the cell corner), show the tee box color the player is ON for that hole
- Current hole's tee box for each player: show as a solid colored pill `● White` in the player name column
- Future holes: show a faint dot (the projected box if they par out from here)
- Completed holes: show a faint dot of what tee they were on

Keep the dot small — 8px circle in the bottom-right corner of each cell. Don't let it compete with the stroke number.

**5. Add "Starting Tee Box" selector to RoundBuilder**
In the round details step (or modifiers step if it exists), when `movingTees` is toggled on:
- Show the 5 tee box color buttons as a horizontal selector
- Show the shift sliders (or +/− steppers): Eagle/Birdie/Par/Bogey shifts, each bounded -3 to +3
- Default: eagle=-2, birdie=-1, par=0, bogey=+1

**6. Show tee box legend on the scorecard header**
When moving tees is active, show a one-line legend below the scorecard header:
> `● Black  ● Blue  ● White ●  Gold  ● Red` — with colored dots, no words needed if space is tight

### Done when
- r4 (upcoming/Skins) has movingTees config in mock data
- Opening HoleByHoleEntry for any r4 group shows tee box dots per player
- Entering scores updates the tee dots for subsequent holes in real time
- A player who birdies hole 1 shows Blue on hole 2 (if starting White)
- A player who eagles hole 1 shows Black on hole 2
- Clamping works: player on Black who birdies stays on Black

### Schema impact — update `SCHEMA.md`
Add to `player_hole_scores` (new table):
```
round_id      text   FK → rounds.id, NN
group_id      text   FK → play_groups.id, NN
hole_number   int    NN
player_id     text   FK → users.id, NN
strokes       int    NN
tee_box       text   nullable   -- current tee box COLOR ID for this hole ('black'|'blue'|'white'|'gold'|'red')
PK: (round_id, group_id, hole_number, player_id)
```
Add `TEE_BOXES` reference note in SCHEMA.md — this is app-level config, not a DB table.

---

## Task D — Multi-Team Scoring

**Branch:** `feature/multi-team`
**Model: Opus**

### What
Add a 3-team mock scenario and verify that the entire scoring pipeline — group formation, score entry, leaderboard aggregation — works correctly with 3 teams. Identify and fix any 2-team assumptions in the UI. Add dead-hole logic (all tied = no winner, hole carries if carryOver is on).

### Why
The schema already supports N teams. The code doesn't. Before migration, you need to know exactly where 2-team assumptions live and that fixing them doesn't break the existing BBMI (2-team) scenario. Opus is needed here because the 2-team assumptions are subtle — they show up in colors, in the lead bar, in the "halve" result option, and in the scorecard column headers.

### How

**1. Add a 3-team mock event to the prototype**
Create `THREESOME_EVENT` alongside `BBMI_EVENT`:
```javascript
const THREESOME_EVENT = {
  _id: 'threesome-test',
  tripId: 'trip-threesome',
  title: '3-Team Test Event',
  teams: [
    { _id: 'team-red',   name: 'Red Team',   shortName: 'Red',   color: '#ef4444', colorDim: '#2a0a0a' },
    { _id: 'team-green', name: 'Green Team', shortName: 'Green', color: '#22c55e', colorDim: '#0a2a0f' },
    { _id: 'team-blue',  name: 'Blue Team',  shortName: 'Blue',  color: '#3b82f6', colorDim: '#0a1a2a' },
  ],
  players: [/* 9 players, 3 per team, in 3 threesomes */],
  groups: [
    { _id: 'g1', name: 'Group 1', teeTime: '8:00 AM', playerIds: ['r1','g1','b1'] },
    { _id: 'g2', name: 'Group 2', teeTime: '8:12 AM', playerIds: ['r2','g2','b2'] },
    { _id: 'g3', name: 'Group 3', teeTime: '8:24 AM', playerIds: ['r3','g3','b3'] },
  ],
  rounds: [
    { _id: 'tr1', day: 1, title: 'Match Play', format: 'match_play', status: 'active', pointsAvailable: 3, modifiers: null }
  ],
  sides: []
}
```
Add a matching `trip-threesome` entry to `MOCK_TRIPS` with `eventId: 'threesome-test'`.

**2. Audit and fix 2-team assumptions — the known list**

Find every one of these patterns and make them work for N teams:

- **Lead bar in LiveLeaderboard**: currently `teamA pts vs teamB pts` with a split bar. For N teams: replace with a sorted horizontal bar chart — each team gets a segment proportional to their points, colored by team color. Label each segment with `shortName + pts`.
- **ScoreEntry "Team A wins / Halved / Team B wins"**: for N teams, show a button per team (winner) plus a "Dead hole" option (no winner). A dead hole still increments carry pot if carryOver is on.
- **HoleByHoleEntry column headers**: currently split into teamA players | teamB players. For N teams: group players by team with a colored team header row above each group's columns.
- **`computeScores()` function**: already handles N teams generically — verify this, no change expected.
- **`group_result_scores` constraint** `CHECK (points IN (0, 0.5, 1))`: for 3+ teams, a win is still 1 point and a loss is still 0. A "halve" in a 3-way match doesn't exist — you either win or you don't. Remove the 0.5 option from the score entry UI when teamCount > 2. The DB constraint stays as-is since 0.5 is still valid for 2-team events.
- **Team color arrays in CompetitionSetup**: currently 4 colors hardcoded. Extend to 8 colors minimum. Add a color picker for the overflow case. Ensure draft mode works when teamCount = 3 (serpentine draft with 3 captains).

**3. Dead hole logic**
In `ScoreEntry` and `HoleByHoleEntry`, when all teams tie for the lowest score on a hole:
- That hole has no winner
- If carryOver is enabled, pot increments as normal
- If carryOver is disabled, the hole result is simply 0 points for all teams (total across teams < 1 for that hole — this is intentional, not a bug)
- Display "Dead hole" in the result summary for that hole

**4. Verify the 3-team scenario end-to-end**
Navigate to `trip-threesome` → Competition tab → Leaderboard. Enter scores for Group 1. Verify:
- Leaderboard updates correctly
- Lead bar renders 3 segments
- Round summary modal shows 3 team columns
- `computeScores()` returns 3 team keys

**5. Verify BBMI (2-team) is unchanged**
All existing BBMI behavior must be identical after this task. Run through the Owner journey on `trip-bbmi-live` and confirm nothing regressed.

### Done when
- 3-team event is navigable and scoreable
- Lead bar shows 3 colored segments
- ScoreEntry shows 3 team winner buttons + Dead hole
- Halved result option hidden when teamCount > 2
- BBMI 2-team scenario unchanged

### Schema impact — update `SCHEMA.md`
- `group_result_scores.points` CHECK constraint: annotate that 0.5 is only applicable in 2-team events. Application enforces this — DB allows it.
- `rounds.format` enum: add `'match_play'` and `'singles'` to the allowed values list
- Add note to `teams` table: no upper limit on team count per event; color is stored per team and is user-configurable

---

## Task E — Completed Trip Read-Only Mode

**Branch:** `feature/completed-trip`
**Model: Sonnet**

### What
When a trip's derived status is `'completed'`, gate all edit controls behind an `isCompleted` flag. Completed trips flip to a read-mostly view: no add buttons, no edit controls, no lock/unlock actions. Messages and Expenses remain fully functional (people recap and settle after the trip). Add visual treatment in TripDetail header and Dashboard card.

### Why
Right now a completed trip (past `endDate`) renders identically to a planning trip — every edit button is live. This is confusing and risks accidental mutations to historical records. The completed trip is the post-mortem, not the planning board.

### How

**1. Derive `isCompleted` at the top of `TripDetail`**
```javascript
const tripStatus = getTripStatus(trip)
const isCompleted = tripStatus === 'completed'
// Existing:
const isOwner = viewerRole === 'owner'
const canEdit = !isCompleted && (viewerRole === 'owner' || viewerRole === 'planner')
const isOwnerActive = !isCompleted && viewerRole === 'owner'
```
Use `canEdit` and `isOwnerActive` as the gate everywhere. `isCompleted` takes precedence over role.

**2. Tab changes for completed trips**

Home tab:
- Hide Planning Progress arc entirely
- Hide destination panel (lock/unlock/vote) — show locked destination as read-only text
- Hide date panel — show locked dates as read-only text
- Show Quick Info Tiles as read-only (no add/edit/delete)
- Competition section: show final scores prominently, leaderboard link still works

Schedule tab:
- Hide "+ Add Booking" button
- All reservations read-only (no edit/delete)

Crew tab:
- Hide "Add crew member" form
- Hide role change and remove buttons on member rows
- Show RSVP status as read-only text (no change widget)
- Self-service RSVP disabled

Competition tab:
- Hide "Enable Competition" toggle
- All sections read-only (teams, rounds, courses)
- "Close Round" button still available if a round is `submitted` — you still need to be able to officially close it even after the trip ends

More tab:
- Expenses: fully functional — add, edit, split (post-trip settlement is a real use case)
- Messages: fully functional
- Trip Settings: hide archive and delete (already shown; but also disable "Transfer Ownership" — trip is over)
- Show a read-only banner at the top: *"This trip is complete. Most editing is disabled."*

**3. Dashboard card treatment**
For completed trips, `TripCard` already gets muted styling. Add:
- Show final competition result if `trip.eventId` exists: *"Team Hammer won · 14–12"* as a single line below the trip title
- Keep "Past Trips" collapsed by default (already does this)

**4. Trip Detail header**
For completed trips, change the header card:
- Status badge reads "Complete" in muted gray (already works via `getTripStatus`)
- Add a subtle trophy icon `🏆` next to the winning team name if competition exists
- Remove the "Planning" progress bar from the header

### Done when
- `trip-bbmi-2024` (completed mock trip) opens with no edit controls visible
- Expenses tab on BBMI 2024 allows adding a new expense (post-trip settlement)
- Messages tab on BBMI 2024 is fully functional
- BBMI 2025 (active) is completely unaffected
- BBMI 2026 (planning) is completely unaffected

### Schema impact — update `SCHEMA.md`
No schema changes. `isCompleted` is derived from `getTripStatus()` which already works from existing fields. Add a note to the `trips` table:
> *"`status` is never stored. `isCompleted` (used to gate edit controls) is derived as `getTripStatus(trip) === 'completed'`."*

---

## Task F — Read-Only Scorecards for Past Rounds

**Branch:** `feature/readonly-scorecards`
**Model: Sonnet**

### What
Group rows in the round summary modal should be tappable and navigate to a read-only version of the hole-by-hole scorecard. `HoleByHoleEntry` gets a `readOnly` prop. When `readOnly={true}`, all stroke inputs become display-only and the submit button is hidden.

### Why
After a round, players want to relive it. "What did Merling shoot on 14?" is a real question at the bar. Currently there's no way to view a completed group's scorecard — the hole-by-hole data exists (`HOLE_RESULTS`) but is inaccessible post-round.

### How

**1. Add `readOnly` prop to `HoleByHoleEntry`**
```javascript
function HoleByHoleEntry({ group, round, event, onSubmit, onClose, onOfflineResult, readOnly = false })
```
When `readOnly`:
- Replace `<input>` cells with `<div>` styled to match input dimensions but non-interactive
- Hide the submit button row entirely
- Change the header: "Scorecard — Day 2: Stableford" (no "Enter Scores" label)
- Show a "Close" button (not "Submit") at the bottom

**2. Make group rows tappable in the round summary modal**
The round summary modal shows per-group result rows (currently static `<div>`). Make each row tappable when `HOLE_RESULTS[roundId]?.[groupId]` exists:
```javascript
const hasHoleData = !!HOLE_RESULTS[round._id]?.[group._id]
// ...
<div
  onClick={hasHoleData ? () => setViewingScorecardGroup(group) : undefined}
  style={{
    cursor: hasHoleData ? 'pointer' : 'default',
    // existing styles...
  }}
>
  {/* existing content */}
  {hasHoleData && <span style={{ color: 'var(--bt-text-3)', fontSize: 11 }}>View scorecard ›</span>}
</div>
```

**3. Add `viewingScorecardGroup` state to `LiveLeaderboard`**
```javascript
const [viewingScorecardGroup, setViewingScorecardGroup] = useState(null)
```
When set, render `HoleByHoleEntry` with `readOnly={true}` over the round summary modal (or replace it — stacking two overlays is messy; replacing is cleaner).

**4. Seed `HOLE_RESULTS` with realistic data for r1 and r2**
Currently `HOLE_RESULTS` is empty for completed rounds — only active rounds have data from live entry. Add pre-populated hole data for at least one group in r1 and one group in r2 so the feature is demonstrable:
```javascript
HOLE_RESULTS['r1'] = {
  'g1': {
    holes: [
      { holeNum: 1, par: 4, strokes: { brad: 4, merling: 5, jd: 3, jrob: 4 } },
      // ... all 18 holes with realistic scores
    ]
  }
}
```
Don't need all 4 groups — 1 group per completed round is enough to demonstrate.

### Done when
- Tapping Group 1 in the r1 round summary shows a read-only scorecard
- All stroke cells are non-editable text
- Close button returns to the round summary
- Groups without hole data show no tap affordance
- Active round (r3) groups still open the editable ScoreEntry / HoleByHoleEntry as before

### Schema impact — update `SCHEMA.md`
No new tables. Add note to `player_hole_scores`:
> *"Read-only access: when `round.status` is `closed`, clients must not allow stroke edits. When `submitted`, only owner/planner can edit."*

---

## Decision Summary

| # | Decision already made | Notes |
|---|---|---|
| Dead hole | No winner when all teams tie | Pot still carries if carryOver is on |
| Bogey+ shift | Single value covers all over-par | Separate double-bogey shift is v2 |
| Tee box clamping | Hard stop at Black and Red | No wrap-around |
| 2-team "halve" | Removed from score entry when >2 teams | DB constraint unchanged |
| Re-open closed round | Not in v1 | Owner must close intentionally; correction window is the `submitted` state |
| `competitionType` field | Not needed | Schema handles N teams without a type flag; UI differences are driven by `event.teams.length` |

---

## Model Usage Summary

| Task | Branch | Model | Why |
|------|--------|-------|-----|
| A — Round lifecycle | `feature/round-lifecycle` | **Sonnet** | Clear spec, mechanical state changes across known locations |
| B — Carry-over | `feature/carry-over` | **Sonnet** | Algorithmic (carry pot math) but fully specified above |
| C — Moving tees | `feature/moving-tees` | **Opus** | Complex per-player state across 18 holes, subtle display logic on a small screen |
| D — Multi-team | `feature/multi-team` | **Opus** | Requires finding all 2-team assumptions across 5,000+ lines without breaking existing behavior |
| E — Completed trip | `feature/completed-trip` | **Sonnet** | Straightforward gating — thread `isCompleted` through known components |
| F — Read-only scorecards | `feature/readonly-scorecards` | **Sonnet** | `readOnly` prop pattern is simple; seeding hole data is mechanical |

**Recommended order:** A → B → C → D → E → F

Tasks A–D are the scoring architecture. Tasks E–F are the UX cleanup you identified today. Run them in order — each builds on the previous. If you want to parallelize, E and F are fully independent and can be done at any time after A.

---

## After These Tasks

When A–F are merged, update `CONTEXT.md` and then proceed to Phase 0 infrastructure setup per `MIGRATION_PLAN.md`:
1. Create Supabase project
2. Install deps (`@supabase/supabase-js`, `@tanstack/react-query`)
3. Initialize clients
4. Run `SCHEMA.md` tables in creation order

The prototype will be complete at that point. The migration is a clean-break rewrite guided by the prototype as UI spec and the schema docs as database spec.
