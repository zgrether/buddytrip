# BuddyTrip — Trip Planning Arc Specs

*Three focused builds. Each is a single Claude Code session with a single branch and PR.*
*Read CONTEXT.md and SCHEMA.md before starting any task.*
*Orientation: run `grep -r "TripNew\|CreateTrip\|trip-new" src --include="*.tsx" -l` etc. to locate files before editing.*

---

# SPEC 1 — TripNew: Creation Wizard Rewrite

**Branch:** `feature/trip-new-rewrite`
**Model: Opus**

Opus because the destination branching logic, the Claude API integration, and the resulting trip data shape all need to be designed coherently as a unit. This isn't mechanical — the branch behavior and idea seeding have downstream effects on every planning screen.

## What

Rewrite the TripNew wizard from scratch. The current version collects the wrong things in the wrong order. The new version has two steps and one critical branch point.

## Step 1 — "Let's get started"

Three fields, nothing else:

**Trip name** (required, autofocused)
- Placeholder: "BBMI 2027, Tyler's Bachelor Party..."
- Inline error on blur if empty: "Trip needs a name"

**Invite co-planners** (optional, skippable)
- Label: "Invite Co-planners" (not "Invite people")
- Input: name, nickname, or email
- Validates against `users` table — must be an existing BuddyTrip account
- Inline error if no match: "No BuddyTrip account found for that name or email"
- Added co-planners appear as chips below the input
- Helper text: "Co-planners can help manage the trip. You can invite the rest of the crew later."
- Skip link: "Skip for now →"

**No description field.** Description lives on the trip page itself after creation.

One button: **Next →**

---

## Step 2 — "Where are you headed?"

Header: *"Do you know where you're going?"*

Two choices rendered as large tap targets:

### Choice A — "Yes, we're going to..."

Reveals a destination text field:
- Placeholder: "Bandon Dunes, OR"
- Free text — no lookup required
- One button: **Create Trip**

On create:
- Build trip object with `comparisonMode: false`
- Seed one idea from the entered destination (title = entered text, location = entered text)
- Set `trip.lockedDestination = { title, location, createdAt: now() }`
- Navigate to the new trip's Home tab

### Choice B — "Let's put it to a vote"

Two sub-sections appear below:

**Sub-section 1 — "Add destinations to compare"**
- Single text input: "Enter a destination" with an Add button
- Each added destination appears as a chip/pill that can be removed
- No minimum — user can add 0 and rely entirely on AI suggestions
- No maximum

**Sub-section 2 — "Tell us about your trip and crew"**
- Textarea, 2-3 lines
- Placeholder: "e.g. 6 guys, links lovers, mid-range budget, did Bandon last year..."
- Helper text: "Claude will suggest 3 destination ideas based on this"
- This field is optional but required to trigger AI suggestions

One button: **Create Trip**

On tap:
1. Show a loading state: "Creating your trip..." with a subtle spinner
2. If the crew description field has text, call the Claude API (see API spec below) to get 3 suggested destinations
3. Build the trip with `comparisonMode: true`
4. Seed ideas array: user-entered destinations first, then AI suggestions appended
5. Navigate to the new trip's Home tab — the destination comparison view opens automatically

**If the crew description field is empty and no destinations were entered:** show inline validation: "Add at least one destination or describe your crew so we can suggest some."

---

## Claude API Call Spec

