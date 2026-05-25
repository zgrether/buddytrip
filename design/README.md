# BuddyTrip Design System

> Group trip planning + competition scoring, built for the way friend
> groups actually plan trips. Mobile-first dark UI, deep navy + teal
> accent, system type, lucide iconography.

This design system was reverse-engineered from the production codebase
at **[github.com/zgrether/buddytrip](https://github.com/zgrether/buddytrip)**
(`main` branch). The repo also ships an in-app
[`STYLE_GUIDE.md`](https://github.com/zgrether/buddytrip/blob/main/STYLE_GUIDE.md)
that this system mirrors — that document is the source of truth for token
naming. If you want to do a better job designing for BuddyTrip than the
files in this folder can support, **read both the style guide and the
marketing page CSS** (`src/components/marketing/MarketingPage.tsx`) in
the repo, plus a few core components — `TripHeader`, `TripCard`,
`PlanningRow`, `BottomNav`, `TripTabBar`.

---

## Product context

**BuddyTrip** is a Next.js 15 / Tailwind v4 / Supabase app, deployed at
`buddytrip-app.vercel.app`. One product, two distinct visual surfaces:

| Surface | Files | What it is |
|---|---|---|
| **Marketing page** (`/`) | `src/components/marketing/*` | Public landing for un-authed visitors. Self-contained CSS, raw hex, no tokens. Dark navy with teal accent — sets the brand temperature. |
| **App** (`/dashboard`, `/trips/[id]/*`) | `src/app/*`, `src/components/*` | The actual product. Mobile-first. Uses `--color-bt-*` token system with built-in light & dark modes (dark is the current shipping default). |

The product covers six surfaces inside `/trips/[tripId]`:

- **Home** — trip overview, planning rows (Destination, Crew, Dates, Logistics)
- **Crew** — invite + RSVP, role management
- **Lodging** — properties, addresses, door codes (owner/planner only)
- **Agenda** — day-by-day itinerary
- **Receipts** — expenses + settle-up math
- **Competition** — teams, events, live scoreboard (the original golf-trip use case)

The "trip" object also passes through five lifecycle stages —
**IDEA → PLANNING → GOING → NOW → PAST** — and the UI changes substantially
per stage. A `SAVED` archive state lives parallel to those.

### The origin story (from the marketing page)

> Every year since 2021, the same crew of guys takes a golf trip called
> **BBMI** — Buddy, Bo, Mike, & the Irishman. Four teams, three days, a
> rotating cast of side games, a trophy that's lived on four different
> mantles. For five years we did it with group texts, a battered Excel
> sheet, and a paper scorecard that someone always left in the cart.

That's the whole tonal cue — write like the founder telling another
buddy about the app. Specific. Slightly profane in spirit if not in
letter. Never corporate.

---

## Index

| File | What it holds |
|---|---|
| **`README.md`** | This document. Read first. |
| **`SKILL.md`** | Agent-skill manifest for use under Claude Code or the design app. |
| **`colors_and_type.css`** | The full `--color-bt-*` token system + type stack. Drop this into a prototype with `<link rel="stylesheet">` to get the brand for free. |
| **`assets/`** | Brand mark (the golf-flag pennant), favicon, apple-touch icon. |
| **`preview/`** | Standalone HTML cards that populate the Design System tab. Open any one in a browser to see a single specimen at full size. |
| **`ui_kits/app/`** | High-fidelity recreation of the mobile app — index plus modular React components for nav, planning rows, vote cells, etc. |

---

## Content fundamentals

**Voice = founder texting another founder.** Specific, conversational,
slightly funny. The product talks like Zach (founder) talking about his
own golf trip. Never corporate, never breathless, never bullet-heavy.

**Specificity beats abstraction.** Marketing copy never says "your group
trip" — it says "Pinehurst No. 2", "Sep 12–15", "Team Banks", "5 crew,
$2,340 total." In-app strings follow suit: empty states reference what
the user would actually add ("Add a date option", "Add a Competition"),
not generic prompts.

**Address the user as *you* / *your crew*.** Never "users". Imperatives
are fine for buttons ("Lock dates", "Add date option"). First-person
("My Trips") shows up as a dashboard heading. Plurals are crew /
friends, never "members" outside the role badge.

**Tone examples (verbatim from the marketing page):**

- H1: "The trip planner your group chat actually needs"
- Section H2 (Plan together): "From 'where should we go?' to locked in"
- Section H2 (Compete): "Live scoring when it matters most"
- Body: "No more spreadsheet. No awkward follow-up texts three weeks
  later."
- Pull-quote: "Six years of group texts, spreadsheets, and lost
  scorecards. BuddyTrip is the tool we wished we'd had from year one."

**Casing.**
- **Sentence case** for everything user-facing — buttons, headings, dialog
  titles. "Lock dates", not "Lock Dates".
- **UPPERCASE + wide tracking** is reserved for status labels and tab
  labels. Status badges: `IDEA`, `PLANNING`, `GOING`, `NOW`, `PAST`.
  Section dividers on dashboard: `ACTIVE`, `IDEAS`, `PAST`. Always
  10–11px with `letter-spacing: 0.1em–0.12em`.
- Role badges use **Title case** ("Owner", "Planner"). The "Member"
  badge is intentionally omitted (returns `null`).

**Emoji.** Sparingly used. Trophy emoji (🥇🥈🥉) show up in the about-page
trophy-standings table. Otherwise **no emoji in the product UI** —
everything else is a lucide / tabler icon. Don't introduce new emoji.

**Unicode in copy.** A few intentional cases:
- `&rarr;` ("→") on CTAs: "Set dates →", "Polling crew →"
- En-dash `–` in date ranges: "Sep 12–15"
- Middle dot `·` as a metadata separator: "Pinehurst, NC · 4 courses"
- Mid-dot `·` placeholder for unvoted poll cells (not "—")

**Don'ts.**
- No "Welcome to BuddyTrip!". No exclamation points except on error
  toasts (and even there: rare).
- No marketing-AI tropes ("Seamlessly...", "Effortlessly...",
  "Powered by..."). The about section explicitly mocks this energy.
- No "let's" or "we'll" unless the founder is signing the line — the
  about section signs off `— Zach Grether, founder`.

---

## Add / edit form field standards

Consistent naming across every add/edit affordance — composer panels,
mobile modals, and desktop edit drawers all use the same labels:

| Concept | Label | Notes |
|---|---|---|
| The human-readable label of a thing (property, agenda item, receipt) | **Title** | Not "Name", not "What was it for?" |
| The label for a person | **Name** | Reserved for crew. In the crew edit drawer, "Name" + a read-only "Account name" pill when the email matches a BT user. |
| Money | **Cost** | Not "Total cost", not "Amount". Renders right-aligned in mono, with a leading `$`. |
| Numeric (count) | **Sleeps**, **Crew**, etc. | Right-aligned in mono. |
| Single-day timing | **Date** | Singular — never "Day". Examples: agenda item date, receipt date. |
| Multi-day range | **Check-in** + **Check-out** | Two separate fields. Used for properties. Never "Dates". |
| Time of day | **Time** | `(optional)` hint when applicable. Mono-typeset. |
| Free-form description | **Detail** | Multi-line. Always optional. |
| Web URL | **Link** | Mono-typeset. Hint `(opens externally)` on edit. |
| Location | **Location** | With a search icon. Always optional except where a venue is structural (golf course). |
| Notes | **Notes** | Multi-line. Always optional. |

**Alignment.** Money + numbers right-aligned, mono. Text fields, dates,
selects all left-aligned with the default sans stack.

## Visual foundations

### Colors

**Brand = teal on deep navy.** Teal is the *only* "highlight" color in
the product — anything teal-filled and interactive is the primary action.
Owner gets a warm amber (badge + warnings). Stage colors layer on top:
blue for planning/idea, orange for going/events, red for danger and
"can't" votes.

- **Surface stack (dark, the shipping default).** Four levels, from
  page-base out:
  `--color-bt-base #0a0e1a` (page) → `--color-bt-card #161e2f` (panel)
  → `--color-bt-card-raised #1f2a40` (input, zebra row) → `--color-bt-card-float #2a3654` (popover).
  Light-mode equivalents are spec'd in `colors_and_type.css` but the
  app ships dark-only.
- **Borders** are translucent `rgba(148,163,184,0.18)` on dark, a solid
  `#c8d0da` on light. Borders separate; **shadows raise**. Chrome
  elements (TopNav, BottomNav) use border-only, no shadow. Content cards
  use shadow.

> **2026 update — Lifted surfaces.** The dark-mode `bt-card` and
> `bt-card-raised` were bumped 5–8% lighter in March to give panels real
> elevation against the deep navy base. The old values (`#111827`,
> `#1a2130`) read mushy in stacked layouts. If you're recreating earlier
> screenshots that look slightly darker, that's why.

### Use of secondary colors

The teal accent is the brand, but it shouldn't carry every callout
alone. The supporting palette (`bt-owner` amber, `bt-ready` orange,
`bt-planning` blue) is meant to be **actively used** for:

- **Owner badge** — amber, both border and a faint amber-tinted fill
- **Trip-stage colors on day strips** — Thu (arrival) amber → Fri/Sat
  (rounds) teal → Sun (departure) orange
- **Team-color highlights** — when a specific person's action is
  surfaced ("Ryan paid for X"), echo their team color
- **Side-games / 2× points** — amber, distinct from primary teal
- **Pre-trip countdowns** — amber, so the live "now" countdown can
  stay teal without ambiguity

Restraint matters — these are accents, not background tints. Don't
wash a whole card in amber just because it's a notes card. But teal
on teal on teal across the whole app is what makes the dark scheme
feel monochromatic. Vary intentionally.

### Type

- **System sans only.** `-apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, sans-serif`. No webfonts. This is intentional — the brand
  inherits the OS feel.
- **System mono** for the few numeric / code displays (door codes, WiFi
  passwords): `ui-monospace, SFMono-Regular, Menlo, Consolas`.
- **Scale leans small.** Body is 14px (`text-sm`). The dashboard's
  largest in-product display is the `$2,340` total expenses tile at
  28px. Marketing H1 goes up to `clamp(32px, 5.5vw, 56px)`.
- **Tracking.** Tight on hero H1 (`-0.02em`). Wide on logo wordmark
  (`0.06em`). Widest on uppercase labels (`0.1–0.12em`).

### Spacing & radii

- **Radii.** Four shapes only, used consistently:
  - `rounded-md` (6px) — compact inline edits
  - `rounded-lg / xl` (10–12px) — **default for buttons, cards, modals**
  - `rounded-2xl` (16px) — hero cards, the trip header
  - `rounded-full` (pill) — filter chips, icon-only circles, send
  - **No arbitrary `border-radius` values.**
- **Spacing rhythm.** Card padding is `p-4` (16px) inside trip cards,
  `p-5` (20px) on hero panels, `px-4 py-3` on nudge banners. Mobile
  gutters are `px-4`. Max dashboard width: `896px`.

### Backgrounds

- **Solid colors, never gradients in product UI.** The dashboard, trip
  list, panels — all flat surfaces against `--color-bt-base`.
- **The exception is the trip-header hero in dark mode**, which uses a
  *temporal gradient* — a hue derived from the trip start-date that
  drifts from cool (winter trips) to warm (summer trips). Even there
  the effect is subtle.
- **Marketing-page hero** uses a deeper drop-shadow card (`0 30px 60px
  -20px rgba(0,0,0,0.5)`) on the same flat navy — no gradient.
- **No textures, no patterns, no photography placeholders.** The one
  decorative motif is a **semi-transparent US-state silhouette** drawn
  behind the destination text on trip cards (when the destination is a
  recognized US state) — see `src/components/LocationHero.tsx` and
  `src/lib/locationUtils.ts` for the path data.

### Borders, shadows, transparency

- **Border tokens.** `--color-bt-border` for visible panel outlines and
  dividers. `--color-bt-subtle-border` is used as a **background fill**
  (zebra rows, inactive chips), not as a CSS border — do not unify them.
- **Three shadow tiers**:
  `--shadow-card` (default elevation),
  `--shadow-raised` (expanded panel, hovered trip card),
  `--shadow-floating` (tooltips, popovers).
  Dark-mode shadows are stronger (4× alpha) because they have to fight
  the dark page.
- **Backdrop blur** lives on the sticky chrome: TopNav and the marketing
  nav both use `backdrop-filter: blur(14px)` over a translucent base
  (`var(--color-bt-nav-bg)` = `rgba(10,14,26,0.85)` on dark).
  This is the only place blur is used.
- **Overlay/modal scrim** is a flat tint via `var(--color-bt-overlay)`
  (`rgba(0,0,0,0.7)` on dark). Never roll your own.

### Animation & states

- **Animations are subtle and short.** The one shared keyframe is a
  `fade-in` of `opacity + translateY(4px)` over 250ms ease-out. Used
  on dropdown menus, dialog content, panel reveals.
- **Hover.** `hover:opacity-90` on primary teal buttons. A subtle
  `--color-bt-hover` background tint (`rgba(0,0,0,0.04)` light /
  `rgba(255,255,255,0.06)` dark) on icon buttons and rows.
- **Press.** `active:scale-[0.98]` on tap targets. Trip cards use
  `motion-safe:active:scale-[0.985]` — slightly less, since they're large.
- **Disabled.** `opacity: 0.4`, never a color change. `cursor: not-allowed`.
- **Loading.** A spinner (`Loader2` from lucide, `animate-spin`) replaces
  the icon; the text stays put.
- **Pulse.** The "Live" badge in the competition surfaces uses a
  `1.4s ease-in-out infinite` opacity pulse on a small dot.

### Layout rules

- **Mobile-first.** Designs default to a 375–414px width target.
- **Sticky chrome.** TopNav (h-14, blurred) is always pinned. BottomNav
  pins to the bottom on small screens with `paddingBottom:
  env(safe-area-inset-bottom)` — must respect the iOS home indicator.
- **Fixed widths.** Dashboard content centers at `max-w-[896px]`;
  bottom-nav inner row at `max-w-2xl`.
- **No floating elements in product UI** (except modals / sheets).

---

## Iconography

**Two stroke-icon libraries, no emoji, no SVG illustrations.**

- **Primary: [lucide-react](https://lucide.dev)** (v0.577). Used for
  nearly everything: `MapPin`, `Calendar`, `Trophy`, `Users`, `Home`,
  `Hotel`, `DollarSign`, `Activity`, `Bell`, `Settings`, `Plus`,
  `ChevronDown`, `ChevronRight`, `Send`, `MessageCircle`, `UserCheck`,
  `UserPlus`, `ThumbsUp`, `FileText`, `Wifi`, etc.
- **Secondary: [@tabler/icons-react](https://tabler.io/icons)** (v3.44).
  Used selectively for the trip-switcher (`IconLayoutGrid`) and for the
  **user-pickable avatar icons** (`flag-2`, `trophy`, etc — see
  `src/lib/avatarIconComponents.ts`).
- **Both are stroke-style at ~1.5–1.75 stroke width.** Default sizes:
  `size={14}` inline, `size={16–20}` in buttons, `size={22}` in nav.
  Match these — don't mix with solid-fill icon sets.
- **The brand mark is a hand-drawn golf-flag pennant** — a single
  `<svg width="100" height="100">` path filled with the teal accent.
  Source: `assets/buddytrip-flag.svg`. Used at 18px in TopNav, 22px in
  the loading screen.
- **Emoji is restricted to medal characters** in the marketing
  about-section trophy standings (🥇🥈🥉 — and `—` for last place).
  Don't add emoji to the product UI.
- **Unicode glyphs as icons.** `→` (right arrow) on CTAs, `·` (middle
  dot) as separator and unvoted-cell placeholder, `÷` and `×` in
  the expense math, `?` for unknown crew status, `✓` / `~` / `✗` in the
  marketing date-poll demo (the production UI uses fills + borders
  instead).

If you need an icon that's not in lucide, prefer adding one from
tabler-icons over hand-rolling SVG.

---

## Known gaps & honest caveats

- **There is no real logo.** The "BuddyTrip" wordmark is the system
  font at `letter-spacing: 0.06em`, with the golf-flag SVG sitting next
  to it. The flag itself is a placeholder the founder calls a "weak
  icon" — open to replacement. See `assets/buddytrip-flag.svg`.
- **The marketing page lives in its own CSS world** — raw hex, no
  `--color-bt-*` tokens, no Tailwind. Don't try to unify them; this is
  intentional so marketing polish doesn't bleed into product screens.
- **Light mode is spec'd but not shipped.** Tokens exist; toggle code
  exists; but the product currently runs dark-only. The founder backed
  out of light mode mid-build.
- **No webfonts.** If you want a brand font, you need to introduce it.
  Recommend evaluating before doing — the OS-stack vibe is part of the
  current identity.
