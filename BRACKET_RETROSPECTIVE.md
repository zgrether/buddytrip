# Bracket Retrospective — what adding a format actually cost

Covers PRs #908–#942, the first real test of the format hardening. Read-only: this
document changed no code.

The promise was that a fifth format couldn't silently omit a behaviour, and that
adding one would be cheap. The useful question isn't whether that worked — it
mostly did — but **what still had to be touched that no registry forced, and why.**

Names of files and functions are confined to the reference columns. If a finding
needs code to explain it, that is called out as its own problem.

---

## 1 · The short version — what to build before the next format

**The registry did its job. Almost nothing that went wrong was a missing format
branch.** What went wrong was, overwhelmingly, *one question answered in two
places* — and a person finding out on a device.

### Build these, in order of what they'd have saved here

| # | Build | What it would have caught | Cost |
|---|---|---|---|
| 1 | **A "what is this game worth" registry** — one place that turns a game into its payout values | The single biggest bug of the whole run: a bracket with no point split paid **nothing**, in three separate places at once. Also the loose points value with no home, and the distribution editor counting the wrong thing. | Small. The helper now exists; it needs to become the *only* way to ask. |
| 2 | **A render-level smoke test per format surface** — mount it, assert it isn't empty and isn't clipped | Two shipped header regressions, the empty-header payouts, the missing in-progress banner. All were invisible to type checking and to every existing test. | Small. One test file per surface. |
| 3 | **A first-run walkthrough of a new format with nothing configured** | Almost every "found on a device" item was reachable within two minutes of using a bracket with default settings. The bugs weren't deep; nobody had walked the empty path. | Free. It's a checklist, not code. |
| 4 | **A refusal-message contract** — no user-facing error may contain an internal code | Four of nine refusal messages leaked internal codes to the user, and the mechanism guaranteed that any code added later would too. | Small, and now done. Worth a test so it stays done. |
| 5 | **A shared type scale and label convention with something pointing at it** | Three surfaces independently invented the same off-scale text size. The convention now exists in writing; nothing enforces it. | Medium — needs a triage pass before it can be enforced. |

All five were approved — see §8 for the decisions and what each one commits to.

### The one-line summary

The hardening stopped the *format* from being incomplete. It did nothing about
**shared machinery that had never been asked a fourth kind of question** — and
that is where all the real cost landed.

### The conclusion that outranks the build list

**Shorten the loop between merging and looking.** A person on a device found
roughly three times as much as every automated mechanism combined, and CI found
nothing at all across 35 PRs. The five items above are worth building, but they
improve a route that was never going to be the main one — and none of them change
the ordering. The expensive pattern was **six PRs of build, then a look**, so a
wrong assumption from the first was still being paid for at the sixth. See §8.

---

## 2 · Where the registry held

These are the cases where something forced an answer, or where a boundary held
without anyone having to defend it.

| What held | Why it held | Reference |
|---|---|---|
| **The play surface cost four lines.** The bracket's board slotted into the existing non-golf game screen. No lifecycle behaviour, no title-bar publishing, no lock rule, no exit path and no cache-refresh list grew a bracket case. | The surface registry requires every format to answer every question, with no optional answers. An unanswered question doesn't compile. | #927; `FORMAT_SURFACE` |
| **The golf formats were never touched for business reasons.** Across 35 PRs, the match-play and stroke-play scoring engines were modified **zero** times. | The bracket's result rule lives in its own pure module and is dispatched by data, not by a chain of format checks. | verified across #908–#942 |
| **Writing a finished result had no second writer.** When the bracket needed to record placements, the existing writer gained a required "which kind of competitor" argument — so all three existing callers had to state their answer out loud. | The argument has no default. A new caller can't quietly inherit someone else's meaning. | #931; `writeManualResults` |
| **The catalog can't grow a bracket-shaped entry by accident.** A test asserts no game type claims the bracket engine, because the engine is a *resolution* of two facts, not a type. | Written specifically to stop a collapsed decision being "tidied" back open later, one entry per category. | #931; `resultStrategy.test.ts` |
| **The screen and the server agree about who can be picked**, because both run the same advancement function. | One resolver, used by the renderer and the validator. A second implementation was explicitly refused. | #924, #925 |
| **The go-live readiness check landed in the right place first time** — judged on the field the save is *establishing*, not the one it replaces. | The surrounding code had already learned this lesson for points, and the new check copied it rather than rediscovering it. | #922 |
| **Opening a game introduced no new navigation machinery.** | An existing documented rule said what to reuse and explicitly recorded that the tempting alternative had been proposed once and was wrong. | #927 |