```typescript
// src/lib/ai/suggestDestinations.ts

export async function suggestDestinations(crewDescription: string): Promise<SuggestedDestination[]> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are helping plan a group trip. Based on this crew description, suggest exactly 3 destination ideas.

Crew description: "${crewDescription}"

Respond with ONLY a JSON array, no other text, no markdown:
[
  {
    "title": "Short destination name",
    "location": "City, State/Country",
    "description": "One sentence why this fits the crew",
    "costTier": "$" | "$$" | "$$$" | "$$$$"
  }
]`
      }]
    })
  })

  const data = await response.json()
  const text = data.content[0]?.text ?? '[]'
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}
```

Note: The API key is handled by the existing Anthropic API setup in the app — do not hardcode it. Check how other AI calls are made in the codebase and follow the same pattern.

Each AI suggestion becomes an `idea` object seeded onto the trip:
```typescript
{
  id: `idea-ai-${Date.now()}-${i}`,
  tripId: newTrip.id,
  title: suggestion.title,
  location: suggestion.location,
  description: suggestion.description,
  costTier: suggestion.costTier,
  source: 'ai',  // so the UI can show an "AI suggested" badge if desired
  archived: false,
  createdAt: new Date(),
}
```

---

## Data Shape on Create

**Choice A (known destination):**
```typescript
{
  title: tripName,
  comparisonMode: false,
  lockedDestination: { title: dest, location: dest, createdAt: now() },
  ideas: [],
  attendees: [{ userId: currentUser.id, role: 'Owner', status: 'in', joinedAt: now() },
              ...coplanners.map(u => ({ userId: u.id, role: 'Planner', status: 'in', joinedAt: now() }))]
}
```

**Choice B (voting):**
```typescript
{
  title: tripName,
  comparisonMode: true,
  lockedDestination: null,
  ideas: [...userEnteredIdeas, ...aiSuggestions],
  attendees: [{ userId: currentUser.id, role: 'Owner', ... }, ...coplanners]
}
```

---

## Navigation After Create

Both paths navigate to `trip-detail` for the new trip. The trip Home tab handles showing the right state:
- Choice A: shows the locked destination, no comparison view
- Choice B: opens directly into the destination comparison panel (trip has `comparisonMode: true` and ideas seeded)

---

## Done When
- [ ] Step 1 collects only name + co-planners (no description field)
- [ ] Co-planner input validates against users table, shows error for unknown names
- [ ] Step 2 shows two clear choices as large tap targets
- [ ] Choice A: creates trip with locked destination, navigates to trip home
- [ ] Choice B: destination input adds chips, crew description field present
- [ ] Choice B with crew description: Claude API called, 3 suggestions appended to ideas
- [ ] Choice B with no entries: inline validation shown, trip not created
- [ ] Loading state shown during trip creation + AI call
- [ ] Created trip appears on Dashboard immediately
- [ ] Co-planners added to trip attendees with Planner role

---

# SPEC 2 — Trip Detail: Structure, Header, and Planning Panels

**Branch:** `feature/trip-detail-structure`
**Model: Opus**

Opus because this touches the nav structure, the header component, the date poll location, Quick Info tiles, and the destination comparison view — all interconnected. Getting the layout wrong here affects every tab.

## What

Rebuild the Trip Detail page structure to match the prototype. This covers navigation, the trip header, Quick Info tiles, the destination comparison panel, and the date poll placement. It does NOT cover the Schedule tab internals or the Crew tab (those are Spec 3).

---

## Navigation Structure

### Bottom Nav — context aware

**Outside a trip** (Dashboard, TripNew): 3 items
- Home (house icon) → Dashboard
- New Trip (plus icon) → TripNew
- Live (activity icon) → LiveLeaderboard for most recent active trip, or disabled if none

**Inside a trip**: 3 items, always
- Trip Home (home icon) → trip Home tab
- Messages (message icon) → trip Messages screen, with unread badge
- Live (activity icon) → LiveLeaderboard for this trip, only shown if `trip.eventId` exists; if no competition, this item is hidden and nav stays 2 items

The current bottom nav almost certainly has too many items or the wrong items. Find it, replace it with this logic.

### Trip Tab Bar

Inside a trip, the tab bar sits in the body of the trip page (not the bottom nav). Four tabs:

| Tab | When shown |
|-----|-----------|
| Home | Always |
| Schedule | Always |
| Crew | Always |
| Competition | Always (shows "Add Competition" CTA if no event) |

More tab / overflow is removed — everything that was in "More" (expenses, settings) moves:
- Expenses → Schedule tab, below bookings
- Trip Settings → accessible via a `⋯` icon in the trip header (owner only)

---

## Trip Header Component

The header is a card at the top of every trip tab. It is NOT a hero image until a destination is locked.

**When destination is NOT locked (`comparisonMode: true` or no destination set):**
```
┌─────────────────────────────────────┐
│ BBMI 2027                    [⋯]   │  ← trip name + settings icon (owner only)
│ Destination: TBD                    │  ← muted text
│ Dates: TBD                          │  ← muted text
│ [Planning] badge                    │  ← derived status
└─────────────────────────────────────┘
```

**When destination IS locked:**
```
┌─────────────────────────────────────┐
│ [location hero: city/state pin,     │  ← LocationHero component (see below)
│  destination name overlaid]         │
│                                     │
│ BBMI 2027                    [⋯]   │
│ Bandon Dunes, OR · Mar 11–14        │  ← destination + dates, both editable inline
│ [Active] badge                      │
└─────────────────────────────────────┘
```

### LocationHero Component

A visual component that shows a stylized representation of the destination location. It does not require a photo — use a map-pin style illustration or a gradient with the city and state name large. Think: teal gradient, large city name, small state below, a subtle pin icon. This is purely presentational — no API call needed.

```tsx
// src/components/LocationHero.tsx
interface LocationHeroProps {
  location: string    // "Bandon Dunes, OR" or "Scottsdale, AZ"
  tripName: string
}
// Renders a colored card with the location name displayed prominently
// Extract city and state/country from the location string for display
// Use a consistent color derived from the location string (hash → hue) so
// the same destination always gets the same color
```

### Inline Editable Destination and Dates

When locked, the destination and dates in the header are tappable for owner/planner:
- Tap destination → opens a small inline edit field, save on blur or Enter
- Tap dates → opens a date range picker (or navigates to the date poll on Schedule tab if poll is open)
- Changes save immediately via mutation

---

## Home Tab Content (after header)

### When `comparisonMode: true` and destination not locked:

Show the **destination comparison panel** inline on the Home tab. This is the core "where are we going?" experience.

```
┌─────────────────────────────────────┐
│ WHERE ARE WE GOING?                 │
│ 3 ideas · 5 votes cast              │
│                         [Full view →]│
├─────────────────────────────────────┤
│ [Scottsdale] ████░░ 3 votes         │
│ [Bandon]     ██░░░░ 2 votes  ← mine │
│ [Cabo]       ░░░░░░ 0 votes         │
│                                     │
│ [Vote] [+ Add idea]  ← canEdit only │
└─────────────────────────────────────┘
```

- Each idea row shows name, vote bar, vote count
- The row for the idea the current user voted for gets a subtle indicator
- "Full view →" navigates to IdeaComparison screen
- "+ Add idea" is canEdit only
- "Vote" button — if user hasn't voted, highlights; if voted, shows current vote

### When destination IS locked:

Show the locked destination prominently:
```
┌─────────────────────────────────────┐
│ ✓ DESTINATION LOCKED                │
│ Bandon Dunes, OR                    │
│ Locked by Brad · Aug 20, 2024       │
│ [Reopen vote] ← isOwner only        │
└─────────────────────────────────────┘
```

### Quick Info Tiles

Below the destination panel. Always visible when tiles exist. Owner/planner can add/edit/delete.

```
┌──────────┬──────────┬──────────┐
│ 🚪 Door  │ 📶 WiFi  │ 🚗 Uber  │
│   4892   │ Bandon   │  Brad    │
│          │ Guest    │          │
└──────────┴──────────┴──────────┘
[+ Add tile] ← canEdit only
```

Tiles are tappable to copy the value to clipboard with a toast: "Copied!"

### Planning Progress Arc

Below Quick Info, visible to canEdit only. Shows completion of planning steps:
- Destination locked ✓/○
- Dates set ✓/○
- Crew confirmed (X of Y in) ✓/○
- Competition set up ✓/○ (only if `trip.hasCompetition`)

This is a summary/status list, not a wizard. Each item taps to the relevant tab/section.

---

## Date Poll Placement

**Decision: Both — summary on Home, full poll under Schedule.**

On the Home tab, below the planning arc, show a date summary card:

**When no dates set:**
```
┌─────────────────────────────────────┐
│ 📅 DATES                            │
│ Not set yet                         │
│ [Set dates] [Poll the crew →]  canEdit│
└─────────────────────────────────────┘
```

**When poll is open:**
```
┌─────────────────────────────────────┐
│ 📅 DATES — Poll open                │
│ Mar 9–12: 4 in, 1 maybe, 1 no      │
│ Oct 5–8:  3 in, 2 maybe, 0 no      │
│ [Vote] [See full poll →]            │
└─────────────────────────────────────┘
```

**When dates locked:**
```
┌─────────────────────────────────────┐
│ 📅 DATES LOCKED                     │
│ March 9–12, 2027                    │
│ 152 days away                       │
└─────────────────────────────────────┘
```

The full date poll (add windows, see all votes, lock a winner) lives under **Schedule tab**, above the bookings list.

---

## Schema Changes

**`trips` table — add one column:**
```sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS has_competition boolean NOT NULL DEFAULT false;
```
This is a denormalized flag for quick header rendering. Set to `true` when an event is linked. (Could be derived from `event_id IS NOT NULL` — if that column already exists and is reliable, use that instead and skip the migration.)

**`ideas` table — add one column:**
```sql
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
-- 'manual' | 'ai'
```
Used to show an "AI suggested" badge on ideas that came from the Claude API call in TripNew.

---

## Done When
- [ ] Bottom nav shows correct items inside vs outside a trip
- [ ] Competition tab only shows in nav when trip has a competition (Live item)
- [ ] Tab bar is in the trip body: Home, Schedule, Crew, Competition
- [ ] Trip header shows LocationHero when destination is locked
- [ ] Trip header shows muted TBD state when no destination
- [ ] Destination and dates in header are inline-editable for owner/planner
- [ ] Home tab shows destination comparison panel when comparisonMode: true
- [ ] Home tab shows locked destination card when locked
- [ ] Quick Info tiles render, copy on tap, owner/planner can add/edit/delete
- [ ] Planning progress arc shows for canEdit users
- [ ] Date summary card on Home tab reflects current date poll state
- [ ] Full date poll lives under Schedule tab
- [ ] Trip settings (⋯) accessible from header, owner only

---

# SPEC 3 — Crew Tab: Simplification + RSVP + Frequently Trips With

**Branch:** `feature/crew-tab-rewrite`
**Model: Sonnet**

Sonnet because the logic here is straightforward once the decisions are made. The "frequently trips with" query is the only complexity and it's a defined Supabase query.

## What

Simplify the crew add form, add RSVP visibility for all trip members, and add "frequently trips with" as a shortcut for adding known collaborators.

---

## Add Crew Member Form

The current form is over-complex. Replace it with:

**Single input:** "Name or email"
- Validates against `users` table on submit (name, nickname, or email match)
- If match found: show the matched user's name + avatar for confirmation before adding
- If no match: show two options:
  - "Add [name] as a guest" → creates guest `users` row + `trip_members` row (Option 2 from the guest identity discussion)
  - "Send invite link" → copies an invite URL to clipboard (stub for now — show toast "Invite link copied" with a placeholder URL)

**No separate name field + email field.** One input, smart matching. If the user types an email and it matches, great. If they type "Merling" and it matches a nickname, great. If nothing matches, the guest path handles it.

Role selector appears only after a match is confirmed:
- Default: Member
- Options: Member, Planner (Owner is not assignable — only one owner, set at creation)

Add button: **Add to Trip**

---

## Crew List

Each crew member row shows:
- Avatar (initials fallback)
- Name + nickname
- Role badge (Owner / Planner / Member)
- RSVP status — visible to everyone (not just owner/planner)

RSVP status display:
```
✅ In  |  🤙 Likely  |  🤷 Maybe  |  ❌ Can't go
```

For the **current user's own row**: show RSVP buttons to change their status (existing behavior, keep it).

For **other members' rows**: show their current status as a read-only badge. Everyone can see who's in and who's out — this is social information that helps people commit.

For **owner/planner viewing other rows**: expanded row also shows role change and remove options (existing behavior, keep it).

---

## Frequently Trips With

Below the add form, above the current crew list, show a "Frequently trips with" section.

**Data source:** Query `trip_members` for all trips the current user has been on, then find the users who appear most frequently across those trips (excluding the current trip's existing attendees).

```typescript
// src/hooks/useFrequentTripmates.ts
export function useFrequentTripmates(currentTripId: string, currentUserId: string) {
  return useQuery({
    queryKey: ['frequent-tripmates', currentUserId, currentTripId],
    queryFn: async () => {
      // Get all trips current user has been on (excluding current trip)
      const { data: myTrips } = await supabase
        .from('trip_members')
        .select('trip_id')
        .eq('user_id', currentUserId)
        .neq('trip_id', currentTripId)

      if (!myTrips?.length) return []

      const tripIds = myTrips.map(t => t.trip_id)

      // Get all members of those trips (excluding current user)
      const { data: tripmates } = await supabase
        .from('trip_members')
        .select('user_id, users(id, name, nickname)')
        .in('trip_id', tripIds)
        .neq('user_id', currentUserId)

      if (!tripmates?.length) return []

      // Count frequency per user
      const counts: Record<string, { user: User, count: number }> = {}
      for (const tm of tripmates) {
        const uid = tm.user_id
        if (!counts[uid]) counts[uid] = { user: tm.users, count: 0 }
        counts[uid].count++
      }

      // Get current trip's attendee IDs to exclude
      const { data: currentAttendees } = await supabase
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', currentTripId)

      const alreadyOn = new Set(currentAttendees?.map(a => a.user_id) ?? [])

      // Return top 8, sorted by frequency, excluding already-on-trip users
      return Object.values(counts)
        .filter(c => !alreadyOn.has(c.user.id))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map(c => c.user)
    },
    enabled: !!currentUserId && !!currentTripId,
  })
}
```

**UI rendering:**

```
┌─────────────────────────────────────┐
│ FREQUENTLY TRIPS WITH               │
│                                     │
│ [JD] [Rob] [Tyler] [Ben] [Steve]    │  ← avatar chips, tappable
│ [Charlie] [Merling] [Frank]         │
└─────────────────────────────────────┘
```

Each chip shows the user's avatar + nickname. Tapping one adds them directly to the trip as a Member (same flow as the add form, but skip the search step since we already have the user). Show a confirmation toast: "JD added to trip."

**When no trip history exists:** hide this section entirely — don't show an empty state for it.

---

## Crew List Summary Bar

At the top of the crew tab, show a one-line summary:
```
8 members · 5 in · 2 maybe · 1 can't go
```

This gives the owner a quick headcount without scrolling through the list.

---

## Done When
- [ ] Add crew form is a single input (name or email)
- [ ] Match found: shows confirmation before adding
- [ ] No match: offers "Add as guest" or "Send invite link" (stub)
- [ ] Guest path creates users row + trip_members row
- [ ] Role selector defaults to Member, Planner is the max assignable role
- [ ] RSVP status visible on every member row to all trip members
- [ ] Current user's row shows RSVP change buttons
- [ ] "Frequently trips with" section shows for users with trip history
- [ ] Tapping a frequent tripmate adds them to the trip directly
- [ ] Section hidden when user has no trip history
- [ ] Summary bar shows headcount breakdown at top of tab
- [ ] Owner/planner role and remove controls still work

---

# Execution Order

```
SPEC 1 (TripNew rewrite)        Opus     ← start here
    ↓
SPEC 2 (Trip Detail structure)  Opus     ← depends on knowing what TripNew creates
    ↓
SPEC 3 (Crew tab)               Sonnet   ← can run after SPEC 2 or in parallel
```

SPEC 2 depends on SPEC 1 because the trip header and Home tab behavior depends on what shape a newly created trip has (`comparisonMode`, `lockedDestination`, seeded `ideas`). Build them in order.

SPEC 3 is largely independent of SPEC 2's internals — it only needs the trip and attendees data to exist. If you want to parallelize, SPEC 3 can start once SPEC 1 is merged.

---

# What's Not In These Specs (Intentionally Deferred)

| Item | Why deferred |
|------|-------------|
| IdeaComparison full screen | Lives in prototype, needs its own spec when the comparison panel is working |
| Schedule tab internals (bookings list, tee time → comp link) | Separate spec, depends on SPEC 2's tab structure first |
| Expense management | Moves to Schedule tab per SPEC 2; needs full spec of its own |
| Competition tab internals | Covered by scoring specs (PROD-A through PROD-F) |
| Date poll full UI | Stub in SPEC 2 is enough to unblock; full date poll spec when ready |
| Push notifications | v2 |
