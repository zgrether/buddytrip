# PICKEM-SPEC.md

The pick'em format, as it is actually built.

> **This document was reconstructed from the code, not carried in from the
> original.** The spec that governed the build lived outside the repository, and
> the reason it is here now is the defaults divergence: it said a non-submitter
> is scored on defaults with "no partial sheets and no forfeits", and the code
> never did that — rows are written on Save and nowhere else, so a
> non-submitter has always scored zero. Nobody could see the two disagreeing
> because only one of them was in the repo.
>
> So the section numbering of the original is gone; nothing here preserves it.
> What is here is derived from the implementation, which under this project's
> own rule is the ground truth when the two conflict. **Where a claim below is
> load-bearing, it names the migration or module that enforces it** — so the
> next divergence is a diff rather than an argument.
>
> Keep this file in step with the code in the same PR that changes the code.

---

## 1. What the game is

A slate of real-world contests. Everybody predicts a winner in every game, and
optionally ranks their picks by confidence. Results land as the contests finish,
totals recompute, and the sheets are compared — either head to head, or as team
totals.

Nothing is stored as a running total. Every figure on every surface is derived
at read time from the picks and the current results (`src/lib/pickemScoring.ts`),
so entering, changing or clearing a result recomputes everything on the next
render and nothing migrates.

---

## 2. The clock

Three timestamps on `pickem_games`, and one derived phase
(`src/lib/pickemLifecycle.ts`).

| Column | Meaning |
|---|---|
| `picks_opened_at` | The slate has been published. Null = still building. |
| `picks_deadline` | Optional scheduled close. Null = the runner closes by hand. |
| `picks_locked_at` | The manual close — the only explicit transition. |

**Phase** is derived, never stored:

- **building** — never opened. Members see "Picks open soon" and cannot tell an
  empty slate from a finished one (enforced in RLS, not in the client).
- **picks open** — sheets are writable. Nobody can see another sheet, staff
  included.
- **locked** — sheets are frozen and revealed. Pairing becomes legal here.

At exactly the deadline instant picks are open and not yet revealed: `open` uses
`now <= deadline`, `revealed` uses `now > deadline`. The two are complements at
that instant, so there is no moment where a sheet is both editable and readable,
and none where it is neither.

**The same rules exist twice**, in TypeScript and in the SQL bodies of
`pickem_picks_open` / `pickem_picks_revealed` (migrations 146/147) that the RLS
policies call. SQL cannot import TypeScript, so the duplication is permanent —
`pickemLifecycleParity.rls.test.ts` drives both over the same table of clock
states and asserts they agree case by case. **Change a rule in one and you must
change the other in the same PR.**

### The controls

One panel, one action, in the runner's vocabulary: **Start picking** and
**Close picking**. There is no "Lock" control and no runner-facing copy uses the
word. Member-facing copy still says picks are *closed* — that is the state, not
the control.

- **Start picking** on a game whose deadline has already passed also clears that
  deadline. `set_pickem_phase('unlock')` clears `picks_locked_at` and nothing
  else (migrations 151, 156, 165), so without this the action would write a
  column and change nothing observable.
- **Start picking is not offered once anything is scored.** Migration 165
  refuses it: reopening picks on a game whose outcomes are partly known is not
  predicting, it is correcting. The panel says why, and names Reset scores.
- **The deadline block renders only while picks are open.** A deadline is a
  scheduled Close; in every other phase it is a control for an event that cannot
  happen.

---

## 3. The sheet

### Nobody has picks until they submit

**A fresh sheet has nothing selected.** Both teams render neutral on every row.

This is the correction this document exists for. The sheet used to open on the
home team in every game, on the reasoning that a sheet is always complete and
always valid — no partial state, no forfeit. The engine never worked that way:
picks are written by `save_pickem_picks` and nowhere else, so a person who never
pressed Save holds no `pickem_picks` rows and `sheetPoints` over an absent sheet
is 0.

**Two shortcuts put the old default one tap away.** `All home` and `All away`
fill every row; `All home` then Save reproduces the old default sheet exactly,
ranking included. The difference is that somebody chose it.

The shortcuts set **picks only**. The ranking keeps its slate-order default,
which is what makes that equivalence exact — and re-ordering somebody's list as
a side effect would be a second decision they did not ask for.

