# Rules Audit — everything the project says must never happen

*Read-only survey. Nothing was changed. Every build-failing test named here was
deliberately broken, watched fail, and put back; the full suite is green
(178 files, 1979 tests) and the working tree is clean.*

*Audited against `main` at `6021ebdb`, 2026-08-08.*

---

## Status — four things were fixed after this audit was read

The audit was a survey; Zach then directed four changes, which are in the same
pull request as this document. **Findings A, B and C below are FIXED** — each is
kept in place, struck through with what was done, because the *reason* is worth
more than the finding. Finding D is now written down permanently but still has
no test.

| Finding | Decision | State |
|---|---|---|
| **A** — firehose notification check could be switched off by allowlisting | Make it independent; it must not read the approved list at all | ✅ Fixed + proven |
| **B** — broadcast privacy check read one named file | Check effective current state, not a filename | ✅ Fixed + proven |
| **C** — linter never ran in CI | Add it, and treat the surfaced backlog as the point | ✅ Fixed — backlog turned out to be **zero** in product code |
| **D** — three-signal invariant had no permanent home | Move it somewhere permanent | ✅ Moved to `CLAUDE.md` #25 — still no test |
| **§6** — "who typed a score is never a permission" was homeless | Move it to the permissions document specifically | ✅ Moved to `PERMISSIONS.md` |

Sections 4–6 of §7 (design folder, marketing colours, the possible sixth
owner-only exception) remain open product questions.

---

## How to read this

Each rule is written the way a person would say it, followed by what actually
goes wrong if someone ignores it. Code names live in the **Reference** column
only — the explanation should make sense without them.

The question that decides most of these is: **if someone broke this tomorrow,
would anyone find out?** A rule with a working test is safe. A rule that lives
only in a paragraph is one distracted afternoon from being gone.

---

# 1 · The short version

Ninety-odd prohibitions are written down across this project. Most are sound and
most still apply. Four things need attention, and the first two are the reason
this audit was worth doing — both are rules everyone believes are protected, and
both are protected by tests that **do not actually work**.

### ✅ A. ~~The rule that stops a phone buzzing on every score can be switched off by accident~~ — FIXED

This is the single most important finding.

There is a test whose stated job is to make sure nobody ever wires a push
notification to score entry — thirty people, eighteen holes, roughly 540
notifications a day, and the ones who then turn notifications off at the phone
level never come back.

It is really two checks: a general one ("only approved files may send a push")
and a specific one ("and definitely not these four, they're the firehose"). The
second check reads as the serious backstop — its failure message literally says
*"This is the check that protects delivery reputation."*

**The second check cannot ever fire.** It only looks at files the first check has
already flagged. So the moment someone adds the score file to the approved list —
which is exactly what a person does when a test blocks them and they're trying to
ship — both checks go quiet together. There is no independent objection.

I verified this. I wired a push into the score router and added it to the
approved list: **all four tests passed green.**

The danger isn't malice, it's plausibility. The approved list is designed to be
edited; the file even invites you to add a line to it. Nothing about doing so
signals that you have just disabled the firehose protection as well.

**Fixed.** The firehose check now reads the raw list of every file that sends a
push, and never consults the approved list. Re-running the exact bypass: the
approved-list check passes (the file *is* approved) while the firehose check
fails on its own — which is the whole point. It is no longer waivable by editing
a list; wiring a push into one of those routers now means deleting a test that
explains why not.

A second gap closed alongside it, and it's the one from the original brief: the
approved list had a check that its entries still name real files, and the
firehose list — the more important one — did not. A rename that turned a
forbidden router into a name matching nothing would have left that check passing
forever while protecting nothing. Both lists are now checked for staleness.

### ✅ B. ~~The rule that keeps player names and scores off a public channel is guarded by a test looking at the wrong thing~~ — FIXED

When someone enters a score, the system pings every watching device to say
"something changed on this game" — and deliberately sends **no** actual
information, because that channel is public and unauthenticated. Anyone on the
internet can listen. The apps then re-fetch the real data through the normal
logged-in path. The rule is: that ping must never carry a score, a name, or a
standing.

