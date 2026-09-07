# Light mode — the survey

**Question asked:** not "does light mode work", but "how many surfaces bypass the
token system". **Cup first**, because that is where the answer matters.

**Method.** Every number below is *derived*, never hand-maintained — this follows
`STYLE_GUIDE.md` §7's own rule, which replaced a path-and-count list because it
had rotted in both directions. Two independent instruments were used, and the
second is the one that carries the findings:

1. **Static.** A comment-stripped scan of non-test `src/`, classified by literal
   family and by area. Re-derive with §7's own grep:
   `grep -rEn "#[0-9a-fA-F]{6}\b" src --include=*.tsx --include=*.ts | grep -v "\.test\."`
2. **Live.** The app run in light mode with an in-page probe that composites each
   element's colour against the opaque surface behind it and reports what actually
   reaches the screen. This is what separates "bypasses a token" from "is
   invisible", and the two lists are **not** the same list.

**Reached live and measured:** dashboard, account menu, Quick Stroke Play setup /
score entry / scorecard, Quick Match Play setup / match card / score entry. Under
`CLAUDE.md` Enforced Pattern #7 those score-entry and scorecard components are the
*same components* the Cup game surfaces use, so the measurements transfer.
**Not reached live:** competition leaderboard, competition hero, pick'em's three
tabs — the local database has no seeded trip. Those rows are from code, and say so.

---

## The headline

**The token system is complete. The bypasses are few, and they cluster.**

- **Zero** tokens are defined only in `.dark`. All 81 `:root` tokens have a value;
  the 25 without a `.dark` counterpart are each documented as deliberately
  mode-independent (vote colours, domain colours, the overlay-row wash).
- **Zero** Tailwind `dark:` variants anywhere in `src/`. The whole app themes
  through CSS custom properties, which is why this list is short.
- `CompetitionLeaderboard.tsx`, `CompetitionFace.tsx` and `GameRow.tsx` — the
  board itself, the surface read most on a course — contain **zero** raw colour
  literals.

**Nine surfaces are actually broken in light mode, seven of them Cup.** Everything
else that "bypasses a token" is cosmetically wrong and visually fine.

**And separately: ordinary light mode probably does not solve the stated problem.**
See the last section — that is a token-*value* question, not a bypass, and it is
the one that decides whether this is the answer or the first step.

---

## The list

`Cup` = `src/components/{games,competition}/`. `Trip` = `src/app/trips/`.
`Shared` = shell, nav, news, profile — appears on both.

### Broken — the thing on screen is wrong, not just off-token

| # | surface | what bypasses | Cup or Trip | evidence |
|---|---|---|---|---|
| 1 | **Scorecard + score-entry score colours** — `golfScore.ts` `GOLF_STYLE.*.fg` | Eagle/birdie/bogey/double numbers are fixed dark-mode pastels (`#fcd34d`, `#fca5a5`, `#93c5fd`, `#c4b5fd`). `par` alone uses `var(--color-bt-text)`. | **Cup** | **measured live: 1.23–1.61 : 1** on the light card. Every score except par. |
| 2 | **Match card identity bars / 18-segment history** — `MatchCard.tsx:27-29` | `NEU_WON_L = "#eaeef4"` (bright), `NEU_WON_R = "#566275"` (dark), `NEU_HALF = "#8c97a8"`. The ramp encodes *who won* as **light-vs-dark value**, which assumes a dark card. | **Cup** | **The polarity inverts — measured live in both themes on the same screen.** See the table below. In light, the left side's bar is simply absent while the right side's is strong; the two sides of a no-team match are not equally visible. |
| 3 | **Scorecard OUT / IN / subtotal columns** — `StandardGrid.tsx:1254,1291,1326,1348`, `OutcomeScorecard.tsx:272` | `rgba(255,255,255,0.025)` column tint. | **Cup** | **measured live: 15 elements, composite delta 0.0–0.58/255 — a no-op.** The OUT/IN/TOTAL separation vanishes. **This contradicts `STYLE_GUIDE.md:473`, which specifies `rgba(0,0,0,0.025)` light / `rgba(255,255,255,0.025)` dark** — see *Code vs documentation* below. |
| 4 | **Competition hero — the settings gear** — `CompetitionHero.tsx:272` | `color: "rgba(241,245,249,0.6)"` — the *dark* theme's text colour at 60%, on a card that is `var(--color-bt-card)` = `#ffffff` in light. | **Cup** | arithmetic: composites to `rgb(247,249,251)` — **1.06 : 1**. The gear is invisible. A functional loss, not cosmetic. *(From code — not reached live.)* |
| 5 | **Competition hero card — points cup / half-built cup** — `CompetitionHero.tsx:43,215,612` | `NEUTRAL_CARD = "linear-gradient(158deg,#222e44,#1a2231)"`, a hardcoded dark gradient, while the text on it is `var(--color-bt-text)`. | **Cup** | near-black text on dark navy. **Only the fallback path** — a two-team cup uses `teamGlow()`, which composites over `var(--color-bt-card)` and is correct in both themes. *(From code.)* |
| 6 | **Scorecard to-par column** — `StandardGrid.tsx:1305` | `diff > 0 ? "#93c5fd" : "#fca5a5"` — same dark pastels as #1. | **Cup** | same family as #1. |
| 7 | **Match number badge / SINGLES–DOUBLES label** — `MatchNumberBadge.tsx:29`, `matchSetup/MatchSetup.tsx:495` | `doubles ? "#c4b5fd" : "#93c5fd"` on a `rgba(…,0.14)` tint. | **Cup** | same family as #1. |
| 8 | **Amber alert glyphs** — `TripHeaderDock.tsx:251,264`, `InfoTileModal.tsx:114`, `HelperCards.tsx:31` | `#fbbf24` hardcoded — that is `--color-bt-warning`'s **dark** value; light is `#d97706`. | Trip / Shared | **1.67 : 1** on white. This is the "amber token inconsistency" the brief mentioned, now located. |
| 9 | **Trip header dock** — `TripHeaderDock.tsx` | **16** `rgba(255,255,255,*)` values in one file — the largest single concentration in the app. | Trip | not measured live; flagged by concentration. |

