# Redesign — features, scale, journey audit and build plan

*Updated 2026-11-16: recalibrated around the rebuild (D19). Companion to the Workflow Wireframes
canvas (Prototype page = source of truth; Explorations page = archive). This is the "Circle Era"
in DEFERRED.md / COMPETITION_ENGINE.md. A Circle is a **Crew** everywhere: under "the database
speaks the code's language", the new schema calls it `crews` (the empty `circles` tables are not
carried).*

**Progress board:** [PMDF Rebuild Board](https://claude.ai/artifact/5ERP9VQXyezWxqkeW4yyKU), every item by phase and status, kept by Claude as work lands or turns up (items added after the plan are counted separately).

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

**What this means for the roadmap:** the build order follows #1 → #2 → #3. #4 and #5 already
work today and are carried over: their screens and the scoring engine move to the new app with
their tests, and only the data access under them is rewritten for the new schema (D19).

---

## 2. Scale: measured (SCALE_AUDIT.md, PR #1708, 2026-11-16)

The table that was here was written from docs and was partly wrong (boards no longer poll every 30 s;
the app reaches Postgres only through PostgREST, so there is no pooler to configure). The audit replaces
it; `SCALE_AUDIT.md` has the evidence, the load test (`scripts/load/`) and a 15-item fix list by phase.
Production: Supabase **Pro** (org `bbmi`). A bottleneck is a discussion with options, not a reflex to
buy capacity (Principles). For the findings below, the design fixes win on the numbers: even with the
spend cap off, one reset (6,140 messages) is over Pro's highest limit.

**What breaks, in order of cost:**
1. **A member's score read runs a permission function per score row and scans every game in the
   database** (the `FOR ALL` write policies apply to reads; a sub-plan reads all of `games`). An 11-game
   cup: 0.85 ms without RLS, 320–816 ms as a Member. A 408-game container (a long-lived crew): 16 s, past
   the app's 8 s abort. 92% of database time in the load test. D13 (crew games visible to the crew) makes
   it grow with a crew's whole history. Extends issue #1153 (measured at 558 rows).
2. **"Has this game started?" reads every score row** (`game_started` view): 78% of a cold board.
3. **One scoring reset sends 307 broadcasts** (one per row) and each is delivered per watcher: about 6,140
   messages in under a second for 20 watchers, against Pro's 500/s. Backstop polls recover the loss.
4. **Every watcher recomputes the standings on every score** (18.4 reads each).
5. **Home from today's queries:** about 230 reads per open for someone in 5 crews.

**What the foundation must do (fix list items 1–8, all Phase 1):** decide visibility **once per game,
never per score row**, from the member's own membership rows by index, never by scanning `games`; keep
read rules separate from write rules; one "can I see this game" answer for every game-scoped table;
store "started" on the game; **one broadcast per game per statement**, payload a signal, backstop polls
kept; store standings on write; build the per-user home-items index with a `user_events:{userId}` topic;
crew-aware membership helpers; the event queue for pushes and email; paged, state-filtered crew game lists.

**Later phases:** one broadcast topic per live game (Phase 2) with cheaper backstop polls and the load
test as the phase gate; Home reads the index and joins one topic (Phase 4); the board reads stored
standings (Phase 5); one broadcast topic per trip (Phase 6). The six remaining `postgres_changes`
subscriptions move to broadcast as their screens are rebuilt.

**Unknown:** the Pro spend-cap setting (500 vs 2,500 messages/s, 500 vs 10,000 connections), compute size
and PostgREST pool. None changes the fix list.

## 3. Games, competitions and trips — how people tell them apart

Three things you can start from **+**, each one sentence, in this order:

- **Game** — "Keep score of a game (or a best-of series)." The default, the biggest button.
- **Competition** — "Any mix of games, teams if you want them, standings, and an awards
  ceremony at the end." (D24.) Built from stages (D25): standings, head to head, a bracket, a
  series; seasons with playoffs come later as their own milestone.
- **Trip** — "Going somewhere together: dates, a place to stay, the plan." A trip can include
  a competition.

A competition **doesn't need a trip** (D11). In the new schema a competition belongs to a crew and may belong to a trip; a trip holds at most one competition (today's `competitions_one_per_trip`, Zach's ruling 2026-09-22, kept). Today's v1 can't do this (`competitions.trip_id` is NOT NULL since migration 033, and the board loads everything by trip), which is one of the reasons for the rebuild. The board's screens are carried over; what's new is its shell for a crew competition: the crew's band and ‹ back to the crew instead of the trip header (Prototype row 7). It shows on the crew page and on Home like anything else. Inside a trip, "Add a competition" creates the trip's one competition.

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
  a name, or a link by text); a member suggests someone (an admin approves at the top of People; ~~or a Helper~~, Helper retired by D21);
  edit a signed-in member (name in this crew + role only); remove someone who's on a trip
  (remove from crew and trip, or only off the trip). Decided 2026-11-08: Helpers can add
  people and approve suggestions; only the admin removes people. **Revised by D21 (16 Nov): no Helper; admins add and remove, members suggest.** Anyone can leave a crew (the
  admin makes someone else admin first). An invite link joins directly and expires after 24 hours.