**The pattern:** every one of these held because a previous mistake had been
written down *with its reasoning*, not because of a type. Types forced two of the
seven. Written-down reasoning forced the rest.

---

## 3 · Where a registry existed and missed the question

The most valuable bucket. In each case something *was* asking formats questions —
it just wasn't asking this one.

| What had to change | Why nothing forced it | Recurs? | Reference |
|---|---|---|---|
| **The push notification said "Results are in." for a game that had just crowned a champion.** The audience was right; the result line was silently empty. | The code asked "is this stroke play?" and treated everything else as team-based. That question had **two spellings in two files**, and neither could express "entrant". Nothing was wrong with the registry — there wasn't one. | **No** — a registry was built. A fifth format now can't compile without answering audience, competitor rows and summary shape. | #932; `NOTIFY_SURFACE` |
| **How many finishing places a game can have** was hard-wired to "how many teams are in the competition" — the same number derived five different ways. | Every format before this one had places that *were* teams, so the question had never been distinguishable from the answer. | **Yes, for any format whose competitors aren't teams.** Now derived once, with the source of the number attached. | #915; `placeCapacity` |
| **The settings page contradicted itself** — a row said "winner takes all" and the panel it opened showed an unfinished split. | Two rows in the same file each worked out the cup's scoring model privately. Fixing the wording couldn't fix it; the control was reading a different fact. | **No** — both now read one predicate. | #911, #921 |
| **A game with no point split paid nothing at all.** No value in the final's header, no projection on the board, no points rolled up. | Three separate places each wrote "if there's a split use it, otherwise use nothing." Every other format flattened to "winner takes the total" a few lines away; the bracket alone didn't. A comment defended it as avoiding a guess. | **Yes** — until asking "what is this worth" goes through one function. **This is build item 1.** | #941 |
| **The status banner had nothing to say while a game was in progress.** The value floated loose in a corner with no container. | A shared banner existed and covered two states. Nobody had asked what it should say in the third — the most common one. | **No** for the banner. **Yes** for the general shape: shared components covering the states that existed when they were written. | #941 |
| **Tapping the other competitor did nothing** until you cleared the current winner first. | A shared predicate existed and was correct; the board keyed on a *neighbouring* one that answers "does this need a result?" rather than "can this be changed?". | **Yes.** Two adjacent booleans where one is subtly wrong is not detectable by any tool. | #936 |
| **Small caps labels and text sizes were invented per surface.** Three surfaces independently chose the same off-scale size with no contact between them. | The style guide's typography section was **entirely colour**. There was no scale to be consistent with, so every surface picked. | **Yes**, until something points at the scale. Written down now; unenforced. | #937 |

**What this bucket is really saying:** the format registry asks *"does this format
answer every question I know about?"* It cannot ask *"is there a question I don't
know about?"* Every finding here is a question nobody had needed to ask before,
because four formats happened to share an answer.

---

## 4 · What nothing forced, and what would have caught it

Found by a person using the app. For each: what would have caught it, and whether
that mechanism is worth building.

