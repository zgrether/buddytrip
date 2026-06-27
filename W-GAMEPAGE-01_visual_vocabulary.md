# W-GAMEPAGE-01 — Visual vocabulary (game config page)

**Status:** design-settled this pass. **This is appearance; the lifecycle doc
(`W-GAMEPAGE-01_game_page_lifecycle.md`) is structure/behavior.** Read both together.
**Source:** Zach's FigJam mocks + this design session. **Dark mode only** (the app is dark-default;
light is reserved for future outdoor mode).
**Feeds:** (1) `STYLE_GUIDE.md` additions (the new component patterns), (2) design-doc §6.x copy/state
updates, (3) the eventual **visual-pass CC spec** (phased — touches many components, not one PR), and
(4) phase (d)'s new surfaces, which should be built against this so they don't need a second skin pass.

**Token rule (binding, from CLAUDE.md/STYLE_GUIDE):** everything below is expressed in `--color-bt-*`
tokens. The hex in the design mocks was for standalone rendering only — **never hardcode hex in
implementation.** The dark values referenced map to existing tokens (no new color tokens needed):
base→`--color-bt-base`, card→`--color-bt-card`, raised→`--color-bt-card-raised`,
border→`--color-bt-border`, text→`--color-bt-text`, dim→`--color-bt-text-dim`,
accent(teal)→`--color-bt-accent`, danger→`--color-bt-danger`.

---

## 1. Principles (the discipline that emerged this pass)

1. **The icon persists; resolution adds a badge.** A resolved row keeps its type-icon and gains a small
   teal check overlay — it never swaps the icon out for a check. Rows stay identifiable in any state
   (critical in a mostly-collapsed accordion).
2. **Teal means something, always.** Teal is reserved for: the check badge (done), the active-selection
   outline (live choice), and live computed values (the points total). **Never** captions, helper text,
   default icon color, or required markers. Teal earns meaning by being rare. *(This was corrected
   repeatedly — over-teal is the default mistake.)*
3. **Show the control when live; summarize when not.** No dead/greyed controls reserved "just in case"
   (e.g. no stepper under an Even match).
4. **Reuse primitives — match, don't reinvent.** The stepper and avatars already exist; adopt their
   exact look, don't draw new ones.
5. **Copy is Zach's exact wording.** Placeholders are flagged as such.

---

## 2. Row anatomy

`icon │ (large title / small subtitle) │ [trailing: chevron, inline control, or check]`

