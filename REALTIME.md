# BuddyTrip — Realtime Architecture

*Defines which features use Supabase Realtime subscriptions vs. standard TanStack Query fetching.*

**Philosophy:** Realtime subscriptions are expensive to maintain (one persistent WebSocket connection per channel, with re-subscribe logic on reconnect). Only use them when a user would be confused or blocked by stale data. Everything else uses TanStack Query with stale-while-revalidate and refetch-on-focus — cheap and self-healing.

---

## Decision Matrix

| Feature | Strategy | Reason |
|---------|----------|--------|
| Trip chat messages | **Realtime** | Multi-user; lag > 1s feels broken |
| Team chat messages | **Realtime** | Same |
| Live leaderboard scores | **Realtime** | Scores submitted by other users while you watch |
| Notification bell | **Realtime** | Bell count should update without refresh |
| Side event results | **Realtime** | Part of the total score display |
| Destination vote counts | **Polling (30s)** | Low urgency; small group (8–16 people) |
| Date poll vote counts | **Polling (30s)** | Same |
| Trip detail (home, schedule, crew) | **TanStack Query** | Infrequent changes; refetch-on-focus sufficient |
| Expense list | **TanStack Query** | No real-time urgency |
| Reservation list | **TanStack Query** | Static once booked |
| Crew roster | **TanStack Query** | Changes rarely during a session |
| Dashboard trip cards | **TanStack Query** | Refetch on navigate-to is sufficient |

---

## Realtime Channels

### 1. Trip Chat — `messages` (channel = 'trip')

**Screen:** TripMessages, TripDetail (chat teaser)
**Table:** `messages`
**Events:** `INSERT`
**Filter:** `trip_id=eq.{tripId} AND channel=eq.trip`

```ts
const channel = supabase
  .channel(`trip-chat:${tripId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `trip_id=eq.${tripId}&channel=eq.trip`,
    },
    (payload) => {
      setTripMessages((prev) => [...prev, payload.new as Message])
    }
  )
  .subscribe()

// Cleanup on unmount:
return () => { supabase.removeChannel(channel) }
```

**Lifecycle:** Subscribe when TripMessages screen mounts. Also subscribe in TripDetail when the home tab is visible (for the chat teaser unread count). Unsubscribe on unmount.

**Optimistic updates:** When the current user sends a message, append it to local state immediately — do not wait for the Realtime event (that would cause a duplicate). Filter incoming events by `payload.new.user_id !== currentUser.id` to avoid duplicates, or use an `_id` dedup set.

---

### 2. Team Chat — `messages` (channel = 'team')

**Screen:** TripMessages
**Table:** `messages`
**Events:** `INSERT`
**Filter:** `trip_id=eq.{tripId} AND channel=eq.team AND team_id=eq.{teamId}`

```ts
// Only subscribe if the current user has a team assignment
const myTeamId = await getTeamId(eventId, currentUser.id) // null if unassigned