| What was wrong | What would have caught it | Worth building? |
|---|---|---|
| The place ceiling was set to what the tree can *tell apart* rather than what it can *pay*, capping configuration at 2 or 4. | Writing out a worked payout example for an 8-entrant draw. It was caught this way — one PR later. | **No mechanism.** This is thinking, and it worked. |
| A game with no split paid nothing (four visible symptoms, one cause). | A first-run walkthrough with nothing configured, or a render test asserting the header isn't empty. | **Yes — items 1, 2 and 3.** The highest-value catch available. |
| The distribution editor's place limit counted teams, so a legitimate setup was refused. | Same walkthrough. | **Yes — item 3.** |
| The banner said nothing during the state a game spends most of its life in. | A render test per state, or a checklist entry: "what does each shared component say in every state this format can be in?" | **Yes — item 2.** |
| Finished results couldn't express "this team finished 1st, 3rd and 5th". | Nothing automatic. It was found by reasoning about the write before building it, and the alternative designs were written down and rejected on paper. | **No mechanism.** Design work, done well. |
| The bracket scrolled sideways inside a half-width column while the page had room. | Looking at it on a wide screen. | **No** — see §7. |
| Competitor names were the smallest text on a screen about competitors. | Looking at it. | **No.** |
| Enabling the 3rd-place match mid-game was refused with an internal error code. | A walkthrough that changes a setting *after* starting play. Nothing else would have found it. | **Yes — item 3**, extended to "change each setting mid-game". |
| The 3rd-place setting existed everywhere except as a control — permanently off since it was built. | A test that every declared setting has a control, or a walkthrough. | **Marginal.** A "settings with no control" check is cheap but narrow. |
| Rounds after the first didn't line up with the matches feeding them. | Looking at it. | **No.** |
| The game header sat 24px lower on desktop than on mobile. | Looking at it. | **No** — but see the *verification* failure in §5. |
| A tap took ~800ms to show anything. | Using it on a real device on real latency. Local measurement showed 25ms. | **No mechanism worth building.** Local timings cannot see this class. |

**The honest summary of this bucket:** almost everything here was reachable within
minutes of using a bracket that hadn't been configured. The bugs were not deep.
Nobody had walked the empty path, because the build order went schema → server →
settings → play surface → results, and each PR verified its own slice.

---

## 5 · Reversals, and whether each was avoidable

A reversal that was always going to happen is a **design cost** — the price of
deciding before you can see. One caused by not checking is a **process cost**.

| Reversal | Cost | Why |
|---|---|---|
| **Place ceiling: what the tree distinguishes → the size of the field** | **Design** | The first answer was reasoned, written down and wrong in a subtle way: it confused what a bracket can *pay* with what it can *tell apart*. It was caught one PR later, before anything was built on it, by writing out a payout example. That is the process working, not failing. |
| **Clearing a result stopped being non-cascading** | **Design** | The original decision was explicitly flagged as surprising-but-defensible, reasoned about, and agreed. It took *using* it — correcting a result and watching a repudiated one come back — to show the reasoning was wrong. No amount of checking beforehand would have produced that. |
| **"One payout formula on every match" → only where places are paid** | **Process** | The formula was chosen on reasoning that sounded right, and the output refuted it immediately: eight first-round matches all reading "worth 0, worth 0". Rendering a full-size draw before choosing would have shown it in seconds. Cheap to check, not checked. |
| **The field picker reused the playing-group builder** | **Process** | A group is a container you fill; a field is a selection. The mismatch was knowable from the two concepts, and the symptom — *"this group is full (max 4)"* after a single pick — appeared on first use. |
| **The game header: two failed attempts before the third worked** | **Process, twice** | Both failures were the same mistake in the fix *and* in the verification: the check measured whether the row was in the right **position**, not whether it was **visible**. A clipped element reports its geometry perfectly happily. The second attempt repeated it one container higher. |
| **A documented rule was cited to justify a layout, and its facts had changed** | **Process** | The rule said the desktop bar carried navigation tabs; they had moved out, and the file's own comment said so. The rule was trusted instead of the code. |

**Three of six are process costs, and all three share one root: a claim was
accepted without looking at the thing it described.** Not a lack of tests — a lack
of *looking*.

---

## 6 · How things were found — the four-column count

Counting non-business-logic findings across #908–#942.