### Consequences, stated deliberately

- **A non-submitter forfeits.** Their opponent has zero upside against them from
  the first result, and the match card says so immediately. This was always
  true; it is now visible rather than discovered.
- It raises the stakes on chasing people. That is the captain's job and what
  proxy entry exists for — worth saying in trip prep rather than on Saturday.
- **A guest can never submit their own sheet.** They have no `auth.uid()`, so
  `pickem_picks_write` can never match them. Without a proxy they score nothing.

### What a sheet is

- **All N or none.** `_pickem_write_sheet` refuses an incomplete sheet. On the
  client, `completedPicks` returns `null` for a sheet with a hole in it, and
  `onSave` takes the narrowed type — so a partial sheet cannot be turned into a
  payload at all, rather than merely having its button disabled.
- **Confidence, when on**, is a permutation of 1..N over the slate — each rank
  once, no holes. The same set test runs client-side (`isCompleteRanking`) and
  in `save_pickem_picks`.
- **Confidence off is a different product, not a disabled version.** No rank
  chip, no drag handle, nothing reorders; every correct pick is worth 1 before
  the multiplier. The affordances are absent, not greyed out.
- **Tapping the side you already took clears it.** Otherwise the first tap on a
  row would be irreversible.
- **A pick is stored only on Save.** The local draft survives a reload through
  `useDraftOutbox`, keyed on `(view, gameId, subject)`.

### Reconciliation

`reconcileSheet` folds whatever the server holds onto the *current* slate. Four
inputs, all reachable:

1. nothing stored → an empty sheet
2. a full stored sheet matching the slate → returned as-is
3. stored picks whose ranks were nulled → keep the winners, re-default the
   ranking, and **say so**
4. a slate that gained or lost games → keep the picks that still have a game,
   leave new games **uncalled**

Case 4 is where the old default did real harm: a runner adding a seventeenth
game silently answered it for everybody, and the next Save submitted an opinion
nobody had been shown.

A partial ranking is **never compacted** into a plausible one. Ranks 4,3,1 over
a three-game slate look salvageable; compacting them to 3,2,1 produces a
complete ranking the person did not choose and cannot tell apart from one they
did — the worst outcome available, because it is the one nobody checks.

---

## 4. The slate

Built by the runner in settings. A game carries two teams, an optional spread,
an optional kickoff, an optional note and an optional multiplier.

- **A missing multiplier reads as 1, never 0.** Setting nothing must produce a
  normal game, never a worthless one.
- **The slate freezes while picks are open**, because people are choosing
  against it right now. Close picking makes it editable again;
  `slateEditable` is `!picksOpen`.
- **Rankings clear only when the slate's id SET changes** — adding or removing a
  game, never re-ordering, re-pricing or renaming one. The identical test runs
  in `save_pickem_config` (migration 156), and that one is the destructive
  half; the client copy only decides whether the runner is warned first.

---

## 5. Scoring

`src/lib/pickemScoring.ts`, pure and client-safe, shared by every surface.

- A correct pick scores its confidence rank (or 1 with confidence off), times
  the game's multiplier.
- A wrong pick scores nothing.
- **A push and a CANCELLATION both score zero for everyone, and are different
  facts.**
  One happened and nobody covered; the other was struck from the scoring. One DB
  value (`pickem_slate_games.result = 'cancelled'`) and one display word,
  **Cancelled** — see that row in `CLAUDE.md`'s glossary for why it stopped
  being two, and why the word chosen is the one a non-technical crew would
  say rather than the one a form would. (This paragraph said **Void /
  Voided** until now: the rename landed in the code and the glossary and not
  here, which is the drift the note at the top of this file exists about.)
- **A cancellation has TWO producers**, which is why it is no longer described
  as "never happened": a runner marking a contest cancelled, and FINALIZING
  with contests outstanding. The second writes `cancelled` for every unresolved game at
  finalize — written, never derived, because "had no result when this was
  finalized" is not something the data remembers. Those games were very likely
  played; nobody entered a result.
- **It is reversible.** Correct a result reopens the game, the runner enters the
  real outcome over the cancellation, and re-finalizing recomputes the award.
  That is
  what makes finalizing early a decision rather than a loss.
- Both are **resolved**: they stop counting as remaining, which is what lets a
  clinch come forward correctly.

