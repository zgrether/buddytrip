# BuddyTrip — Game Format Definitions (design-of-record)

> **This is the design-of-record for BuddyTrip's game formats** — the definition every
> current and future format must conform to. It is **prescriptive**: it states what each
> format is *meant* to do.
>
> **Intent is authoritative here.** Where code diverges from this doc, the default reading
> is a **code bug** → produce a delta and fix the code. The exception is a deliberate
> **rule change**, which updates this doc *as part of that decision*. This inverts the
> repo's usual "code is ground truth" rule **on purpose**: a code-derived doc canonizes
> whatever decisions were made — including erroneous ones — whereas this doc canonizes
> intent, so the two can be diffed and reconciled.
>
> **Marker legend:**
> - `⚠️ VERIFY-CODE` — intent is stated below; confirm the code conforms, or generate a delta.
> - `⚠️ RULING-NEEDED` — intent is not yet decided; requires a ruling before it's canon.
>
> **Conventions.** DB schema names, enums, and `result_strategy` keys are kept — they're
> reused vocabulary, not rot. File references are **filename only** (paths change on
> refactor). **No session/PR/cluster labels** — those are provenance, not intent.

---

## 1 · Glossary

| Term | Meaning |
|------|---------|
| **Competition** (code) / **Cup** (UI) | The overall contest attached to a trip (e.g. BBMI). Contains one or more games. |
| **Game** | The unit of play a competition is built from (stroke / match / rack / non-golf). |
| **Round** | Golf's 18 (or 9) holes — the thing a game scores *over*. **Never** a synonym for game/match. |
| **Match** | A head-to-head pairing that settles win/halve/lose. **Authored & stored** (`game_matches`) in match play; **derived** in rack. |
| **Grouping** | Players who play and enter scores together (a cart). In **stroke & rack**, mandatory — *ungrouped = not in the game.* Read from the **live grouping field**, never a create-time snapshot. |
| **Team** (roster) / **Side** (a match slot, may be solo) | Preserve the split. |
| **Member** (trip) / **Participant** (game) / **Guest** (placeholder) | A person, by context. |
| **Slot** | A ranked position within a team after sorting (rack). Slot k faces the other team's slot k. |
| **`total_points`** ≡ **points-in-play** | The owner-set pool a game puts up. **One concept — kept merged.** The invariant a points format is built around. |
| **`point_value`** (`game_matches.point_value`) | A match's stored points value; `null` → the derived even share. |
| **To-par** | Score relative to par, measured over **holes actually played** (not assumed 18). |
| **Anchor** | The stable thing a score belongs to — the **person** (`user_id`), never a slot/group id, so re-grouping can't orphan scores (migration 089's precise guard: only a *scored*-player removal is refused). |

---

## 2 · The three axes that classify every format

A format is defined by where it sits on three independent axes:

1. **`result_strategy`** (dispatch — `gameTypes.ts`). The finish/post compute key:
   `stroke_total`, `match_play`, `rack_n_stack`, or `null` (declared-outcome). **New
   formats slot in as a new strategy** — never a hardcoded id branch.
2. **`scoring_model`** (`competitions.scoring_model`) — *how points accrue*:
   - **`match_play`** — a **fixed points ceiling**, so "first to X" / clinch is calculable
     and shown.
   - **`points`** — points accrue **open-endedly**, no ceiling, so clinch / first-to-X /
     pts-in-play chrome is **deliberately absent** (type-gated off).
3. **Distribution model** — *how the pool is split*:
   - **Even share** — the pool divides evenly across units (matches/slots). Match & rack.
     Nothing to mis-sum → **immune** to distribution-validity errors.
   - **Placement** — the pool is allocated by finishing place (1st/2nd/…). Stroke-placement
     & non-golf. Place values **must sum to `total_points`** (enforced at save — §9).

---

## 3 · The format families (`gameTypes.ts`)