**#2 in full, because it is the one a player would call a broken app.** The three
constants were measured live on the same Quick Match Play screen, toggled:

| constant | means | on the dark card `rgb(22,30,47)` | on the light card `rgb(255,255,255)` |
|---|---|---|---|
| `NEU_WON_L` `#eaeef4` | left side won | **14.30 : 1** — loud | **1.16 : 1** — gone |
| `NEU_WON_R` `#566275` | right side won | 2.70 : 1 — quiet | **6.18 : 1** — loud |
| `NEU_HALF` `#8c97a8` | halved | 5.64 : 1 | 2.95 : 1 |

This is not a contrast bug that got worse. It is a **semantic encoding that
reverses**: the ramp says "brighter = left, darker = right", and which of those two
is visible depends entirely on what colour the card is. It only applies when there
are no teams (`teams ? lc : NEU_WON_L`) — with teams the bars take the team
colours and are fine. Quick Match Play is always in the no-team case; so is any
competition match played before rosters exist.

### Off-token but visually correct — do not let these inflate the count

| what | count | why it is fine |
|---|---|---|
| `#0d1f1a` written out instead of `var(--color-bt-on-accent)` | **58** (18 Cup, 19 Trip, 15 Shared, 3 lib, 3 marketing) | The token is `#0d1f1a` **in both `:root` and `.dark`** — mode-independent by design. Every one of these renders identically to the token. Verified live: the selected keypad key and the confirm button read correctly in light. **The largest number in this survey is the one that changes nothing.** |
| `rgba(0,0,0,0.5)` scrims | 46 | `--color-bt-overlay` *is* `rgba(0,0,0,0.5)` in light. Identical output. |
| `rgba(0,0,0,0.35–0.45)` box-shadows | ~12 | Heavier than the light `--shadow-*` set, but a shadow that is too strong is not a legibility failure. |
| `--color-bt-overlay-row*`, vote colours, domain colours | 25 tokens | Documented mode-independent in `globals.css` with reasons. Not omissions. |
| Team colours, tee-marker colours, per-player chart colours, email styling, PWA manifest | — | `STYLE_GUIDE.md` §7's exception table, unchanged. |

### Off-token, mild, worth one issue between them

| what | where | effect in light |
|---|---|---|
| `rgba(45,212,191,*)` / `#2dd4bf` — the **dark** teal — as focus rings, selected chips, the scorecard total column | 10 Cup sites (`StandardGrid` ×4, `ScoreEntryView`, `MatchEntryView`, `RelHandicapControl`, `MemberSetupView`, `OutcomeScorecard`, `HoleEditor`) + 5 Shared | teal-400 at low alpha over white is a paler, cooler wash than `--color-bt-accent-faint` (teal-600). The selection cue weakens; it does not disappear. |
| City-pin fill `#00d4aa` | `LocationHero.tsx:123`, `RailTripRow.tsx:215`, `TripCard.tsx:179` | §7 "still open" item 1. **Three sites, not the two §7 says** — see below. |
| `CupTrophy.tsx` (13 literals) + `ClinchCelebration.tsx` | Cup | Gold trophy artwork. Same category as tee-marker colours — a trophy is gold. The `#f6e0a0` glow reads weakly on white; the trophy itself is fine. |

