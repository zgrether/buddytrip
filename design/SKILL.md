---
name: buddytrip-design
description: Use this skill to generate well-branded interfaces and assets for BuddyTrip, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping a mobile-first dark group-trip planning + competition scoring app.
user-invocable: true
---

# BuddyTrip design skill

BuddyTrip is a mobile-first group trip planning + competition scoring
app. Deep navy + teal accent, system type, lucide stroke icons, no
webfonts, no gradients in product UI (except the trip-header hero in
dark mode).

## Where to read

Start with **`README.md`** — it covers product context, voice & tone,
visual foundations, iconography, and known caveats. Then dip into the
specific files you need:

- **`colors_and_type.css`** — drop-in stylesheet exposing the full
  `--color-bt-*` token system and type stack. Reference these variables
  in any HTML artifact instead of hardcoding hex values.
- **`assets/`** — the brand mark (golf-flag pennant SVG) and favicons.
- **`preview/`** — standalone HTML cards for individual specimens
  (buttons, badges, type scale, nudge banners, planning row, trip card,
  vote grid, etc). Open any one to see the canonical treatment.
- **`ui_kits/app/`** — React component recreations of the mobile app's
  core screens. Use `atoms.jsx` for buttons / badges / avatars /
  nudges, `chrome.jsx` for TopNav and BottomNav, `screens.jsx` for full
  Dashboard / Trip Home / Date Poll / Scoreboard screens. Load via the
  React+Babel pattern in `ui_kits/app/index.html`.

## How to use

If you're creating a visual artifact (mock, deck, throwaway prototype):

1. Copy `colors_and_type.css` and `assets/buddytrip-flag.svg` into your
   working folder.
2. Add `<html class="dark">` and link `colors_and_type.css` — that
   gives you the dark navy + teal background and full token set.
3. For React prototypes, copy `ui_kits/app/atoms.jsx` and reuse the
   `BTButton`, `BTStatusBadge`, `BTNudge`, `BTPlanningRow` etc.
   components. They handle the variant styling correctly.
4. Use only the radii / shadows / colors defined in
   `colors_and_type.css`. Do not invent new ones.

If you're working on production code (the actual BuddyTrip repo):

1. The repo's `STYLE_GUIDE.md` is the authoritative reference — this
   skill mirrors it but won't always be in lockstep.
2. Use `var(--color-bt-*)` tokens, not raw hex. The audit-checklist
   section of the style guide lists every hardcoded value that should
   be migrated.
3. Stick to the five button variants and four border radii. Don't
   create new ones without updating the style guide first.

## When invoked without context

If the user invokes this skill without telling you what they want:

1. Ask whether they want **a marketing artifact** (dark navy hero,
   feature blocks, raw-CSS treatment with hex) or **an in-app surface**
   (mobile-first, token-driven, lucide icons).
2. Ask whether the work is a **throwaway mock** or **production code**
   — that determines whether you copy assets out or just reference them.
3. Ask whether they want **dark mode** (default, currently shipping) or
   **light mode** (spec'd in tokens but not in production).
4. Ask which surface they're building — Dashboard, Trip Home, Date
   Poll, Crew, Lodging, Agenda, Receipts, Competition, or a new screen
   that doesn't yet exist.

Then act as an expert designer who outputs HTML artifacts or production
code, depending on the need.

## Non-negotiables (the things the founder cares about)

- **Dark navy + teal.** `--color-bt-base: #0a0e1a`, accent `#2dd4bf`.
- **No webfonts.** System-sans + system-mono.
- **No emoji in the product UI.** Lucide stroke icons only. The only
  exception is medal characters (🥇🥈🥉) in marketing trophy tables.
- **No gradients in product cards** except the trip-header hero.
- **No nested cards-on-cards-on-cards.** The founder is sensitive to
  this. Three surface levels max in any view (base → card → raised).
- **Voice = founder talking to a buddy.** Specific, not corporate. No
  "Welcome to BuddyTrip!", no "seamlessly", no "powered by".