| Family | `game_type_id` | `result_strategy` | Standard or authored | Entry |
|--------|----------------|-------------------|-----------------------|-------|
| **Stroke play** | `gtt_stroke_play` | `stroke_total` | standard (golf) | per-player strokes |
| **Match play** | `gtt_match_play` | `match_play` | standard (golf) | per-hole, 1v1 / 2v2 |
| **Rack-n-stack** | `gtt_rack_n_stack` | `rack_n_stack` | **BuddyTrip-authored** | net-stroke, team settlement |
| **Non-golf** (card/yard/bar/manual) | `gtt_generic_*`, `gtt_manual` | `null` | **BuddyTrip-authored** | declared finishing order |

*Standard formats* carry external rules-of-golf grounding; *authored formats* are
BuddyTrip's own inventions and their rules live **here**.

> `⚠️ VERIFY-CODE` **Someday golf formats** — foursomes/alt-shot, four-ball
> (`group_holes` entry, `match_play`) — have **no `gtt_*` id yet**. Not live formats.

---

## 4 · Cross-cutting mechanics (all golf formats)

- **Settings = draft-then-save.** A format's whole settings page commits through one atomic
  `save_game_config` RPC — nothing self-persists per row.
- **Course / tee.** Selecting or adding a course writes into the config **draft**, so the
  inline picker reflects the pending pick immediately (all three golf formats compose a
  draft course row). Applying a course snapshots its par + stroke-index into the scorecard
  schema; the snapshot **freezes once scores exist** (`COURSE_LOCKED`).
- **Finalize = game-level, all-units-complete, `canEdit`.** Rack and stroke finalize from
  the **game scoreboard** (never a per-group entry page), enabled only when **every** unit
  is thru every hole — a shared `allUnitsComplete(thrus, unitCount)` (`gameCompleteness.ts`),
  derived live over the **current** group set so a mid-round-added group re-blocks it.
  `canEdit` = owner / organizer / game-**delegate**; hidden for others.
- **Handicaps (relative).** Per-player strokes allocate against the course's stroke index
  (hardest holes first). Course-gated. Player chips render the shared `Avatar` (team-colored
  initial + name), fed from the **live grouping field**.
- **Modifier compatibility** (real applicability):
  `stroke → moving_tees` · `match → moving_tees, glorious_holes` · `rack → moving_tees` ·
  `non-golf → none`. *Glorious Finishing Holes doubles a hole's **match** value (match only),
  derived at compute time — never snapshotted.*

---

## 5 · Stroke play — *standard* (`stroke_total`)

**What it is.** Add every stroke over the round; lowest total wins. No hole-by-hole duel —
each player against the scorecard. The unit is the **individual player**.

**Definition.** Groupings mandatory; anyone ungrouped is not in the game (no standalone
"pick 2–4 players" pre-screen — that fossil is retired). The leaderboard **aggregates the
whole field** across groupings, ranked by to-par over *scored* holes only (a thru-0 player
sorts to the bottom, never mis-ranked to the top).

**Configuration.** Groupings → Point Distribution → Handicaps (inline accordions), plus the
bare **Total Points**, Course, Modifiers. **Total / Distribution split:** the owner-set
Total and the **placement distribution** read the same drafted total so they can't drift;
default is **winner-takes-all** (1st holds the whole pool; "Add 2nd place" opts into a real
split). Place fields use the app number picker (decimal-capable). The handicap roster is the
**live grouping field** — populates the instant a group is built, no cap, no save-and-return.

**Scoring.** Total strokes → to-par ordering; points (if enabled) by placement.

**Team aggregation (decided).** Where a competition rolls stroke results up to a team
score, the team score = the **sum of that team's members' total net strokes**; the lowest
team net-stroke total wins. (Groupings may span teams; the field is scored per-individual,
then summed per team for the team result.)

**Principles.** Scores anchor to the person. **Roadmap:** a true standalone mode that skips
the grouping step and assumes one group — the "it's Sunday, just keep score" path (not built).

**Relationships.** Shares its **score-entry model** with rack.

---

## 6 · Match play — *standard* (`match_play`)

