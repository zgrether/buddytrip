# Trip week runbook

For reading on a phone, on a course, with no laptop.
Written from measurement against prod, 2026-09-03 — see `TRIP_WEEK_PHASE0.md`.

---

## First 30 seconds

**Ask one question: is it happening to everybody, or just to you?**

- **Everybody, all at once** → it is the platform, and it is most likely auth.
  Read the next section. Wait it out; do not sign anyone out.
- **Just you** → it is your phone, your signal, or your session. Reload once.
- **Just one game** → it is data, not infrastructure. Skip to *"The leaderboard
  is wrong"*.

**The one rule that covers every case below:**

> Scores that have been typed are not lost, even when the app says they failed.
> They are saved on the phone that typed them and re-send when that phone
> reopens that game. **So never hand the round to a different device to "fix"
> it, and never clear the browser.**

---

## "Nobody can sign in" / "it logged me out"

**The most likely thing to go wrong, and the one to be slowest about.**

**Recognise it:** someone is bounced to the login screen mid-round, or a sign-in
hangs and then fails. Often more than one person within a few minutes.

**What it is:** Supabase's auth server intermittently stalls. Measured Sep 2:
five token refreshes took over 25 seconds, one took **146 seconds**, and every
one eventually succeeded. Same fault caused 25-second dead pages on Aug 27 and
5-minute hangs on Aug 29. It is on their side. It clears on its own.

**Do:**
1. **Wait two minutes before doing anything.** Most of these resolve without
   intervention.
2. Then reload the page once.
3. If still stuck, sign in again normally. It will usually work on the second
   attempt.
4. Keep scoring on any phone that is still signed in. One person can enter for
   a whole group.

**Don't:**
- **Don't sign everybody out and back in.** Signing out consumes the session,
  and if the auth server is the thing stalling, you have turned one stuck phone
  into sixteen. **This is the single worst move available this week.**
- Don't delete the app or clear data to "fix the login" — see the rule at the
  top; that is where unsaved scores live.
- Don't change anything in the Supabase dashboard.

**Afterwards:** Supabase → Logs → Auth, and Edge filtered to
`/auth/v1/token`. Look for `origin_time` over 25,000 ms, or status 400 with
`refresh_token_already_used`.

---

## "The app is slow"

**Recognise it:** everything is sluggish for everyone at once — the board, the
scorecard, opening a game. Nothing errors. It just takes 5–8 seconds.

**What it is:** measured on Sep 2, a 30-second window where every request in
flight took 5–7.7 seconds and then it stopped. All of them succeeded. It is not
your round, not the number of people, and not anything anyone did.

**Do:** nothing. Wait a minute. Keep entering scores — they queue and save.

**Don't:**
- Don't reload repeatedly. Each reload re-fetches everything and adds load.
- Don't close the game to "reset" it.

**Afterwards:** Supabase → Logs → Edge, sort by `origin_time`. If a cluster of
requests sat between 5 s and 8 s and all returned 200, it was this.

---

## "Scores won't save"

**Recognise it:** a score cell turns red / flags an error, or a Save spins.

**What it is:** the write failed, or its answer got lost. **The score is still
on the phone.**

**Do:**
1. Keep going. Enter the rest of the hole.
2. If a cell stays red, tap it to retry.
3. If the whole app is unresponsive, force-close and reopen **on the same
   phone**, go back into **the same game**. You should see
   *"Recovered N unsaved scores — retrying"*.
4. Only when that has been seen and cleared, move on.

**Don't:**
- **Don't finish or advance past a red cell** — the app already blocks this;
  do not go looking for a way around it.
- **Don't re-enter the round on someone else's phone.** The unsaved scores live
  on the phone that typed them and nowhere else.
- **Don't clear site data, don't use a private/incognito tab, don't uninstall.**
  Any of those destroys the queue.
- Don't reset scores in the Danger zone to "start clean". That is the one
  action here that genuinely loses data.