### Roll-ups

- **`individual_matches`** — a match list. Each side is one person's sheet;
  highest total wins the match.
- **`team_totals`** — every sheet on a side adds into one team total.

In a **points competition** the roll-up is inert: N teams finish in order and
each place pays. `pointsMode` overrides `rollUp` in one place, because a fifth
call site is inevitable and the version where each caller remembers the override
is the version where one of them does not.

### The states a match can be in

`not-started` · `live` · `clinched` · `final` · **`no-sheet`**

`no-sheet` outranks clinch and is outranked by final. Beating an empty sheet is
not a contest: the maths is right, but "clinched" is the wrong word for a match
decided because nobody entered.

---

## 6. Results

The runner marks each contest as it finishes: **away**, **home**, **push** or
**cancelled**. Any order — nothing waits on the row above it, and
`set_pickem_result` never reads `display_order`.

- An entered game **reopens in place** for correction. Clearing first would pass
  through a state where the game reads unplayed and every total on every surface
  moves, for a mistake being fixed in the same breath.
- **One list, in slate order.** Marked and unmarked games sit together in the
  order the slate has everywhere else. There was an `Entered · N` section and
  it is gone: it meant marking a game MOVED it out of the position the runner
  found it in — the position it holds on the picks sheet, on the matches tab
  and on the scoreboard they are reading from — sixteen times over an
  afternoon. A marked game still collapses in place; that is the correction
  affordance and it is a different decision from the section.
- Results are visible to everyone as they land. There is no embargo; watching it
  resolve is the point.
- **The first result freezes the scoring settings** (migration 157) and refuses
  a reopen (migration 165).

### How a settled row reads — four marks, one rule

Two facts live on every settled row and they are **not the same fact**:

| | comes from | shown by |
|---|---|---|
| who **won the game** | the scores | weight |
| who **covered** | the runner's call against a hand-entered line | a box |

They diverge, and that divergence is what a spread is for — a team can win by
three against −7.5 and lose the pick'em entirely. Before this round ONE mark
(weight) was driven by `result`, so it answered *who covered* while reading as
*who won*; once the "covered" badges were removed nothing on a row said which
side the runner had marked at all.

- **Weight** — winner of the game bold, loser grey and **normal weight**. Never
  dimmed-and-bold. With no score there is no winner, so nothing is bold: an
  absent score must not fabricate a result.
- **The score inherits its own name's colour and weight**, from the same call,
  so the two halves of a line cannot disagree about who won.
- **A box** wraps the covering side's name, score and line together — the three
  things that constitute the bet. A container rather than a colour, because
  weight and teal are both spoken for. **No box on a push or a cancellation.**
- **Teal is your pick, and the PICKS page only.** It overrides the winner
  colour, because on your own sheet the question is *what did I pick* before
  *who won*. A pick that lost the bet is struck through; a pick on a push is
  not, because the stake stood.

**One derivation — `sideMarks` in `src/components/games/pickem/slateRowVisual.tsx`
— and every surface calls it.** The Picks exception is a PARAMETER (`pick`), so
Matches and Results simply have no pick to pass and cannot reach the teal case.
This replaced `resultEmphasis`, which lived on the results page, was imported by
the head-to-head and was re-wrapped privately by the sheet: three call sites,
two functions, one concept.