**What it is.** Head-to-head, hole by hole — low net wins each hole; winning more holes wins
the **match**. Each match is **1v1 or 2v2**; one game can mix both. `scoring_model = match_play`
→ fixed ceiling → **first-to-X / clinch is shown**.

**Definition.** Matchups are **authored and stored** (`game_matches`) — a fixture list decided
up front, *not* derived from scores. (Deliberate opposite of rack.) The **authored-matchup
wall** guarding stored matches against invalidating roster edits **stays** — do not make
match derive its pairings the way rack does. Reorder is via **up/down arrows** (ends disabled).

**Configuration — points.** Owner sets `total_points`; per-match value **derives** (even
share = total ÷ matchCount). Individual matches can be **overridden** (`game_matches.point_value`;
`null` → even share) — e.g. a singles game combining two players into a **2v1** sets that match
to 2. Edited via a popup holding the Total Points picker (tap value → decimal entry, commits
itself); `×` / "use even share" clears to the derived default (even-share **excludes that
match's own override**, so it reverts to the real share, not a degenerate 0). Award per match
= `point_value ?? even_share`; **team total = `points_total`** (authoritative).

> `⚠️ VERIFY-CODE` **Override redistribution.** Intent: an override holds `total_points`
> fixed by redistributing the remainder across the other matches (total is the invariant).
> Confirm the code does exactly this (vs. letting the total float when a match is overridden).

**Modifiers.** `moving_tees`, `glorious_holes` (doubles a hole's match value).

**Settlement (standard match play).** Holes won decide the match; dormie / close-out are
standard match-play concepts. **Glorious Holes is not a special case** — it's a hole's value
**×2** that feeds the *same* dormie/close-out and match-points logic (a won glorious hole
simply contributes 2 toward holes-up). A halved hole changes nothing; a **halved/tied match
splits its `point_value`** evenly between the sides.

> `⚠️ VERIFY-CODE` Confirm the code implements the standard halved-match **points split**.
> (Not a ruling — the rule is standard match play; this is a code-conformance check.)

**Relationships.** Rack borrows match's **finalization model**.

---

## 7 · Rack-n-stack — *BuddyTrip-authored* (`rack_n_stack`)

**What it is.** Stroke-play *entry*, match-play *settlement*: everyone posts a net round,
players are sorted low→high within their team, and each ranked slot is matched against the
same slot on the other team — every slot a separate match result at day's end. **Do NOT
generalize rack** to other formats — its settlement is uniquely its own.

**Definition.** Matchups are **derived, never stored** (`computeRack`) from per-player net
scores + rosters. The match count = **`min(grouped-A, grouped-B)`** — a *consequence* of who's
in the groups, never an authored input (you fill groups; the pairable count falls out).
`total_points` is the authored invariant; the per-slot value = **even share** over that count.

**Scoring — short-handed (INTENT: even distribution over the live pairable count).** When
teams are uneven, sort each team, pair slot-k vs slot-k; the deeper team's **worst-scoring
surplus slot(s)** go **unpaired** — a **positional, identity-neutral tail-drop** (never a
named person). The surplus player still plays and enters scores (counts for their own to-par);
they're excluded from **match settlement** only, and the UI marks their scores "not in play."
`total_points` distributes evenly across the pairable slots (i.e. total ÷ `min(A,B)`).

> `⚠️ VERIFY-CODE` **Confirm rack settles this way (2A):** even distribution of `total_points`
> over `min(grouped-A, grouped-B)`, worst-surplus slots unpaired. This is the intended rule;
> if `computeRack` diverges, that's a delta to fix in code.

> `⚠️ VERIFY-CODE / possible leak` **Per-slot overrides in rack.** Rack's intent is **pure
> even-share** (total ÷ matches), with per-slot overrides *not* part of its design — the
> override concept is **match-only** (the 2v1). A code read suggests rack may carry the same
> `point_value` override model as match. **Confirm:** is a per-slot override intended for rack,
> or did a match-concept leak in? If unintended → delta (remove from rack).

> **DEFERRED FEATURE — no withdrawal mechanism today.** There is currently no way to mark a
> player withdrawn. Standing workaround: **enter a score for anyone who can't play** so the
> field stays complete (this is how it's always been done). A real withdrawal model — and
> whether a mid-round withdrawal should settle differently from a plain absence — is a
> **future feature requirement**, not a current rule. Until then, short-handed (above) arises
> only from **deliberately uneven groupings**, and 2A covers it.

**Principles.** `total_points` is the invariant; the per-slot value is **derived** from it,
never the reverse. Scores anchor to the person.

**Relationships.** Score entry ⊃ **stroke**; finalization ⊃ **match**; settlement is its own.

---

## 8 · Non-golf / declared-outcome — *BuddyTrip-authored* (`result_strategy = null`)

**What it is.** However the game is actually played (poker, cornhole, a bar game), you settle
it and **enter the finishing order by hand** — the day's rules say how it's won.

**Definition.** Scores are posted as a **placement** finishing order via `games.post` (not
per-hole `score_entries`): order the teams by finish; points come from the configured
placement distribution (you set the order, not the points). Uses the **placement** distribution
model → subject to the §9 save gate.

**Competition format** (`competitions.competition_format`, enum
`head_to_head | bracket_se | bracket_de | best_of_n | live_results`): **Head-to-Head is the
only enabled option** (and default). **Bracket (single/double), Best-of-N, Live Results** are
visible-but-disabled **"Soon" placeholders** — no engine yet.

> **DEFERRED FEATURE** — bracket / best-of-N / live-results engines are undesigned
> placeholders. When built, each becomes a new format entry here (its own settlement rules),
> dispatched via a `result_strategy`. Not a canon blocker for the live formats.

---

## 9 · Points-distribution validity (placement formats only)

For the **placement** formats (stroke-placement, non-golf), a **started** distribution (1st
entered) must sum **exactly** to `total_points`. An **undistributed** shell (no places
entered) is a legal, saveable state; a **partial** split (entered but ≠ total) is **blocked**
— client-side (Save disables + shows the shortfall) *and* server-side (a `saveConfig` refine
rejects it before the RPC). Validity is **re-derived at save** against the current total,
never snapshotted. **Even-share formats (match/rack) are immune** — there is no stored
placement array to fall out of sync.

---

## 10 · Open items (consolidated)

**Rulings owed — NONE.** All live-format intent is now decided: stroke team-aggregate (sum of
team net strokes), match settlement (standard match play; glorious = transparent ×2), rack
short-handed (2A). Canon is gated only on the code checks below.

**Code checks before full canon (`⚠️ VERIFY-CODE`) — confirm code matches stated intent, else
file a delta:**
- §6 — override redistribution holds `total_points` fixed.
- §6 — halved/tied match splits `point_value` (standard).
- §7 — rack settles as 2A (even over `min(grouped-A, grouped-B)`, worst-surplus unpaired).
- §7 — **whether rack carries per-slot overrides** (intended, or a match-concept leak?) — the
  one check that may surface a real **bug** rather than just confirm conformance.

**Deferred features** (undesigned; do NOT block canon of live formats): player-withdrawals (all formats);
non-golf engines (bracket/best-of-N/live-results); someday golf formats (foursomes, four-ball).

---

## Template — adding a new format

```
## <Name> — *standard | BuddyTrip-authored* (<result_strategy>)

**What it is.** One line + standard-vs-authored.
**Definition.** Scoring model · unit (individual / team / N-team) · play · groupings.
**Configuration.** scoring_model (match_play / points) · distribution model
  (even-share / placement) · settings · what may change once scores exist.
**Scoring.** Inputs → result · settlement · tiebreaks · edge cases (short-handed, incomplete).
**Principles.** Intent · "don't assume X".
**Relationships.** Shared *model* (not code) with other formats.
```

*Living design-of-record. Intent is authoritative; code conforms or a delta is filed.
Update only when a format's rules change.*