### Not a bypass — but never once executed

Nine `resolvedTheme === "dark"` branches exist, all **Trip-side**, and every one of
them has been unreachable since `forcedTheme="dark"` was set:

```
ArchivedIdeasBrowser · CatalogBrowser · IdeaZonePanel · ExpensesSection
LocationHero · ArchivedIdeasPanel · RailTripRow · TripCard · TripHeader
```

These are theme-*aware* code — the right shape — but untested by construction; the
switch makes them live for the first time. `RailTripRow.tsx:121` uses
`resolvedTheme !== "light"` where the other eight use `=== "dark"`; equivalent
under `enableSystem={false}`, but it is one concept written two ways.

### The class this session created — checked explicitly, and the expectation was wrong

The brief nominated the pick'em result box, the strikethrough, the settled mute,
the amber rails and team colours as "tuned by looking at dark mode only".

**Pick'em is the cleanest directory in the app.** `src/components/games/pickem/` —
25 non-test files — contains **zero** raw colour literals outside one
`rgba(0,0,0,0.5)` modal scrim. More than that, `slateRowVisual.tsx:326-338` and
`PickemSheetRow.tsx:505-522` record *measured light-mode compositing* as the reason
for their current design:

> ```
> light   box rgb(15,23,42)     card border rgb(200,208,218)
> dark    box rgb(241,245,249)  card border rgb(45,54,72)
> ```

The strikethrough and the settled mute are `textDecoration` and `opacity` —
mode-independent by construction. The remaining nomination, **team colours**, is a
real light-mode weakness but not a bypass: a team's colour is identity data, and
`teamTextColor` solves it only for the *fill* case. Where a team colour is used as
**text** on a card (`CompetitionHero.tsx:395`, `MatchCard.tsx:473`) amber `#f59e0b`
and cyan `#06b6d4` sit at 2.15 : 1 and 2.43 : 1 on white. `teams.color_dim` — a set of near-black
tints that only make sense on a dark card — is stored, passed through three routers,
and **rendered nowhere**; it is not a light-mode problem today.

---

## Code vs documentation

Per the brief: quoted, named, and **not resolved**.

**1. `STYLE_GUIDE.md:473` vs `StandardGrid.tsx`.**

> `STYLE_GUIDE.md:473` — "Even: `rgba(0,0,0,0.025)` light / `rgba(255,255,255,0.025)` dark — barely perceptible; scanability only"

> `src/components/games/StandardGrid.tsx:1254` — `background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)"`

The guide specifies a pair; the code implements the dark half only. Same at
`:1291`, `:1326`, `:1348` and `OutcomeScorecard.tsx:272`. **A stale doc is a
cleanup; a drifted implementation is a bug — and these look identical from here.**

**2. The brief's starting point vs `STYLE_GUIDE.md` §7.**

The brief says §7 "already tracks 17+ hardcoded `#00d4aa` instances awaiting
migration". §7 no longer says that, and says so pointedly:

> `STYLE_GUIDE.md:667` — "said a colour was hardcoded 'in 17+ places' when it was in two"

Measured today: `#00d4aa` appears **three** times as a bypass (the three city-pin
fills above), once as the `--color-bt-vote-yes` token definition, and once in a
comment. So the brief is one revision behind §7 — **and §7 is itself one site
behind the code**, since its "still open" item 1 says the pin is drawn in "the two
components", and there are three (`LocationHero`, `RailTripRow`, `TripCard`).
Nothing was changed in either direction.

**3. `src/app/layout.tsx` viewport `themeColor`.**

`themeColor: "#0a0e1a"` is a single dark literal, and the comment beside it said
"the app is dark-mode-forced, so the single dark value is correct". The switch
falsifies the premise. **The comment was updated to state the consequence; the
value was not touched** — a light-mode user gets dark browser chrome above a light
page, and a dark splash before a light first paint on a standalone iOS launch.
Fixing it is not a find-and-replace: a `media`-keyed pair keys off the *OS*, not
off this app's stored theme, so it would be wrong for exactly the person who chose
light against a dark OS.