**Known gap:** if a score is refused for a *reason* (not a network failure), the
app retries it forever instead of saying why — issue #1230. Symptom: a cell that
never goes green and never gives a message. Write that hole on paper and move on.

**Afterwards:** Supabase → Logs → Edge, filter path `/rest/v1/score_entries`,
method `POST`. Anything other than 200 is a real refusal.

---

## "The leaderboard is wrong"

**Recognise it:** standings disagree with what people know happened, or a game
that is being played still reads "Ready".

**What it is:** almost always a display lag, not bad data. The board updates by
push, with a 5-minute backstop.

**Do:**
1. Pull to refresh / reload once. Wait 30 seconds.
2. If one game reads "Ready" while it is clearly underway, that is a known
   cosmetic half-state (the status flag failed to flip; the scores are fine).
   Ignore it, or flip it from the game's settings.
3. If the numbers are genuinely wrong rather than stale, **do not try to correct
   them by re-entering scores.** Note which game and which hole. Fix it after
   the round.

**Don't:**
- Don't finalize a game to "make it update".
- Don't delete and recreate a game to fix a number.
- **Don't have two people in one game's settings at once.** If both save, the
  second one is told *"This game changed on another device — reload before
  saving"* and **their edits are discarded**. One person edits settings at a
  time.

---

## "The app won't load at all"

**Recognise it:** blank screen, or a spinner that never resolves, on more than
one phone.

**What it is:** with no client-side timeout, a hung request spins for up to five
minutes rather than failing. That is what a total stall looks like from a phone.

**Do:**
1. Give it 60 seconds, then force-close and reopen.
2. Check one other phone. If that one works, it was yours.
3. If nothing works for anyone for more than ~5 minutes, treat the app as down
   for the round and go to the fallback below. Do not spend the round debugging.

**Don't:**
- Don't redeploy. Don't run a migration. Don't change Supabase or Vercel
  settings from a phone. Nothing measured this week is fixed by any of those,
  and all of them can make it worse in ways nobody on a course can undo.

**Afterwards:** Vercel → the project → Logs, and Observability → Errors. A real
outage shows 5xx; the stalls measured this week show 200s that took too long.

---

## Fallbacks — decided in advance

**Use these without asking. They are the plan, not a defeat.**

- **Rained-out or shortened round** → finalize on holes played. The game does
  not need all 18.
- **Match play breaks mid-round and cannot be recovered** → delete the affected
  games and award the points through a generic **non-golf simple game**. It
  takes the points directly; it does not need hole-by-hole anything.
- **The app is unusable for a round** → **paper. Rob has the spreadsheet.**
  Enter it afterwards; nothing about entering a round late is harder than
  entering it live.

Choosing a fallback early is cheap. Choosing it at 4pm after two hours of
fighting the app is what costs the day.

---

## Where to look afterwards

| Question | Where |
|---|---|
| Was it auth? | Supabase → Logs → Auth; Edge path `/auth/v1/token` |
| Was it slow for everyone? | Supabase → Logs → Edge, sort by `origin_time` |
| Did a score actually fail? | Same, path `/rest/v1/score_entries`, method POST |
| Did the app itself error? | Vercel → Observability → Errors |
| Is the database in trouble? | Supabase → Reports → Database. It will not be — it is under 600 rows a table |

---

## What is *not* worth chasing

Measured this week and confirmed harmless — so nobody burns an evening on them:

- **`Warp server error: Thread killed by timeout manager`** in the Postgres/
  PostgREST logs. Appears 55–450 times *every hour*, including hours when
  nothing at all was wrong. It is idle-connection reaping. Ignore it.
- **A `500` on `save_game_config` reading `GLORIOUS_FROZEN`** (or any other
  ALL-CAPS code). That is a deliberate refusal with a real sentence after it —
  the app shows the sentence. The rule is working, not breaking.
- **404s in the Vercel log.** Credential scanners, 404'd at the edge on purpose.
