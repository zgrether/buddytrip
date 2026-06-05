# Handoff: BuddyTrip — News (the Trip Board)

## Overview
**News** is the owner/organizer announcement channel inside a BuddyTrip trip.
The owner and organizers post updates — a welcome, the team draw, the
weekend schedule, recap videos, day-of logistics — and they land
front-and-center for the whole crew, newest first, with the option to pin one
to the top. It opens from a button in the trip's title bar, beside Chat.

This bundle is the deliverable for implementing News in the real app.

## About the design files
The files here are **design references created in HTML/React-via-Babel** —
prototypes that show the intended look and behavior. **They are not
production code to copy.** The HTML uses in-browser Babel and a small
exploration harness (a pannable "design canvas") that has nothing to do with
the product. Your job is to **recreate these designs in the BuddyTrip
codebase** using its existing stack and patterns (the prototype mirrors the
app's real `--color-bt-*` token system and component conventions, so it
should map cleanly). If a detail isn't covered here, prefer the codebase's
established pattern over inventing a new one.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, and interaction
states. Recreate the UI faithfully using the codebase's existing components
and the `--color-bt-*` tokens (already in the app's `globals.css`). The exact
token values are also in `source/colors_and_type.css` and listed below.

## How to view the reference
Open **`news-design-reference.html`** in a browser (self-contained, works
offline). It's a pannable canvas — scroll/drag to the **"Pinned News —
finished (+ composer)"** section. Every artboard there is a state you need to
build. The **`SPEC-news.md`** file is the authoritative written spec; this
README expands it into implementation detail. Source components are in
`source/` — `explorations-pinned.jsx` is the primary reference (block
renderer, panels, composer, sample data).

---

## The core model

A **post** is an ordered **stack of blocks**. There are exactly **six** block
types — the set is **closed**. Do not add poll/table/quote/divider/heading/
free-color blocks; if something seems unmet it maps to one of these six.

| Block | Purpose | Key rules |
|---|---|---|
| **Text** | A paragraph | Inline `@Crew` mentions allowed. Emphasis is a **toolbar** (bold · italic · list · link · @) — **no typed markdown, no free text color.** |
| **@Crew** | A person reference: avatar + name pill | Works **inline inside Text** *and* as a **labeled row** ("Captains", "Pairing"). Autocompletes from the trip roster. |
| **Teams** | The competition draw — team cards | **Synced from the Competition feature**, never re-typed. In the composer it's a reference picker (e.g. "The draw · 4 teams" + Change), not editable rosters. |
| **Media** | A photo, or a pasted video link → card | `video` (play affordance + title + meta) or `photo`. |
| **Steps** | A numbered how-to | Rules, "how scoring works," logistics. Composer: `label` + `body` per step, "+ Add step". |
| **Callout** | One highlighted line (a "panel") | **Preset caution-amber. No color choice.** The single must-not-miss line. |

---

## News & Chat: separate panels, same behavior

News and Chat are **two separate panels** opened from **two separate
title-bar buttons**. They are NOT one shell with a toggle. They share
*behavior*:

- **Desktop** → a **docked right rail**: full height, pinned under the title
  bar, **no scrim** (the page behind stays visible and usable — it's a dock,
  not a modal). The left edge is a **drag handle to resize within a min/max**
  (340–680px, default ~400px). Persist the chosen width per user.
- **Mobile** → a **bottom sheet** with a grab handle; **drag up/down to
  resize** between snap points. A dim scrim behind is acceptable on mobile.

**News** = the posts feed. **Chat** = real-time messaging with sub-tabs
**Crew · Organizers · Bet** (Bet is the side-bet room). News has no sub-tabs;
Chat has no posts. Keep them distinct.

---

## Screens / views

### 1. News feed (the rail / sheet body)
- **Layout:** vertical list of post cards, 13px gap, 14px panel padding.
  Header row (44px tall): pin icon + "News" title (left); for owner/organizer
  a teal **"New post"** button + a resize icon + close ×; for members just
  resize + close.
- **Owner/organizer** also see a dashed **compose row** at the top of the
  feed: avatar + "Post an update to the crew…" + a teal "New post" affordance.
  Members never see it.
- **Order:** pinned posts first, then **reverse-chronological**.
- **Post card** (`.post`):
  - Header: 38px circular **CrewAvatar** (team color) · author name (15px/700,
    `--color-bt-text`) over role line (12px, role color — Owner =
    `--color-bt-owner`). Right side: the amber **`Pinned` tag (only if the
    post is pinned)**, a mono relative timestamp (`--color-bt-text-dim`), and
    a `⋯` button shown only to people who can manage it (owner, organizers,
    **and the post's own author**).
  - Body: the block stack, 12px gap between blocks.

### 2. Block catalog
A reference artboard listing all six blocks with a live demo of each. Use it
to match each block's exact rendering. Not a product screen — a spec aid.

### 3. Composer — new post (`ComposerCard mode="add"`)
- Opens in the same rail/sheet surface.
- **Body = a vertical stack of block editors.** Each editor (`.cmp-blk`,
  `--color-bt-card-raised` on `--color-bt-border`, `--radius-lg`, padding
  `10px 34px 12px 30px`) has:
  - a **drag handle** (grip icon, left) to reorder,
  - a **remove ×** (top-right; hover turns `--color-bt-danger`),
  - an uppercase **kind label** (9.5px/700, accent icon),
  - the block's inputs.
- **Text editor:** a 6-button toolbar — **bold · italic · | · list · link · |
  · @** (each 28×28, `--radius-sm`, bordered) — above a textarea. Placeholder:
  "Write something… type @ to tag the crew. Bold, italic, lists and links are
  buttons — no markdown." **No color control of any kind.**
- **Steps editor:** numbered rows, each a small accent number chip + a label
  input + a body input; "+ Add step" below.
- **Teams editor:** a read-only reference row (trophy icon + "The draw · N
  teams" + a "Change" link). Rosters stay synced to Competition.
- **"Add a block" row:** the six block buttons (`.cmp-addbtn`, dashed border →
  accent fill on hover).
- **Footer:** left = a **"Pin to top"** toggle; right = `Cancel` (ghost) +
  **`Post`** (teal, `--color-bt-text` is `#0d1f1a` on the teal fill).

### 4. Composer — edit own post (`ComposerCard mode="edit"`)
- **The author can edit their own post** (⋯ → Edit); owner/organizers can edit
  any post. Same composer, **prefilled** with the existing blocks.
- Footer differs: left = a **Delete** action (`--color-bt-danger`, trash
  icon); right = `Cancel` + **`Save changes`**.

### 5. Composer — mobile (`ComposerSheetMobile`)
- Single column in the bottom sheet. The text toolbar sits above the field.
- The "Add a block" row becomes a **horizontal swipe scroller** of block
  chips. Large tap targets (≥44px). Full-width Post in the footer.

### 6. Docked-in-context
- Shows the rail docked over a live trip Home with **no scrim** and the
  resize grip on its left edge — confirming the page stays usable behind it.

### 7. Chat (sibling panel)
- Same panel chrome; header carries sub-tabs **Crew · Organizers · Bet**
  (the active tab uses `--color-bt-planning` on `--color-bt-blue-bg`).
- Message rows: others = `--color-bt-card-raised` bubble with a 26px avatar +
  name; me = `--color-bt-accent` bubble, right-aligned. Persistent
  "Say something…" input + circular send button in a footer (footer exists in
  Chat only, never in News).

### 8. Empty states
- **Owner:** centered 56px accent pin tile, "Nothing posted yet", "Post the
  first update — a welcome, the team draw, the schedule. It lands here for the
  whole crew, newest first." (Compose row still sits above.)
- **Member:** same layout, **dim** pin, "When the owner or an organizer posts
  an update, it shows up here. Nothing to do but wait." No compose affordance.

---

## Interactions & behavior
- Title-bar **News** and **Chat** buttons each open their own panel. News
  button carries an unread-count badge (teal, mono) when there are unread
  posts; no badge at zero.
- **Pin = stick to top.** Pinning sorts a post above unpinned ones and is the
  only thing that shows the `Pinned` tag. Multiple pins allowed. Set via the
  composer "Pin to top" toggle or ⋯ → Pin.
- **Edit:** ⋯ → Edit opens the prefilled composer. Author edits own; owner/
  organizers edit any. Edit footer offers Save + Delete.
- **Compose:** add blocks from the "Add a block" row; reorder by dragging the
  grip; remove via the block's ×. Post is enabled once there's content.
- **Resize:** desktop drag the rail's left edge (clamp 340–680px, persist);
  mobile drag the sheet handle between snaps.
- **Permissions (server-enforced, not just UI):** only owner + organizers can
  create posts; only owner/organizers/author can edit or delete a given post;
  members are read-only.
- **`@` autocomplete** pulls live from the trip roster; **Teams** reads from
  the Competition feature.
- Panels render at natural content height with the list scrolling — no fixed
  inner frames that clip content.

## State management
- `posts: Post[]` where `Post = { id, authorId, role, createdAt, pinned,
  blocks: Block[] }` and `Block` is a discriminated union over the six types
  (`text` carries rich segments incl. mention refs; `crew` a label + member
  ids; `teams` a competition draw ref; `media` kind+src/meta; `steps` an
  array of {label, body}; `callout` a string).
- Composer holds a draft `Block[]` + `pinned` flag; supports add/reorder/
  remove/edit of blocks; resolves on Post/Save.
- Panel UI: `open` (which panel), `railWidth` (persisted), Chat `activeRoom`.
- Derived feed order: pinned-first, then `createdAt` desc.

## Design tokens (dark theme — the shipping default)
Reference the app's `--color-bt-*` vars; **never hardcode hex.** Values for
reference (dark):

**Surfaces** — base `#0a0e1a` · card `#161e2f` · card-raised `#1f2a40` ·
card-float `#2a3654` · border `rgba(148,163,184,.18)` · subtle-border
`rgba(148,163,184,.08)` · hover `rgba(255,255,255,.06)` · overlay
`rgba(0,0,0,.7)`.
**Text** — text `#f1f5f9` · text-dim `#94a3b8`.
**Accent (teal/brand)** — accent `#2dd4bf` · accent-faint
`rgba(45,212,191,.12)` · accent-border `rgba(45,212,191,.25)` · on-accent text
`#0d1f1a`.
**Status** — planning/blue `#60a5fa` (bg `#1e3a5f`) · owner/warning amber
`#fbbf24` (faint `rgba(251,191,36,.08)`, border `rgba(251,191,36,.20)`) ·
danger `#f87171`.
**Team identity** (outside the system, per-team) — blue `#3b82f6` · green
`#22c55e` · purple `#a855f7` · cyan `#06b6d4` · orange `#f97316`.
**Radii** — sm 6 · md 10 · **lg 12 (default cards/buttons)** · xl 16 · pill
9999.
**Shadows (dark)** — card `0 1px 3px rgba(0,0,0,.3)…` · floating
`0 8px 24px rgba(0,0,0,.5)…`.
**Type** — system stack (`-apple-system, "Segoe UI", Roboto…`); no webfonts.
h3 `600 16px/1.25` · body `400 14px/1.5` · body-sm `400 13px/1.45` · micro
`500 11px/1.3` · label `600 10px/1.2` uppercase. Mono: `ui-monospace,
SFMono-Regular, Menlo…` for timestamps, counts, emails.

Light-theme parity values are in `source/colors_and_type.css`, but the app
ships dark-only today — build dark first.

## Assets
- **Icons:** lucide-style, 1.75 stroke, drawn inline in the prototype
  (`source/explorations-atoms.jsx`). Use the codebase's existing icon set
  (lucide-react or equivalent) — match by name: `pin`, `pencil`, `message-
  circle`, `users`, `trophy`, `image`, `list-ordered`, `type`, `at-sign`,
  `bold`, `italic`, `link`, `grip-vertical`, `dice`, `more-horizontal`,
  `play`, `x`, `maximize2`, `send`, `trash`.
- **No images/photos** ship in the design — Media blocks use placeholders;
  real content is user-supplied at runtime.
- **No webfonts** — system stack by design.

## Files in this bundle
- `news-design-reference.html` — self-contained, openable visual reference
  (the whole exploration canvas; go to the "Pinned News" section).
- `SPEC-news.md` — the authoritative written spec.
- `source/explorations-pinned.jsx` — **primary reference**: block renderer
  (`NB`), `NewsPanelCard`, `ChatPanelCard`, `ComposerCard`,
  `ComposerSheetMobile`, `NewsDockedContext`, `NewsBlockCatalog`, and the
  `SAMPLE_POST` / `SECOND_POST` sample data.
- `source/explorations-board.jsx` — original block CSS (`.post`, `.blk-*`) and
  the title-bar News button (`BtTopBar`).
- `source/explorations-screens.jsx`, `source/explorations-shell.jsx` — the app
  chrome the panels dock into (`CrewAvatar`, `BtTripHeader`, `BtTabBar`,
  `QuickInfoTiles`, container-query shell).
- `source/explorations-atoms.jsx` — inline icon set + small helpers.
- `source/colors_and_type.css` — the full token source of truth.
