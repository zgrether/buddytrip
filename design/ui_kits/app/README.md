# BuddyTrip — mobile app UI kit

A high-fidelity React recreation of the BuddyTrip mobile app's core
screens. Drop these components into a prototype and you'll get the look
and behavior of the production app without wiring up Supabase / tRPC /
realtime subscriptions.

## Files

| File | What |
|---|---|
| `index.html` | Click-thru prototype. **Showcase** mode shows all four screens side-by-side in iPhone frames; **Interactive** mode collapses to a single phone you can navigate through. |
| `atoms.jsx` | `BTIcon`, `BTFlag`, `BTButton`, `BTStatusBadge`, `BTRoleBadge`, `BTAvatar`, `BTNudge`, `BTPlanningRow`, `BTVoteCell`, `BTLiveBadge` — small reusable building blocks. |
| `chrome.jsx` | `BTTopNav`, `BTBottomNav`, `BTTripTabBar` — the app's navigation surfaces. |
| `screens.jsx` | `DashboardScreen`, `TripHomeScreen`, `DatePollScreen`, `ScoreboardScreen` — the four screens stitched together. |
| `ios-frame.jsx` | iPhone device bezel + status bar (starter component). |

## Screens covered

1. **Dashboard / My Trips** — TopNav, welcome line, NOW / ACTIVE / IDEAS
   sections, multiple `TripCard` variants (dark gradient, idea-stage,
   competition trophy chip, unread badge, countdown bar).
2. **Trip Home** — locked-destination hero with temporal gradient + gear,
   countdown bar, accent + warning nudge banners, four collapsible
   PlanningRows (one opens inline with a crew list), an "Add a
   Competition" dashed CTA, and the in-trip BottomNav.
3. **Date poll** — the full availability grid: zebra rows, dashed
   unvoted cells, yes/maybe/no fills. Tap your row to cycle the vote.
4. **Scoreboard** — Live pill, event chips (done / active / upcoming /
   final), team rows with leading-team highlight, current-hole entry.

## How to use the components

The atoms read directly from CSS variables in
`../../colors_and_type.css`, which `index.html` pulls in. Drop that
stylesheet into your prototype and the components will theme correctly.

```jsx
<BTButton variant="primary" icon="lock">Lock dates</BTButton>
<BTStatusBadge status="going" />
<BTRoleBadge role="Owner" />
<BTAvatar name="Zach Grether" size={36} teamColor="#a855f7" />
<BTNudge tone="warning" title="Arrival is before the trip starts" />
<BTPlanningRow icon="map-pin" title="Destination" sub="Pinehurst — locked ✓" state="done" />
<BTVoteCell vote="y" />
```

`BTIcon` accepts a name from a small hand-traced subset of lucide:
`map-pin`, `calendar`, `trophy`, `users`, `user-plus`, `home`, `hotel`,
`dollar`, `activity`, `bell`, `settings`, `plus`, `chevron-down`,
`chevron-right`, `chevron-up`, `send`, `message`, `user-check`, `lock`,
`check`, `x`, `wifi`, `key`, `layout-grid`, `arrow-right`, `arrow-left`,
`more-horizontal`. If you need an icon that's not here, pull it from the
real lucide-react in your own project.

## Out of scope (by design)

This kit doesn't replicate every screen — only the four most
characteristic. If you need pixel-fidelity for a specific surface (the
trip settings modal, the catalog browser for lodging, the competition
events panel), go to the source: `src/components/` and
`src/app/trips/[tripId]/` in
[github.com/zgrether/buddytrip](https://github.com/zgrether/buddytrip).

## Known divergences from production

- **Icons are hand-traced lucide paths** rather than the real
  `lucide-react` package, because this kit runs from CDN with Babel
  Standalone. Visual match should be close but not identical for every
  glyph.
- **The temporal gradient** on the trip-home hero is a static teal
  gradient here. In production it's derived from `tripStartDate` and
  drifts cool → warm depending on the season — see
  `src/lib/temporalGradient.ts` for the real algorithm.
- **State silhouettes** (the US state outline drawn behind the trip
  card title) are omitted here. See `src/lib/locationUtils.ts` for the
  full set of state path data.