if (myTeamId) {
  const channel = supabase
    .channel(`team-chat:${tripId}:${myTeamId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `trip_id=eq.${tripId}&channel=eq.team&team_id=eq.${myTeamId}`,
      },
      (payload) => {
        setTeamMessages((prev) => [...prev, payload.new as Message])
      }
    )
    .subscribe()
}
```

**RLS note:** The `messages` RLS policy for team channel must enforce `team_id` — users can only SELECT messages where their `team_assignments.team_id` matches `messages.team_id`. Realtime respects RLS, so an incorrect subscription filter is not a security risk, but filtering server-side reduces bandwidth.

**Lifecycle:** Same as trip chat — subscribe on TripMessages mount, unsubscribe on unmount.

---

### 3. Live Leaderboard — `group_results`

**Screen:** LiveLeaderboard
**Table:** `group_results`
**Events:** `INSERT`, `UPDATE`
**Filter:** `event_id=eq.{eventId}`

```ts
const channel = supabase
  .channel(`scores:${eventId}`)
  .on(
    'postgres_changes',
    {
      event: '*', // INSERT and UPDATE both matter
      schema: 'public',
      table: 'group_results',
      filter: `event_id=eq.${eventId}`,
    },
    (payload) => {
      // Recompute the full score summary from the updated group results
      queryClient.invalidateQueries({ queryKey: ['groupResults', eventId] })
    }
  )
  .subscribe()
```

**Schema addition required:** Add `event_id text REFERENCES events(id)` as a denormalized column on `group_results`. This enables the server-side filter. Without it, you'd have to subscribe to all `group_results` changes and filter client-side.

```sql
ALTER TABLE group_results ADD COLUMN event_id text REFERENCES events(id) NOT NULL;
CREATE INDEX ON group_results(event_id);
```

**Score recomputation:** On receiving an update, invalidate the TanStack Query for `groupResults`. The `computeScores(event, groupResults)` pure function runs client-side — the server only needs to push the raw group result, not the aggregated totals.

**Lifecycle:** Subscribe when LiveLeaderboard mounts. Unsubscribe on unmount. Do not subscribe on Dashboard (the scoreboard strip there is low-urgency — refetch-on-navigate is fine).

---

### 4. Side Event Results — `side_events`

**Screen:** LiveLeaderboard (Overview tab — contributes to total score)
**Table:** `side_events`
**Events:** `UPDATE`
**Filter:** `event_id=eq.{eventId}`

```ts
const sideChannel = supabase
  .channel(`side-events:${eventId}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'side_events',
      filter: `event_id=eq.${eventId}`,
    },
    () => {
      queryClient.invalidateQueries({ queryKey: ['sideEvents', eventId] })
    }
  )
  .subscribe()
