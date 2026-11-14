# Score sheet patterns (requirement, not solved yet)

*Captured 2026-11-11. Zach: "the scoresheet needs to be abstractable." Not designed or drawn yet;
this records the requirement and how it fits the engine we already specified.*

## The requirement

The everyday score sheet can't be one fixed "count up and add" grid. Card and table games score a
round in different ways, the same way golf already has different cards by format. The default is
a count-up with a TOTAL; other games need their own way to enter a round. Nobody should have to
type a negative number: the sheet asks in the game's own terms and works out the signs.

## It slots into what's already specified

`COMPETITION_ENGINE.md` already splits every format into an **entry schema** (how a unit is
entered) and a **result strategy** (how entries become a result), described per game by
`scorecard_schema` (`units`, `entry`, `scoring`, `participants`). Golf uses `user_holes` /
`group_holes`; non-golf has `winner_only`, `turn_append`, `categories`. The everyday sheet extends
the same schema with **round** units that append as you play, plus a few round entry patterns:

| Entry pattern | How a round is entered | Round math | Examples |
|---|---|---|---|
| **Count up** (default) | Each player's points for the round | Add to each total | Scrabble, Five dice rounds, Rook (each for themselves) |
| **Went out** | Who went out? Then each other player's leftover points | Others lose (or the one who went out gains) their leftovers | Rummy, gin, Uno-style |
| **Bid and make** | Each side's bid, then what they made | Made it: + points; missed: − the bid | Rook partners, Spades, Oh Hell |
| **Split a fixed pool** | Points for each player; must add to the pool | Checked against the pool; "shot the moon" flips it | Hearts (26) |
| **Fill a box** | Pick a box and a value | Box rules, bonuses | Yahtzee / Five dice card |
| **Who won the round** | Tap the winner | Winner +1 (or + value) | Cornhole ends, quick bar games |

Layout is a separate choice: **columns per player** or **columns per side** (partners).
Who wins stays as it is today: highest, lowest, first to N.

## How it shows up in the design we have

- **How to score** already picks the pattern. Each "way to score" option is one sheet variant
  (layout + entry pattern + who wins), and its preview is drawn in that variant's shape.
- **The score sheet** is one shell: header, rows, TOTAL, Cancel / Finish. Only the entry panel at
  the bottom swaps by pattern. Count up uses the keypad; Went out asks "Who went out?" first, then
  steps through the others; Bid and make asks bid, then made.
- **A finished game** needs nothing new: the sheet slot shows the same grid, read-only.

## Open (later)

- Which games ship with which patterns, and whether people can build a custom one.
- How Correct scores works on the computed patterns (edit the inputs, not the signed results).
