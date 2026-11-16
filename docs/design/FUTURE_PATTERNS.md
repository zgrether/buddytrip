# Future patterns — what the app should be able to grow into

*Captured 2026-11-07. Not a backlog item and not a spec. Concepts to design toward, so
today's choices don't close these doors. Origin: a family Thanksgiving blind wine tasting
(8 hidden bottles, 20–25 tasters, a paper sheet per person, a reveal at the end), but the
point is the patterns, not wine.*

## The repeatable patterns

1. **A sheet is items × people × what you record.** Rows are the things being played or
   judged (holes, rounds, games, wines, chilis, trivia questions). Columns are people (or
   teams). A cell holds whatever that kind of event records: a number, a choice, a few tags,
   a short note. Golf cards, Scrabble rounds and a tasting card are all the same shape.
2. **Who fills it in is a setting, not an assumption.** Three modes:
   - *One keeper* — one phone scores everyone (today's game sheet).
   - *Scoped* — you score your own unit (today's golf: your match or group).
   - *Self* — everyone fills their own card on their own phone (a tasting, trivia).
3. **The host paces it.** "Now pouring #3" / "Question 7" / "Hole 12": the host moves the
   event forward and everyone's screen follows. Same idea as the live agenda and a live
   cup.
4. **Hidden until revealed.** The host holds the truth (which wine, the right answers, the
   results of a pick) and reveals it at a moment they choose. The reveal is a ceremony
   (the winner's circle, ribbons and fireworks we already built), not just new data on a
   screen.
5. **Three kinds of result can come out of the same sheet:**
   - *Rank the people* — who won (every game today).
   - *Rank the items* — the group's favorite wine, best chili (average of everyone's ratings).
   - *Score against the truth* — best palate, most trivia right. Pick'em already works this way.
6. **Join in seconds.** A QR code or link at the table; type your name and you're in. No
   account needed for the night; an email later claims the spot (the name-only → claimed
   model we already have). This one also helps game-night guests and trip plus-ones.
7. **It happens every year.** The same event recurring in a crew ("Thanksgiving tasting
   2026, 2027…") is a history on the crew page, like BBMI's past trips.

## How it would be presented to people

- **Templates, not a builder.** People pick "Tasting", "Cook-off", "Trivia night",
  "Pick'em" from the same picker as Scrabble. Each template is just a preset of the
  patterns above. Nobody ever sees "items × criteria".
- **The host answers a few plain questions:** What's being judged? (add the items) · What
  does everyone note? (a preset list they can trim) · Is anything hidden until the end? ·
  What wins (a person, an item, or both)?
- **Guests see one card at a time,** big and simple, with the host's "now" marker on top.
- **The reveal is the moment the night builds to,** using the existing celebration pieces.

## Start from what the host wants to do

- The way in is the host's intent: **"Help me host a wine night."** The app turns that into
  the template and asks only what it needs; everything else has a sensible default.
- **Every layer is optional, and the night still works without it.** Assume some guests
  aren't tech savvy and some won't bother:
  - *Host's phone only* — the minimum. The host runs the pours and the reveal; guests use
    paper (the app can print cards with a QR in the corner).
  - *Some guests on phones* — they fill their own cards; the host can type in a paper
    card for anyone who'd rather not (keeper mode for just those people).
  - *A TV* — the room watches along (below).
  Nothing a guest does is required for the event to finish.

## The big screen

An original idea for live scoring, and it fits every event type: a **read-only board for a
TV**, so people watching from across the room (or the clubhouse) can follow along.

- **Join pattern, Jackbox-style:** the TV opens a short address and shows a 4-letter code;
  the host's phone pairs to it with that code. No login on the TV. The same code on the
  TV is how guests join from their phones, so "join in seconds" and "show it on the TV"
  are one feature.
- **Works on whatever is in the room:** a smart-TV browser at that address, Chromecast or
  AirPlay from the host's phone, or a laptop on HDMI.
- **What it shows, by event:**
  - *A cup* — the standings, the live game, the clinch watch; the winner's circle when it's decided.
  - *A game night* — the score sheet, big, with the leader highlighted.
  - *A tasting* — "Now pouring #3", how many cards are in, then the reveal, item by item.
- **Designed for distance:** huge type, dark, nothing to tap, changes on its own as the
  host moves the event forward.

## Guardrails for today's design (cheap, do now)

- Don't assume one phone scores for everyone.
- Don't assume every participant has an account.
- Keep score entry typed and pluggable per kind of sheet (numbers today; choices, tags and
  notes later), not hard-wired to numbers.
- Keep the reveal and celebration components generic, not cup-only.
- Keep "what wins" separate from "what's entered", so one sheet can rank people and items.
- Make every live view (standings, a sheet, the reveal) renderable read-only from one
  share code, with no sign-in, so a TV board is a new layout over existing data, not a
  new data path.
- Never make a guest's participation required for an event to finish; the host can
  always fill in or skip.

## Other events this covers

Bourbon or beer flights · chili or BBQ cook-off · pie or dessert contest · trivia night ·
an awards ballot (best shot of the trip) · pick'em.
