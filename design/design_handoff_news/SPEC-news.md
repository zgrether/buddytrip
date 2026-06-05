# Handoff — News (the Trip Board, finished) + composer

> Spec for **News** — owner/organizer posts pinned front-and-center for the
> crew. Formerly "Trip Board." Reference artboards: `explorations-2.html` →
> "Pinned News — finished (+ composer)" (`explorations-pinned.jsx`).
> Token-first, no hardcoded hex. **Build exactly this. The block set is closed.**

---

## 0. News and Chat are SEPARATE panels that BEHAVE the same

They are **not** one shell with a toggle. Each opens from its own title-bar
button. They share *behavior*, not markup:

- **Desktop:** a **docked right rail**, full height, pinned under the title
  bar, **no scrim** (the page stays usable — it's a dock, not a modal).
  Drag the left edge to **resize within min/max** (`340–680px`, default
  `~400px`); persist width per user.
- **Mobile:** a **bottom sheet** with a grab handle; drag up/down to resize
  between snaps. Scrim behind is fine on mobile.

**News** = the posts feed (this doc). **Chat** = real-time rooms, with
sub-tabs **Crew · Organizers · Bet** (Bet is the side-action room; cap
sub-tabs at ~3–4). Don't merge them.

---

## 1. PIN = stick to top (not "everything is pinned")

Most posts are **chronological, newest first**. Pinning a post **sticks it
to the top** of the feed, and that post is the **only** one that shows the
amber **`Pinned`** tag. Owner/organizers set it (composer footer "Pin to
top", or ⋯ → Pin). More than one pinned post is allowed; pinned sort above
unpinned. Don't show the tag on ordinary posts.

---

## 2. A post = a stack of SIX blocks. No more, no less.

No markdown. The author stacks blocks; emphasis is a **toolbar**, never typed
syntax, and there is **no free text color** (brand discipline). The six:

| Block | For | Notes |
|---|---|---|
| **Text** | A paragraph | Inline **@Crew** mentions. Toolbar: **bold · italic · list · link · @**. No color picker. `.blk-p`. |
| **@Crew** | A person — avatar + name pill | Inline in Text *and* as a labeled row ("Captains", "Pairing"). Autocomplete on `@` from the trip roster. `.blk-crew`. |
| **Teams** | The draw — team cards | **Synced from Competition**, never retyped. In the composer it's a reference ("The draw · 4 teams") with a "Change", not editable rosters. |
| **Media** | Photo, or paste a video link → card | `video` (play + title + meta) or `photo`. |
| **Steps** | Numbered how-to | Rules, scoring, logistics. Composer: label + body per step, "+ Add step". |
| **Callout** | One highlighted line = a "panel" | **Preset caution-amber, no color choice.** The must-not-miss line. |

> ⚠️ **For Claude Code:** these six are the complete set. Do **not** add
> poll / table / quote / divider / heading / free-color blocks. If a use case
> seems unmet, stop and ask — it maps to one of the six.

> 📝 **Post-handoff decision (PR4):** a **Heading** block (a plain title line,
> `{ type: "heading", text }`) was added as a 7th type at the product owner's
> request — long posts needed section titles, which none of the six covered.
> The "stop and ask" rule was followed; this is the agreed exception, not a
> silent expansion. The rest of the closed set still holds: no poll / table /
> quote / divider / free-color. Also: **lists** in the Text toolbar are
> deferred to a later pass — the Text editor ships **bold · italic · link · @**
> for now (the Steps block already covers numbered lists).

Block render CSS: `.post`, `.blk-p`, `.blk-teams/.team-card`, `.blk-video`,
`.blk-steps/.step`, `.blk-callout` are in `explorations-board.jsx`;
`.blk-crew`, `.blk-crewrow`, `.blk-photo` in `explorations-pinned.jsx`.

---

## 3. The composer (add + edit) — `ComposerCard`

Opens in the same rail/sheet. **The author can edit their own post** (⋯ →
Edit) → this same composer, prefilled. Owner/organizers can edit any post.

**Body = a vertical stack of block editors.** Each editor (`.cmp-blk`):
a **drag handle** (left, reorder), a **remove ×** (right), an uppercase
**kind label**, and the block's inputs:

- **Text** → a `bold · italic · list · link · @` toolbar over a textarea.
  Placeholder: "Write something… type @ to tag the crew." No color control.
- **@Crew** → chip input, `@` autocompletes the roster.
- **Teams** → a read-only reference row ("The draw · 4 teams" + "Change") —
  rosters stay in sync with Competition; not retyped here.
- **Media** → "Paste a link or upload" + thumbnail.
- **Steps** → numbered `label` + `body` rows + "+ Add step".
- **Callout** → a single line in the amber panel (preset; no color).

Below the stack: an **"Add a block"** row of the six block buttons
(`.cmp-addbtn`, dashed → accent on hover).

**Footer:** left = "Pin to top" toggle (add) / "Delete" danger (edit);
right = `Cancel` + `Post` / `Save changes`.

**Mobile composer** (`ComposerSheetMobile`): single column; the add-block
row becomes a **horizontal swipe scroller** of block chips; the text toolbar
sits above the field; big tap targets; full-width Post in the footer.

---

## 4. The canonical sample post (build the rhythm to this)

`SAMPLE_POST` — a pinned Brad "Year 19" welcome that exercises **every
block** in believable order: Callout → Text → Text+inline @Crew → @Crew row
(Captains) → Text → Teams → Steps → Media(video) → Text(dim). A second,
**unpinned** post (`SECOND_POST`: text + photo) shows the chronological,
no-badge default. 12px gap between blocks.

Post chrome (`.post`): `CrewAvatar` + author + role line (Owner =
`var(--color-bt-owner)`), the `Pinned` tag **only if pinned**, mono time, and
a `⋯` manage button for owner/organizers **and the author of that post**.

---

## 5. States

- **Owner/organizer** — "New post" button in the header + dashed compose row;
  ⋯ on posts they can manage.
- **Member** — read-only: no New post, no compose row, no ⋯.
- **Empty (owner)** — 56px accent pin tile, "Nothing posted yet", "Post the
  first update…".
- **Empty (member)** — same layout, dim pin, "When the owner or an organizer
  posts an update, it shows up here."

---

## 6. Acceptance

- [ ] News and Chat are **separate** panels; same dock/sheet behavior, no
      shared toggle.
- [ ] Chat has Crew · Organizers · Bet rooms; News does not.
- [ ] Desktop = docked rail, **no scrim**, drag-resize 340–680px, persisted.
- [ ] Mobile = draggable bottom sheet.
- [ ] Exactly **six** block types; @Crew works inline + as a row from the
      roster; Teams reads from Competition; **no free text color**.
- [ ] Composer stacks/reorders/removes blocks; **author can edit own post**;
      mobile composer is single-column with a swipe add-row.
- [ ] **Pin = stick to top**; `Pinned` tag shows on pinned posts only.
- [ ] No hardcoded hex — all `var(--color-bt-*)`.

---

## 7. Where to look

- `explorations-2.html` → "Pinned News — finished (+ composer)" — catalog,
  full feed, composer (add/edit/mobile), docked-in-context, Chat rooms,
  empty states, mobile sheet.
- `explorations-pinned.jsx` → `NewsPanelCard`, `ChatPanelCard`,
  `ComposerCard`, `ComposerSheetMobile`, `NewsDockedContext`, `NB`,
  `SAMPLE_POST` / `SECOND_POST`, `NewsBlockCatalog`.
- `explorations-board.jsx` → original block CSS + `BtTopBar` (title-bar News
  button). `README.md` → founder voice + secondary-color rules.