- **Title:** ~16.5px, weight 500, `--color-bt-text`. The game-type or row name.
- **Subtitle:** ~12.5px, `--color-bt-text-dim`. A status line, not a value-eyebrow.
- **NOT** the old caps-eyebrow-over-value pattern (that's the current app being replaced).
- Two states only: **empty (dashed)** and **resolved (solid + check)**. There is no "in progress"
  state — it didn't earn its place.

---

## 3. Icon set

Each config row carries one semantic icon. Production is `lucide-react`, one consistent size + stroke
weight across all rows (single-set/single-weight discipline is half of "consistency").

| Row | Lucide (prod) | Tabler (mock) | Notes |
|---|---|---|---|
| Matches | `Swords` | `ti-swords` | head-to-head |
| Points | `Hash` | `ti-hash` | (was Trophy — rejected; Trophy is reserved for higher-level competition branding) |
| Course / Tee | `Flag` | `ti-flag` | the pin |
| Handicaps | `SlidersHorizontal` | `ti-adjustments-horizontal` | strokes = adjustment |
| Modifiers | `Sparkles` | `ti-sparkles` | special extras |

- Icon color: `--color-bt-text` (white) when active/resolved; `--color-bt-text-dim` (muted) when empty.
- **Check badge:** small circle, `--color-bt-accent` fill, dark check glyph, overlaid bottom-right of
  the icon, with a 2px ring in the row's surface color so it reads as a badge.

---

## 4. State treatments

| State | When | Border | Surface | Icon | Check |
|---|---|---|---|---|---|
| **Empty (dashed)** | required-and-unsatisfied, or optional-and-untouched | 1.5px **dashed** `--color-bt-border` | transparent | muted | none |
| **Resolved** | satisfied / has a value | 0.5px solid `--color-bt-border` | `--color-bt-card` | white | teal badge |
| **Invalid** | Matches mid-build (empty slot) | red (`--color-bt-danger` family) | — | — | red-X, not check |

Invalid is the §6.1 hard-block state (a match with an empty player slot) — a separate error treatment,
not part of the empty/resolved pair.

---

## 5. Exact copy (per row — verbatim, both states)

| Row | Empty (large / small) | Resolved (large / small) | Flip trigger |
|---|---|---|---|
| Matches | `1-on-1 Matches` / `0 matches assigned` | `1-on-1 Matches` / `x of y matches assigned` | as matches fill (title is the game-type name; varies by format) |
| Points | `Points Per Match` / `Total Points Available: 0` | `Points Per Match` / `Total Points Available: N` | per-match > 0 (the `N` is teal — live computed value) |
| Course | `No Golf Course` / `Handicaps disabled` | `Golf Course Selected` / `Handicaps enabled` | course confirmed |
| Handicaps | `Handicaps` / `No handicaps assigned` | `Handicaps` / `Handicaps assigned` | anyone receives strokes |
| Modifiers | `Game Modifiers` / `No modifiers added to your round yet` | `Game Modifiers` / `Modifiers have been added` | a modifier selected |

Note: the Course subtitle reports the **handicaps gate** (course gates handicaps), not the course name.

---

## 6. Stepper primitive (shared)

The existing component — **match it, don't redraw**:
- Buttons: **no background** (transparent), thin border (`--color-bt-border`), rounded-square (~9px),
  muted `−`/`+` glyphs. **Not filled circles.**
- Number: **bold (700)**, `--color-bt-text`.
- Optional small caps label beneath (`--color-bt-text-dim`).

Three densities, one component:
- **Full** — centered, ~40px buttons / ~25px number. Used in the expanded Handicaps strokes control.
- **Compact** — ~30px buttons / ~18px number. Used in the Modifier card.
- **Inline** — right-justified on the Points row (see §7).

`−` is disabled-styled at the floor (can't go below 0 / 1).

---

## 7. Points row (special — does not expand)

- **Inline right-justified stepper; no accordion expansion.** A single number has nothing to expand
  into, so the stepper lives on the row itself, right-justified. **No chevron.**
- **Never participates in the single-open accordion slot** (like the players-readout exemption in §9 of
  the lifecycle doc).
- **Dashed/empty at 0** — same empty treatment as other unsatisfied rows; the inline stepper stays live
  so `+` lifts it out of empty. `−` disabled at 0.
- **> 0 to be done:** first increment → solid, white icon, teal check, total recomputes. **Points > 0 is
  required to Enable scoring** (joins the spine gate, §7 of the lifecycle doc).
- **Competition-format picker REMOVED from this row** (Zach's call — "this isn't the place for it"). The
  row is points-only. *(Open: where format/"how's it played?" now lives — confirm for §6.2.)*

---

## 8. Handicaps — segmented selector (1v1 match play)

- **Match number on the LEFT** (a small left gutter, like the matches design). The per-row
  `MATCH # · WHO GETS STROKES?` header is **removed** — the control answers it, repeating it five times
  wasted vertical space.
- **Segmented control:** `[avatar + Player A] │ [Even] │ [avatar + Player B]`. Even segment is narrow,
  no avatar; player segments carry the team avatar (§11).
- **Selected = outline, not fill.** Active segment gets a teal border; **no solid teal fill** (solid
  fill fights the avatar colors and muddies them).
- **Even selected →** no stepper rendered, just a muted caption "Even match — no strokes given".
- **Side selected →** the centered full stepper reveals, with a **muted** caption naming the recipient:
  "{Player} gets strokes on holes 1, 2, 3" (names the recipient so the centered stepper isn't
  ambiguous; **not teal**).
- **Even matches = one line; stroked matches = two lines.** Massive vertical savings vs. the current
  match-play handicaps screen.

---

## 9. Handicaps — three models, forked by format

The Handicaps row renders a **different layout per format**. The lifecycle doc §6.4 currently describes
only the side selector — it needs the other two added.

1. **Per-player strokes list** — stroke play + rack-n-stack. A flat list: `avatar + name │ [−] SCR [+]`
   (SCR = scratch / 0). **This already exists and looks right — adopt as the standard; the match-play
   selector borrows its avatars, fonts, and buttons.**
2. **Per-match side selector** — 1v1 match play (§8 above).
3. **Per-individual-within-match** — 2v2 best ball. **DEFERRED — not built.** In best ball you stroke a
   specific person (e.g. just Buddy vs Steve), not a whole side, so the side selector can't express it.
   Offline workaround is acceptable for now (BBMI Saturday is 1v1). Logged to `DEFERRED.md`.

---

## 10. Modifier card

- `checkbox │ (title / description) │ [optional compact stepper]`.
- **Checkbox:** teal fill + dark check when on; bordered/empty when off.
- **`glorious_holes`:** + compact hole-count stepper (default 3).
- **`moving_tees`:** checkbox only.
- **Copy: use the mock's wording verbatim** ("We suggest making the last 3 holes worth double…" /
  "Score well and everyone else will appreciate you moving back a tee…"). **Do NOT add any
  "not auto-scored yet / config-only" disclaimer** — a stale disclaimer someone forgets to remove when
  scoring logic lands is worse than none.
- Data/registry behavior is unchanged from #469 (snake_case keys, presence-model jsonb,
  `compatibleModifiers` from `gameTypes.ts`, hide-row-when-none).

---

## 11. Avatars

- **Team-colored circles with initials** — red (Rhinos), purple (Phoenix). One avatar component used
  everywhere: rows, segments, the per-player list.
- **🐞 BUG to file:** Zach's own avatar renders as the crossed-clubs glyph instead of his team avatar in
  the in-match render path — the avatar refactor missed this case. In this vocabulary there is **no
  special per-user avatar** in the config context; always the team-colored initial.

---

## 12. Surfaces, spacing, zones

- **Row:** `--color-bt-card`, 0.5px `--color-bt-border`, 12px radius, ~13px/14px padding.
- **Empty row:** transparent, 1.5px **dashed** `--color-bt-border`.
- **Icon container:** ~38px, ~10px radius, `--color-bt-card-raised` (transparent when empty).
- **Zone labels** ("settings" / "options"): small, letter-spaced, uppercase, `--color-bt-text-dim`
  (muted) — organizational labels, not panes (it's one scrolling column).
- **Required marker:** red dot (`--color-bt-danger`), never teal.

---

## 13. What this changes in the existing docs

**`STYLE_GUIDE.md` — add component patterns:** the config-row (large-title/subtitle + icon + check
badge), the empty/dashed vs resolved states, the stepper (no-bg squares + bold number, three
densities), the segmented stroke selector (outline-selected), the modifier card, the avatar component.
Note teal-reservation rule explicitly.

**`W-GAMEPAGE-01_game_page_lifecycle.md`:**
- §6.1–§6.5: replace any eyebrow/value copy with the §5 exact copy + state transitions here.
- §6.2 Points: inline right-justified stepper, no expansion, > 0 required, **format picker removed**.
- §6.4 Handicaps: add the **three models** (§9) — only the side selector is currently documented.
- §9 accordion: **Points is exempt** (inline, never opens/closes the slot).

---

## 14. Deferred / bugs / open, surfaced this pass

| Item | Where it goes |
|---|---|
| Zach's avatar = crossed-clubs (not team) | **File a bug** — avatar refactor missed the in-match path |
| 2v2 per-individual handicaps model | `DEFERRED.md` |
| Per-player handicaps variant (image 1) not documented | design-doc §6.4 update (above) |
| Modifier card final copy | **RESOLVED** — mock copy verbatim now; revisit when modifier scoring logic ships |
| Competition-format control | **RESOLVED** — *not needed on the golf game page.* Only non-golf formats use it, and they have no logic yet (manual points-awarding only). Out of scope for this surface. |
| Switch subsumes the "Enable scoring" button | **(d) Phase 0 input.** §7 of the lifecycle doc still says "button" while §3/§5 say "switch" — they are **one control** (first flip enables scoring when the spine is green; later flips toggle pause). The bottom button goes away when Zone 2 populates in (d). Doc-sync merged without this note — carry it into W-BACKNAV-01 Phase 0. |
| Scorecard: per-nine yardages for all tees | **(d)/scorecard Phase 0 check** — verify `setBackNine` retains them (§16) |

---

## 15. Coverage (honest state of this pass)

**Settled:** icon set + state language, row anatomy + exact copy, the stepper primitive, the Points row
(inline), the Handicaps 1v1 segmented selector, the Modifier card structure, avatars, surfaces/tokens.

**Not yet fully styled (do before the visual-pass build spec):**
- **Course staged-picker chrome** — the §10 search-flow UI (recents/filter/results/manual) re-styled to
  this vocabulary; only the row subtitle copy is settled.
- **Per-player strokes list** — adopt image 1 as-is; confirm it already matches these tokens.
- **Modifier expanded cards** — final copy from the mock (the copy pass).

**Implementation note:** this is the design reference, **not a build spec**. The visual pass will be
specced from it and **phased** (it spans many components — not one PR), the same way W-GAMEPAGE-01 was.
Phase (d) builds its new surfaces against this so they're styled from birth.

---

## 16. Scorecard provenance header + multi-tee rows (course chrome)

The score-entry scorecard is reused read-only as the "view scorecard" affordance on the confirmed-course
state. The existing component already renders a composed 18 as one continuous 1–18 card with the OUT/IN
split at the seam (correct default) — but it lacks course/tee provenance and shows only one tee. Add both.

**Header forks by round type:**
- **Single course →** single band: course name (tees now live in rows, not the band).
- **Composed 18 (two 9-hole courses) →** **split band:** front course name over holes 1–9, back course
  name over holes 10–18, aligned to the OUT/IN seam. (A single band can't name both courses.)

**Multi-tee rows (DECIDED):** show every tee box as its own yardage row, color-marked by tee, instead of
a single YARDS row. Serves the real case — a foursome playing different tees.
- **Tees are consistent across the nines.** Real composed 18s are multi-nine facilities (Brigantine /
  Clipper / Galleon) where the same tee names run on every nine — so a tee row composes naturally from
  front + back, exactly like the single yardage row does today. The mismatched-tee-set case (different
  tee names per nine) is not a real course; **do not design for it.**
- **Zebra striping** on tee rows — a real surface-value alternation (not a faint overlay), so stacked
  tees stay scannable.
- **Chosen tee highlighted:** the round's actual playing tee (the one driving score-entry yardage,
  persisted with the game) gets the teal-fill + bold + teal label-edge treatment. Teal = "the live/real
  one," consistent with its meaning everywhere else. Rows stay in tee-length order; the chosen tee does
  **not** reorder to the top.
- **Filter is view-only.** Chips toggle which tee rows are visible — pure decluttering, never changes the
  chosen tee. The **chosen tee is un-hideable** (foot-gun guard: hiding your own playing tee is never the
  goal); its chip reads as locked-on/checked.

**Honest blanks:** a nine whose course lacks yardage data shows blank yard cells under a correctly-named
course/tee — never invented numbers (same `CourseService` graceful-fallback principle).

**🚩 Data check (Phase 0, plumbing not design):** the composed object must **retain per-nine yardages for
every tee**, not just the chosen tee (the single-row scorecard only needed the chosen one). Confirm
`setBackNine` (#465) carries all tees' yardages through from both nines; if it kept only the selected
tee, that's a small carry-through add. No design fork remains — this is a verify-then-build.

**Tee-selector chip** (the one genuinely new course-chrome component): outline-selected, per the
outline-not-fill rule. Justified independently (yardage must display on the score-entry pages) and also
the UI seed for future moving-tee-boxes (logged in `DEFERRED.md`; **not** a current-path item).

**Out of scope for course chrome (tracked separately):** the picker *workflow* cleanup (clunky selection
mechanics — its own small CC spec) and the picker *slowness* (golfapi.io latency — its own W-PERF-style
pass).

**Scope note:** multi-tee rows + filter is a defined scorecard enhancement. It can ship with the course
chrome or as its own slice, but it is **not** blocked on a design decision anymore — only the per-nine
yardage carry-through check.