- **d [Drawn 2026-11-14 → row 7; decided → D16]** Leave, admins, archive, delete. Modelled on Microsoft Teams.
- **e [Decided → D2; retired by D21]** ~~The second role is **Helper**.~~ Crew roles are Admin and Member; organizer is per trip, competition and game.

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
- **X6 [Measured → section 2]** Scale audit done (PR #1708); its Phase 1 items go into `CREWS_FOUNDATION.md`.
- **X8 [Drawn 2026-11-16 → row 8]** Golf course library: You → Golf courses (played, nearby, + Add a course); search the library first, then the online lookup with today's count (`courses.apiUsage`); a course page (tees, rating and slope, par and index, rounds played there). Builder is today's `/courses/new` (`CourseEntryFlow`), opened from the library and returning to it. **Entry points:** the You row only once you've played a round or added a course; + → Golf has "Golf courses ›" under the formats; a course name is a link wherever it shows. **New in code:** editing a saved course (no update procedure or policy exists). **Decided (Zach, 16 Nov): anyone can edit a shared course.** Keep an edit history (who changed what, when) so a bad edit can be undone from the admin page; finished games are safe because a game snapshots its course once scores exist.
- **X9 [Scope approved 2026-11-16]** Admin page (desktop, app admins only; needs an app-admin flag, which doesn't exist; a flag on the user, set for Zach only for now): feature flags and a user lookup first (Phase 1–2, since the redesign ships behind a flag); then crews (restore a deleted crew, D16), courses (fix, merge duplicates), help and feedback inbox, and a health panel of counts and links out (Vercel errors, Supabase advisors, an uptime monitor, golf lookups used today, push failures).
- **X7 [Later]** Leagues, the TV board, judged events (FUTURE_PATTERNS.md).

---

## 6. Decisions log

| # | Decision | Status |
|---|---|---|
| D1 | UI name is **Crew** (code keeps `circles`) | ✓ Agreed |
| D2 | ~~Second role is **Helper**~~ Retired by D21 | ✓ Decided 2026-11-08, retired 2026-11-16 |
| D3 | Score a simple game with no account; sign up to save or to play with others | ✓ Agreed |
| D4 | Every trip belongs to a crew; inviting people to a trip puts them in one crew (existing or new); explain it simply | ✓ Agreed |
| D5 | Activity tab | ✓ Replaced by **Events** (competitions, trips, leagues across crews). Tab bar: Home · Crews · + · Events · You |
| D6 | Leave trip mode with **‹ Home** in the title bar | ✓ Agreed |
| D7 | Series chip on Who's playing + Run it back | ✓ Agreed |
| D8 | Retire Quick Game once the no-account sheet ships | ✓ Agreed (it's the same idea, done properly) |
| D9 | Desktop | ✓ Placement approved 2026-11-14 (left rail, two-column Home, crew page, focus-mode sheet, finished game, trip control room, Show on TV). **Caution for the specs:** the trip's Today page is the one genuinely new desktop surface (itinerary + cup board + live games merged); its spec starts from an inventory of the detail today's ItineraryView, CompetitionFace and live game cards carry, so none of it is lost |
| D10 | "Cancel game" / "Cancel series", never "abandon" | ✓ Agreed |
| D11 | Competitions can stand alone in a crew; + offers Game · Competition · Trip | ✓ Agreed 2026-11-14 |
| D12 | Roles are **Member · Helper · Admin** (not Owner). ~~One admin per crew~~ **A crew can have several admins** (revised 2026-11-14, D16: Teams' answer to orphaned teams). Helpers add people and approve suggestions; only admins remove people, set roles, archive or delete the crew. UI words only: code can keep `owner_id` | ✓ Decided 2026-11-08, revised 2026-11-14 **Revised again by D21 (16 Nov): Helper retired; crew roles are Admin and Member.** |
| D13 | A game in a crew shows to the whole crew by default, with no line saying so. A "Hide from the rest of the crew" switch on the finished game keeps it to the players' own histories (replaces "players see it; sharing widens it"). No Share button on games | ✓ Decided 2026-11-11 |
| D14 | **Open crews** (a crew of people you don't all know, e.g. a 200-person pool) are Later. Phase 1's data model leaves room for them (see Phase 1 guardrails). Crews today are "people we know" | ✓ Agreed 2026-11-14 |
| D15 | **Trip mode** = the trip's `now` status, which already exists (`trip_status()` / `getEffectiveStatus`, migration 020): on for everyone from 3 days before the start date, off 3 days after the end. While on, opening the app lands every trip member on the trip (incl. right after sign-up from the invite); ‹ Home lasts until the next open. **New:** the admin can start it early or end it early (two optional timestamps on the trip, not a stage column; 020 removed a manual stage and dates stay the default). A panel on the trip Home says what it is, why it waits, why start early. Receipts and money stay editable until end + 14 days rounded to Sunday (`isReadOnly`, as today), so trip mode can end at +3 | ✓ Decided 2026-11-14 |
| D16 | **Crew lifecycle, modelled on Microsoft Teams.** Several admins allowed; only the last admin can't leave ("You're its only admin. Make someone else admin first."). Leaving or being removed takes the crew's games out of that person's own history; their scores stay in the crew's games; the confirm says so ("Its games leave your history."). Leaving a crew leaves its upcoming trips. **Archive** is the normal end: moves to Archived for everyone, nothing deleted, any admin can bring it back. Where: the Crews tab ends with "Archived · N" (only when there are any) → the list → the crew page read only (grey look, "Archived Nov 14" banner, no Start buttons, no Who's playing); admins get **Bring it back** and **Delete crew** there, members can open it and leave. Archived games stay in everyone's Your games and record; Home's Recent skips them. **Delete** wipes its games, cups, trips and receipts for everyone; it's soft-deleted for 30 days and restored only by contacting us (the admin tool restores it), then gone. Needs: a Contact us page (You → Help), and restore-a-deleted-crew in the admin tool. Members see names only, never emails | ✓ Decided 2026-11-14 **Revised by D27 (17 Nov): one "End this crew…" entry; delete is restorable by the admin for 30 days, no Contact us.** |
| D17 | **Brand: Put Me Down For (PMDF)**, "Same crew. Every game. Anywhere." Logo Route A (the Pen line as the last character, `PMDF ___`). Palette Ink / Paper / Pen with Pen on Paper; Live red with dot and word; gold only means won; Lime replaces cyan. Rulings 2026-11-16: palette and the Paper/Ink neutrals adopted now; Archivo and score tiles on the score surfaces Phase 2 builds; ten drawn game glyphs adopted (one per game type, on a tinted tile; `claude/GAME_GLYPHS.md`), lucide for everything else, crests left out; light-as-default not ruled. Everything in `docs/design/BRAND.md`. **Open:** float and chrome surfaces, status colors, logo files, domains (Zach buys), trademark | ✓ Decided 2026-11-16 |
| D18 | **Your move pushes only when someone is waiting on you or a deadline is close;** everything else waits on Home. One push per item, at most one reminder. Yes: invited to a crew/trip/game (invites; replaces the email when they have the app, never both) · make your picks, one reminder ~3h before lock if unpicked (game results) · vote on dates or ideas, when the poll opens + one reminder a day before close if unvoted (planning) · approve a suggested person (organizer) · results needed on a game you run (organizer, already wired) · trip mode starting, early or by date (planning) · settle up, once when the trip becomes its recap, only if you owe or are owed (planning) · made an admin or an organizer (invites; Helper retired by D21). No: "make a crew?" suggestions · Start game N of a series · removed from a crew or a crew archived. The `chat` category retires with chat (News replaces it); settings show five: Games & cups, News, Trips, Invites, Running things | ✓ Decided 2026-11-16 |
| D19 | **Rebuild the database, keep the repo and the engine.** Cut a frozen `v1` branch from `main` before the first rebuild PR merges; the existing Vercel project serves bbmi.app from `v1` against today's Supabase, untouched (a real BBMI bug is the only change that may land on `v1`). A second Vercel project serves `main` on the new domain against the new Supabase project, so nothing built on `main` can reach v1's data. A new Supabase project for PMDF with a designed schema (one clean baseline; the 228 old migrations archived); `main` becomes the new app. Carry over the pure scoring and competition engine and the persistence-agnostic game screens with their tests; rewrite the data-access layer. Production data (13 trips, 27 accounts, 97 guests, 71 games, 1,481 score rows on 16 Nov) moves by one rehearsed script, checked by recomputing every result against v1. Launch on putmedownfor.com. **Cutover:** a quiet week with no trip or game in progress; run the move script, check BBMI and Clemson in the new app, send everyone the new link to re-add the app; bbmi.app stays up a few weeks with a banner pointing to the new app (the one v1 change), then is turned off. **No redirect** from bbmi.app (Zach, 16 Nov: people re-add the app). Login accounts move between the two Supabase projects as part of the script (spec item); everyone signs in again. The schema is designed or reviewed on Fable | ✓ Approved 2026-11-16 |
| D20 | **UUID primary and foreign keys** in the new schema (today every id is `text`; 96 guest ids are `ghost-<uuid>`). People link to `auth.users`. ~~Deleting an account cascades~~ **Corrected 16 Nov** (it contradicted D16): deleting an account removes the login and its link; the crew person stays, by name, with their scores in the crew's games, as today (migration 132) | ✓ Approved 2026-11-16 |
| D21 | **Who organizes (decided, Zach, 16 Nov).** Crew roles are **Admin** and **Member**; **Helper is retired** (revises D2, D12). **Organizer is one word at every level**, scoped to one thing: a trip's organizers are whoever started it plus co-organizers they add from the people going; a competition has its organizers; a game's organizers are today's delegates (`games.addOrganizer` already uses the word), so the glossary's `delegate` becomes organizer in the new schema. **Anyone in a crew can start a trip** and organizes it (Zach: people shouldn't feel they can't plan a gathering of a subset of friends); admins can do anything in the crew, any trip included. A trip organizer, after the redesign, is whoever decides (closes the date and idea votes, confirms bookings, approves agenda suggestions), announces (News) and manages who's going and the trip's details, for that trip. Games and competitions leave trip roles (they have their own organizers). Today's 54 Organizer and 5 Owner trip procedures were mapped to get here. Members suggest, vote, add expenses and score. **Someone new on a trip** (Zach, 16 Nov): an organizer who is an admin adds or invites them straight away (crew and trip); an organizer who is a member suggests them, using the People suggestion flow already drawn (an admin approves at the top of People, pushed as a Your move item per D18); the person shows on the trip as Pending meanwhile, joins crew and trip on approval, and drops off if declined | ✓ Decided 2026-11-16 |
| D22 | **Placeholders belong to one crew.** No linking across crews. An admin can merge a placeholder into a person already in the crew (today's link refuses an account already on the trip, so this is new) and two placeholders into one; signing up with the placeholder's email still links automatically. Deleting a crew deletes its placeholders (today deleting a trip leaves its guests behind: the cause of the 65 loose guests) | ✓ Decided 2026-11-16 |
| D23 | **What the move carries** (data-move audit, PR #1710). BBMI 2023–2026 → one crew (Zach and Brad admins); Clemson Fall Golf Trip → its own crew (JD admin). Everything else is test data and stays in v1 only, Test Apparatus included. The three BBMI "Frank" placeholders become one; no placeholder is linked to an account (Bob ≠ Bobby Steiner, Billy ≠ Bill Giesler). Teams stay per cup (new every year). Chat is not moved. Dropped: the 65 guests on no trip and one never-confirmed signup with no account | ✓ Decided 2026-11-16 |
| D24 | **+ → Competition is its own choice, with a one-line explainer of what it unlocks** (Zach, 16 Nov). A competition is a collection of games, with teams or without; Cup (head to head) and Tournament (points) are kinds of competition, chosen inside it. The menu word is the existing `COMPETITION_UMBRELLA`, so no glossary change. Inside, reuse today's "What are you playing?" picker (`startingPoints.ts`); its "Just keep score" tile is redundant beside + → Game. **What a competition unlocks** (Zach, 16 Nov): **teams, if you want them; any combination of game types; standings built from awarded points; an awards ceremony at the end.** Live scoring, handicaps, side bets and best-of series are not differentiators: a plain game has them too. Draft explainer for the + menu: *"Any mix of games, teams if you want them, standings, and an awards ceremony at the end."* Some formats are competition-only today because the work wasn't done, not by nature (pick'em and brackets as standalone games); the Phase 5 spec decides which stay that way | ✓ Decided 2026-11-16 |
| D25 | **A choose-your-own-adventure competition builder** (Zach, 16 Nov: "we can support any kind of combination, we just need to make it clear"). Model (Claude's proposal): **who plays** (individuals or teams) + **one or more stages in order** (Standings: games add points, a weekend or a season; Head to head: two teams to a number; Bracket: knockout; Series: best of N) + **advancing** (a stage takes its field from the one before, e.g. top 4) + **what you win** (champion, podium, optional prize name that carries year to year with a defending champion). Standings, Head to head and Bracket exist today; Series comes from Phase 2; advancing is new (the composable-competitions plan left leagues and seasons out). Onboarding: presets first (today's picker), each tile drawing its shape (`Standings → Bracket`); Build your own asks the three questions in plain words. **Phase 1 guardrail:** competitions have ordered stages in the schema from day one. **Decided (Zach, 16 Nov):** (1) **Cup and Tournament stop being type words**, reversing the 2026-10-12 ruling: they were coined to tell match play from points, and the builder makes that a setup step instead. **Two teams (Zach, 16 Nov, after walking through it): setup asks, it doesn't force.** Forcing two teams into head to head was too limiting (it stops individual places scoring for the team, games with more than two finishers, scramble groups ranked by score, points both teams can earn, and a team count that changes). The aim was easy setup for people who don't know match play, met three ways instead: presets decide it for most people (Team cup weekend is head to head); Build your own asks only when there are exactly two teams, with head to head preselected (every real two-team competition so far used it) and each option described by what happens ("Each game, one team wins it, or a tie splits it" / "Each game ranks everyone, and points go by place"); and every game shows its points as a sentence ("Winner gets 4; a tie splits 2–2"). Three or more teams, or individuals, are standings; each game awards by place or as a match between two sides (today's per-game `competition_format`; PR 5). Stage words describe the structure; "Cup" is free for the competition's own name and prize. Display words and the stored value change together (the database speaks the code's language). (2) **Advancing waits** until after launch, released as its own milestone (full seasons, end to end) | ✓ Decided 2026-11-16 |
| D26 | **Live updates may carry data on private channels** (Zach, 16 Nov), relaxing CLAUDE.md rule #20 (signal-only broadcasts, because today's topics are public). On a private, members-only, listen-only channel, the database sends the change itself (the new score, the new standings) once, and every phone applies it with no follow-up request. Conditions: private channels only; a payload carries only what every listener may already read; the person entering scores still wins over an incoming update (rule #15); catching up is a single fetch of the current state when the app wakes or the connection reconnects; a slow backstop poll runs only while the screen is open, in case the connection dies silently (#1522), and goes if a test shows a dead connection is always detected. Designed in the Phase 1 schema with the scale audit's broadcast fixes. Public signal-only topics keep rule #20 as it is | ✓ Decided 2026-11-16 |
| D27 | **Prototype rulings from Zach's comments, 17 Nov.** (1) **+ explains itself:** Game · Competition · Trip are tiles with a line each (Score one game, or a best-of / Many games, one winner / Plan it, then play it there) and an icon; Trip's icon carries the competition's trophy; Competition and Trip open with what they unlock; the header says Start. (2) **Starting a trip:** + → Trip picks the crew and names the trip (crew and year by default) → "Do you know where you're going?" (I know where → setup guide; Help us decide → ideas) → the ideas screen opens with **Who helps decide** (helpers matter there; their use ends once the crew is being added). (3) **One suggest / vote / comment / pick piece** for places, agenda slots and dates (the agenda slot's pattern). (4) **Dates:** the organizer chooses who votes, the people helping decide (default: too many voters make consensus hard) or everyone coming; the organizer makes the call either way. (5) **Who's coming** on the trip's Crew tab: Helping decide (highlighted), Coming on the app (Invited / Added · not invited yet), Coming not on the app yet, then the rest of the crew with + Add; **people added are a draft and can't see the trip until invited**; the bottom button invites them all; tapping anyone opens their sheet, which carries the trip (invite state, helping decide, team, take off the trip). (6) **An email on a name-only person:** admin-only (it decides whose account inherits the spot); the checkbox appears with a valid email and sends on Save; the admin sees the same words whether or not the email has an account (no account lookup through the form); an existing user gets a Your move request to join and accepts before the games become theirs; a match inside the crew offers a merge (D22). "He won't use the app" silences the add-email reminder. (7) **Ending a crew** (revises D16): one "End this crew…" sheet: Keep its history (archive, bring back anytime) or Delete it (restorable by the admin from Archived for 30 days; "Delete everything now" for immediate) | ✓ Decided 2026-11-17 |
| D28 | **Rulings from Zach, 18 Nov.** (1) **A trip stays off the crew page for anyone not invited until it is over;** once it is in the rear-view mirror it appears in the crew's history. (2) **"Ask who's in" is Later**, under the working name *open invitation trips*. (3) **Chat is retired;** organizers text each other for live talk. Comments on a destination idea stay with the idea and keep growing while the trip is choosing where; **comments expire once the thing they are about is confirmed**: the destination set, the dates set, an agenda slot picked. News is not a conversation tool. (4) **Claiming a spot takes effect at once, with no guard in the join flow.** The link in Dave's email is addressed to Dave, so a wrong claim needs someone else to have his email, or someone in a group text tapping the wrong name on the crew link: rare. The fix for that case is on the **admin page** (X9): move a person's history (every game, competition and trip) to another account. Nothing extra in joining. (5) **New comments:** the people following an item (who suggested it, everyone who commented, the trip's organizers) see a dot and a count on it and a line on the trip in Going on; no push by default, a "Replies to you" switch in settings. No @-mentions (there are no handles). (6) **Who can enter things for others is a per-competition / per-trip setting, Locked by default** (your own group, plus organizers and admins, as today). Open is described plainly: "Anyone can enter scores for anyone, not just their own group." **One setting covers scores, receipts and logistics** (travel details for someone not on the app included): Locked, organizers and admins enter logistics for others; Open, anyone in it can. (7) **The + Start page in the PMDF look is approved** ("PUT ME DOWN FOR ___", the three tabs with pictures, What you get, the crew row on every tab); regulars see it too for now. The crew row folds open and offers Decide later; **there is no crewless competition or trip**, so Decide later forms a crew from the people added. On scroll the line shrinks to `PMDF ___` in the title bar. (8) **There is no separate invite mechanism:** the first "Email the crew" email to someone is their invite (today's `email_count`), each link carries the person's own token, and every Invite / Resend button opens that one composer. For someone on the app the invite is a push (D18). The crew's People page and the trip's Crew tab are built from the same parts: faces say on the app or not; In is a grid; Not in yet is one list, ordered invited · not invited on the app · not on the app with email · without, each row with its own button; Rest of the crew is ordered by trips taken, "4 trips · Last: BBMI 2024 (Mar 2024)", the date dropping when it won't fit. | ✓ Decided 2026-11-18 |

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
- **v1 keeps running untouched on bbmi.app** (D19): a frozen `v1` branch, today's Supabase. `main`
  is the new app on its own Vercel and Supabase projects, seen only by Zach until the cutover, so
  nothing needs a feature flag.
- **Carry over, don't rebuild, what works:** the scoring engine and the persistence-agnostic game
  screens (rule #7) move with their tests; the data access under them is rewritten for the new
  schema. A bug that lives in carried code comes with it (#1699) and is fixed in the phase that
  carries it.
- **Design one phase ahead of the build.**
- **Reuse before new:** each spec's Phase 0 audits StandardGrid, GolfCard, Sheet,
  ReorderableList, NeedsAttentionCard, CupTrophy/ribbons, ghost crew, invites, News,
  Quick Game.
- **The database speaks the code's language** (Zach, 2026-11-16). Every stored value, column and table uses the same word the code and the screen use; no enum that maps to a differently named key. With no active users, the redesign is the time to do these renames, and we come out of it with a codebase and schema that follow good practice throughout. (This overrides the old habit of keeping a stored value and renaming only the display, e.g. `cancelled` / "Canceled", `Organizer` / "Helper".)
- **A performance bottleneck is a discussion, not a reflex** (Zach, 2026-11-16). When a spec or an audit hits one, Claude Code stops and reports it with the options: the design change (query, trigger, model) and what more capacity would buy. We pick the fix together. More capacity is a legitimate option when it is the right one, never the default answer that skips looking at the design. Production is on Supabase **Pro** (org `bbmi`, checked 2026-11-16): Realtime 500 messages/s.
- **Performance is a requirement in every spec:** what's computed on write, what's pushed,
  what each screen costs per open; load-tested where it matters.
- House spec rules hold: Phase 0 report-and-STOP, DO NOT lists, a commit per task, STOPs
  for on-device looks; Zach runs production migrations.
- **The board is the status of record.** Every item lives on the [PMDF Rebuild Board](https://claude.ai/artifact/5ERP9VQXyezWxqkeW4yyKU); work found mid-phase (an audit, a look, a STOP, an issue) is added there the same day with where it came from, so growth shows. Folded GitHub issues are named on the item that owns them, and its spec reads them.

### Which model when
Opus 5.5 is the default. Switch only where the work changes shape:

| Work | Model | Why |
|---|---|---|
| Design sessions, reviewing boards, writing specs, ruling on copy | **Opus 5.5** | Judgment over a lot of context; the default |
| The data model and RLS for Phase 1 (`CREWS_FOUNDATION.md`), the live-update design (D26), the move script (D23) | **Fable** | The few problems where a wrong call is expensive and hard to undo. One deep pass, then back to Opus |
| An independent check of high-stakes work (the schema, an RLS change, the move, a finished spec) by a model that didn't write it | **Fable** | A fresh reviewer that isn't grading its own work |
| Claude Code carrying out a reviewed spec task by task; refreshing audits; copy renames (Owner → Admin); tests; doc mirroring | **Sonnet 5.5** | The thinking is already in the spec; this is careful execution, faster and cheaper |
| Claude Code's Phase 0 report-and-STOP on a new spec | **Opus 5.5** | It decides what the spec got wrong about the code |

Each spec names its model at the top, and a STOP that turns up a design question goes back to
Opus before work continues.

### Phases

**Phase 0 — Design and decisions.** Done: J1–J10, desktop comps (D9), trip mode (D15), crew
lifecycle (D16), course library (X8), admin scope (X9), pushes (D18), brand (D17), glyphs, and
decisions D19–D26. Left:
- **Redraw for 16 Nov's decisions:** drop Helper from role choices (D21); + → Competition with its
  explainer, reusing today's picker (D24, D25); Pending people on a trip (D21).
- **Check the crew add / invite / plan-a-trip workflow end to end** (Zach, 16 Nov: "some holes
  there… or the first part of trip planning is weak and is missing a lot of what we've already
  built"). Walk it against today's trip planning (ideas and votes, the date poll, the setup guide,
  lodging, invites and the invite blast) and redraw what's missing before `TRIPS_IN_CREWS.md`.
- **The look pass:** once the grey boards are approved, redraw the key screens in the PMDF look
  (Home, the score sheet, the finished game, a crew page, the competition board, desktop Home) so
  every spec has a visual reference.
- **`BRAND_TOKENS.md`** for Claude Code: the token split, the neutrals, the eight team colors and
  the cyan mapping, Archivo with its fallback, the score tile, the game glyph map (an exhaustive
  `Record` by game type id, dice as the fallback), the tinted tile and the stage table (grey until
  scoring is on; teal is not a status). Lands before Phase 2, the first phase that builds screens.
- **The rules update:** CLAUDE.md and STYLE_GUIDE in one docs commit, the first step of the
  foundation spec. Includes the glossary (Cup and Tournament retire as type words, D25; Helper
  retired and delegate becomes organizer, D21), rule #20 relaxed for private channels (D26),
  system fonts (Archivo), game icons (glyphs), trip-only hooks and rule #29 (a game's container is
  a crew), and retiring the chat rules and the chat-action E2E spec.

**Phase 0.5 — Audits (done).** Read-only, each a report PR, all merged 16 Nov: `SCALE_AUDIT.md`
(#1708: today's hot paths, a load test, the 15-item fix list), `DATA_MOVE_AUDIT.md` (#1710: what
moves and how; D22, D23), `REACHABILITY_AUDIT.md` (#1711: what's reachable, what's orphaned).
The open-issue list was triaged the same day: 16 kept open, 67 folded into board items and closed, 27 closed as obsolete or already fixed.

**Phase 1 — Foundation.** Spec: `CREWS_FOUNDATION.md` (Opus writes; Fable designs the schema
and RLS, then a fresh Fable reviews).
- **Freeze v1:** cut the `v1` branch from `main` before the first rebuild PR merges; the bbmi.app
  Vercel project serves `v1`; a new Supabase project and a new Vercel project serve `main` (D19).
- **One clean baseline migration** for the new schema, with UUID keys (D20) and every table's
  grants stated; the 228 old migrations are archived, not replayed.
- **The model:** crews, members and roles (Admin, Member; organizers per trip, competition and
  game, D21); people and placeholders keyed to a crew (D22; merging a placeholder into a member;
  deleting an account keeps the crew person and their scores); competitions with ordered stages
  (D25) belonging to a crew and optionally a trip; games belonging to a crew, a competition or
  neither; the visibility rule (D13).
- **The scale groundwork, designed in rather than added later** (SCALE_AUDIT.md): visibility
  checked once per game; separate read and write rules; "started" stored on the game; one
  broadcast per game per statement; standings stored on write; a home-items index and a per-user
  live topic; crew-aware permission helpers; an event queue for pushes and follow-up work; paged
  lists; private channels that carry the change itself (D26). Load-tested before Phase 2.
- **Carry over** the scoring engine and the game screens with their tests; write the data access
  for people and crews; the app-admin flag (X9).
- **The move script, part 1:** crews, people, placeholders (D23), with the local-only
  possible-match list. Part 2 is in Phase 7.

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
- **Competitions have ordered stages** (D25): a competition holds one or more stages (standings, head to head, bracket, series), each game belongs to a stage, and a stage can take its field from the one before. Launch may offer one stage at a time; the schema must not.

**Phase 2 — The everyday game loop.** Spec: `GAME_LOOP.md`. + → Game → Who's playing → score sheet
→ game over → finished-game screen → Your games → add a past game to a crew. Works with no
account (local), "sign up to save" moves it to the account. Live updates on one private topic per live game (D26).
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

**Phase 3 — Crews.** Spec: `CREW_PAGES.md`. Crews tab, crew page, Edit crew (Lime replaces
cyan), people flows (admins add and remove, members suggest, D21; merging placeholders, D22),
crew invites (a link with expiry and uses), leave / archive / delete and the Archived list (D16),
and the Contact us page D16 needs.

**Phase 4 — Home, navigation and the desktop shell.** Spec: `HOME_AND_NAV.md`. Home by urgency,
the mini score sheet, the tab bar (D5), Events, the You page, the desktop shell, the golf course
library with editing and history (X8), the five push settings (D18), the admin page v1 (X9).

**Phase 5 — Competitions.** Spec: `COMPETITIONS_STANDALONE.md`. Today's cups and tournaments on
the new schema (teams, rosters, the board, brackets, pick'em, clinch, podium, re-credit); the
builder (D25: who plays, stages, what you win; presets first, each tile drawing its shape; two
teams ask head to head or points with head to head preselected); start one from + in a crew;
standings computed on write and pushed; the live card on Home; Series as a stage. Fixes the false
clinch that comes with the engine (#1699).

**Phase 6 — Trips inside crews.** Spec: `TRIPS_IN_CREWS.md` (may split), written after Phase 0's
trip-workflow check. Trips belong to crews (anyone can start one and organizes it; newcomers are
suggested and Pending until an admin approves, D21); planning on the new schema (ideas and votes,
the date poll, lodging, the agenda, quick info); receipts and splits; News (chat is not moved,
D23); trip mode in and out (D15, ‹ Home); team pages with results; the trip live card.

**Phase 7 — Launch and cutover.** Spec: `LAUNCH.md` (Fable reviews the move).
- **The rename to Put Me Down For:** app name, icons, the favicon from the P, the email sender,
  auth emails and reset pages in the new project. No bbmi.app redirect: people re-add the app.
- **The move script, part 2:** games, competitions, trips, money, lodging photos and login
  accounts (everyone signs in again); recompute every moved result and compare it with v1 (the
  BBMI replay, #419); rehearse the whole move end to end.
- **Cutover:** a quiet week with no trip or game in progress; run the move; check BBMI and
  Clemson in the new app; send everyone the new link to re-add the app; a banner on bbmi.app
  points to the new app (the one v1 change) for a few weeks, then v1 is turned off.
- Zach: buy the domains; a trademark search.

**Later (after launch).** Joined stages: a season, then playoffs, released as its own milestone
(D25); start from a previous trip or cup (Zach, 16 Nov: "reuse parts of a previous trip? Same
crew? Are the teams the same too?"); moving games between crews; leagues; open crews and pools
(D14); the TV board; join with a code; judged events; crew photos (J7); Google profile photos;
pins in the desktop rail (see below); the past-trip recap (see below); the one-tab Itinerary
(ITINERARY_REDESIGN.md); the feature ideas kept as GitHub issues.

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

### Already built: carry it over, never re-spec it (checked against main @ bbc3bcc)
Prototype boards titled **Exists ·** stand in for these. Specs reference the component and say
only what changes around it. Under the rebuild (D19) the screens move as they are; the data
access under them is rewritten for the new schema, so a spec names the component and the new
procedure it reads from.

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
joins the crew, ‹ Home); team pages with results; the scale work; the move. Renames happen at every layer at once in the new schema (the database speaks the code's language): Owner → Admin, Helper never exists, delegate → organizer, Circle → Crew, Cup and Tournament as types → stages (D21, D25).

### Spec list
1. ~~`SCALE_AUDIT.md`~~, ~~`DATA_MOVE_AUDIT.md`~~, ~~`REACHABILITY_AUDIT.md`~~ — Phase 0.5, merged
2. `CREWS_FOUNDATION.md` — Phase 1 (Fable designs the schema and RLS)
3. `GAME_LOOP.md` — Phase 2 (may split: start · sheet & game over · Your games & sign-up)
4. `CREW_PAGES.md` — Phase 3
5. `HOME_AND_NAV.md` — Phase 4 (incl. desktop shell, course library, pushes, admin page)
6. `COMPETITIONS_STANDALONE.md` — Phase 5
7. `TRIPS_IN_CREWS.md` — Phase 6 (may split)
8. `LAUNCH.md` — Phase 7 (the rename, the move, the cutover)
