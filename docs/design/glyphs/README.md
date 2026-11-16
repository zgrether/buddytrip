# Game glyphs

Ten drawn glyphs, one per game type, adopted 16 Nov 2026 (`docs/design/BRAND.md`). Each is one path on a
24 x 24 grid, `fill="currentColor"`, `fill-rule="evenodd"`: no font, no library, no mask.

| File | Game type id | Tile tint (category) |
|---|---|---|
| `stroke-play.svg` | `gtt_stroke_play` | golf, green |
| `scramble.svg` | `gtt_scramble` | golf, green |
| `skins.svg` | `gtt_skins` | golf, green |
| `match-play.svg` | `gtt_match_play` | golf, green |
| `rack-n-stack.svg` | `gtt_rack_n_stack` | golf, green |
| `card-game.svg` | `gtt_generic_card` | cards, red |
| `yard-game.svg` | `gtt_generic_yard` | yard, orange |
| `bar-game.svg` | `gtt_generic_bar` | bar, yellow |
| `pickem.svg` | `gtt_pickem` | pick'em, purple |
| `any-game.svg` | `gtt_manual` | any game, blue |

Rules: always Ink on a pale tint of one of the eight team colors; games only (the tab bar and utility
icons stay lucide); an unknown game type falls back to `any-game.svg`; the tile is grey until scoring is
on and full tint after. Category tabs: Golf shows stroke play, Other shows the dice.

The stage table and build notes (an exhaustive `Record` keyed by game type id; the five places that pick
a game icon today) are in the claude.ai project as `claude/GAME_GLYPHS.md`. Not wired into the app yet;
it folds into Phase 2 and `BRAND_TOKENS.md`.