---

## Would the existing light tokens be readable in daylight?

**Stated separately from whether they render correctly, because the answers differ.
Render: yes. Daylight: partly, and the part that fails is the golf.**

Measured on the live Quick Match Play score-entry screen — every text node, real
composite, real font size:

| contrast band | nodes |
|---|---|
| ≥ 7 : 1 (AAA) | **18** |
| 4.5 – 7 : 1 (AA) | 4 |
| 3 – 4.5 : 1 (AA large only) | 5 |
| < 3 : 1 | 3 |

**The primary layer is already sun-ready.** `--color-bt-text` `#0f172a` on
`--color-bt-card` `#ffffff` is **17.85 : 1** — near-black on near-white, exactly the
prescription. Player names, scores and the keypad digits all sit in the AAA band.

**The secondary layer is the problem, and it is where the golf lives.** Every node
below 4.5 : 1 is `--color-bt-text-dim` (`#64748b`) at 13–15px, and the measured
sample is not decoration:

```
"Par 5 · Hdcp 2"      13px   4.43 : 1
"Hole 2 of 18"        13px   4.43 : 1
"Double"              13px   4.43 : 1
"Alice — Enter score" 13px   4.05 : 1
"AS"  (match status)  15px   2.95 : 1
```

That is the token system working exactly as designed. `STYLE_GUIDE.md:197` already
prescribes `#64748b` "or darker" for light-mode muted text; the code is compliant.

**So my read: light mode is cheap AND insufficient, and the insufficiency is not a
bug list.** Three reasons it will not fully solve the sun problem:

1. **Contrast ratios overstate outdoor performance.** They assume the black level
   *is* black. In direct sun, screen reflectance raises the black floor and
   compresses everything toward it — a 4.4 : 1 pair indoors can collapse toward
   1.5 : 1 under a specular reflection. The AAA band survives that; the 4.0–4.4
   band does not.
2. **The type scale is 10–15px** (`src/lib/typeScale.ts`). Small dim text is the
   first thing to go outdoors, and no colour token fixes a size.
3. **The whole app dims by alpha in places**, which `STYLE_GUIDE.md:197` warns
   against ("Never use opacity to dim text… especially in light mode") — 46
   `rgba(0,0,0,*)` and every `disabled:opacity-40`.

**What a high-contrast theme would actually be** (not built, per the brief — noted
so the switch does not preclude it): `--color-bt-text-dim` collapsed to within a
step of `--color-bt-text`; `--color-bt-border` several steps darker;
`--color-bt-accent` darker than teal-600; and alpha-based dimming replaced by
explicit values. That is a **third set of token values**, roughly a day's work,
and it needs none of the nine repairs above to be done first — which is the
argument for the theme value being a string rather than a boolean.

**Recommendation: ship the switch, fix items 1–5, and treat high-contrast as the
real answer to the sun.** Items 1 and 2 are the ones a player would report as "the
app is broken"; 3–5 are the ones they would report as "it looks wrong".

---

## Reproducing this

```bash
# The static half — STYLE_GUIDE §7's own command.
grep -rEn "#[0-9a-fA-F]{6}\b" src --include=*.tsx --include=*.ts | grep -v "\.test\."

# The live half. Open the app, set light mode, then in the console composite every
# element against the opaque surface behind it. The probe is in the PR description;
# it is the instrument that separates "off-token" from "invisible", and running only
# the grep will produce a list four times too long.
```

---

## Filed

- **#1343** — the dark-only-literal class: eight sites, one fix shape (a light/dark
  pair where there is currently one dark value). Carries the `STYLE_GUIDE.md:473`
  disagreement as a decision for Zach, not a resolution.
- **#1344** — `MatchCard`'s neutral ramp, separately, because it is not a token
  swap: the encoding reverses and the fix is a design call.

Nothing else met `CLAUDE.md`'s entry rule. The 58 `#0d1f1a` sites, the 46 scrims
and the twelve dark shadows are not issues, because there is no version of that
work anybody would pick up — they already render correctly.

The **high-contrast theme** is deliberately not filed. It is strategy, not a
defect, and `CLAUDE.md` says a nomination does not become an issue until it is
about to be worked — that is a `TRACKER.md` entry and Zach's call to make.

---

*Survey run 2026-09-07 against `dfac3956`. Zach's eyes are the instrument that
settles it — where this list and the eye disagree, the eye is right.*
