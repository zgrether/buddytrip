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

## Type and the look (as drawn in the marketing pieces)

- **Archivo**, one variable family: condensed caps (62% width, 800) for names, scores and
  headlines; 78% width 700 caps with tracking for labels; regular width for anything longer than a
  few words.
- **Scores sit in tiles.** The winner's total is a gold tile; others are raised neutral tiles.
- **People are roundels:** an initial in a ring of their team or crew color.
- **Game types are tokens:** a solid glyph on a pale tile.
- **Both themes:** Day (Paper) and Night (Ink). The app already supports both.
- This is the "Big Board" direction (`claude/BIG_BOARD_LOOK.md`) recolored to PMDF. Where that doc
  says the brand has no hue, or that today's app is dark-forced, PALETTE.md overrides it.

## Copy rules

US spelling. "Won", never "takes". "Cancel", never "abandon". No real event names. Points are
"awarded", never "paid". Every score sheet says TOTAL. No golf-only or betting words in a
headline or the line. Money: "it tracks who owes whom; it never touches the money."

## What changes in the app (for the specs, not built)

- `STYLE_GUIDE.md` and `CLAUDE.md` standing rules this reverses: system fonts only; lucide/tabler
  icons only; the current surface colors (light `#d8e0e8`, dark `#0a0e1a`).
- `--color-bt-accent` splits into a fill token and a text token in light mode;
  `--color-bt-on-accent` becomes Ink.
- Teams saved as cyan need a mapping before the swatch is removed.
- Archivo becomes the app's first web font: `font-display: swap` and a metric-matched fallback so
  scores don't jump.
- The rename from BuddyTrip: domain, the home-screen name and icon, the email sender
  (`DOMAIN_AND_EMAIL.md`), and `bbmi.app` redirecting to the new address.

## Still open

- Trademark search, App Store / Play names, social handles.
- Registering `putmedownfor.com` (and `.app`).
- Final logo artwork and final fonts.
- A device check in real sunlight and a color-blindness check (Pen vs Green is the weakest pair).