| Found by | Count | What kind of thing |
|---|---|---|
| **CI** | **0** | CI was green on every PR that reached it. It caught no novel finding all run. Its value here was confirming that local red was environmental — real, but not discovery. |
| **A guard, test or compiler** | **6** | The config-hash invariant tests caught a bug mid-build **twice**, including one where a team change would have silently skipped a write. The React compiler caught a derived value missing an input. The linter caught a component being rebuilt every render. The finalized-game tests caught a rewrite that lost the word "handicaps". A catalog test prevented a collapsed decision reopening. |
| **A person on a device** | **~17** | Nearly everything in §4: the payout, the ceiling, the banner, the latency, the clipping, the alignment, the type sizes, the missing toggle, the refused setting, the label noise. |
| **Reading the code** | **~6** | Almost always *downstream of a person's report*: the two-spellings boolean behind the wrong push, the three duplicate payout call sites, the nine refusal codes behind one bad message, the stranded placeholder accounts behind two missing names. |

**The ratio is the finding.** A person on a device found roughly **three times**
as much as every automated mechanism combined — and the reading column is mostly
*diagnosis of what a person reported*, not independent discovery.

### What the guards caught, and what they missed — both sides

**Caught (and worth keeping):** the hash-invariant tests are the best-performing
mechanism in the codebase. They caught two real bugs *during* the build, one of
which — a change that would have silently stopped writing entrant data — had no
visible symptom at all and would have shipped.

**Missed:** the settings-page guard checks that a value is *passed in the source
text*, not that anything renders. A wrong value satisfies it completely. It has
already been noted in the code that a corrected boolean under that guard "would
just reset the clock." **A guard that reads source text rather than output is
worth less than it appears**, and this one has been giving false confidence.

**Also missed, by everything:** every visual defect, every empty state, and every
piece of copy.

### Amendment (2026-08-19) — the count is about CLASSES, not about strength

The reading most likely to be taken from the table above is "types are weak."
That is not what it found, and the difference matters before #943–#946 are worked,
because two of those four are automation items whose value depends entirely on the
class of thing they are aimed at.

What the table actually says is that in THIS build, the expensive questions were not
expressible as types. "Does this format answer a question I have not thought of" has
no type. "Is the payout right" has no type. So types held two of seven boundaries —
not because the mechanism is weak, but because it was pointed at a class it cannot
address.

**The double-elim build produced the control.** Widening `BracketSide` from
`main | consolation` to the four values migration 127 admits is a closed set of
values, which is exactly what a union expresses. The compiler then refused SEVEN
separate sites that had re-narrowed the union locally — two `z.enum` wire validators,
four component prop types, and a test helper that would have rejected nothing at
runtime at all. Types held all seven, and a person on a device would have found none
of them, because six of the seven fail before anything renders.

So the generalisation is not a ranking. **Each mechanism catches a different class,
and the useful question is which class a given risk falls into** — not which
mechanism is strongest:

| Class of risk | What actually catches it |
|---|---|
| A closed set of values, or a shape | the compiler — cheaply, exhaustively, before render |
| An invariant over data the code writes | a guard test (the hash-invariant tests remain the best-performing mechanism here) |
| A model that is coherently wrong | a CONCRETE anchor, hand-computed — see below |
| A question nobody thought to ask | a person on a device, and so far nothing else |

**On concrete anchors, which the double-elim tree also produced evidence for.** Its
shape tests are mostly invariants — rounds halve, the drop map is a bijection, every
entrant has room to lose twice. All were green against a match count that was wrong.
The error was caught only by a single hand-computed number (15 emitted matches at 8
entrants, where I had asserted 14 by conflating matches PLAYED with matches EMITTED).

Invariants check internal consistency; they cannot catch a model that is coherently
wrong, because a wrong model is internally consistent. That is an argument for keeping
at least one concrete, hand-computed anchor per case — not for preferring anchors,
which are brittle and blind to cases nobody enumerated.

---

## 7 · Is double elimination cheap?

**Cheaper than the first bracket by a wide margin, but it is not one function with
a branch.**

### What genuinely reuses, with no work

