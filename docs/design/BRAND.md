# Brand: Put Me Down For

*Consolidated 2026-11-16 from the branding conversation's docs (`claude/POSITIONING.md`,
`claude/PALETTE.md` rev 3, `claude/MARKETING_KIT.md`) and the canvas "CrewCup — brand & launch
kit", pages **PMDF · logo routes**, **PMDF · Infographics** and **PMDF · Social**. Replaces the
naming rounds (CrewCup, Halfpoint, Who's Counting, Big Board, domain-first) as the reference.
Those docs stay in the claude.ai project as history.*

## Name and line

- **Put Me Down For**, short form **PMDF**. A working name: no trademark search yet.
- **Line:** Same crew. Every game. Anywhere. (For ads aimed at strangers: Any crew. Any game. Anywhere.)
- **The device:** the name finishes itself. "Put me down for ___" with a handwritten answer on
  the line: anything · the rematch · the cup · a 4 · the trip · Saturday.
- **Address:** `putmedownfor.com` is on every marketing piece and is **not registered yet**.

## Logo (Route A, round 5)

- The blank is a **hand-drawn line in Pen**, and it is the **last character**: `PMDF ___` and
  `PUT ME DOWN FOR ___`, built the same way. Never an underline beneath the letters.
- **Icon:** PM over DF, the blank after the F.
- **Motion:** each letter opens into its word (P→PUT, M→ME, D→DOWN, F→FOR), pushing the blank along.
- **Filled in:** a handwritten answer sits on the blank, which grows to the answer's width.
- Lettering is Archivo condensed 800; the handwriting is Caveat Brush. Both are stand-ins for
  final artwork.

## Color

| Name | Value | Job |
|---|---|---|
| **Ink** | `#10121F` | Text, scores, the logo's letters; the Night ground |
| **Paper** | `#F4F3EE` | The Day ground; cards are white |
| **Pen** | `#2DD4BF` | The one brand color: every button and fill, always with Ink text (10:1) |
| **Pen on Paper** | `#0F766E` | Pen for thin lines and links on light grounds (never on Ink) |
| Live | `#D42B2E` Day · `#FF5247` Night | Always with its dot and the word Live |
| Won | `#E3B341` fill, Ink text | Gold only ever means won |

Neutrals, Day / Night: ground `#EDECE6` / `#10121F`, card `#FFFFFF` / `#1A1D2E`, raised
`#E3E1DA` / `#272B40`, line `#D5D2C9` / `#32374E`, quiet text `#4B4D5C` / `#A5AAC0`.

Teams and crews pick from eight: Red `#C8102E`, Orange `#F56A0B`, Yellow `#FFD21F`, Lime
`#84CC16` (replaces today's cyan), Green `#167F2F`, Blue `#2A62F0`, Purple `#8B3DFF`, Pink
`#F0509B`. Full contrast table and text-on-fill pairs: `claude/PALETTE.md`.

**Rules:** Pen is for the person (anything you write, tap or fill in), never a team, a score or a
status. A solid color is a team or a crew; chrome is Ink and Paper. Games get a pale tint of one
of the eight with an Ink glyph, never a new hue. A team may be red; Live is told apart by its dot
and word.

## Type and the look (Zach's rulings, 16 Nov 2026, in `claude/BRAND_HANDOFF.md`)

| Part | Status |
|---|---|
| Palette tokens | **Adopted** |
| Paper and Ink neutrals as the app's backgrounds | **Adopted now**, with the redesign (nobody is actively using the app, so no one is affected) |
| Archivo, and scores in tiles (gold for the winner) | **Adopted on the score surfaces** Phase 2 builds. Condensed caps for scores, headlines and labels only; names and body text stay regular width |
| Crests and the 32 custom glyphs | **Deferred. Keep lucide.** The marketing pieces show them; that is a known mismatch at launch |
| Light as the default theme | **Not ruled.** Both themes work today; dark is the default |

People keep today's avatar (the icon each person picks; Google photos as an option later).
`claude/BIG_BOARD_LOOK.md` is the source for tiles; where it says the brand has no hue, or that
today's app is dark-forced, `claude/PALETTE.md` and this doc override it.

## Copy rules

US spelling. "Won", never "takes". "Cancel", never "abandon". No real event names. Points are
"awarded", never "paid". Every score sheet says TOTAL. No golf-only or betting words in a
headline or the line. Money: "it tracks who owes whom; it never touches the money."

## What changes in the app (for the specs, not built)

- **One standing rule reverses:** "system fonts only" (Archivo for scores and headlines). lucide stays.
- **Neutrals map onto today's tokens:** `--color-bt-base` `#EDECE6` / `#10121F`, `-card` `#FFFFFF` /
  `#1A1D2E`, `-card-raised` `#E3E1DA` / `#272B40`, `-border` `#D5D2C9` / `#32374E`, `-text` Ink /
  Paper, `-text-dim` `#4B4D5C` / `#A5AAC0` (light / dark).
- `--color-bt-accent` splits into a fill token and a text token in light mode;
  `--color-bt-on-accent` becomes Ink.
- **Team colors take the deeper values** wherever a score sits on a team fill (white on today's
  green is about 2.3:1). Teams saved as cyan need a mapping; how team color is stored (name or hex)
  decides how.
- Archivo becomes the app's first web font: `font-display: swap` and a metric-matched fallback so
  scores don't jump.
- **The rename from BuddyTrip** (which is taken: an App Store "Buddytrip" and both domains):
  `name` Put Me Down For, `short_name` **PMDF** (never "Put Me Down"), the domain, icon files,
  the email sender (`BuddyTrip <noreply@bbmi.app>` today) and a redirect from `bbmi.app`
  (`DOMAIN_AND_EMAIL.md` section 4).

## Still open

- **Undecided in the new neutrals:** the float surface (dialogs, sheets) and dark-mode chrome have
  no value; white cards separate less on the new light ground (1.18:1), so borders may carry more;
  the status colors (warning, danger, planning, ready, owner, Glorious) weren't reviewed, and
  Danger red and Live red are now two reds with different jobs.
- **Logo files:** no SVG, PNG icon set or maskable icon exists; the logo is canvas sketches. With
  no outside designer, they are made from the sketches before the rename. Both fonts are SIL Open
  Font License.
- **Domains:** Zach buys them himself (`putmedownfor.com`, `putmedownfor.app`; `pmdf.app` for
  short links). Nothing with the address on it is posted until then.
- Trademark search (none done for Put Me Down For), App Store / Play names, social handles.
- A say-it-aloud test; a device check in sunlight; a color-blindness check (Pen vs Green).
- **Don't re-propose:** the Board logo with the ME tile lit, a rectangle blank, a pencil or check
  mark, the line as an underline, a single in-between teal, near-black Ink, volt.