```

**Lifecycle:** Opened together with the `group_results` subscription when LiveLeaderboard mounts. Both use the same `eventId` and can be combined into a single channel with two `.on()` listeners.

---

### 5. Notification Events — `notification_events`

**Screen:** TopNav (bell icon — always visible while logged in)
**Table:** `notification_events`
**Events:** `INSERT`
**Filter:** `trip_id=in.(${userTripIds})`

```ts
// Subscribe in App root, after user's trips are loaded
const notifChannel = supabase
  .channel(`notifications:${currentUser.id}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notification_events',
      filter: `trip_id=in.(${userTripIds.join(',')})`,
    },
    (payload) => {
      const event = payload.new as NotificationEvent
      setNotifications((prev) => [event, ...prev])
      setUnreadCount((n) => n + 1)
    }
  )
  .subscribe()
```

**Lifecycle:** Subscribe in the App root once trips are loaded. Re-subscribe (update filter) if the user creates a new trip. Never unsubscribe while the user is logged in.

**Filter limitation:** Supabase Realtime `IN` filters have a maximum length. If a user has more than ~50 trips, paginate or use a server-side function to push notifications instead. For BuddyTrip (small recurring groups), this limit is not a concern.

**Alternative — server-side push:** For production at scale, consider a Postgres trigger that inserts into a `user_notifications` fan-out table (one row per recipient), then subscribe to `user_notifications` filtered by `user_id=eq.{currentUserId}`. Simpler filter, better scalability.

---

## Non-Realtime Features

These use **TanStack Query** with standard fetch semantics.

### TanStack Query Config (global defaults)

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // data is fresh for 30s
      refetchOnWindowFocus: true, // refetch when user returns to tab
      retry: 2,
    },
  },
})
```

### Feature → Query Key mapping

| Feature | Query Key | staleTime override |
|---------|-----------|-------------------|
| Trip list (Dashboard) | `['trips', userId]` | — |
| Single trip detail | `['trip', tripId]` | — |
| Trip members (Crew tab) | `['tripMembers', tripId]` | — |
| Ideas + vote counts | `['ideas', tripId]` | 30s (polling interval) |
| Date poll windows + votes | `['datePoll', tripId]` | 30s (polling interval) |
| Reservations (Schedule tab) | `['reservations', tripId]` | — |
| Expenses (More tab) | `['expenses', tripId]` | — |
| Notifications (initial load) | `['notifications', userId]` | 0 (always refetch on mount) |
| Event + teams + rounds | `['event', eventId]` | — |

### Polling for vote counts

Idea votes and date poll votes should use `refetchInterval` rather than a Realtime subscription. The vote count changing by 1 while a user is looking at the screen is acceptable with up to 30s lag — the group is small and decisions are not time-critical.

```ts
// IdeaComparison screen
const { data: ideas } = useQuery({
  queryKey: ['ideas', tripId],
  queryFn: () => fetchIdeasWithVotes(tripId),
  refetchInterval: 30_000, // poll every 30s while screen is mounted
})
```

---

## Supabase Realtime Configuration

### Enable Realtime on required tables (Supabase dashboard or migration)

```sql
-- Enable Realtime publication for the tables that have subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE group_results;
ALTER PUBLICATION supabase_realtime ADD TABLE side_events;
ALTER PUBLICATION supabase_realtime ADD TABLE notification_events;
```

Tables NOT in the publication (standard query only): `trips`, `trip_members`, `ideas`, `idea_votes`, `idea_comments`, `date_polls`, `date_windows`, `date_poll_votes`, `reservations`, `expenses`, `expense_splits`, `users`, `series`, `events`, `teams`, `players`, `team_assignments`, `play_groups`, `rounds`, `quick_info_tiles`.

### RLS requirements for Realtime

Supabase Realtime Postgres Changes respects RLS — a user will only receive events for rows they could SELECT. Ensure these policies are in place:

| Table | Required SELECT policy |
|-------|----------------------|
| `messages` | Trip members can SELECT trip channel; own-team members can SELECT team channel |
| `group_results` | All members of the linked trip's event can SELECT |
| `side_events` | All members of the linked trip's event can SELECT |
| `notification_events` | Members of the notification's trip can SELECT |

See `PERMISSIONS.md` for the full RLS policy definitions.

---

## Channel Lifecycle Summary

| Channel | Opened | Closed | Re-subscribe condition |
|---------|--------|--------|----------------------|
| `trip-chat:{tripId}` | TripMessages mounts | TripMessages unmounts | `tripId` changes (navigate to different trip) |
| `team-chat:{tripId}:{teamId}` | TripMessages mounts (if team assigned) | TripMessages unmounts | `tripId` or `teamId` changes |
| `scores:{eventId}` | LiveLeaderboard mounts | LiveLeaderboard unmounts | `eventId` changes |
| `side-events:{eventId}` | LiveLeaderboard mounts | LiveLeaderboard unmounts | `eventId` changes |
| `notifications:{userId}` | App root on login | App root on logout | User's trip list changes (add filter) |

**Reconnect handling:** Supabase client handles reconnect automatically. On reconnect, re-fetch the full dataset (invalidate the relevant TanStack Query) to catch any events missed during the disconnect window:

```ts
channel.on('system', {}, (payload) => {
  if (payload.extension === 'presence' && payload.event === 'sync') {
    // Channel reconnected — fetch missed data
    queryClient.invalidateQueries({ queryKey: ['messages', tripId] })
  }
})
```

---

## Prototype → Production Mapping

| Prototype pattern | Production equivalent |
|------------------|--------------------|
| `setTripMsgs(prev => [...prev, msg])` after local send | INSERT to `messages` table → Realtime pushes to other subscribers |
| `GROUP_RESULTS[roundId][groupId] = result` + `scoreNonce++` | INSERT/UPDATE `group_results` → Realtime invalidates leaderboard query |
| `NOTIFICATION_EVENTS.push(event)` + `notifNonce++` | INSERT to `notification_events` → Realtime pushes to all trip members |
| Module-level reads at component init | `useQuery()` on mount with stale-while-revalidate |
| `setTrips()` after destination/date lock | PATCH `trips` → invalidate `['trip', tripId]` query |

---

## Implementation Order

When wiring up Realtime during migration (see `MIGRATION_PLAN.md`):

1. **Messages last** — implement chat UI with optimistic local state first (matches prototype behavior); add Realtime subscription after the UI is stable
2. **Leaderboard before messages** — score accuracy is higher stakes than chat lag
3. **Notifications after leaderboard** — lowest complexity; just append to an array
4. **Never add Realtime to voting/dates** — polling is intentional; Realtime subscriptions for 8-16 person groups would be premature optimization