There is a good test pinning this. But it checks by reading **one specific file
by name** — the original change that set the rule up. Anything that comes along
later and overrides it is invisible to the test.

I verified this too. I added a later change that renamed the channel *and* put a
player's name and score into the public ping. **The test passed green**, because
it was still reading the old file.

Two separate things break silently here: live updating stops working (scores
still save, the board just quietly stops refreshing), and player names and scores
start being broadcast to anyone listening.

**Fixed.** The test now reads *every* database change in the order they're
applied, works out the state the database actually ends up in, and checks that.
The last definition of the emitter wins, and the triggers are reduced through
their creations and deletions rather than being read off one file.

Re-running the same bypass: it now fails three assertions and the message names
the offending file. I also checked a second failure the old version couldn't see
at all — a later change that quietly *deletes* one of the triggers, which would
stop the board updating on score entry — and that now fails too.

The underlying lesson is the same as A: **a check that reads a snapshot of the
past cannot protect a rule about the present.**

### ✅ C. ~~No style rule is enforced by anything, anywhere~~ — PARTLY FIXED

"Never use a raw colour value" is stated in the project instructions and in the
style guide. There is no test for it, and **the linter does not run in CI at
all** — only type-checking and tests do. There are around 823 raw colour values
in the code today.

Most are legitimate (team colours are deliberately outside the system, and test
files account for many). The point isn't that the code is bad — it's that this
rule has no way of being true or false. It's a preference, presented as a
prohibition.

The style guide's own clean-up list has decayed to match: it names three files
that **no longer exist**, and says a particular colour is hardcoded "in 17+
places" when it is now in exactly two.

**The linter now runs in CI, and the backlog was the surprise.** The instruction
was to treat surfacing the backlog as the point rather than the cost — and there
is no backlog. Of 198 errors, **every single one is in the `design/` mockup
folder**; product code has **zero errors and zero warnings**. Those files are
standalone design explorations that reference illustrative components which were
never meant to exist, so linting them with the app's React rules produces 198
copies of the same non-fact. They're excluded; everything else is now gated, at
`--max-warnings 0` so the line holds.

Turning the linter on cost nothing, which is worth knowing: the reason it wasn't
running was never that the code couldn't pass.