The field picker, the partner builder, the seeding list, the pick mutation and its
optimistic update, the broadcast that reaches other devices, entrant storage, the
roll-up to cup teams, the whole settings surface, the lifecycle (finalize, correct,
re-lock), the notification, the results write. **None of these should need to know
double elimination exists.**

### What actually differs

Three pure modules, plus the board's geometry:

| Module | Why it can't just branch |
|---|---|
| **Building the tree** | Every match currently feeds exactly one destination — one slot up. Double elimination needs each match to feed **two**: the winner upward, the loser sideways into a second bracket. That is a different shape of tree, not a longer one. |
| **Working out who's standing where** | The current walk goes round by round assuming a single feed. With a losers bracket it has to resolve two interleaved sequences whose rounds alternate. |
| **Deciding finishing places** | Today a place is a pure function of *the round you lost in*. With two lives that formula doesn't hold at all — placement becomes "when you took your second loss", which the current rule cannot express. |
| **The board's layout** | The geometry assumes one column per round converging on a single final. A losers bracket doesn't converge that way and sits alongside. |

### The honest estimate

**One migration is probably unnecessary** — the storage already distinguishes
brackets by name and holds entrant placements. The two-bracket distinction already
exists in the data as a "main / consolation" marker; a third value is plausible
rather than a schema change.

So: **three pure, well-tested modules to extend and one layout to rework, and
nothing outside them.** That is a substantially smaller job than the bracket was,
and the reason is exactly what §2 records — the lifecycle, settings, picking,
notification and roll-up were all made format-agnostic on the way through.

**The risk isn't the size. It's §3 again:** double elimination will ask a question
nobody has asked — most likely *"what does it mean to lose and still be in?"* —
and the place that breaks will be something shared that has only ever seen
single-life formats. Placement, and anything that assumes losing removes you.

---

## 8 · Decisions

All five were put to Zach and answered. Recorded here rather than left in a chat
log, because the point of the document is that the next person doesn't have to
reconstruct this.

| # | Question | Decision | What follows |
|---|---|---|---|
| 1 | Formalise the first-run walkthrough? | **Yes.** Free, and the highest ratio in the document. §4's summary is the argument: almost everything was reachable within minutes of an unconfigured bracket, and nobody had walked the empty path because **each PR verified its own slice**. | A written checklist, not a habit. It must include *changing a setting after play has started* — the only route that would have found the refused 3rd-place match. |
| 2 | Fix or delete the settings-page guard? | **Fix it.** Deleting is honest but loses the intent; a rendering version is what everyone already believes they have. | Replace the source-text check with one that renders. Until then it should be read as decorative. |
| 3 | Render smoke test per surface? | **Yes.** Two shipped header regressions, the empty payout header, the missing banner state. | One test per format surface: it mounts, it isn't empty, it isn't clipped by any ancestor. Explicitly **not** a judgement about whether it looks good. |
| 4 | Enforce the type scale? | **Yes, and the triage is a job.** Three surfaces independently invented the same off-scale value with no contact between them. | Triage the ~12 off-scale values into "legitimate one-off" and "drift", then a lint rule or source guard over what remains. |
| 5 | Is "found on a device" the expected route? | **Yes — and this is the real conclusion.** | Shorten the loop rather than trying to move findings into columns they demonstrably don't reach. **CI found nothing all run.** |

### What decision 5 changes about this document

It reorders everything above it. Items 1–4 are worth building, but they are
*improvements to a route that was never going to be the main one*. The evidence
across 35 PRs is that a person looking at the running app is not the fallback when
automation misses something — **it is the primary discovery mechanism**, by roughly
three to one, and the automated columns did not fail so much as decline to
participate.

The practical consequence: **treat the time between "merged" and "someone looked at
it" as the number to optimise.** Every finding in §4 was cheap to see and expensive
to reach, and none of the mechanisms in items 1–4 would have changed that ordering
— they only shorten the *distance* a defect travels once someone is looking.

The costly pattern was never "we lacked a test." It was **six PRs of build, then a
look** — so a wrong assumption from PR one was still being paid for at PR six.