**The line shows on both rows**, mirrored from the one number the runner types
(the builder's field is labelled *Spread Home*, so the number is the home
team's). Without it a box around the away row would wrap a team with nothing
where its line should be. **A spread of `0` shows on neither side** — a pick'em
with no line is a straight winner call. The slate BUILDER is excluded and still
shows the single badge.

**The rank chip depends on whether ranks vary.** With confidence ON it shows the
STAKE, struck through when missed — a struck 16 says you spent your best rank
and got nothing, which a 0 cannot. With confidence OFF every stake is 1, so it
shows what was **earned** and drops the line; miss and push are then told apart
by the box and the strike on the names rather than by the chip.

### The score (migration 180)

Two optional integers per contest, `away_score` / `home_score`, typed by hand
on the results row beside the outcome.

- **It is never interpreted.** Nothing derives a result, a cover or a total
  from it. The spread is hand-entered too, so a cover derived from a score
  would be an automatic decision made from two inputs nobody checked — which
  is why the column comment says it and this does too, in the two places a
  reader might arrive from.
- **Optional in both directions.** A game can be marked with no score, and a
  score can be typed on a game with no result. Neither is incomplete.
- **Empty is not zero.** NULL means unknown; `0` is a scoreless final. The
  fields commit empty as NULL and the display refuses to draw anything unless
  BOTH numbers are present — half a score is not a score. The storage layer
  deliberately admits the half state so entry can pass through it.
- **Editable after marking**, through the same tap that reopens the outcome. A
  score arrives late more often than a result does.
- `pickem_slate_games.status` (`scheduled` / `in_progress` / `final`) exists
  alongside them and **nothing writes it yet**. It is a column ahead of its
  writer, for a future scheduled fetch's cost gate — `kickoff` is free text
  (#1137), so nothing else in this schema can say a game has ended.

---

## 7. Who can do what

- **Enter results, run the phase, edit the slate** — Owner, Organizer, or this
  game's delegate. The same `canEditGame` predicate the settings gear uses.
- **Enter somebody else's sheet (proxy)** — decided by
  `_pickem_can_proxy_for` and surfaced by `pickem_sheet_status`, which returns
  exactly the people the caller may act for.

**The list is the permission.** No client-side role check decides who appears in
the proxy list, or whether the control that opens it exists — the row count
does. A client-side check would be a second copy of a policy that lives in one
place, and two copies drift.

---

## 8. The screens

While picks are open the page **is** the sheet. There is no tab row: nobody is
in a match yet, no result exists, and for a participant the roll-up shape
changes not one pick they make. The only question before the lock is whether
their sheet is in.

At the lock, three tabs appear:

| Tab | What it answers |
|---|---|
| **Matches** | Who is winning, and is it still live |
| **Picks** | What I picked — and, under a sub-tab, what everyone else did |
| **Results** | What has been marked, and what is left |

**Picks carries the same two sub-tabs in both phases** — *Your picks* and *Other
picks* — and they read from different sources either side of the lock, because
they are different questions. Open: `pickem_sheet_status`, whose sheet may I
*write*. Locked: the revealed sheets map, whose may I *read*, which after the
lock is everybody. The first answers nobody once picks close, so using it after
the lock would empty the tab for every member.

The whole surface decision lives in one pure function, `src/lib/pickemSurface.ts`,
which the view reads and does not re-derive.

---

## 9. Rules this feature has had to learn the hard way

Each of these was a real defect, and each generalises past pick'em. They are
listed because the next surface will meet them again.

**Empty is not unknown.** A value that resolved to nothing and a value that is
not yet known must not render the same way. Six instances so far: a push scoring
0-0 read as unmarked; a sheet belonging to nobody's team rendered as absent; an
unconfigured placement schedule paid everyone "0 pts" because `[]` is truthy; a
side with no sheet made the opponent read CLINCHED with nine games to play; and
a Save button read "Saved" over an empty sheet, because `needsSave` was false
for two opposite reasons — nothing to save, and something that cannot be sent
yet.

**A refusal must name an action the reader can take.** And the inverse: an
action that silently performs nothing is worse than a refusal, because there is
no message to disbelieve. Both have happened here — a refusal pointing at
matches a points cup cannot have, and a Start button that cleared a lock the
deadline was still holding shut.

**Copy describing a mechanic that is not in play is a falsehood.** The
explanation is assembled from the settings rather than written per combination:
there are sixteen combinations, nobody proofreads sixteen blocks, and the two
that ship most are not the two anyone writes first.

**One screen, one statement.** Per-component tests cannot see a duplicate
heading, because both halves are correct in isolation. Four have shipped here.

---

## 10. Known gaps

- **Pick'em cannot be finalized** (#1130) — no path to `games.finish`.
- **Kickoff is free text**, not a timestamp (#1137). Day grouping parses it and
  refuses rather than guessing.
- **Point Distribution** is unbuilt for pick'em (#1138).
- **The slate saves through its own RPC**, not through `save_game_config`, so
  the settings page has two save actions. Folding it in needs a `slate` arm on
  `save_game_config` **and** `pickem_slate_games` added to `configHash` — the
  slate is currently outside that contract, which is fine only while it is
  written by a different RPC.