**What this does NOT fix, and I want to be exact about it:** the linter enforces
the rules it is *configured* with. There is still **no rule against raw colour
values** — so the specific prohibition that motivated this ("never hardcode a
colour") remains unenforced. Writing one is a separate piece of work, and it is
blocked on a decision rather than on effort: a colour rule needs an exemptions
list, and whether the marketing pages are exempt is still open (§7 Q5). Building
it now would mean guessing the answer and encoding the guess — which is the
failure mode this whole audit is about.

The excluded `design/` files also say nothing about whether the design *rules*
in that folder are live. That's still open (§7 Q4), and the exclusion is
commented to say so.

### 🟠 D. Three signals must move together or people stop seeing their own games — now written down, still untested

There is an invariant where three separate flags on a game must always agree. If
any one moves without the others, ordinary members stop being able to see a game
they're in. It was written down in one place — a backlog document, under a
heading about deferred work — and there is no test for it.

This is the most consequential rule I found that had **no permanent home at all**.
Someone reorganising that document would reasonably have deleted the paragraph.

**Moved to the project instructions**, and in the process I checked it against
the code rather than copying the claim across — which turned out to matter,
because the real mechanism is sharper than the note suggested. Two of the three
flags are read a few lines apart in the *same* piece of code: one decides whether
a member is allowed in at all, the other decides whether they're told the
pairings are announced. So there are two distinct silent failures, not one — a
live game that reads as "not announced yet", or members refused outright while
the game looks fine to organisers. The third flag controls whether a score can be
written, so getting *that* one out of step lets a member see a game they can't
enter a score into.

All three writes in the code today are correct and set all three flags in one
go. The exposure is entirely in what gets added next.

**Still no test.** The mechanism is now documented precisely enough to write
one, which is the part that was missing.

### What's fine

The other guard tests are genuinely good, and several are better than typical.
Most check that they actually found files to scan before passing — the failure
mode where a test quietly checks nothing. Section 2 lists them.

---

# 2 · Rules that are still right and still protected

Each of these I broke on purpose, confirmed the build went red, and restored.

| # | The rule, in plain language | What it protects | Still holds? | Verified | Matters | Reference |
|---|---|---|---|---|---|---|
| 1 | Only four named files are allowed to send a push notification | Stops any write in the app quietly becoming a notification source | Yes | ✅ Broke it → red | **High** | `pushCallSites.guard.test.ts` |
| 2 | Trip pages must not each work out which trip they're on — one place does it and the rest ask it | Six pages had copied the same logic and a seventh forgot, so a whole tab showed "nothing here yet" for real trips | Yes | ✅ Broke it → red | **High** | `TripIdProvider.test.ts` |
| 3 | The old short-name-in-the-URL system stays deleted | It was removed once, incompletely, and the app drifted back onto the leftovers. This fails the build if the word reappears | Yes | ✅ Broke it → red | Medium | same file |
| 4 | Never glue a web address directly onto a value someone else supplied | A leading `@` turns the rest into the real destination — a link that looks like the app and isn't. This is a real attack, not a theory | Yes | ✅ Broke it → red | **High** | `originConcat.guard.test.ts` |
| 5 | When a game is being finalised, a failure to save the result must be loud | Otherwise a game is marked finished with no result recorded — worse than not finishing | Yes | ✅ Broke it → red | **High** | `writeGameResults.guard.test.ts` |
| 6 | The top bar must always be handed the user's team colour | It's an optional detail, so nothing complains if it's missing — the colour silently vanished for weeks once | Yes | ✅ Broke it → red | Low | `TopNav.avatarTeamColor.test.ts` |
| 7 | Only one place may set the refresh behaviour for the trip list | Several screens share one cached list; a second opinion silently changes how fresh it is everywhere else | Yes | ✅ Broke it → red | Medium | `tripsListCachePolicy.test.ts` |
| 8 | The sign-in gate must keep covering the app's data route, and must keep answering the way the app expects | Getting this wrong logs people out mid-round. Excluding that route was tried once and is called out as the one thing not to do | Yes | ✅ Broke it → red | **High** | `botPaths.test.ts` |
| 9 | Every new setting on a game must be included in the fingerprint that tells other phones something changed | This has failed silently four separate times. Once it went unnoticed for six weeks, disabling cross-device sync entirely | Yes | ✅ Broke it → red *(against the live database)* | **High** | `configHash.coverage.test.ts` |
| 10 | Opening a different game must genuinely start a fresh screen | Without it the app reuses the old screen, and scores typed for one game save onto another | Yes | ✅ Broke it → red | **High** | `gamePanelView.test.tsx` |
| 11 | The unsaved-changes check must actually be wired up, not just exist | A correct rule nobody calls protects nothing | Yes | ✅ Broke it → red | Medium | `configDraft.test.ts` |

**A note on #9.** This is the strongest guard in the project and worth copying
elsewhere. It doesn't ask a human to remember to add new settings to a list — it
reads the database's actual columns and fails if any one of them is neither
included nor explicitly excused. It cannot go stale, because the database tells
it what exists.

**Two things I did not break, and why.** The library-contract test
(`hydrationTransport.test.ts`) pins the behaviour of an outside dependency, not
this project's code — there is no change anyone here could make that it would
catch. It is an early-warning system for a dependency upgrade, which is useful,
but it is not a guard on anyone's behaviour. And the hand-written settings
checklist (`games.saveConfig.p2.test.ts`) I verified only indirectly, through #9
above, which is its automatic backstop.

---

# 3 · Rules that are still right but nothing enforces them

These are all correct. None would be noticed if broken.

### 3.1 ~~The two that look protected but aren't~~ — both now protected

These were the dangerous ones, because everyone reasonably assumed they were
covered. Both are fixed; the entries stay because the *shape* of the mistake is
worth recognising again.

| The rule | Was | Now | Matters |
|---|---|---|---|
| **Never send a notification when someone enters a score** | Nothing would catch it. Verified: with a push wired into score entry *and* added to the approved list, all four tests passed | ✅ The firehose check reads every sending file directly and ignores the approved list. Same bypass now fails, and a stale entry in either list fails too | **High** |
| **Never put a score, a name, or a standing in the live-update ping** | Nothing, if the change arrived as a later override. Verified green with a player name and score in a public payload | ✅ Reads the effective state across every database change. Same bypass now fails on three assertions and names the file; a deleted trigger fails too | **High** |

**The one sentence worth keeping from both.** They were the same underlying
mistake: **a check that inherits its input from the thing it is supposed to be
double-checking.** One took its input from the list it was backstopping; the
other took its input from a moment in the past. Neither was a weak assertion —
both were strong assertions pointed at the wrong data. That's what makes this
class hard to spot in review: the test *looks* rigorous, and it is, about
something other than what it claims.

### 3.2 The coverage gap with a live example

The rule that trip screens must not each work out which trip they're on has a
test (§2, #2) — but it only looks in **three folders**. Trip-related code also
lives in at least two others.

I confirmed both halves: the same violation fails the build inside a watched
folder and **passes silently** outside one. And there is already a real instance
in the blind spot — the feedback dialog reads the trip directly today.

That one instance is arguably harmless (it reads the value to label a bug report,
not to fetch anything). The problem is that the test's name promises more than it
delivers, so nobody has reason to look.

**Matters: Medium.** Nothing is broken now; the guard is simply narrower than it
reads.

### 3.3 Rules with no enforcement at all

| The rule | What it protects | If broken, would anyone find out? | Matters |
|---|---|---|---|
| Three signals on a game must always move together | Ordinary members stop seeing a game they're playing in | No — still no test. But it now lives in the project instructions rather than a backlog document (§1D) | **High** |
| Score tables must stay out of the live-updates feed | Keeps the database from shipping whole rows of scores over the wire; the whole design depends on it | No — the protection is two paragraphs of comment | **High** |
| Who typed a score is a record, never a permission | Deliberate product decision: anyone in your group can write down scores, so a foursome isn't four people on four phones | No test — but it's now in the **permissions document**, where a permission rule belongs, instead of one marked stale | Medium |
| Never use a raw colour value | Light and dark mode both stay correct | Still no. The linter now runs in CI, but **there is no rule against raw colours** — see §1C for why writing one is blocked on §7 Q5 | Medium |
| Score entry is always a fixed width and never stretches | A designed screen; stretching it breaks the layout on real phones | No | Low |
| Buttons that do something destructive always confirm first | Someone deletes a competition with one tap | No | Medium |
| Never re-add the abandoned-game concept | It was invented by mistake and removed at the root | No — but it's stated in both the code and the database change, so it's hard to miss | Low |
| The scorecard icon is the same one everywhere | Consistency | No | Low |
| No notification bypasses someone's preferences | Someone who muted a category gets notified anyway — the fastest route to a permanent opt-out | No, for a *new* send path. The existing paths are correct | **High** |
| The service worker must never cache anything | A stale version of the app sticks on thirty phones with no way to clear it | No | **High** |
| Never add a date library — extend the existing helpers | Dependency discipline | No | Low |
| The private key for notifications must never be imported by anything the browser sees | It would be published to every visitor | No — comment only | **High** |
| Team text colour is calculated once, centrally, never chosen per place | Unreadable text on some team colours | No. One place picks a fixed foreground on a team-coloured fill today | Low |
| The five- and twenty-second background refreshes are deliberate backups — don't remove them as redundant | They cover a dropped connection, a backgrounded phone, a handoff on a golf course. Removing them makes the app fine in the office and broken at the event | No | **High** |

**On the last one.** This is the rule I'd expect to be broken first, because it
looks like dead weight. Live updating works, so the periodic refresh appears
redundant — and it is, right up until the connection drops, which on a golf
course is normal rather than exceptional. It's stated clearly in three places;
it just has nothing enforcing it.

---

# 4 · Rules that no longer apply

| The rule | What changed | What to do |
|---|---|---|
| **"That colour is hardcoded in 17+ places — every instance must be migrated"** | It's in **two** places now | Update the number, or close the item |
| **The style guide's clean-up list** | Of the files it names, **three no longer exist**; several other entries are already done | The list is now more wrong than right — worth pruning |
| **"Every screen gets its own end-to-end test"** | Already retired in the project instructions, honestly labelled as "aspirational and unmet" | Nothing — this is how it should be done |
| **The description of one notification category** | It says the category "defaults OFF and carries an in-context bell toggle." It defaults **ON**, and the bell **was removed**. The correct explanation sits ten lines above it in the same file | Small but worth fixing — it's the file that calls itself the single source of truth, contradicting itself |
| **"There are 23 owner-only permission checks"** | There are **14**. The figure describes the state before a batch of them were moved | The count of *outstanding* items (10) is still right — only the headline is stale. Notable because this passage exists specifically to correct earlier bad arithmetic, and has now drifted a third time |

**None of these is harmful.** They're all the same kind of decay: a specific
number or file list written into a document that then kept moving. Worth noting
that every one of them is a *count* or a *path* — the two things that go stale
fastest and the two things a person can't verify by reading.

---

# 5 · Rules where I couldn't tell

| The rule | What I'd need to know |
|---|---|
| **Ten permission gaps each "blocked by a specific reason"** | Whether the reasons still hold is a question about intent, not code. The document is unusually careful here — it lists each one with its blocker, and records that two attempts to fix them were reverted, the second with evidence. I have no reason to doubt it. But "is this still blocked?" needs someone who knows what's planned |
| **Whether the feedback dialog reading the trip directly is a violation** | Depends what "trip-scoped" means. It reads the value to label a bug report, not to fetch trip data — closer to the one case already excused than to the bug the rule came from. A judgement call, not a fact |
| **Whether the design folder's rules are live** | The repo's own audit lists that folder as superseded, but it contains what reads as a current design system alongside two genuinely expired handoffs. Same folder, two different lifespans. See §6 |
| **Whether the marketing pages should keep raw colour values** | The design notes say explicitly not to unify them; the style guide says every raw colour must be migrated. Two documents, opposite instructions, both current-looking. Nobody has broken anything — but whoever gets there first will follow one and be wrong |

---

# 6 · Rules that exist only in old specs and were never written down

These live in documents that could reasonably be deleted or reorganised. Ordered
by what would actually be lost.

### High — would cause a real problem

| The rule | Where it lives now | Why it matters |
|---|---|---|
| ✅ **Three signals on a game must move together** | **Moved** to the project instructions (`CLAUDE.md` #25), with the concrete failure modes worked out from the code rather than copied across | Members stop seeing games they're in. Silent, and no type checking or test catches it. **Was the single most valuable homeless rule here** |
| ✅ **Who typed a score is never a permission check** | **Moved** to `PERMISSIONS.md`, per Zach's instruction that a permission rule belongs in the permissions document | Someone tightening score entry "for integrity" would undo a deliberate product decision — that a foursome shouldn't need four phones out. Verified before moving: the column is only ever written, never read by any gate or policy |
| **Scores are always stored raw; the adjusted number is worked out on the fly, never saved** | Same stale document | Storing the adjusted number would make later corrections wrong in ways that are very hard to unpick |
| **The marketing pages deliberately keep raw colours — don't unify them** | Design notes | Directly contradicted by the style guide. See §5 |

### Medium — would cause avoidable rework

| The rule | Where it lives now |
|---|---|
| One game format's pairings are chosen deliberately and must not be made automatic like another's | Format design document — which self-describes as authoritative and *is* current |
| One format's settlement rules must not be generalised to other formats | Same |
| Dropping a player at the end is done by position, never by name | Same |
| Never assume this project's identifiers look a particular way | Partly in the code |

### Lower — style and voice, but genuinely nowhere

The design notes carry a set of rules about how the product should read and look
that appear in **no permanent document and no test**: no exclamation points, no
marketing-speak, no emoji in the product, system fonts only, no gradients outside
one specific header, sentence case everywhere, and a naming table for form fields
("Cost", not "Amount"; "Date", never "Day").

One of these actively conflicts with the style guide: the design notes say
**three** levels of stacked panels maximum, and the style guide defines **four**.

**Why this cluster matters more than it looks.** The style guide covers colours,
buttons and spacing thoroughly. It says nothing about words. So the entire voice
of the product — the thing a person actually reads — rests on one file in a
folder the repo's own audit calls superseded.

### One-off scope fences — safe to lose

For completeness: several "don't build this here" notes are ordinary phase
boundaries and are meant to expire. They name the future work explicitly. No
action needed.

---

# 7 · Questions for Zach

**1–3 and 7 are ANSWERED and done** — kept here with the decision recorded, so
the reasoning survives with the change.

**1. Should the firehose check be independent of the approved list?**
→ **Yes, independent — it shouldn't read the approved list at all.** Done and
proven (§1A). The check is now unwaivable by editing a list.

**2. Should the live-update contract be checked against the whole database
history rather than one named file?**
→ **Current state, not a named file.** Done and proven (§1B), including the
trigger-deletion case the old version couldn't see.

**3. Should the linter run in CI?**
→ **Yes, and treat the surfaced backlog as the point rather than the cost.**
Done — and the backlog in product code turned out to be **zero**, so this cost
nothing (§1C). One thing to flag, because it's stricter than what was asked: I
set it to fail on warnings as well as errors, since the repo was already at zero
of both and a gate that tolerates warnings just accumulates them. Two trivial
unused variables in deferred, unrun test files were cleaned up to get there.
Easy to relax if you'd rather it only blocked on errors.

**Note the limit:** this enforces the rules the linter is *configured* with. The
no-raw-colour rule still doesn't exist, and writing one is blocked on Q5 below —
it needs an exemptions list, and marketing is the open question.

**7. Should the two homeless rules move somewhere permanent?**
→ **Yes, both — and the score one belongs in the permissions document
specifically.** Done. Both were verified against the code before being written
down, and the three-signal one gained a sharper description as a result (§1D).

---

The rest are still open.

**4. Is the design folder live or superseded?**
The repo's audit says superseded; it contains what looks like a current design
system next to two expired handoffs. If the voice-and-tone and form-field rules
are still what you want, they need a permanent home. If they aren't, the folder
should say so.

**5. Marketing pages: raw colours or tokens?**
Two documents currently say opposite things and both look current.

**6. Is appointing a team captain a sixth owner-only exception, or a gap?**
The permissions document raises this itself and calls it a product decision
rather than a code one. It's still open.

**8. Should the three-signal invariant get a test?** (New, arising from the fix.)
It's now documented precisely enough to write one, but it doesn't have one, and
it's the highest-consequence unenforced rule left. The natural shape is a guard
that fails if any write touches one of the three columns without the other two —
the same source-scanning approach the other guards use.

---

## Appendix — what I did

- Read every prohibition in the project instructions, the permissions document,
  the notifications document and the style guide.
- Swept all source, database changes, and configuration for comments that forbid
  something — around 98 distinct ones, grouped in §3 and §6.
- Searched every planning, spec and audit document for rules with no permanent
  home.
- **Broke 11 of the 13 build-failing guard tests on purpose, confirmed each went
  red, and restored it.** Two were not broken, for the reasons given at the end
  of §2.
- Additionally proved two *negative* results — a violation that the guards do
  **not** catch — by constructing the bypass and watching the suite stay green
  (§1A, §1B). Both artefacts were removed.
- Ran the full suite afterwards: **178 files, 1979 tests, all passing.** Working
  tree clean.

**The audit itself changed no code.** The fixes in §1A–D came afterwards, as a
separate directed piece of work in the same pull request, and each was proven by
re-running the exact bypass that had previously passed green.
