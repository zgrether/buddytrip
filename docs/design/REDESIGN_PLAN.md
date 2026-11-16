# Redesign — features, scale, journey audit and build plan

*Updated 2026-11-14. Companion to the Workflow Wireframes canvas (Prototype page = source of
truth; Explorations page = archive). This is the "Circle Era" in DEFERRED.md /
COMPETITION_ENGINE.md: in the UI a Circle is a **Crew**; in code it stays `circles`.*

---

## 1. What the app does — features, ranked

Written the way a marketing page would list them, then ranked by how much each one matters
to people choosing and keeping the app (how often it's used × how much it sets us apart).

| Rank | Feature | The pitch | Why this rank |
|---|---|---|---|
| 1 | **Keep score of any game** | A fast score sheet for cards, board games, dice and golf. No account needed to start. | Used every week, by anyone, with no setup. It's how people find the app. |
| 2 | **Crews** | Your regular groups, with every game you've played together, the records and the rivalries, year after year. | Turns one-off scoring into history worth coming back to. It's the reason to sign up. |
| 3 | **Competitions** | Ryder Cup–style team cups, points cups, brackets: live standings, the clinch watch, the winner's circle. | The thing nobody else does well, and the most fun. Less frequent than #1. |
| 4 | **Golf** | Scorecards with courses and handicaps; match play, stroke play, scramble, rack-n-stack. | Deep and loved by golf groups; narrower audience. |
| 5 | **Trips** | Plan it together: where (ideas and votes), dates (a poll), lodging, the agenda, invites. | High value, but a few times a year. The app's origin. |
| 6 | **Series, rematches and rivalries** | Best-of series, Play again in one tap, head-to-head records. | Small features that make #1 and #2 sticky. |
| 7 | **News and plans in the open** | Organizers post updates; everyone suggests and votes on dinner spots. | Replaces chat; useful on trips. |
| 8 | **Money** | Split trip receipts, see who owes whom. | Expected on trips; not a reason to choose the app. |
| — | Later | Leagues (pick'em), judged events (tastings, cook-offs), the TV board, join with a code. | See FUTURE_PATTERNS.md. |

**What this means for the roadmap:** the build order should follow #1 → #2 → #3, with #4 and #5
already working today and moved over, not rebuilt.

---

## 2. Scale — built for thousands at once

Target: thousands of people at the same time setting up games, scoring, and watching. The
redesign is the moment to fix anything that won't hold up. What's known today (CLAUDE.md,
AUDIT_REPORT.md), and what the redesign should do instead:

| Today | Problem at scale | Redesign |
|---|---|---|
| Live games **poll every ~20s** per open device; boards **poll every 30s**, and a board load computes standings (sometimes twice, per DEFERRED). | Load grows with every viewer, even when nothing changed. A cup with 100 people watching = 100 standings computations every 30s. | **Compute on write, push on change.** Standings and results are stored when a score is posted (they mostly are: `game_results`); viewers subscribe to a per-game / per-competition **Realtime broadcast** channel and refetch only when told something changed. Keep a cheap "has anything changed?" check as the fallback, not a full refetch. |
| **Chat** uses Realtime `postgres_changes`, which checks RLS for every subscriber on every message. | The known Supabase scaling limit. | **Chat goes away** (News replaces it). News is low-write; any live updates use broadcast, not `postgres_changes`. |
| Home (new) would gather games, series, cups, trips and leagues across every crew. | Many queries per Home load, for every user, every open. | A **per-user index of what's going on** ("home items"), kept up to date when things change, read with one indexed query. |
| The visibility rule (players see a game; sharing widens it; crew members see crew things) runs in RLS on every row. | Row-by-row `EXISTS` checks on big tables get slow. | Indexed membership tables and small `stable`, `security definer` helper functions; check plans with EXPLAIN on realistic volumes before shipping. |
| Notifications (e.g. game finished) are sent inside the request. | Slow requests and timeouts when one action notifies many people. | A **queue**: the request records the event; a background job sends. |
| Serverless functions talking to Postgres. | Too many connections under load. | Confirm everything goes through the **connection pooler**; check the Supabase plan's Realtime and connection limits against the target. |
| The future TV board / share links. | Many anonymous viewers. | A **read-only, cacheable snapshot** plus broadcast; no per-viewer queries. |

**Before Phase 1, a scale audit (CC, no product change):** measure today's hot paths, write a
load test (k6 or similar) for N people scoring and M watching, and decide the Realtime design.
Output: `SCALE_AUDIT.md` with numbers and a fix list that feeds the specs below.

---

## 3. Games, competitions and trips — how people tell them apart

Three things you can start from **+**, each one sentence, in this order:

- **Game** — "Keep score of a game (or a best-of series)." The default, the biggest button.
- **Competition** — "Several games with teams or a bracket, and one overall winner." A cup,
  a bracket, later a league with a season.
- **Trip** — "Going somewhere together: dates, a place to stay, the plan." A trip can include
  a competition.

A competition **doesn't need a trip.** The Thanksgiving cup lives in its crew, like a game
does (`trip_id` is already nullable on competitions). It shows on the crew page and on Home
like anything else. Inside a trip, "Add a competition" creates one that belongs to the trip.

**The live card on Home** has one header and one featured thing:
- The **header goes to the event** (the trip, or the competition when there's no trip).
- The **featured thing goes to itself.** What's featured depends on the moment, in this
  order: your live match/game → the next agenda item if it's soon → the standings →
  today's plan. During a round that's your match (→ scoring); in the evening it's the
  standings (→ the competition); the morning of a travel day it's the next agenda item.
- A standalone competition uses the same card: header → the competition, featured → your
  live game or the standings.

---

## 4. Stress test — Home while you're on a trip, playing in a cup

Board: **Home · on a trip, cup live** (Prototype). The trip is one live card (cup bar,
**Open ›**) with your own match inside it (thru 8 · 1 UP, hole strip, **Score hole 9 ›**).
**Your move** mixes the trip's decisions ("Dinner tonight · pick one") with everything else
("Week 4 picks"); **Going on** keeps the Family series and the league rank visible.

---

## 5. Journey audit — holes found

Severity: **[Blocks]** a spec can't be written until it's settled · **[Decide]** needs
Zach's call · **[Draw]** design work, answer is clear · **[Proto]** prototype only.

### J1 · Keep score with a crew
- **a [Blocks → D7 agreed] Series for any game:** a **Single game ▾** chip next to Start on
  Who's playing (Single · Best of 3/5/7); Run it back at game over can also turn a game
  into a series.
- **b [Draw] High or low wins:** catalog games carry it; a blank sheet asks once.
- **c [Draw] The score sheet doesn't say which crew it's in:** crew color band + name in the
  header; tap to change before the first score.
- **d [Draw] Player-count limits:** Start greys out with the reason.
- **e [Draw] Leaving a game unfinished:** it stays Live on Home; the sheet's menu offers
  **Finish · Cancel game** ("Cancel", never "abandon"). A cancelled game isn't counted.
- **f [Draw] Game over → Done** returns to where you started.
- **g [Proto]** The sheet starts with fixed players.

### J2 · Start from a crew page
- **a [Blocks] No finished-game screen.** Every list (crew page, Your games, Home) opens a
  live, editable sheet. Needed: result + the sheet read-only + who can see it + Share +
  Correct + Delete.
- **b [Draw]** The crew page doesn't wear the crew's look.
- **c [Drawn 2026-11-08 → prototype row 9]** Add someone (people you've played with first;
  a name, or a link by text); a member suggests someone (the admin or a Helper approves at the top of People);
  edit a signed-in member (name in this crew + role only); remove someone who's on a trip
  (remove from crew and trip, or only off the trip). Decided 2026-11-08: Helpers can add
  people and approve suggestions; only the admin removes people. Anyone can leave a crew (the
  admin makes someone else admin first). An invite link joins directly and expires after 24 hours.
- **d [Drawn 2026-11-14 → row 7; decided → D16]** Leave, admins, archive, delete. Modelled on Microsoft Teams.
- **e [Decided → D2]** The second role is **Helper**.

### J3 · Pick up a series
- **a [Draw] Cancel a series** part-way; shown as unfinished, not counted.
- **b [Proto]** The sheet doesn't show the 112–87 from the Home preview.

### J4 · A game with scoring choices — works; shares J1-a/b.

### J5 · First time, nobody yet
- **a [Decided → D3]** Score without an account; "Sign up to save this game and play with
  others" appears at game over and when you try to make a crew or invite. The local game
  moves into the account on sign-up.
- **b [Draw]** A first-timer's near-empty Home.

### J6 · Fix a past game — J2-a again; **[Draw]** the You page needs profile, settings,
notifications, sign-out, delete account. Plus **Help · Contact us** (needed by D16: a deleted crew is restored on request within 30 days).

### J7 · Make a crew your own — J2-b; photo upload and crop **drawn 2026-11-16 (row 7) and moved to Later** (Zach: standard, not critical as long as launch has a good set of icons to pick from). Launch needs a fuller Picture set than five emoji. When built: reuses the lodging-photo upload (`AddPropertySheet`); new are the crop, resizing on the phone, and a crew-photos bucket whose write rule follows crew roles.

### J8 · Plan a trip, as the admin
- **a [Decided → D4; drawn 2026-11-08 → prototype row 10]** + → Trip asks which crew first
  (or + New crew): "Everyone on the trip joins this crew, so your games stay together after
  you're home." Who's coming starts from the crew's people; anyone new joins the crew too, and
  the invite says "You'll join the BBMI crew."
- **b [Decided → D15; drawn 2026-11-14 → row 9]** Trip mode: automatic by dates, the admin can start or end it early.

### J9 · On the trip, as the admin
- **a [Decided → D6]** Out of trip mode: the title bar says **‹ Home** (or ‹ wherever you came
  from) in place of the app name. No extra tab.
- **b [Drawn 2026-11-08 → row 10]** Add to the agenda: what, when, then It's set (where) or
  Pick one (everyone suggests and votes; the admin picks).
- **c [Spec in words, no drawing]** The golf live card on Home / crew page. Title line carries
  the course: "Golf · Kiva Dunes". Match play: the hole strip (W/L/H), "1 UP thru 8", "Score
  hole 9" (drawn on p-HomeTrip). Stroke play: "+3 thru 12 · 2nd of 4" and your last three holes
  as scores; same tap target to keep scoring.

### J10 · Invited to a trip, as a member
- **a [Blocks → D3]** Sign-up from an invite email, for someone new.
- **b [Decided → D4]** Joining a trip joins its crew.
- **c [Draw]** A member's view of a big crew.

### Cross-cutting
- **X1 [Decided → D5]** Activity is replaced by Events.
- **X2 [→ D9]** Desktop — a new design, not today's desktop. First comps drawn; awaiting review.
- **X3 [Decided → D18]** Which *Your move* items notify the phone.
- **X4 [Decided → D8]** Quick Game is retired once the no-account score sheet ships.
- **X5 [Blocks]** Moving today's data: BBMI's trips into one crew; trip members → crew
  members; ghost crew → name-only people.
- **X6 [Blocks]** Scale (section 2): scale audit before Phase 1.
- **X7 [Later]** Leagues, the TV board, judged events (FUTURE_PATTERNS.md).

---

## 6. Decisions log

| # | Decision | Status |
|---|---|---|
| D1 | UI name is **Crew** (code keeps `circles`) | ✓ Agreed |
| D2 | Second role is **Helper** | ✓ Decided 2026-11-08 |
| D3 | Score a simple game with no account; sign up to save or to play with others | ✓ Agreed |
| D4 | Every trip belongs to a crew; inviting people to a trip puts them in one crew (existing or new); explain it simply | ✓ Agreed |
| D5 | Activity tab | ✓ Replaced by **Events** (competitions, trips, leagues across crews). Tab bar: Home · Crews · + · Events · You |
| D6 | Leave trip mode with **‹ Home** in the title bar | ✓ Agreed |
| D7 | Series chip on Who's playing + Run it back | ✓ Agreed |
| D8 | Retire Quick Game once the no-account sheet ships | ✓ Agreed (it's the same idea, done properly) |
| D9 | Desktop | ✓ Placement approved 2026-11-14 (left rail, two-column Home, crew page, focus-mode sheet, finished game, trip control room, Show on TV). **Caution for the specs:** the trip's Today page is the one genuinely new desktop surface (itinerary + cup board + live games merged); its spec starts from an inventory of the detail today's ItineraryView, CompetitionFace and live game cards carry, so none of it is lost |
| D10 | "Cancel game" / "Cancel series", never "abandon" | ✓ Agreed |
| D11 | Competitions can stand alone in a crew; + offers Game · Competition · Trip | ✓ Agreed 2026-11-14 |
| D12 | Roles are **Member · Helper · Admin** (not Owner). ~~One admin per crew~~ **A crew can have several admins** (revised 2026-11-14, D16: Teams' answer to orphaned teams). Helpers add people and approve suggestions; only admins remove people, set roles, archive or delete the crew. UI words only: code can keep `owner_id` | ✓ Decided 2026-11-08, revised 2026-11-14 |
| D13 | A game in a crew shows to the whole crew by default, with no line saying so. A "Hide from the rest of the crew" switch on the finished game keeps it to the players' own histories (replaces "players see it; sharing widens it"). No Share button on games | ✓ Decided 2026-11-11 |
| D14 | **Open crews** (a crew of people you don't all know, e.g. a 200-person pool) are Later. Phase 1's data model leaves room for them (see Phase 1 guardrails). Crews today are "people we know" | ✓ Agreed 2026-11-14 |
| D15 | **Trip mode** = the trip's `now` status, which already exists (`trip_status()` / `getEffectiveStatus`, migration 020): on for everyone from 3 days before the start date, off 3 days after the end. While on, opening the app lands every trip member on the trip (incl. right after sign-up from the invite); ‹ Home lasts until the next open. **New:** the admin can start it early or end it early (two optional timestamps on the trip, not a stage column; 020 removed a manual stage and dates stay the default). A panel on the trip Home says what it is, why it waits, why start early. Receipts and money stay editable until end + 14 days rounded to Sunday (`isReadOnly`, as today), so trip mode can end at +3 | ✓ Decided 2026-11-14 |
| D16 | **Crew lifecycle, modelled on Microsoft Teams.** Several admins allowed; only the last admin can't leave ("You're its only admin. Make someone else admin first."). Leaving or being removed takes the crew's games out of that person's own history; their scores stay in the crew's games; the confirm says so ("Its games leave your history."). Leaving a crew leaves its upcoming trips. **Archive** is the normal end: moves to Archived for everyone, nothing deleted, any admin can bring it back. Where: the Crews tab ends with "Archived · N" (only when there are any) → the list → the crew page read only (grey look, "Archived Nov 14" banner, no Start buttons, no Who's playing); admins get **Bring it back** and **Delete crew** there, members can open it and leave. Archived games stay in everyone's Your games and record; Home's Recent skips them. **Delete** wipes its games, cups, trips and receipts for everyone; it's soft-deleted for 30 days and restored only by contacting us (the admin tool restores it), then gone. Needs: a Contact us page (You → Help), and restore-a-deleted-crew in the admin tool. Members see names only, never emails | ✓ Decided 2026-11-14 |
| D17 | **Brand: Put Me Down For (PMDF)**, "Same crew. Every game. Anywhere." Logo Route A (the Pen line as the last character, `PMDF ___`). Palette Ink / Paper / Pen with Pen on Paper; Live red with dot and word; gold only means won; Lime replaces cyan. Rulings 2026-11-16: palette and the Paper/Ink neutrals adopted now; Archivo and score tiles on the score surfaces Phase 2 builds; crests and custom glyphs deferred, lucide stays; light-as-default not ruled. Everything in `docs/design/BRAND.md`. **Open:** float and chrome surfaces, status colors, logo files, domains (Zach buys), trademark | ✓ Decided 2026-11-16 |
| D18 | **Your move pushes only when someone is waiting on you or a deadline is close;** everything else waits on Home. One push per item, at most one reminder. Yes: invited to a crew/trip/game (invites; replaces the email when they have the app, never both) · make your picks, one reminder ~3h before lock if unpicked (game results) · vote on dates or ideas, when the poll opens + one reminder a day before close if unvoted (planning) · approve a suggested person (organizer) · results needed on a game you run (organizer, already wired) · trip mode starting, early or by date (planning) · settle up, once when the trip becomes its recap, only if you owe or are owed (planning) · made a Helper or admin (invites). No: "make a crew?" suggestions · Start game N of a series · removed from a crew or a crew archived. The `chat` category retires with chat (News replaces it); settings show five: Games & cups, News, Trips, Invites, Running things | ✓ Decided 2026-11-16 |

**D5 options (in place of Activity):**
- **Events** — every competition, trip and (later) league you're in: upcoming, live, past.
  Gives standalone competitions an obvious home, keeps the + centered with two tabs each side
  (Home · Crews · + · Events · You). *Recommended.*
- **Games** — move Your games out of You into its own tab; You becomes record + settings.
- **Nothing** — four tabs with an off-center +.

---

## 7. Build plan

### Principles
- **Close the holes before the first spec**; specs are written from Prototype boards.
- **Every spec covers phone and desktop.** Desktop is designed alongside each phase, not
  bolted on after.
- **Model first, then vertical slices,** each shippable end to end.
- **The live app keeps working:** new navigation behind a flag for testers until Phase 4.
- **Design one phase ahead of the build.**
- **Reuse before new:** each spec's Phase 0 audits StandardGrid, GolfCard, Sheet,
  ReorderableList, NeedsAttentionCard, CupTrophy/ribbons, ghost crew, invites, News,
  Quick Game.
- **Performance is a requirement in every spec:** what's computed on write, what's pushed,
  what each screen costs per open; load-tested where it matters.
- House spec rules hold: Phase 0 report-and-STOP, DO NOT lists, a commit per task, STOPs
  for on-device looks; Zach runs production migrations.

### Which model when
Opus 5.5 is the default. Switch only where the work changes shape:

| Work | Model | Why |
|---|---|---|
| Design sessions, reviewing boards, writing specs, ruling on copy | **Opus 5.5** | Judgment over a lot of context; the default |
| The data model and RLS for Phase 1 (`CREWS_FOUNDATION.md`), the scale audit's Realtime design, the data-move map (X5) | **Fable 5.1** | The few problems where a wrong call is expensive and hard to undo. One deep pass, then back to Opus |
| An independent check of high-stakes work (a migration, an RLS change, a finished spec) by a model that didn't write it | **Fable 5.1** | A fresh reviewer that isn't grading its own work |
| Claude Code carrying out a reviewed spec task by task; refreshing audits; copy renames (Owner → Admin); tests; doc mirroring | **Sonnet 5.5** | The thinking is already in the spec; this is careful execution, faster and cheaper |
| Claude Code's Phase 0 report-and-STOP on a new spec | **Opus 5.5** | It decides what the spec got wrong about the code |

Each spec names its model at the top, and a STOP that turns up a design question goes back to
Opus before work continues.

### Phases

**Phase 0 — Close the holes (design).** D5, D9 (desktop comps), D11. Draw: finished-game
screen; You page; first-run and sign-up (incl. from an invite and "sign up to save"); people
flows; the + chooser (Game · Competition · Trip); a standalone competition's start; trip
invite → crew explanation; ‹ Home title bar; opening an agenda slot; golf mini card; series
chip; Cancel game. Update the Prototype.

**Phase 0 also: the look pass (design).** Once the grey boards are approved, redraw the key screens in the PMDF look (Home, the score sheet, the finished game, a crew page, the cup board, desktop Home) so every spec has a visual reference, and write `BRAND_TOKENS.md` for Claude Code: the token split, the neutrals, the eight team colors and the cyan mapping, Archivo with its fallback, and the score tile component (crests and custom glyphs are deferred; lucide stays). It lands before Phase 2, which is the first phase that builds new screens.

**Phase 0.5 — Scale audit (CC, no product change).** `SCALE_AUDIT.md`: today's hot paths,
a load test, the Realtime design, the fix list.

**Phase 1 — Foundation (ships dark).** Crews in the data model (membership, Helper role,
person records absorbing ghost crew, `games.circle_id`, `trips.circle_id`,
`competitions.circle_id`, visibility rule) **plus the scale groundwork** it needs (indexes,
RLS helpers, the per-user "home items" index, event queue). Backfill BBMI.

**Phase 1 guardrails for open crews (D14).** Not built now, but nothing in Phase 1 may rule
them out. Each is cheap now and a migration later:
- **Join policy on the crew** (`join_policy`: invite only today; "anyone with the link" later).
  Stored, not shown.
- **Invites aren't trip-only.** Today `invites` hangs off `trip_id` with a fixed 7-day expiry.
  Make the target a crew or a competition, with `expires_at` and `max_uses` per invite; 24 hours
  is the default for crew links, not a rule.
- **Entrants are not members.** A competition's players are its own rows; never assume everyone
  in the crew is in it, or that joining one joins the other.
- **No list assumes a small crew.** Member and stats queries are paged and capped; anything that
  shows faces takes a cap and falls back to a count plus search (BigCrew's "+23 ▾" is the model).
- **Members can't read each other's contact details.** Other members get name and photo through
  a view or RLS; email and phone stay with the person and the admin.
- **Names per crew** ("name in this crew", J2-c) so six Mikes can be told apart.
- **Notifications:** a per-crew mute and an "about me" flag on each event in the registry; the
  BATCH coalescing that NOTIFICATIONS.md leaves undesigned must cover "14 people joined".
- **"People you've played with"** comes from games played together, not from sharing a crew,
  so a big crew of strangers never fills your suggestions.
- **Crews can end** (`archived_at`): out of the rail and the Crews list, history kept.

**Phase 2 — The everyday game loop (behind a flag).** + → Game → Who's playing → score sheet
→ game over → finished-game screen → Your games → add a past game to a crew. Works with no
account (local), "sign up to save" moves it to the account. Live updates by broadcast.
Retires Quick Game.
Golf inside this loop reuses today's Quick Games screens unchanged (setup sheet, CoursePicker,
ScoreEntryView + keypad, side bets, finish/settlement). New for golf: + → Golf lists the formats
(in place of the dashboard tiles) with any round in progress; finished rounds are saved to the
database (Your games, history) instead of one localStorage slot per format; the no-account path
needs the login wall and the authed course procedures opened up, or course-less rounds until
sign-up. Prototype row 11.
Two standard screens (prototype row 12), used by every game type including golf:
- **How to score**: the game's token, name, rule, player limits, then ways to score (with previews
  in the game's own sheet shape) and who wins. On the way in for every game; a game with one
  way to score shows Everyone for themselves, already chosen. Who's playing shows the rule under
  the game name and reopens it. PLAY on this screen starts a series up front (One game / Best of
  3, 5, 7; not for golf).
- **A finished game**: header · crew band · result · series · the sheet · money · where it lives
  (or make a crew / sign up) · next. Same slots for game over and opened later. The bottom row is
  always one button: Start game N in an open series, Play series again once a series is over (won
  or ended early), otherwise Play again. Series choices live in the series slot: End the series
  here while it's open (the leader wins, "Ended early · You won 3–2"; a tie ends as a draw), Extend
  to best of N+2 when it's won, Make it a series (Best of 3/5/7; this game is game 1) on the
  latest single game. Every sheet says TOTAL. Who sees it (D13): a crew game shows to the crew,
  with nothing said; one switch, "Hide from the rest of the crew", keeps it to the players' own histories.
  No Share button; Correct scores and Delete this game are quiet links.
- **Continuing a series** never needs the history: Home's Going on (Start game N); the series row
  on a crew page or in Your games opens with the live game or "Game N · Up next · Start" first;
  How to score offers an open series when the picked players already have one in that game.
  End the series sits in the series card of every game in an open series. No separate series page.
- **The score sheet must be abstractable** (SCORE_SHEET_PATTERNS.md): one shell (rows, TOTAL,
  Cancel/Finish) whose entry panel swaps by pattern (count up, went out, bid and make, split a
  fixed pool, fill a box, who won the round), driven by `scorecard_schema` like golf's cards.
  Phase 2 builds the shell with count-up only, but must not hard-code it.
  Every "play again" in the app continues an open series between the same people.

**Phase 3 — Crews.** Crews tab, crew page, Edit crew, people flows, invites.

**Phase 4 — Home, navigation and the desktop shell (flag comes off).** Home by urgency,
mini score sheet, the decided tab bar (D5), You page, desktop layout.

**Phase 5 — Competitions on their own.** Start a competition from + in a crew; live card on
Home; standings computed on write and pushed (fixes today's polling).

**Phase 6 — Trips inside crews.** Trips belong to crews (with the new-crew-on-invite flow),
trip mode in and out (‹ Home), News replaces chat (chat hidden, not deleted), agenda slots
with ideas, team pages, the trip live card.

**Phase 7 — Later.** Moving games between crews, leagues, open crews and pools (D14), the TV board, join with a code,
judged events, crew photos (J7), Google profile photos as an option instead of the app avatar, pins in the desktop rail (see below), the past-trip recap (see below), the
one-tab Itinerary (ITINERARY_REDESIGN.md: deferred; today's Agenda/Lodging fit as they are).

### Desktop rail: events under their crew (decided 2026-11-08)
A crew in the rail always opens its crew page. While a trip or competition is live or about
to start, it gets its own indented line under its crew ("BBMI 2027 · LIVE"), one click to it.
It appears and drops off on its own (a few days after it ends, once money is settled). On the
event, its line is active and the crew is bold as its parent. No "pin to rail" prompt.
Later, maybe: a quiet pin icon for things the app can't know you care about (a league, a
series); desktop only, since the phone has no rail and Home already sorts by urgency.

### Past trips are a recap, not empty tabs (end of the list)
A finished trip shouldn't open as the live trip with Agenda, Lodging, Money and People tabs
that are mostly empty (most past trips today have only competitions and people). It becomes
one page of a few panels, no tabs:
- **The result** — who won the cup, final score, standouts.
- **The games** — kept in full: every competition and game, with links into each.
- **Who came** — faces and names.
- **Where and when** — one line (from lodging, if it was entered).
- **Money** — "all settled", only if money was used.
A panel with no data doesn't show. The crew page's Events list and Events → Past link here.

### Home: the rules (decided 2026-11-12, prototype row 1)
Always this order; a section shows only when it has something:
- **LIVE NOW**: live = a game being scored now, or an event you're in that's on today. One tinted
  panel (the only red on Home) with its title inside, one card per live thing: your game gets the
  mini sheet (name and crew; golf adds the course; no series info), an event is one line with its
  key number, a trip on today is one card with your match inside. Over 3: "+N more live".
- **YOUR MOVE**: one line and one button per item (picks, invites, decisions, "make a crew?"
  suggestions); details on tap. Up to 3, then "+N more".
- **GOING ON**: a series as the series card (dots, who leads, Start game N), leagues, competitions
  between games. Up to 3.
- **COMING UP**: the next 2 dated events.
- **RECENT** (replaces Play again): last finished games, one row per group (same game, same
  people), newest first, up to 3; each row is the result plus ▶ to play again (▶ continues an open
  series). Live games and games in an open series don't repeat here. "All your games ›" in the header.
- **Starters** (+ Keep score, + Plan a trip): only while nothing is Live, Going on or Coming up and
  there are fewer than 3 recent games.
A first game and a busy week are the same Home; there is no separate new-user mode.

### Already built: reuse it, never re-spec it (checked against main @ bbc3bcc)
Prototype boards titled **Exists ·** stand in for these. Specs reference the component and say
only what changes around it.

| Area | What exists today |
|---|---|
| Trip planning | Trip tabs (Home, Crew, Lodging, Agenda, Receipts); destination ideas, voting and lock (`IdeaZonePanel`); date poll; setup guide (`FreshTripGuide`); lodging; agenda (`ScheduleTab`) and the read-only itinerary; quick-info tiles; receipts and splits |
| Trip people | Crew tab roster; roles Owner / Organizer / Member; name-only (ghost) crew; email invites and invite blast; the `/invite` page with invite links and spent-link handling |
| News | `NewsPanel`, composer, rich text, notifications |
| Competitions | The starting-point picker ("What are you playing?", tiles with `StartingPointArt`, Build your own) and its review; the Head-to-Head Cup / Tournament chooser; `TeamsPanel` (up to 8 teams, colors); the competition board (`CompetitionFace`, hero, leaderboard, games panel, clinch celebration, podium, side games) |
| Golf | Quick Games (setup sheet, `CoursePicker`, handicaps, side bets and settlement, finish screens); trip golf games (stroke, match, skins, rack-n-stack, scramble); `ScoreEntryView` + keypad; `StandardGrid` / `ScorecardSheet` |

**What the specs do cover (new):** crews as the container (data, pages, people, look);
+ / Home / tabs / desktop shell; How to score, Who's playing, the everyday score sheet shell and
the finished-game screen; Your games and You; Events; crew-scoped competition creation (the
picker's new "For which crew?" step and the standalone wiring); trips belonging to crews (who
joins the crew, ‹ Home); team pages with results; the scale work. Renames (Owner → Admin,
Organizer → Helper) are copy changes on existing screens.

### Spec list
1. `SCALE_AUDIT.md` — Phase 0.5 (CC writes it)
2. `CREWS_FOUNDATION.md` — Phase 1
3. `GAME_LOOP.md` — Phase 2 (may split: start · sheet & game over · Your games & sign-up)
4. `CREW_PAGES.md` — Phase 3
5. `HOME_AND_NAV.md` — Phase 4 (incl. desktop shell, and the rename to PMDF: domain, home-screen name and icon, email sender, bbmi.app redirect)
6. `COMPETITIONS_STANDALONE.md` — Phase 5
7. `TRIPS_IN_CREWS.md` — Phase 6 (may split)
